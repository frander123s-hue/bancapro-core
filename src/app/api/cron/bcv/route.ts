import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * CRON JOB AUTOMATIZADO: SINCRONIZACIÓN DE TASA OFICIAL BCV (USD/VES)
 * Frecuencia: Cada 6 horas (00:00, 06:00, 12:00, 18:00).
 *
 * Consulta el API pública de cotización oficial del Banco Central de Venezuela (BCV)
 * y almacena el histórico en `tasas_cambio`. Los tickets emitidos congelan la tasa exacta
 * vigente al segundo de su creación (`tasa_cambio`).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (
      cronSecret &&
      authHeader !== `Bearer ${cronSecret}` &&
      request.nextUrl.searchParams.get("key") !== cronSecret
    ) {
      return NextResponse.json(
        { ok: false, error: "No autorizado para ejecutar Cron BCV" },
        { status: 401 }
      );
    }

    let tasaBcvDetectada: number | null = null;

    // 1. Consulta a endpoint primario de tasa oficial BCV (DolarApi Venezuela / BCV Oficial)
    try {
      const response = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) {
        const data = await response.json();
        const promedio = Number(data?.promedio);
        if (!isNaN(promedio) && promedio > 0) {
          tasaBcvDetectada = Number(promedio.toFixed(4));
        }
      }
    } catch {
      // Fallback silencioso a la última tasa registrada si el servicio externo falla
    }

    const supabase = createServerSupabaseClient();

    if (tasaBcvDetectada && tasaBcvDetectada > 0) {
      const fechaCaracas = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Caracas",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      await supabase.from("tasas_cambio").insert({
        fuente: "BCV",
        tasa: tasaBcvDetectada,
        fecha_vigencia: fechaCaracas,
      });
    }

    const { data: ultimaTasa } = await supabase
      .from("tasas_cambio")
      .select("id, fuente, tasa, fecha_vigencia, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      ok: true,
      actualizado_desde_fuente_externa: Boolean(tasaBcvDetectada),
      tasa_vigente: ultimaTasa ?? {
        fuente: "BCV",
        tasa: tasaBcvDetectada ?? 45.85,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al sincronizar tasa oficial BCV",
      },
      { status: 500 }
    );
  }
}
