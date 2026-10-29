-- ============================================================================
-- MIGRACIÓN 003: FIX GOTRUE AUTH.USERS NULL TOKENS + CANAL WHATSAPP
-- Soluciona el error 500 "Database error querying schema" en Supabase Auth
-- al autenticar a Magaly Rodríguez (magaly.rodriguez@bancapro.local)
-- ============================================================================

-- 1. Asegurar que los campos token de auth.users sean cadenas vacías '' y no NULL (Requerido por GoTrue v2)
UPDATE auth.users
SET
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    reauthentication_token = COALESCE(reauthentication_token, ''),
    is_sso_user = COALESCE(is_sso_user, FALSE),
    is_anonymous = COALESCE(is_anonymous, FALSE)
WHERE email = 'magaly.rodriguez@bancapro.local';

-- 2. Asegurar columnas de comprobante digital por WhatsApp en `public.tickets`
ALTER TABLE public.tickets
    ADD COLUMN IF NOT EXISTS cliente_telefono VARCHAR(30),
    ADD COLUMN IF NOT EXISTS canal_entrega VARCHAR(25) NOT NULL DEFAULT 'WHATSAPP'
        CHECK (canal_entrega IN ('WHATSAPP', 'TERMICA_ESCPOS', 'AMBOS')),
    ADD COLUMN IF NOT EXISTS whatsapp_enviado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_cliente_telefono
    ON public.tickets (tenant_id, cliente_telefono);
