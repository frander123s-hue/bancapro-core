-- ============================================================================
-- MIGRACIÓN 005: BANCAPRO CORE HARDENING FIXES
-- 1. Elimina sobrecarga obsoleta de 2 argumentos de `emitir_ticket` (Fix PGRST202)
-- 2. Corrige `search_path` a `public, extensions` en `emitir_ticket` para resolver `hmac()` (Fix 42883)
-- 3. Corrige identificador no declarado `v_serial_corto` en `anular_ticket` (Línea 828)
-- 4. Asegura `liquidar_sorteo` con validación estricta de superadmin
-- 5. Añade Stored Procedures SECURITY DEFINER para Crons y Cobro por PIN:
--    - `public.actualizar_tasa_bcv(p_tasa NUMERIC, p_fecha DATE)` (Fix RLS 42501)
--    - `public.obtener_sorteos_cron(p_fecha DATE)` (Fix RLS anon en sorteos)
--    - `public.pagar_ticket_por_pin(p_pin TEXT)` (Soporte de cobro por PIN WhatsApp)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ELIMINAR SOBRECARGA OBSOLETA DE EMITIR_TICKET (2 ARGUMENTOS)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.emitir_ticket(JSONB, TEXT);

-- ----------------------------------------------------------------------------
-- 2. RECREAR `public.emitir_ticket` CON EXTENSIONS EN SEARCH_PATH
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_ticket(
    p_jugadas JSONB,
    p_secret_key TEXT,
    p_cliente_telefono VARCHAR(30) DEFAULT NULL,
    p_canal_entrega VARCHAR(25) DEFAULT 'WHATSAPP'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

    -- Fórmula matemática de riesgo: Cupo Máximo por Animal = Pérdida Aceptable Máxima / 30
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

    -- Firma criptográfica HMAC-SHA256 (pgcrypto en esquema extensions)
    v_codigo_seguridad := encode(
        extensions.hmac(
            v_tenant_id::TEXT || '|' || v_ticket_id::TEXT || '|' || v_total_usd::TEXT || '|' || v_timestamp_epoch::TEXT,
            COALESCE(NULLIF(p_secret_key, ''), 'bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210')::bytea,
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

        -- Bloqueo estricto a T - 3 minutos antes del sorteo
        v_hora_cierre := v_sorteo.hora_oficial - (v_sorteo.minutos_cierre_previo || ' minutes')::INTERVAL;
        IF v_sorteo.fecha = v_fecha_hoy_ve AND v_hora_actual_ve >= v_hora_cierre THEN
            RAISE EXCEPTION 'LOCKDOWN_ACTIVO: Sorteo % cerrado por horario límite (%).',
                v_sorteo.etiqueta, TO_CHAR(v_hora_cierre, 'HH12:MI:SS AM');
        END IF;

        -- Control atómico de cupo por figura y sorteo
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

GRANT EXECUTE ON FUNCTION public.emitir_ticket(JSONB, TEXT, VARCHAR, VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. CORREGIR `public.anular_ticket` (v_ticket.serial_corto)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anular_ticket(
    p_ticket_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_tenant_id UUID := public.get_my_tenant_id();
    v_ticket RECORD;
    v_segundos_transcurridos NUMERIC;
    v_now_ve TIMESTAMP := NOW() AT TIME ZONE 'America/Caracas';
    v_detalle RECORD;
    v_hora_cierre TIME;
BEGIN
    IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'NO_AUTORIZADO: Sesión inválida o expirada.';
    END IF;

    -- Bloqueo pesimista del ticket
    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE id = p_ticket_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKET_NO_ENCONTRADO: El ticket especificado no existe o pertenece a otro comercio.';
    END IF;

    IF v_ticket.estado = 'ANULADO' THEN
        RAISE EXCEPTION 'TICKET_YA_ANULADO: El ticket ya se encuentra anulado.';
    END IF;

    IF v_ticket.estado <> 'EMITIDO' THEN
        RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se pueden anular tickets en estado EMITIDO (estado actual: %).', v_ticket.estado;
    END IF;

    -- Regla de Negocio 1: Estricto límite de 60 segundos desde la emisión
    v_segundos_transcurridos := EXTRACT(EPOCH FROM (NOW() - v_ticket.created_at));
    IF v_segundos_transcurridos > 60 THEN
        RAISE EXCEPTION 'TIEMPO_ANULACION_EXPIRADO: Han transcurrido % segundos desde la emisión (máximo permitido: 60 segundos).',
            ROUND(v_segundos_transcurridos, 1);
    END IF;

    -- Regla de Negocio 2: Ningún sorteo del ticket puede estar dentro de los 3 minutos previos al cierre
    FOR v_detalle IN
        SELECT td.sorteo_diario_id, td.animal_numero, td.monto_usd, sd.fecha, hs.hora_oficial, hs.minutos_cierre_previo, hs.etiqueta
        FROM public.ticket_detalles td
        JOIN public.sorteos_diarios sd ON sd.id = td.sorteo_diario_id
        JOIN public.horarios_sorteo hs ON hs.id = sd.horario_id
        WHERE td.ticket_id = p_ticket_id
    LOOP
        v_hora_cierre := v_detalle.hora_oficial - (v_detalle.minutos_cierre_previo || ' minutes')::INTERVAL;
        IF v_detalle.fecha = v_now_ve::DATE AND v_now_ve::TIME >= v_hora_cierre THEN
            RAISE EXCEPTION 'LOCKDOWN_ANULACION: No se puede anular el ticket porque el sorteo % ha entrado en periodo de cierre definitivo.',
                v_detalle.etiqueta;
        END IF;

        -- Revertir el cupo acumulado
        UPDATE public.cupos_sorteo
        SET monto_acumulado_usd = GREATEST(0.00, monto_acumulado_usd - v_detalle.monto_usd),
            updated_at = NOW()
        WHERE tenant_id = v_tenant_id
          AND sorteo_diario_id = v_detalle.sorteo_diario_id
          AND animal_numero = v_detalle.animal_numero;
    END LOOP;

    -- Transicionar el estado del ticket
    UPDATE public.tickets
    SET estado = 'ANULADO',
        updated_at = NOW()
    WHERE id = p_ticket_id;

    -- Registrar el contra-asiento en caja
    INSERT INTO public.caja_movimientos (
        tenant_id, usuario_id, tipo, monto_usd, monto_bs, ticket_id, concepto, fecha
    ) VALUES (
        v_tenant_id, v_user_id, 'ANULACION',
        -v_ticket.total_usd, -v_ticket.total_bs,
        v_ticket.id,
        'Anulación Ticket #' || LPAD(v_ticket.serial_corto::TEXT, 7, '0'),
        NOW()
    );

    RETURN jsonb_build_object(
        'ticket_id', v_ticket.id,
        'serial_corto', v_ticket.serial_corto,
        'estado', 'ANULADO',
        'monto_reembolsado_usd', v_ticket.total_usd,
        'monto_reembolsado_bs', v_ticket.total_bs,
        'anulado_at', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.anular_ticket(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. ASEGURAR `public.liquidar_sorteo` CON REQUISITO DE SUPERADMIN
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liquidar_sorteo(
    p_sorteo_id BIGINT,
    p_animal_ganador INT,
    p_metodo VARCHAR(20) DEFAULT 'AUTO_CRON'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_sorteo RECORD;
    v_total_jugadas_ganadoras INT := 0;
    v_total_premios_usd DECIMAL(12, 2) := 0.00;
    v_tickets_ganadores INT := 0;
    v_tickets_perdedores INT := 0;
BEGIN
    -- Verificación de seguridad: solo superadministradores pueden liquidar sorteos manualmente
    IF NOT public.is_superadmin() THEN
        RAISE EXCEPTION 'NO_AUTORIZADO: Se requiere rol superadmin para liquidar sorteos.';
    END IF;

    -- Validar rango de figura ganadora (0..37)
    IF p_animal_ganador < 0 OR p_animal_ganador > 37 THEN
        RAISE EXCEPTION 'ANIMAL_INVALIDO: El código de figura % está fuera del rango permitido (0..37).', p_animal_ganador;
    END IF;

    -- Bloqueo de cabecera de sorteo diario para asegurar idempotencia
    SELECT id, estado, animal_ganador
    INTO v_sorteo
    FROM public.sorteos_diarios
    WHERE id = p_sorteo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SORTEO_NO_ENCONTRADO: El sorteo % no existe.', p_sorteo_id;
    END IF;

    IF v_sorteo.estado = 'LIQUIDADO' THEN
        RAISE EXCEPTION 'SORTEO_YA_LIQUIDADO: El sorteo % ya fue liquidado previamente con la figura %.',
            p_sorteo_id, v_sorteo.animal_ganador;
    END IF;

    -- 1. Marcar el sorteo como LIQUIDADO
    UPDATE public.sorteos_diarios
    SET estado = 'LIQUIDADO',
        animal_ganador = p_animal_ganador,
        timestamp_resultado = NOW(),
        liquidado_por = auth.uid(),
        metodo_liquidacion = COALESCE(p_metodo, 'AUTO_CRON')
    WHERE id = p_sorteo_id;

    -- 2. Liquidación atómica multi-tenant de todas las jugadas
    UPDATE public.ticket_detalles td
    SET es_ganador = (td.animal_numero = p_animal_ganador),
        premio_liquidado_usd = CASE
            WHEN td.animal_numero = p_animal_ganador THEN ROUND(td.monto_usd * 30.0, 2)
            ELSE 0.00
        END
    FROM public.tickets t
    WHERE td.ticket_id = t.id
      AND td.sorteo_diario_id = p_sorteo_id
      AND t.estado <> 'ANULADO';

    SELECT COUNT(*), COALESCE(SUM(premio_liquidado_usd), 0.00)
    INTO v_total_jugadas_ganadoras, v_total_premios_usd
    FROM public.ticket_detalles
    WHERE sorteo_diario_id = p_sorteo_id AND es_ganador = TRUE;

    -- 3. Actualizar estado y premios de los tickets afectados
    WITH tickets_afectados AS (
        SELECT DISTINCT ticket_id
        FROM public.ticket_detalles
        WHERE sorteo_diario_id = p_sorteo_id
    ),
    resumen_tickets AS (
        SELECT
            td.ticket_id,
            BOOL_OR(td.es_ganador = TRUE) AS tiene_ganador,
            BOOL_AND(td.es_ganador IS NOT NULL) AS todos_resueltos,
            COALESCE(SUM(td.premio_liquidado_usd), 0.00) AS total_premio_usd
        FROM public.ticket_detalles td
        JOIN tickets_afectados ta ON ta.ticket_id = td.ticket_id
        GROUP BY td.ticket_id
    )
    UPDATE public.tickets t
    SET
        premio_total_usd = rt.total_premio_usd,
        estado = CASE
            WHEN rt.tiene_ganador THEN 'GANADOR'
            WHEN rt.todos_resueltos AND NOT rt.tiene_ganador THEN 'PERDEDOR'
            ELSE t.estado
        END,
        updated_at = NOW()
    FROM resumen_tickets rt
    WHERE t.id = rt.ticket_id
      AND t.estado <> 'ANULADO';

    SELECT COUNT(*) INTO v_tickets_ganadores
    FROM public.tickets t
    JOIN (SELECT DISTINCT ticket_id FROM public.ticket_detalles WHERE sorteo_diario_id = p_sorteo_id) ta ON ta.ticket_id = t.id
    WHERE t.estado = 'GANADOR';

    SELECT COUNT(*) INTO v_tickets_perdedores
    FROM public.tickets t
    JOIN (SELECT DISTINCT ticket_id FROM public.ticket_detalles WHERE sorteo_diario_id = p_sorteo_id) ta ON ta.ticket_id = t.id
    WHERE t.estado = 'PERDEDOR';

    RETURN jsonb_build_object(
        'sorteo_id', p_sorteo_id,
        'animal_ganador', p_animal_ganador,
        'estado', 'LIQUIDADO',
        'jugadas_ganadoras', v_total_jugadas_ganadoras,
        'premios_generados_usd', v_total_premios_usd,
        'tickets_ganadores', v_tickets_ganadores,
        'tickets_perdedores', v_tickets_perdedores,
        'timestamp', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.liquidar_sorteo(BIGINT, INT, VARCHAR) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. PROCEDIMIENTOS ALMACENADOS SECURITY DEFINER PARA AUTOMATIZACIONES Y PAGOS
-- ----------------------------------------------------------------------------

-- 5.1 Actualización de Tasa Oficial BCV para Cron (Sin error RLS 42501)
CREATE OR REPLACE FUNCTION public.actualizar_tasa_bcv(
    p_tasa NUMERIC,
    p_fecha DATE DEFAULT (NOW() AT TIME ZONE 'America/Caracas')::DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id BIGINT;
    v_fecha DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Caracas')::DATE);
BEGIN
    IF p_tasa IS NULL OR p_tasa <= 0 THEN
        RAISE EXCEPTION 'TASA_INVALIDA: La tasa oficial debe ser mayor a 0.';
    END IF;

    INSERT INTO public.tasas_cambio (
        fuente, tasa, fecha_vigencia, created_at
    ) VALUES (
        'BCV', ROUND(p_tasa, 4), v_fecha, NOW()
    ) RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'id', v_id,
        'fuente', 'BCV',
        'tasa', ROUND(p_tasa, 4),
        'fecha_vigencia', v_fecha,
        'created_at', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_tasa_bcv(NUMERIC, DATE) TO authenticated, anon;

-- 5.2 Consulta Segura de Sorteos Diarios para Cron (Sin bloqueo RLS para rol anon)
CREATE OR REPLACE FUNCTION public.obtener_sorteos_cron(
    p_fecha DATE DEFAULT (NOW() AT TIME ZONE 'America/Caracas')::DATE
)
RETURNS TABLE (
    id BIGINT,
    fecha DATE,
    estado VARCHAR(20),
    animal_ganador INT,
    horario_id INT,
    hora_oficial TIME,
    etiqueta VARCHAR(20),
    minutos_cierre_previo INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        sd.id,
        sd.fecha,
        sd.estado,
        sd.animal_ganador,
        sd.horario_id,
        hs.hora_oficial,
        hs.etiqueta,
        hs.minutos_cierre_previo
    FROM public.sorteos_diarios sd
    JOIN public.horarios_sorteo hs ON hs.id = sd.horario_id
    WHERE sd.fecha = COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Caracas')::DATE)
    ORDER BY hs.hora_oficial ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_sorteos_cron(DATE) TO authenticated, anon;

-- 5.3 Cobro de Ticket Ganador por PIN o Serial Corto (Soporte Digital WhatsApp)
CREATE OR REPLACE FUNCTION public.pagar_ticket_por_pin(
    p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_tenant_id UUID := public.get_my_tenant_id();
    v_ticket RECORD;
    v_pin_limpio TEXT := UPPER(TRIM(COALESCE(p_pin, '')));
    v_serial_str TEXT;
    v_hash_prefix TEXT;
    v_tasa_actual DECIMAL(12, 4);
    v_premio_bs DECIMAL(14, 2);
    v_jugadas_pendientes INT;
BEGIN
    IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'NO_AUTORIZADO: Operador sin sesión activa o sin comercio asignado.';
    END IF;

    IF v_pin_limpio = '' THEN
        RAISE EXCEPTION 'PIN_VACIO: Debe proporcionar el PIN o serial de cobro.';
    END IF;

    -- Si tiene guion (ej. 0001042-9F4C2E81)
    IF POSITION('-' IN v_pin_limpio) > 0 THEN
        v_serial_str := SPLIT_PART(v_pin_limpio, '-', 1);
        v_hash_prefix := SPLIT_PART(v_pin_limpio, '-', 2);

        SELECT *
        INTO v_ticket
        FROM public.tickets
        WHERE tenant_id = v_tenant_id
          AND serial_corto = v_serial_str::BIGINT
          AND UPPER(SUBSTRING(codigo_seguridad FROM 1 FOR LENGTH(v_hash_prefix))) = v_hash_prefix
        FOR UPDATE;
    ELSE
        -- Búsqueda por serial corto, código de seguridad completo, o UUID
        SELECT *
        INTO v_ticket
        FROM public.tickets
        WHERE tenant_id = v_tenant_id
          AND (
            codigo_seguridad = LOWER(v_pin_limpio)
            OR (v_pin_limpio ~ '^[0-9]+$' AND serial_corto = v_pin_limpio::BIGINT)
          )
        FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKET_NO_ENCONTRADO: No se encontró ningún ticket coincidente con el PIN/Serial indicado para este comercio.';
    END IF;

    IF v_ticket.estado = 'PAGADO' THEN
        RAISE EXCEPTION 'TICKET_YA_PAGADO: Este ticket ya fue cobrado el %.',
            TO_CHAR(COALESCE(v_ticket.paid_at, v_ticket.updated_at) AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY HH12:MI:SS AM');
    END IF;

    IF v_ticket.estado = 'ANULADO' THEN
        RAISE EXCEPTION 'TICKET_ANULADO: Este ticket se encuentra anulado y carece de validez comercial.';
    END IF;

    IF v_ticket.estado <> 'GANADOR' OR COALESCE(v_ticket.premio_total_usd, 0) <= 0 THEN
        RAISE EXCEPTION 'TICKET_NO_PREMIADO: El ticket se encuentra en estado % y no posee premios pendientes de cobro.',
            v_ticket.estado;
    END IF;

    SELECT COUNT(*) INTO v_jugadas_pendientes
    FROM public.ticket_detalles
    WHERE ticket_id = v_ticket.id AND es_ganador IS NULL;

    IF v_jugadas_pendientes > 0 THEN
        RAISE EXCEPTION 'SORTEOS_PENDIENTES: El ticket tiene % jugada(s) en sorteos aún no resueltos.',
            v_jugadas_pendientes;
    END IF;

    SELECT tasa INTO v_tasa_actual
    FROM public.tasas_cambio
    ORDER BY created_at DESC
    LIMIT 1;

    v_tasa_actual := COALESCE(v_tasa_actual, v_ticket.tasa_cambio);
    v_premio_bs := ROUND(v_ticket.premio_total_usd * v_tasa_actual, 2);

    UPDATE public.tickets
    SET estado = 'PAGADO',
        paid_at = NOW(),
        paid_by = v_user_id,
        updated_at = NOW()
    WHERE id = v_ticket.id;

    INSERT INTO public.caja_movimientos (
        tenant_id, usuario_id, tipo, monto_usd, monto_bs, ticket_id, concepto, fecha
    ) VALUES (
        v_tenant_id, v_user_id, 'PAGO_PREMIO',
        -v_ticket.premio_total_usd, -v_premio_bs,
        v_ticket.id,
        'Pago Premio Ticket #' || LPAD(v_ticket.serial_corto::TEXT, 7, '0') || ' (Cobro PIN)',
        NOW()
    );

    RETURN jsonb_build_object(
        'ticket_id', v_ticket.id,
        'serial_corto', v_ticket.serial_corto,
        'estado', 'PAGADO',
        'premio_pagado_usd', v_ticket.premio_total_usd,
        'premio_pagado_bs', v_premio_bs,
        'tasa_aplicada', v_tasa_actual,
        'paid_at', NOW()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pagar_ticket_por_pin(TEXT) TO authenticated;

-- 5.4 Consulta Pública de Comprobante de Ticket por Firma HMAC o ID (Para Verificación Web / QR)
CREATE OR REPLACE FUNCTION public.consultar_ticket_publico(
    p_ticket_param TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_param TEXT := TRIM(COALESCE(p_ticket_param, ''));
    v_ticket_id UUID;
    v_hash_busqueda TEXT;
    v_ticket RECORD;
    v_tenant RECORD;
    v_detalles JSONB;
BEGIN
    IF v_param = '' THEN
        RETURN NULL;
    END IF;

    -- Si proviene de QR BANCAPRO|tenant|ticket_id|monto|epoch|hash
    IF v_param LIKE 'BANCAPRO|%' THEN
        v_ticket_id := SPLIT_PART(v_param, '|', 3)::UUID;
        v_hash_busqueda := SPLIT_PART(v_param, '|', 6);
    ELSIF v_param ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_ticket_id := v_param::UUID;
    ELSE
        -- Buscar por código de seguridad HMAC completo
        v_hash_busqueda := LOWER(v_param);
    END IF;

    IF v_ticket_id IS NOT NULL THEN
        SELECT * INTO v_ticket FROM public.tickets WHERE id = v_ticket_id;
    ELSIF v_hash_busqueda IS NOT NULL THEN
        SELECT * INTO v_ticket FROM public.tickets WHERE codigo_seguridad = v_hash_busqueda;
    END IF;

    IF v_ticket IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id, nombre, rif, telefono
    INTO v_tenant
    FROM public.tenants
    WHERE id = v_ticket.tenant_id;

    SELECT jsonb_agg(
        jsonb_build_object(
            'id', td.id,
            'animal_numero', td.animal_numero,
            'monto_usd', td.monto_usd,
            'premio_potencial_usd', td.premio_potencial_usd,
            'es_ganador', td.es_ganador,
            'premio_liquidado_usd', td.premio_liquidado_usd,
            'sorteo_hora', hs.etiqueta,
            'sorteo_estado', sd.estado,
            'sorteo_animal_ganador', sd.animal_ganador
        )
    )
    INTO v_detalles
    FROM public.ticket_detalles td
    JOIN public.sorteos_diarios sd ON sd.id = td.sorteo_diario_id
    JOIN public.horarios_sorteo hs ON hs.id = sd.horario_id
    WHERE td.ticket_id = v_ticket.id;

    RETURN jsonb_build_object(
        'id', v_ticket.id,
        'serial_corto', v_ticket.serial_corto,
        'tenant_id', v_ticket.tenant_id,
        'tenant_nombre', COALESCE(v_tenant.nombre, 'Bodega Piloto Magaly'),
        'tenant_rif', COALESCE(v_tenant.rif, 'J-40123987-1'),
        'codigo_seguridad', v_ticket.codigo_seguridad,
        'total_usd', v_ticket.total_usd,
        'total_bs', v_ticket.total_bs,
        'tasa_cambio', v_ticket.tasa_cambio,
        'estado', v_ticket.estado,
        'premio_total_usd', COALESCE(v_ticket.premio_total_usd, 0.00),
        'created_at', v_ticket.created_at,
        'detalles', COALESCE(v_detalles, '[]'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_ticket_publico(TEXT) TO authenticated, anon;
