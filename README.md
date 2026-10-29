# BancaPro Core — Plataforma SaaS Multi-Tenant para Lotería de Animalitos (Lotto Activo)

Arquitectura transaccional de alta concurrencia construida con **Next.js 14+ (App Router)**, **Supabase (PostgreSQL, Auth, Row Level Security - RLS, Stored Procedures ACID)**, **Tailwind CSS**, **TypeScript** y soporte nativo de impresión térmica **ESC/POS (58mm y 80mm)**.

## Características de Arquitectura y Seguridad

1. **Aislamiento Total Multi-Tenant (RLS):**
   - Cada comercio (`tenants`) opera en una bóveda lógica aislada mediante políticas `ROW LEVEL SECURITY` basadas en `public.get_my_tenant_id()`.
   - Usuario inicial aprovisionado en la migración: **Magaly Rodríguez** (`magaly.rodriguez@bancapro.local` / `123456789`) asignada al Tenant #1 (**Bodega Piloto Magaly**).

2. **Corte de Sorteo (Lockdown) Estricto en Servidor ($T - 3\text{ minutos}$):**
   - La función `public.emitir_ticket()` valida directamente con el reloj de PostgreSQL (`NOW() AT TIME ZONE 'America/Caracas'`) que falten más de 3 minutos para el sorteo.

3. **Control Atómico de Cupo de Riesgo (`FOR UPDATE`):**
   - Fórmula de riesgo configurable por comercio: $\text{Cupo Máximo por Animal} = \frac{\text{Pérdida Máxima Aceptable}}{30}$.
   - Bloqueo pesimista por fila en `cupos_sorteo` que rechaza con `ROLLBACK` inmediato cuando `monto_acumulado + nuevo_monto > cupo_maximo`.

4. **Criptografía Anti-Falsificación HMAC-SHA256 y QR Idempotente:**
   - Firma generada en el servidor: $\text{Hash} = \text{HMAC-SHA256}(\text{SECRET}, \text{"tenant\_id|ticket\_id|monto|timestamp"})$.
   - El procedimiento `public.pagar_ticket_ganador()` bloquea el ticket con `FOR UPDATE` y garantiza que pase de `GANADOR` a `PAGADO` una única vez.

5. **Cron Jobs en Tiempo Real (Vercel Cron):**
   - `/api/cron/resultados`: Sincroniza cada 10 minutos los resultados oficiales de Lotto Activo y dispara `public.liquidar_sorteo()`.
   - `/api/cron/bcv`: Sincroniza cada 6 horas la tasa oficial USD/VES del Banco Central de Venezuela (BCV).
