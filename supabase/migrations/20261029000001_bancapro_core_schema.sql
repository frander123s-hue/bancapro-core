-- ============================================================================
-- BANCAPRO CORE - ARQUITECTURA TRANSACCIONAL MULTI-TENANT (LOTTO ACTIVO)
-- Motor: PostgreSQL 15+ (Supabase) con Row Level Security (RLS) y ACID estricto
-- Zona Horaria: America/Caracas (UTC-4)
-- ============================================================================

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. DEFINICIÓN DE TABLAS PRINCIPALES (DDL)
-- ============================================================================

-- 1.1 Tenants (Comercios / Bodegas / Agencias independientes)
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(120) NOT NULL,
    rif VARCHAR(20) NOT NULL UNIQUE,
    telefono VARCHAR(30),
    perdida_maxima_sorteo_usd DECIMAL(12, 2) NOT NULL DEFAULT 300.00, -- Cupo por animal = 300 / 30 = $10.00 USD default
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.2 Usuarios vinculados a Supabase Auth (auth.users) y a su Tenant
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE RESTRICT,
    nombre VARCHAR(120) NOT NULL,
    email VARCHAR(150),
    rol VARCHAR(25) NOT NULL CHECK (rol IN ('superadmin', 'admin_comercio', 'cajero')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Regla de integridad: todo admin_comercio o cajero debe pertenecer a un tenant
    CONSTRAINT chk_usuario_tenant CHECK (
        (rol = 'superadmin') OR (tenant_id IS NOT NULL)
    )
);

-- 1.3 Tasas de Cambio Oficial (BCV USD/VES)
CREATE TABLE IF NOT EXISTS public.tasas_cambio (
    id BIGSERIAL PRIMARY KEY,
    fuente VARCHAR(20) NOT NULL DEFAULT 'BCV',
    tasa DECIMAL(12, 4) NOT NULL CHECK (tasa > 0),
    fecha_vigencia DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Caracas')::DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasas_cambio_reciente ON public.tasas_cambio (created_at DESC);

-- 1.4 Catálogo de Loterías
CREATE TABLE IF NOT EXISTS public.loterias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE,
    total_figuras INT NOT NULL DEFAULT 38,
    multiplicador_premio DECIMAL(6, 2) NOT NULL DEFAULT 30.00,
    activa BOOLEAN NOT NULL DEFAULT TRUE
);

-- 1.5 Horarios Oficiales de Sorteo (09:00 AM a 07:00 PM)
CREATE TABLE IF NOT EXISTS public.horarios_sorteo (
    id SERIAL PRIMARY KEY,
    loteria_id INT NOT NULL REFERENCES public.loterias(id) ON DELETE CASCADE,
    hora_oficial TIME NOT NULL,
    etiqueta VARCHAR(30) NOT NULL, -- Ej: '09:00 AM', '10:00 AM'
    minutos_cierre_previo INT NOT NULL DEFAULT 3,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (loteria_id, hora_oficial)
);

