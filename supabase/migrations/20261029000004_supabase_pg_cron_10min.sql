-- ============================================================================
-- MIGRACIÓN 004: CRON JOBS NATIVOS EN SUPABASE (PG_CRON + PG_NET) CADA 10 MINUTOS
-- Ejecuta la sincronización de resultados de Lotto Activo cada 10 minutos
-- y la sincronización de tasa oficial BCV cada 6 horas directamente desde Supabase,
-- sin depender de los límites del plan Hobby de Vercel.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Asegurar que los sorteos diarios se creen automáticamente todos los días a las 08:00 AM (12:00 UTC)
SELECT cron.schedule(
    'bancapro_inicializar_sorteos_diarios',
    '0 12 * * *',
    $$SELECT public.asegurar_sorteos_del_dia();$$
);

-- Disparar el endpoint de resultados de Lotto Activo cada 10 minutos entre las 8:50 AM y las 7:10 PM (12:50 - 23:10 UTC)
SELECT cron.schedule(
    'bancapro_sincronizar_resultados_lotto_activo',
    '*/10 12-23 * * *',
    $$
    SELECT net.http_get(
        url := 'https://bancapro-core-venezuela.vercel.app/api/cron/resultados?key=bancapro_cron_job_auth_secret_2026'
    );
    $$
);

-- Disparar el endpoint de Tasa Oficial BCV cada 6 horas
SELECT cron.schedule(
    'bancapro_sincronizar_tasa_bcv',
    '0 */6 * * *',
    $$
    SELECT net.http_get(
        url := 'https://bancapro-core-venezuela.vercel.app/api/cron/bcv?key=bancapro_cron_job_auth_secret_2026'
    );
    $$
);
