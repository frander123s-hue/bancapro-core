import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolverFiguraPorInput } from "@/lib/constants/animalitos";

export const dynamic = "force-dynamic";

/**
 * CRON JOB AUTOMATIZADO: SINCRONIZACIÓN DE RESULTADOS LOTTO ACTIVO
 * Frecuencia: Cada 10 minutos entre las 8:50 AM y las 7:10 PM (Hora de Venezuela, UTC-4).
 *
 * Responsabilidad:
 * 1. Asegura que los 11 sorteos diarios de Lotto Activo estén creados en `sorteos_diarios`.
 * 2. Consulta el feed externo de resultados oficiales de Lotto Activo.
 * 3. Al detectar el animal ganador (0, 00, 1..36) de un sorteo pendiente, ejecuta el Stored Procedure
 *    transaccional `liquidar_sorteo(p_sorteo_id, p_animal_ganador, 'AUTO_CRON')` que liquida todos los
 *    tenants simultáneamente en milisegundos con aislamiento de caja por comercio.
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
        { ok: false, error: "No autorizado para ejecutar Cron Job" },
        { status: 401 }
      );
    }

    const supabase = createServerSupabaseClient();

    // 1. Asegurar que los sorteos del día actual existen en `sorteos_diarios`
    await supabase.rpc("asegurar_sorteos_del_dia");

    // 2. Consultar los sorteos del día aún no liquidados
    const fechaCaracas = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const { data: sorteosPendientes, error: errSorteos } = await supabase
      .from("sorteos_diarios")
      .select(
        `
        id,
        fecha,
        estado,
        horarios_sorteo (
          hora_oficial,
          etiqueta
        )
      `
      )
      .eq("fecha", fechaCaracas)
      .neq("estado", "LIQUIDADO");

    if (errSorteos) {
      return NextResponse.json(
        { ok: false, error: errSorteos.message },
        { status: 500 }
      );
    }

    // 3. Consultar feed oficial / proveedor externo de resultados de Lotto Activo
    const externalFeedUrl =
      process.env.LOTTO_ACTIVO_API_URL ||
      "https://api.loteriadehoy.com/v1/resultados/lottoactivo";

    let resultadosExternos: Array<{ hora: string; numero: string }> = [];

    try {
      const resp = await fetch(externalFeedUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json?.resultados)) {
          resultadosExternos = json.resultados;
        }
      }
    } catch {
      // Si el proveedor externo demora o cae, el sistema mantiene los sorteos intactos
      // y habilita el Fail-safe Manual de dos pasos en el panel administrativo.
    }

    const liquidadosAhora: unknown[] = [];

    for (const sorteo of sorteosPendientes ?? []) {
      const horarioObj = Array.isArray(sorteo.horarios_sorteo)
        ? sorteo.horarios_sorteo[0]
        : sorteo.horarios_sorteo;

      if (!horarioObj) continue;

      const match = resultadosExternos.find(
        (r) =>
          r.hora === horarioObj.etiqueta ||
          r.hora === horarioObj.hora_oficial.slice(0, 5)
      );

      if (match) {
        const figura = resolverFiguraPorInput(match.numero);
        if (figura) {
          const { data: liqData, error: liqError } = await supabase.rpc(
            "liquidar_sorteo",
            {
              p_sorteo_id: sorteo.id,
              p_animal_ganador: figura.dbNumber,
              p_metodo: "AUTO_CRON",
            }
          );

          if (!liqError && liqData) {
            liquidadosAhora.push(liqData);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      fecha_operativa: fechaCaracas,
      sorteos_verificados: sorteosPendientes?.length ?? 0,
      sorteos_liquidados: liquidadosAhora.length,
      detalles: liquidadosAhora,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error en sincronización de resultados",
      },
      { status: 500 }
    );
  }
}
