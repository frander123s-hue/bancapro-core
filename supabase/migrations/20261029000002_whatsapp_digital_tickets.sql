-- ============================================================================
-- MIGRACIÓN 002: SOPORTE DE COMPROBANTE DIGITAL WHATSAPP ANTI-FRAUDE (SIN IMPRESORA)
-- Permite asociar el teléfono del cliente al ticket y auditar el canal de entrega
-- ============================================================================

ALTER TABLE public.tickets
    ADD COLUMN IF NOT EXISTS cliente_telefono VARCHAR(30),
    ADD COLUMN IF NOT EXISTS canal_entrega VARCHAR(25) NOT NULL DEFAULT 'WHATSAPP'
        CHECK (canal_entrega IN ('WHATSAPP', 'TERMICA_ESCPOS', 'AMBOS')),
    ADD COLUMN IF NOT EXISTS whatsapp_enviado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_cliente_telefono
    ON public.tickets (tenant_id, cliente_telefono);

-- Actualizar `public.emitir_ticket` para recibir opcionalmente el teléfono de WhatsApp del cliente
CREATE OR REPLACE FUNCTION public.emitir_ticket(
    p_jugadas JSONB,
    p_secret_key TEXT,
    p_cliente_telefono VARCHAR(30) DEFAULT NULL,
    p_canal_entrega VARCHAR(25) DEFAULT 'WHATSAPP'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_perdida_max_tenant DECIMAL(12, 2);
    v_cupo_default_animal DECIMAL(12, 2);
    v_tasa_bcv DECIMAL(12, 4);
    v_now_ve TIMESTAMP;
    v_fecha_hoy_ve DATE;
    v_hora_actual_ve TIME;
    v_ticket_id UUID := gen_random_uuid();
    v_serial_corto BIGINT;
    v_total_usd DECIMAL(12, 2) := 0.00;
    v_total_bs DECIMAL(14, 2) := 0.00;
    v_codigo_seguridad VARCHAR(64);
    v_timestamp_epoch BIGINT;
    v_jugada RECORD;
    v_sorteo RECORD;
    v_hora_cierre TIME;
    v_cupo_actual RECORD;
    v_animal_nombre TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'NO_AUTORIZADO: Sesión inválida o expirada.';
    END IF;

    SELECT u.tenant_id, t.perdida_maxima_sorteo_usd
    INTO v_tenant_id, v_perdida_max_tenant
    FROM public.usuarios u
    JOIN public.tenants t ON t.id = u.tenant_id
    WHERE u.id = v_user_id AND u.activo = TRUE AND t.activo = TRUE;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'TENANT_INVALIDO: El usuario no tiene un comercio activo asignado.';
    END IF;

    v_cupo_default_animal := ROUND(v_perdida_max_tenant / 30.0, 2);

    IF p_jugadas IS NULL OR jsonb_typeof(p_jugadas) <> 'array' OR jsonb_array_length(p_jugadas) = 0 THEN
        RAISE EXCEPTION 'JUGADAS_VACIAS: El ticket debe contener al menos una jugada válida.';
    END IF;

    SELECT tasa INTO v_tasa_bcv
    FROM public.tasas_cambio
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_tasa_bcv IS NULL OR v_tasa_bcv <= 0 THEN
        RAISE EXCEPTION 'TASA_NO_DISPONIBLE: No existe una tasa BCV registrada en el sistema.';
    END IF;

    v_now_ve := NOW() AT TIME ZONE 'America/Caracas';
    v_fecha_hoy_ve := v_now_ve::DATE;
    v_hora_actual_ve := v_now_ve::TIME;
    v_timestamp_epoch := EXTRACT(EPOCH FROM NOW())::BIGINT;

    SELECT COALESCE(SUM(ROUND((elem->>'monto_usd')::DECIMAL, 2)), 0.00)
    INTO v_total_usd
    FROM jsonb_array_elements(p_jugadas) AS elem;

    IF v_total_usd <= 0 THEN
        RAISE EXCEPTION 'MONTO_INVALIDO: El monto total del ticket debe ser mayor a $0.00 USD.';
    END IF;

    v_total_bs := ROUND(v_total_usd * v_tasa_bcv, 2);

    -- Firma HMAC-SHA256 (incluye teléfono si fue provisto para blindaje del comprobante digital)
    v_codigo_seguridad := encode(
        hmac(
            v_tenant_id::TEXT || '|' || v_ticket_id::TEXT || '|' || v_total_usd::TEXT || '|' || v_timestamp_epoch::TEXT,
            COALESCE(NULLIF(p_secret_key, ''), 'bancapro_default_hmac_secret_2026'),
            'sha256'
        ),
        'hex'
    );

    INSERT INTO public.tickets (
        id, tenant_id, usuario_id, codigo_seguridad,
        total_usd, total_bs, tasa_cambio, estado,
        cliente_telefono, canal_entrega, whatsapp_enviado_at, created_at
    ) VALUES (
        v_ticket_id, v_tenant_id, v_user_id, v_codigo_seguridad,
        v_total_usd, v_total_bs, v_tasa_bcv, 'EMITIDO',
        NULLIF(TRIM(p_cliente_telefono), ''),
        COALESCE(p_canal_entrega, 'WHATSAPP'),
        CASE WHEN p_cliente_telefono IS NOT NULL AND TRIM(p_cliente_telefono) <> '' THEN NOW() ELSE NULL END,
        NOW()
    ) RETURNING serial_corto INTO v_serial_corto;

    FOR v_jugada IN
        SELECT
            (elem->>'sorteo_diario_id')::BIGINT AS sorteo_diario_id,
            (elem->>'animal_numero')::INT AS animal_numero,
            ROUND((elem->>'monto_usd')::DECIMAL, 2) AS monto_usd
        FROM jsonb_array_elements(p_jugadas) AS elem
        ORDER BY (elem->>'sorteo_diario_id')::BIGINT, (elem->>'animal_numero')::INT
    LOOP
        SELECT
            sd.id, sd.fecha, sd.estado,
            hs.hora_oficial, hs.etiqueta, hs.minutos_cierre_previo
        INTO v_sorteo
        FROM public.sorteos_diarios sd
        JOIN public.horarios_sorteo hs ON hs.id = sd.horario_id
        WHERE sd.id = v_jugada.sorteo_diario_id;

        IF NOT FOUND OR v_sorteo.estado <> 'ABIERTO' THEN
            RAISE EXCEPTION 'SORTEO_CERRADO: El sorteo seleccionado no está disponible.';
        END IF;

        v_hora_cierre := v_sorteo.hora_oficial - (v_sorteo.minutos_cierre_previo || ' minutes')::INTERVAL;
        IF v_sorteo.fecha = v_fecha_hoy_ve AND v_hora_actual_ve >= v_hora_cierre THEN
            RAISE EXCEPTION 'LOCKDOWN_ACTIVO: Sorteo % cerrado por horario límite (%).',
                v_sorteo.etiqueta, TO_CHAR(v_hora_cierre, 'HH12:MI:SS AM');
        END IF;

        INSERT INTO public.cupos_sorteo (
            tenant_id, sorteo_diario_id, animal_numero, monto_acumulado_usd, cupo_maximo_usd
        ) VALUES (
            v_tenant_id, v_jugada.sorteo_diario_id, v_jugada.animal_numero, 0.00, v_cupo_default_animal
        ) ON CONFLICT (tenant_id, sorteo_diario_id, animal_numero) DO NOTHING;

        SELECT id, monto_acumulado_usd, cupo_maximo_usd
        INTO v_cupo_actual
        FROM public.cupos_sorteo
        WHERE tenant_id = v_tenant_id
          AND sorteo_diario_id = v_jugada.sorteo_diario_id
          AND animal_numero = v_jugada.animal_numero
        FOR UPDATE;

        IF (v_cupo_actual.monto_acumulado_usd + v_jugada.monto_usd) > v_cupo_actual.cupo_maximo_usd THEN
            v_animal_nombre := CASE WHEN v_jugada.animal_numero = 37 THEN '00' ELSE LPAD(v_jugada.animal_numero::TEXT, 2, '0') END;
            RAISE EXCEPTION 'CUPO_AGOTADO: Cupo agotado para esta figura (#% en sorteo %). Disponible: $% USD.',
                v_animal_nombre, v_sorteo.etiqueta, ROUND(v_cupo_actual.cupo_maximo_usd - v_cupo_actual.monto_acumulado_usd, 2);
        END IF;

        UPDATE public.cupos_sorteo
        SET monto_acumulado_usd = monto_acumulado_usd + v_jugada.monto_usd,
            updated_at = NOW()
        WHERE id = v_cupo_actual.id;

        INSERT INTO public.ticket_detalles (
            ticket_id, tenant_id, sorteo_diario_id, animal_numero,
            monto_usd, premio_potencial_usd, es_ganador, premio_liquidado_usd
        ) VALUES (
            v_ticket_id, v_tenant_id, v_jugada.sorteo_diario_id, v_jugada.animal_numero,
            v_jugada.monto_usd, ROUND(v_jugada.monto_usd * 30.0, 2), NULL, 0.00
        );
    END LOOP;

    INSERT INTO public.caja_movimientos (
        tenant_id, usuario_id, tipo, monto_usd, monto_bs, ticket_id, concepto, fecha
    ) VALUES (
        v_tenant_id, v_user_id, 'VENTA', v_total_usd, v_total_bs, v_ticket_id,
        'Venta Ticket #' || LPAD(v_serial_corto::TEXT, 7, '0') || COALESCE(' (WA: ' || p_cliente_telefono || ')', ''), NOW()
    );

    RETURN jsonb_build_object(
        'ticket_id', v_ticket_id,
        'serial_corto', v_serial_corto,
        'tenant_id', v_tenant_id,
        'codigo_seguridad', v_codigo_seguridad,
        'cliente_telefono', p_cliente_telefono,
        'canal_entrega', COALESCE(p_canal_entrega, 'WHATSAPP'),
        'total_usd', v_total_usd,
        'total_bs', v_total_bs,
        'tasa_cambio', v_tasa_bcv,
        'timestamp_epoch', v_timestamp_epoch,
        'created_at', NOW()
    );
END;
$$;