-- 1.6 Sorteos Diarios (Instancias operativas por fecha y horario)
-- Convención para animal_ganador (38 figuras de Lotto Activo):
--   0  = Delfín ("0")
--   37 = Ballena ("00")  <-- Codificado como 37 en INT para distinguir "0" de "00" con integridad numérica
--   1..36 = Carnero (1) hasta Culebra (36)
CREATE TABLE IF NOT EXISTS public.sorteos_diarios (
    id BIGSERIAL PRIMARY KEY,
    horario_id INT NOT NULL REFERENCES public.horarios_sorteo(id) ON DELETE RESTRICT,
    fecha DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Caracas')::DATE,
    estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'CERRADO', 'LIQUIDADO')),
    animal_ganador INT CHECK (animal_ganador IS NULL OR (animal_ganador >= 0 AND animal_ganador <= 37)),
    timestamp_resultado TIMESTAMPTZ,
    liquidado_por UUID REFERENCES auth.users(id),
    metodo_liquidacion VARCHAR(20) DEFAULT 'AUTO_CRON' CHECK (metodo_liquidacion IN ('AUTO_CRON', 'MANUAL_CONTINGENCIA')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (horario_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_sorteos_diarios_fecha_estado ON public.sorteos_diarios (fecha, estado);

-- 1.7 Cupos de Riesgo por Sorteo, Comercio y Animal (Control Atómico de Exposición)
CREATE TABLE IF NOT EXISTS public.cupos_sorteo (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    sorteo_diario_id BIGINT NOT NULL REFERENCES public.sorteos_diarios(id) ON DELETE CASCADE,
    animal_numero INT NOT NULL CHECK (animal_numero >= 0 AND animal_numero <= 37),
    monto_acumulado_usd DECIMAL(12, 2) NOT NULL DEFAULT 0.00 CHECK (monto_acumulado_usd >= 0),
    cupo_maximo_usd DECIMAL(12, 2) NOT NULL CHECK (cupo_maximo_usd >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, sorteo_diario_id, animal_numero)
);

CREATE INDEX IF NOT EXISTS idx_cupos_lookup ON public.cupos_sorteo (tenant_id, sorteo_diario_id, animal_numero);

-- 1.8 Tickets de Venta (Cabecera Transaccional con Firma Criptográfica)
CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_corto BIGSERIAL UNIQUE, -- Número legible para ticket térmico (Ej: #0001045)
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
    codigo_seguridad VARCHAR(64) NOT NULL UNIQUE, -- Firma HMAC-SHA256
    total_usd DECIMAL(12, 2) NOT NULL CHECK (total_usd > 0),
    total_bs DECIMAL(14, 2) NOT NULL CHECK (total_bs > 0),
    tasa_cambio DECIMAL(12, 4) NOT NULL CHECK (tasa_cambio > 0), -- Tasa BCV congelada al instante de emisión
    premio_total_usd DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(20) NOT NULL DEFAULT 'EMITIDO' CHECK (estado IN ('EMITIDO', 'GANADOR', 'PAGADO', 'PERDEDOR', 'ANULADO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    paid_by UUID REFERENCES public.usuarios(id),
    anulado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_fecha ON public.tickets (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_codigo_seguridad ON public.tickets (codigo_seguridad);
CREATE INDEX IF NOT EXISTS idx_tickets_estado ON public.tickets (tenant_id, estado);

-- 1.9 Detalles de Ticket (Jugadas individuales por sorteo y figura)
CREATE TABLE IF NOT EXISTS public.ticket_detalles (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    sorteo_diario_id BIGINT NOT NULL REFERENCES public.sorteos_diarios(id) ON DELETE RESTRICT,
    animal_numero INT NOT NULL CHECK (animal_numero >= 0 AND animal_numero <= 37),
    monto_usd DECIMAL(12, 2) NOT NULL CHECK (monto_usd > 0),
    premio_potencial_usd DECIMAL(12, 2) NOT NULL CHECK (premio_potencial_usd > 0), -- monto_usd * 30
    es_ganador BOOLEAN DEFAULT NULL, -- NULL mientras el sorteo está abierto, TRUE/FALSE al liquidar
    premio_liquidado_usd DECIMAL(12, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_ticket_detalles_sorteo ON public.ticket_detalles (sorteo_diario_id, animal_numero);
CREATE INDEX IF NOT EXISTS idx_ticket_detalles_ticket ON public.ticket_detalles (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_detalles_tenant ON public.ticket_detalles (tenant_id);

-- 1.10 Movimientos de Caja (Libro Mayor Inmutable por Tenant)
CREATE TABLE IF NOT EXISTS public.caja_movimientos (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    usuario_id UUID REFERENCES public.usuarios(id),
    tipo VARCHAR(25) NOT NULL CHECK (tipo IN ('VENTA', 'PAGO_PREMIO', 'ANULACION', 'AJUSTE')),
    monto_usd DECIMAL(12, 2) NOT NULL, -- Positivo para entradas (VENTA), Negativo para salidas (PAGO_PREMIO, ANULACION)
    monto_bs DECIMAL(14, 2) NOT NULL,
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
    concepto VARCHAR(160),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caja_tenant_fecha ON public.caja_movimientos (tenant_id, fecha DESC);

-- ============================================================================
-- 2. FUNCIONES HELPER DE AUTENTICACIÓN Y MULTI-TENANCY PARA RLS
-- ============================================================================

-- Obtiene el tenant_id del usuario autenticado actualmente en la sesión JWT
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tenant_id FROM public.usuarios WHERE id = auth.uid() AND activo = TRUE LIMIT 1;
$$;

-- Verifica si el usuario autenticado tiene rol de SuperAdmin global
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.usuarios
        WHERE id = auth.uid() AND rol = 'superadmin' AND activo = TRUE
    );
$$;

-- Verifica si el usuario es administrador de su comercio
CREATE OR REPLACE FUNCTION public.is_admin_comercio()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.usuarios
        WHERE id = auth.uid() AND rol IN ('admin_comercio', 'superadmin') AND activo = TRUE
    );
$$;

-- ============================================================================
-- 3. POLÍTICAS DE ROW LEVEL SECURITY (AISLAMIENTO ESTRICTO MULTI-TENANT)
-- ============================================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasas_cambio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loterias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_sorteo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sorteos_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupos_sorteo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_detalles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_movimientos ENABLE ROW LEVEL SECURITY;

-- 3.1 Políticas en `tenants`
CREATE POLICY "Tenants: lectura aislada por propio comercio o superadmin"
    ON public.tenants FOR SELECT
    TO authenticated
    USING (id = public.get_my_tenant_id() OR public.is_superadmin());

CREATE POLICY "Tenants: actualización de cupo global por admin_comercio propio o superadmin"
    ON public.tenants FOR UPDATE
    TO authenticated
    USING ((id = public.get_my_tenant_id() AND public.is_admin_comercio()) OR public.is_superadmin())
    WITH CHECK ((id = public.get_my_tenant_id() AND public.is_admin_comercio()) OR public.is_superadmin());

CREATE POLICY "Tenants: creación exclusiva para superadmin"
    ON public.tenants FOR INSERT
    TO authenticated
    WITH CHECK (public.is_superadmin());

-- 3.2 Políticas en `usuarios`
CREATE POLICY "Usuarios: lectura de miembros del mismo tenant o superadmin"
    ON public.usuarios FOR SELECT
    TO authenticated
    USING (id = auth.uid() OR tenant_id = public.get_my_tenant_id() OR public.is_superadmin());

CREATE POLICY "Usuarios: gestión por admin_comercio de su propio tenant o superadmin"
    ON public.usuarios FOR ALL
    TO authenticated
    USING ((tenant_id = public.get_my_tenant_id() AND public.is_admin_comercio()) OR public.is_superadmin())
    WITH CHECK ((tenant_id = public.get_my_tenant_id() AND public.is_admin_comercio()) OR public.is_superadmin());

-- 3.3 Tablas Globales de Referencia (`tasas_cambio`, `loterias`, `horarios_sorteo`, `sorteos_diarios`)
CREATE POLICY "Tasas BCV: lectura pública para usuarios autenticados"
    ON public.tasas_cambio FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Tasas BCV: inserción solo superadmin"
    ON public.tasas_cambio FOR INSERT TO authenticated WITH CHECK (public.is_superadmin());

CREATE POLICY "Loterias: lectura global autenticada"
    ON public.loterias FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Horarios: lectura global autenticada"
    ON public.horarios_sorteo FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Sorteos Diarios: lectura global autenticada"
    ON public.sorteos_diarios FOR SELECT TO authenticated USING (TRUE);

-- 3.4 Políticas de Aislamiento Estricto por `tenant_id` en Tablas Transaccionales
-- Ningún comercio puede leer, insertar o modificar registros de otro `tenant_id`.

-- `cupos_sorteo`
CREATE POLICY "Cupos: aislamiento total por tenant_id"
    ON public.cupos_sorteo FOR SELECT
    TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "Cupos: ajuste de cupo máximo por admin_comercio propio"
    ON public.cupos_sorteo FOR UPDATE
    TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.is_admin_comercio())
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.is_admin_comercio());

-- `tickets`
CREATE POLICY "Tickets: aislamiento estricto de lectura por tenant_id"
    ON public.tickets FOR SELECT
    TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

-- `ticket_detalles`
CREATE POLICY "Ticket Detalles: aislamiento estricto de lectura por tenant_id"
    ON public.ticket_detalles FOR SELECT
    TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

-- `caja_movimientos`
CREATE POLICY "Caja Movimientos: aislamiento estricto de lectura por tenant_id"
    ON public.caja_movimientos FOR SELECT
    TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

-- Nota de Arquitectura de Seguridad:
-- Las operaciones de escritura transaccional (`INSERT`/`UPDATE` en `tickets`, `ticket_detalles`,
-- `cupos_sorteo` y `caja_movimientos`) se ejecutan exclusivamente mediante Stored Procedures ACID
-- con `SECURITY DEFINER` que validan `auth.uid()`, el `tenant_id` del operador, el reloj del servidor
-- `NOW()` y los bloqueos pesimistas `FOR UPDATE`, impidiendo manipulaciones directas desde el cliente.

-- ============================================================================
-- 4. FUNCIONES TRANSACCIONALES Y ANTI-FRAUDE (STORED PROCEDURES ACID)
-- ============================================================================

-- 4.1 Inicializador automático de los 11 sorteos diarios de Lotto Activo para la fecha actual
CREATE OR REPLACE FUNCTION public.asegurar_sorteos_del_dia(
    p_fecha DATE DEFAULT (NOW() AT TIME ZONE 'America/Caracas')::DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.sorteos_diarios (horario_id, fecha, estado)
    SELECT h.id, p_fecha, 'ABIERTO'
    FROM public.horarios_sorteo h
    WHERE h.activo = TRUE
    ON CONFLICT (horario_id, fecha) DO NOTHING;
END;
$$;

-- 4.2 Motor de Emisión de Ticket con Lockdown Estricto (T - 3 min) y Control Atómico de Cupos
-- Recibe:
--   p_jugadas: JSONB Array -> [{"sorteo_diario_id": 1, "animal_numero": 5, "monto_usd": 2.00}, ...]
--   p_secret_key: Secreto del servidor para generar la firma HMAC-SHA256 inmutable en DB
CREATE OR REPLACE FUNCTION public.emitir_ticket(
    p_jugadas JSONB,
    p_secret_key TEXT
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
    -- 1. Validar identidad y Tenant del cajero/administrador autenticado
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

    -- Fórmula de riesgo: Cupo Máximo por Animal = Pérdida Máxima Aceptable / 30
    v_cupo_default_animal := ROUND(v_perdida_max_tenant / 30.0, 2);

    -- 2. Validar payload de jugadas
    IF p_jugadas IS NULL OR jsonb_typeof(p_jugadas) <> 'array' OR jsonb_array_length(p_jugadas) = 0 THEN
        RAISE EXCEPTION 'JUGADAS_VACIAS: El ticket debe contener al menos una jugada válida.';
    END IF;

    -- 3. Obtener la Tasa Oficial BCV vigente para congelarla en el ticket
    SELECT tasa INTO v_tasa_bcv
    FROM public.tasas_cambio
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_tasa_bcv IS NULL OR v_tasa_bcv <= 0 THEN
        RAISE EXCEPTION 'TASA_NO_DISPONIBLE: No existe una tasa BCV registrada en el sistema.';
    END IF;

    -- 4. Capturar tiempo autoritativo del servidor PostgreSQL en hora de Venezuela (UTC-4)
    v_now_ve := NOW() AT TIME ZONE 'America/Caracas';
    v_fecha_hoy_ve := v_now_ve::DATE;
    v_hora_actual_ve := v_now_ve::TIME;
    v_timestamp_epoch := EXTRACT(EPOCH FROM NOW())::BIGINT;

    -- Pre-calcular el total del ticket para el registro cabecera
    SELECT COALESCE(SUM(ROUND((elem->>'monto_usd')::DECIMAL, 2)), 0.00)
    INTO v_total_usd
    FROM jsonb_array_elements(p_jugadas) AS elem;

    IF v_total_usd <= 0 THEN
        RAISE EXCEPTION 'MONTO_INVALIDO: El monto total del ticket debe ser mayor a $0.00 USD.';
    END IF;

    v_total_bs := ROUND(v_total_usd * v_tasa_bcv, 2);

    -- 5. Generar Firma Criptográfica Anti-Falsificación HMAC-SHA256:
    -- Hash = HMAC-SHA256(SECRET, "tenant_id|ticket_id|monto|timestamp")
    v_codigo_seguridad := encode(
        hmac(
            v_tenant_id::TEXT || '|' || v_ticket_id::TEXT || '|' || v_total_usd::TEXT || '|' || v_timestamp_epoch::TEXT,
            COALESCE(NULLIF(p_secret_key, ''), 'bancapro_default_hmac_secret_2026'),
            'sha256'
        ),
        'hex'
    );

    -- 6. Insertar cabecera del Ticket antes de iterar los detalles (dentro de la misma transacción ACID)
    INSERT INTO public.tickets (
        id, tenant_id, usuario_id, codigo_seguridad,
        total_usd, total_bs, tasa_cambio, estado, created_at
    ) VALUES (
        v_ticket_id, v_tenant_id, v_user_id, v_codigo_seguridad,
        v_total_usd, v_total_bs, v_tasa_bcv, 'EMITIDO', NOW()
    ) RETURNING serial_corto INTO v_serial_corto;

    -- 7. Procesar cada jugada: Validar Lockdown (T - 3 min) y Cupo Atómico con Row-Level Lock
    FOR v_jugada IN
        SELECT
            (elem->>'sorteo_diario_id')::BIGINT AS sorteo_diario_id,
            (elem->>'animal_numero')::INT AS animal_numero,
            ROUND((elem->>'monto_usd')::DECIMAL, 2) AS monto_usd
        FROM jsonb_array_elements(p_jugadas) AS elem
        ORDER BY (elem->>'sorteo_diario_id')::BIGINT, (elem->>'animal_numero')::INT -- Orden determinista para evitar Deadlocks
    LOOP
        IF v_jugada.monto_usd <= 0 THEN
            RAISE EXCEPTION 'MONTO_JUGADA_INVALIDO: Cada jugada debe tener un monto positivo.';
        END IF;

        IF v_jugada.animal_numero < 0 OR v_jugada.animal_numero > 37 THEN
            RAISE EXCEPTION 'FIGURA_INVALIDA: El número de figura % no existe en Lotto Activo.', v_jugada.animal_numero;
        END IF;

        -- 7.1 Verificar estado del sorteo y hora límite estricta en el servidor (T - 3 minutos)
        SELECT
            sd.id, sd.fecha, sd.estado,
            hs.hora_oficial, hs.etiqueta, hs.minutos_cierre_previo
        INTO v_sorteo
        FROM public.sorteos_diarios sd
        JOIN public.horarios_sorteo hs ON hs.id = sd.horario_id
        WHERE sd.id = v_jugada.sorteo_diario_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'SORTEO_NO_EXISTE: El sorteo seleccionado (%) no existe.', v_jugada.sorteo_diario_id;
        END IF;

        IF v_sorteo.estado <> 'ABIERTO' THEN
            RAISE EXCEPTION 'SORTEO_CERRADO: El sorteo de las % ya se encuentra %.', v_sorteo.etiqueta, v_sorteo.estado;
        END IF;

        IF v_sorteo.fecha < v_fecha_hoy_ve THEN
            RAISE EXCEPTION 'SORTEO_VENCIDO: No se pueden emitir jugadas para fechas pasadas.';
        END IF;

        -- Cálculo exacto de T - 3 minutos (ej. 10:00:00 - 3 mins = 09:57:00)
        v_hora_cierre := v_sorteo.hora_oficial - (v_sorteo.minutos_cierre_previo || ' minutes')::INTERVAL;

        IF v_sorteo.fecha = v_fecha_hoy_ve AND v_hora_actual_ve >= v_hora_cierre THEN
            -- Auto-cerrar el sorteo si ya cruzó el umbral de bloqueo
            RAISE EXCEPTION 'LOCKDOWN_ACTIVO: Sorteo % cerrado por horario límite (%). Hora servidor: %.',
                v_sorteo.etiqueta, TO_CHAR(v_hora_cierre, 'HH12:MI:SS AM'), TO_CHAR(v_hora_actual_ve, 'HH12:MI:SS AM');
        END IF;

        -- 7.2 Asegurar existencia de la fila de cupo para (tenant, sorteo, animal) y bloquearla atómicamente
        INSERT INTO public.cupos_sorteo (
            tenant_id, sorteo_diario_id, animal_numero, monto_acumulado_usd, cupo_maximo_usd
        ) VALUES (
            v_tenant_id, v_jugada.sorteo_diario_id, v_jugada.animal_numero, 0.00, v_cupo_default_animal
        ) ON CONFLICT (tenant_id, sorteo_diario_id, animal_numero) DO NOTHING;

        -- Bloqueo pesimista a nivel de fila (SELECT ... FOR UPDATE) para serializar concurrencia en el mismo animal
        SELECT id, monto_acumulado_usd, cupo_maximo_usd
        INTO v_cupo_actual
        FROM public.cupos_sorteo
        WHERE tenant_id = v_tenant_id
          AND sorteo_diario_id = v_jugada.sorteo_diario_id
          AND animal_numero = v_jugada.animal_numero
        FOR UPDATE;

        -- Validar si monto_acumulado + nuevo_monto > cupo_maximo -> ROLLBACK inmediato
        IF (v_cupo_actual.monto_acumulado_usd + v_jugada.monto_usd) > v_cupo_actual.cupo_maximo_usd THEN
            v_animal_nombre := CASE
                WHEN v_jugada.animal_numero = 37 THEN '00'
                ELSE LPAD(v_jugada.animal_numero::TEXT, 2, '0')
            END;
            RAISE EXCEPTION 'CUPO_AGOTADO: Cupo agotado para esta figura (#% en sorteo %). Disponible: $% USD, Solicitado: $% USD.',
                v_animal_nombre,
                v_sorteo.etiqueta,
                ROUND(v_cupo_actual.cupo_maximo_usd - v_cupo_actual.monto_acumulado_usd, 2),
                v_jugada.monto_usd;
        END IF;

        -- Actualizar el monto acumulado del cupo
        UPDATE public.cupos_sorteo
        SET monto_acumulado_usd = monto_acumulado_usd + v_jugada.monto_usd,
            updated_at = NOW()
        WHERE id = v_cupo_actual.id;

        -- 7.3 Insertar el detalle de la jugada (Premio potencial = 30x monto jugado)
        INSERT INTO public.ticket_detalles (
            ticket_id, tenant_id, sorteo_diario_id, animal_numero,
            monto_usd, premio_potencial_usd, es_ganador, premio_liquidado_usd
        ) VALUES (
            v_ticket_id, v_tenant_id, v_jugada.sorteo_diario_id, v_jugada.animal_numero,
            v_jugada.monto_usd, ROUND(v_jugada.monto_usd * 30.0, 2), NULL, 0.00
        );
    END LOOP;

    -- 8. Registrar el ingreso en el Libro Mayor de Caja del Comercio (`caja_movimientos`)
    INSERT INTO public.caja_movimientos (
        tenant_id, usuario_id, tipo, monto_usd, monto_bs, ticket_id, concepto, fecha
    ) VALUES (
        v_tenant_id, v_user_id, 'VENTA', v_total_usd, v_total_bs, v_ticket_id,
        'Venta Ticket #' || LPAD(v_serial_corto::TEXT, 7, '0'), NOW()
    );

    -- 9. Retornar payload estructurado para impresión térmica ESC/POS inmediata
    RETURN jsonb_build_object(
        'ticket_id', v_ticket_id,
        'serial_corto', v_serial_corto,
        'tenant_id', v_tenant_id,
        'codigo_seguridad', v_codigo_seguridad,
        'total_usd', v_total_usd,
        'total_bs', v_total_bs,
        'tasa_cambio', v_tasa_bcv,
        'timestamp_epoch', v_timestamp_epoch,
        'created_at', NOW()
    );
END;
$$;

-- 4.3 Motor de Liquidación Multi-Tenant Masiva (Stored Procedure Transaccional)
-- Determina ganadores (30x el valor jugado) y perdedores en milisegundos mediante operaciones basadas en conjuntos (Set-Based SQL)
CREATE OR REPLACE FUNCTION public.liquidar_sorteo(
    p_sorteo_id BIGINT,
    p_animal_ganador INT,
    p_metodo VARCHAR(20) DEFAULT 'AUTO_CRON'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sorteo RECORD;
    v_total_jugadas_ganadoras INT := 0;
    v_total_premios_usd DECIMAL(12, 2) := 0.00;
    v_tickets_ganadores INT := 0;
    v_tickets_perdedores INT := 0;
BEGIN
    -- Validar rango de figura ganadora (0 = Delfín, 37 = Ballena 00, 1..36 = Carnero..Culebra)
    IF p_animal_ganador < 0 OR p_animal_ganador > 37 THEN
        RAISE EXCEPTION 'ANIMAL_INVALIDO: El código de figura % está fuera del rango permitido (0..37).', p_animal_ganador;
    END IF;

    -- Bloquear únicamente la cabecera del sorteo diario para garantizar idempotencia
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

    -- 1. Marcar el sorteo como LIQUIDADO con su animal ganador y timestamp oficial
    UPDATE public.sorteos_diarios
    SET estado = 'LIQUIDADO',
        animal_ganador = p_animal_ganador,
        timestamp_resultado = NOW(),
        liquidado_por = auth.uid(),
        metodo_liquidacion = COALESCE(p_metodo, 'AUTO_CRON')
    WHERE id = p_sorteo_id;

    -- 2. Actualizar todas las jugadas (`ticket_detalles`) de este sorteo para TODOS los tenants en una sola pasada atómica
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

    -- Obtener métricas de jugadas premiadas
    SELECT COUNT(*), COALESCE(SUM(premio_liquidado_usd), 0.00)
    INTO v_total_jugadas_ganadoras, v_total_premios_usd
    FROM public.ticket_detalles
    WHERE sorteo_diario_id = p_sorteo_id AND es_ganador = TRUE;

    -- 3. Actualizar el estado y el premio acumulado de los tickets afectados:
    --    - Si el ticket tiene al menos 1 jugada ganadora -> Estado pasa a 'GANADOR' y suma su premio_total_usd
    --    - Si todas las jugadas del ticket ya fueron evaluadas (ninguna es NULL) y ninguna ganó -> Estado pasa a 'PERDEDOR'
    --    - Si el ticket aún tiene jugadas de sorteos posteriores abiertos y ninguna ha ganado todavía -> Permanece 'EMITIDO'
    WITH tickets_afectados AS (
        SELECT DISTINCT ticket_id
        FROM public.ticket_detalles
        WHERE sorteo_diario_id = p_sorteo_id
    ),
    resumen_tickets AS (
        SELECT
            td.ticket_id,
            BOOL_OR(COALESCE(td.es_ganador, FALSE)) AS tiene_ganador,
            BOOL_AND(td.es_ganador IS NOT NULL) AS todos_sorteos_liquidados,
            COALESCE(SUM(td.premio_liquidado_usd), 0.00) AS suma_premios_usd
        FROM public.ticket_detalles td
        JOIN tickets_afectados ta ON ta.ticket_id = td.ticket_id
        GROUP BY td.ticket_id
    )
    UPDATE public.tickets t
    SET premio_total_usd = rt.suma_premios_usd,
        estado = CASE
            WHEN t.estado IN ('PAGADO', 'ANULADO') THEN t.estado
            WHEN rt.tiene_ganador THEN 'GANADOR'
            WHEN rt.todos_sorteos_liquidados AND NOT rt.tiene_ganador THEN 'PERDEDOR'
            ELSE 'EMITIDO'
        END
    FROM resumen_tickets rt
    WHERE t.id = rt.ticket_id
      AND t.estado NOT IN ('PAGADO', 'ANULADO');

    GET DIAGNOSTICS v_tickets_ganadores = ROW_COUNT;

    RETURN jsonb_build_object(
        'sorteo_id', p_sorteo_id,
        'animal_ganador', p_animal_ganador,
        'estado', 'LIQUIDADO',
        'jugadas_ganadoras', v_total_jugadas_ganadoras,
        'premios_generados_usd', v_total_premios_usd,
        'tickets_actualizados', v_tickets_ganadores,
        'timestamp', NOW()
    );
END;
$$;

-- 4.4 Pago Idempotente de Ticket Ganador con Verificación de Firma QR y Aislamiento de Tenant
CREATE OR REPLACE FUNCTION public.pagar_ticket_ganador(
    p_codigo_seguridad VARCHAR(64)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_tenant_id UUID := public.get_my_tenant_id();
    v_ticket RECORD;
    v_tasa_actual DECIMAL(12, 4);
    v_premio_bs DECIMAL(14, 2);
    v_jugadas_pendientes INT;
BEGIN
    IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'NO_AUTORIZADO: Operador sin sesión o sin comercio asignado.';
    END IF;

    -- Bloqueo pesimista sobre el ticket para garantizar que un ticket ganador JAMÁS se pague dos veces
    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE codigo_seguridad = TRIM(p_codigo_seguridad)
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKET_NO_ENCONTRADO: El código de seguridad QR no existe o pertenece a otro comercio.';
    END IF;

    IF v_ticket.estado = 'PAGADO' THEN
        RAISE EXCEPTION 'TICKET_YA_PAGADO: Este ticket ya fue cobrado el %.',
            TO_CHAR(v_ticket.paid_at AT TIME ZONE 'America/Caracas', 'DD/MM/YYYY HH12:MI:SS AM');
    END IF;

    IF v_ticket.estado = 'ANULADO' THEN
        RAISE EXCEPTION 'TICKET_ANULADO: Este ticket se encuentra anulado y carece de validez.';
    END IF;

    IF v_ticket.estado <> 'GANADOR' OR v_ticket.premio_total_usd <= 0 THEN
        RAISE EXCEPTION 'TICKET_NO_PREMIADO: El estado actual del ticket es % y no posee premios exigibles.',
            v_ticket.estado;
    END IF;

    -- Verificar si el ticket es multi-sorteo y aún tiene sorteos abiertos pendientes por jugar
    SELECT COUNT(*) INTO v_jugadas_pendientes
    FROM public.ticket_detalles
    WHERE ticket_id = v_ticket.id AND es_ganador IS NULL;

    IF v_jugadas_pendientes > 0 THEN
        RAISE EXCEPTION 'SORTEOS_PENDIENTES: El ticket aún tiene % jugada(s) en sorteos abiertos sin liquidar.',
            v_jugadas_pendientes;
    END IF;

    -- Obtener tasa BCV en tiempo real para conversión de pago en Bolívares
    SELECT tasa INTO v_tasa_actual
    FROM public.tasas_cambio
    ORDER BY created_at DESC
    LIMIT 1;

    v_tasa_actual := COALESCE(v_tasa_actual, v_ticket.tasa_cambio);
    v_premio_bs := ROUND(v_ticket.premio_total_usd * v_tasa_actual, 2);

    -- Transición idempotente a 'PAGADO'
    UPDATE public.tickets
    SET estado = 'PAGADO',
        paid_at = NOW(),
        paid_by = v_user_id
    WHERE id = v_ticket.id;

    -- Registrar salida de efectivo en `caja_movimientos`
    INSERT INTO public.caja_movimientos (
        tenant_id, usuario_id, tipo, monto_usd, monto_bs, ticket_id, concepto, fecha
    ) VALUES (
        v_tenant_id, v_user_id, 'PAGO_PREMIO',
        -v_ticket.premio_total_usd, -v_premio_bs,
        v_ticket.id,
        'Pago Premio Ticket #' || LPAD(v_ticket.serial_corto::TEXT, 7, '0'),
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

-- 4.5 Regla de Anulación Estricta (< 60 segundos desde emisión Y > 3 minutos antes del sorteo)
CREATE OR REPLACE FUNCTION public.anular_ticket(
    p_ticket_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    SELECT *
    INTO v_ticket
    FROM public.tickets
    WHERE id = p_ticket_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKET_NO_ENCONTRADO: El ticket no existe en este comercio.';
    END IF;

    IF v_ticket.estado <> 'EMITIDO' THEN
        RAISE EXCEPTION 'ESTADO_NO_ANULABLE: Solo se pueden anular tickets en estado EMITIDO (Estado actual: %).', v_ticket.estado;
    END IF;

    -- Regla 1: Exactamente <= 60 segundos posteriores a su emisión
    v_segundos_transcurridos := EXTRACT(EPOCH FROM (NOW() - v_ticket.created_at));
    IF v_segundos_transcurridos > 60 THEN
        RAISE EXCEPTION 'TIEMPO_ANULACION_EXPIRADO: Han transcurrido % segundos desde la emisión (límite máximo: 60 segundos).',
            ROUND(v_segundos_transcurridos, 0);
    END IF;

    -- Regla 2: Faltar más de 3 minutos para todos los sorteos incluidos en el ticket y liberar cupo
    FOR v_detalle IN
        SELECT td.sorteo_diario_id, td.animal_numero, td.monto_usd,
               sd.fecha, sd.estado, hs.hora_oficial, hs.minutos_cierre_previo, hs.etiqueta
        FROM public.ticket_detalles td
        JOIN public.sorteos_diarios sd ON sd.id = td.sorteo_diario_id
        JOIN public.horarios_sorteo hs ON hs.id = sd.horario_id
        WHERE td.ticket_id = v_ticket.id
    LOOP
        v_hora_cierre := v_detalle.hora_oficial - (v_detalle.minutos_cierre_previo || ' minutes')::INTERVAL;
        IF v_detalle.estado <> 'ABIERTO' OR (v_detalle.fecha = v_now_ve::DATE AND v_now_ve::TIME >= v_hora_cierre) THEN
            RAISE EXCEPTION 'SORTEO_EN_LOCKDOWN: No se puede anular porque el sorteo % ya entró en los 3 minutos previos al cierre.',
                v_detalle.etiqueta;
        END IF;

        -- Revertir el cupo acumulado de forma atómica
        UPDATE public.cupos_sorteo
        SET monto_acumulado_usd = GREATEST(0.00, monto_acumulado_usd - v_detalle.monto_usd),
            updated_at = NOW()
        WHERE tenant_id = v_tenant_id
          AND sorteo_diario_id = v_detalle.sorteo_diario_id
          AND animal_numero = v_detalle.animal_numero;
    END LOOP;

    -- Marcar ticket como ANULADO
    UPDATE public.tickets
    SET estado = 'ANULADO',
        anulado_at = NOW()
    WHERE id = v_ticket.id;

    -- Registrar reverso contable en `caja_movimientos`
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
        'reverso_usd', v_ticket.total_usd,
        'anulado_at', NOW()
    );
END;
$$;

-- ============================================================================
-- 5. DATOS SEMILLA INICIALES (SEED DATA: TENANT #1, MAGALY RODRÍGUEZ, LOTTO ACTIVO)
-- ============================================================================

-- 5.1 Insertar Tenant #1 ("Bodega Piloto Magaly")
INSERT INTO public.tenants (id, nombre, rif, telefono, perdida_maxima_sorteo_usd, activo)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'Bodega Piloto Magaly',
    'J-40123987-1',
    '+58 414-1234567',
    300.00, -- $300 pérdida máx aceptable => $10.00 USD de cupo máximo por animal por sorteo
    TRUE
) ON CONFLICT (rif) DO NOTHING;

-- 5.2 Insertar Tasa Oficial BCV Inicial
INSERT INTO public.tasas_cambio (fuente, tasa, fecha_vigencia)
VALUES ('BCV', 45.8500, (NOW() AT TIME ZONE 'America/Caracas')::DATE);

-- 5.3 Insertar Lotería Oficial "Lotto Activo" (38 figuras, paga 30x)
INSERT INTO public.loterias (id, nombre, total_figuras, multiplicador_premio, activa)
VALUES (1, 'Lotto Activo', 38, 30.00, TRUE)
ON CONFLICT (nombre) DO NOTHING;

-- 5.4 Insertar los 11 Horarios Oficiales de Lotto Activo (09:00 AM a 07:00 PM, cierre 3 min antes)
INSERT INTO public.horarios_sorteo (loteria_id, hora_oficial, etiqueta, minutos_cierre_previo, activo)
VALUES
    (1, '09:00:00', '09:00 AM', 3, TRUE),
    (1, '10:00:00', '10:00 AM', 3, TRUE),
    (1, '11:00:00', '11:00 AM', 3, TRUE),
    (1, '12:00:00', '12:00 PM', 3, TRUE),
    (1, '13:00:00', '01:00 PM', 3, TRUE),
    (1, '14:00:00', '02:00 PM', 3, TRUE),
    (1, '15:00:00', '03:00 PM', 3, TRUE),
    (1, '16:00:00', '04:00 PM', 3, TRUE),
    (1, '17:00:00', '05:00 PM', 3, TRUE),
    (1, '18:00:00', '06:00 PM', 3, TRUE),
    (1, '19:00:00', '07:00 PM', 3, TRUE)
ON CONFLICT (loteria_id, hora_oficial) DO NOTHING;

-- 5.5 Inicializar los sorteos diarios para la fecha actual
SELECT public.asegurar_sorteos_del_dia();

-- 5.6 Aprovisionamiento del Usuario Inicial de Prueba (Magaly Rodríguez) en `auth.users` y `public.usuarios`
DO $$
DECLARE
    v_magaly_uid UUID := '22222222-2222-4222-8222-222222222222';
    v_tenant_magaly UUID := '11111111-1111-4111-8111-111111111111';
BEGIN
    -- Crear cuenta en auth.users si no existe (Contraseña: 123456789)
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'magaly.rodriguez@bancapro.local') THEN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
            confirmation_token, recovery_token, email_change_token_new, email_change,
            created_at, updated_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_magaly_uid,
            'authenticated',
            'authenticated',
            'magaly.rodriguez@bancapro.local',
            crypt('123456789', gen_salt('bf')),
            NOW(),
            '{"provider": "email", "providers": ["email"], "tenant_id": "11111111-1111-4111-8111-111111111111", "rol": "admin_comercio"}'::JSONB,
            '{"nombre": "Magaly Rodríguez"}'::JSONB,
            '', '', '', '',
            NOW(),
            NOW()
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(),
            v_magaly_uid,
            format('{"sub":"%s","email":"%s"}', v_magaly_uid::TEXT, 'magaly.rodriguez@bancapro.local')::JSONB,
            'email',
            v_magaly_uid::TEXT,
            NOW(),
            NOW(),
            NOW()
        );
    ELSE
        SELECT id INTO v_magaly_uid FROM auth.users WHERE email = 'magaly.rodriguez@bancapro.local' LIMIT 1;
    END IF;

    -- Vincular perfil en `public.usuarios` asociado a "Bodega Piloto Magaly"
    INSERT INTO public.usuarios (id, tenant_id, nombre, email, rol, activo)
    VALUES (
        v_magaly_uid,
        v_tenant_magaly,
        'Magaly Rodríguez',
        'magaly.rodriguez@bancapro.local',
        'admin_comercio',
        TRUE
    ) ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        nombre = EXCLUDED.nombre,
        rol = EXCLUDED.rol,
        activo = TRUE;
END;
$$;
