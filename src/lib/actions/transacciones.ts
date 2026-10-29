"use server";

import crypto from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface JugadaInput {
  sorteo_diario_id: number;
  animal_numero: number; // 0 = Delfín, 37 = Ballena ("00"), 1..36 = Carnero..Culebra
  monto_usd: number;
}

export interface EmitirTicketResultado {
  ok: boolean;
  error?: string;
  codigoError?:
    | "LOCKDOWN_ACTIVO"
    | "CUPO_AGOTADO"
    | "NO_AUTORIZADO"
    | "ERROR_TRANSACCIONAL";
  ticket?: {
    ticket_id: string;
    serial_corto: number;
    tenant_id: string;
    codigo_seguridad: string;
    qr_payload: string;
    total_usd: number;
    total_bs: number;
    tasa_cambio: number;
    created_at: string;
  };
}

const SERVER_HMAC_SECRET =
  process.env.TICKET_HMAC_SECRET ||
  "bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210";

/**
 * Genera o verifica la firma HMAC-SHA256 del ticket en el servidor Node.js:
 * Hash = HMAC-SHA256(SECRET, "tenant_id|ticket_id|monto|timestamp")
 */
export async function generarFirmaHmacTicket(
  tenantId: string,
  ticketId: string,
  montoUsd: number,
  timestampEpoch: number
): Promise<string> {
  const payload = `${tenantId}|${ticketId}|${montoUsd.toFixed(2)}|${timestampEpoch}`;
  return crypto
    .createHmac("sha256", SERVER_HMAC_SECRET)
    .update(payload)
    .digest("hex");
}

/**
 * 1. EMISIÓN ATÓMICA DE TICKET (`emitirTicket`)
 * - Valida sesión GoTrue activa.
 * - Valida en PostgreSQL (`NOW()`) que falten más de 3 minutos para el sorteo (Lockdown T - 3 min).
 * - Bloquea con `SELECT ... FOR UPDATE` la fila en `cupos_sorteo` del tenant actual.
 * - Si `monto_acumulado + nuevo_monto > cupo_maximo`, aborta con `ROLLBACK` ("Cupo agotado para esta figura").
 * - Congela la tasa oficial BCV en `tasa_cambio` y firma el ticket con HMAC-SHA256.
 */
export async function emitirTicket(
  jugadas: JugadaInput[],
  clienteTelefono?: string,
  canalEntrega: "WHATSAPP" | "TERMICA_ESCPOS" | "AMBOS" = "WHATSAPP"
): Promise<EmitirTicketResultado> {
  try {
    if (!jugadas || jugadas.length === 0) {
      return {
        ok: false,
        error: "El ticket debe incluir al menos una jugada.",
        codigoError: "ERROR_TRANSACCIONAL",
      };
    }

    const supabase = createServerSupabaseClient();

    // Validar sesión autenticada GoTrue
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        error:
          "NO_AUTORIZADO: Debe iniciar sesión con una cuenta de operador activa para emitir tickets.",
        codigoError: "NO_AUTORIZADO",
      };
    }

    // Intentar invocación con 4 argumentos
    let rpcResponse = await supabase.rpc("emitir_ticket", {
      p_jugadas: jugadas,
      p_secret_key: SERVER_HMAC_SECRET,
      p_cliente_telefono: clienteTelefono ?? null,
      p_canal_entrega: canalEntrega,
    });

    // Fallback de compatibilidad: si la BD aún tiene la firma de 2 argumentos (PGRST202)
    if (rpcResponse.error && rpcResponse.error.code === "PGRST202") {
      rpcResponse = await supabase.rpc("emitir_ticket", {
        p_jugadas: jugadas,
        p_secret_key: SERVER_HMAC_SECRET,
      });
    }

    const { data, error } = rpcResponse;

    if (error) {
      const msg = error.message || "Error al procesar la transacción";
      if (msg.includes("CUPO_AGOTADO")) {
        return {
          ok: false,
          error: msg.replace(/^.*CUPO_AGOTADO:\s*/, ""),
          codigoError: "CUPO_AGOTADO",
        };
      }
      if (msg.includes("LOCKDOWN_ACTIVO") || msg.includes("SORTEO_CERRADO")) {
        return {
          ok: false,
          error: msg.replace(/^.*(LOCKDOWN_ACTIVO|SORTEO_CERRADO):\s*/, ""),
          codigoError: "LOCKDOWN_ACTIVO",
        };
      }
      if (msg.includes("NO_AUTORIZADO") || msg.includes("TENANT_INVALIDO")) {
        return {
          ok: false,
          error: msg,
          codigoError: "NO_AUTORIZADO",
        };
      }
      return {
        ok: false,
        error: msg,
        codigoError: "ERROR_TRANSACCIONAL",
      };
    }

    if (!data || !data.ticket_id) {
      return {
        ok: false,
        error: "Respuesta de emisión de ticket vacía o incompleta desde el servidor.",
        codigoError: "ERROR_TRANSACCIONAL",
      };
    }

    const qrPayload = `BANCAPRO|${data.tenant_id}|${data.ticket_id}|${Number(
      data.total_usd
    ).toFixed(2)}|${data.timestamp_epoch}|${data.codigo_seguridad}`;

    return {
      ok: true,
      ticket: {
        ticket_id: data.ticket_id,
        serial_corto: Number(data.serial_corto),
        tenant_id: data.tenant_id,
        codigo_seguridad: data.codigo_seguridad,
        qr_payload: qrPayload,
        total_usd: Number(data.total_usd),
        total_bs: Number(data.total_bs),
        tasa_cambio: Number(data.tasa_cambio),
        created_at: data.created_at || new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Error inesperado en el servidor";
    return {
      ok: false,
      error: message,
      codigoError: "ERROR_TRANSACCIONAL",
    };
  }
}

/**
 * 2. MOTOR DE LIQUIDACIÓN DE SORTEO (`liquidarSorteo`)
 * - Invoca el Stored Procedure `liquidar_sorteo(p_sorteo_id, p_animal_ganador, p_metodo)` en PostgreSQL.
 * - Exige rol `superadmin`.
 */
export async function liquidarSorteo(
  sorteoId: number,
  animalGanador: number,
  metodo: "AUTO_CRON" | "MANUAL_CONTINGENCIA" = "MANUAL_CONTINGENCIA"
) {
  try {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        error: "NO_AUTORIZADO: Se requiere autenticación para liquidar sorteos.",
      };
    }

    const { data, error } = await supabase.rpc("liquidar_sorteo", {
      p_sorteo_id: sorteoId,
      p_animal_ganador: animalGanador,
      p_metodo: metodo,
    });

    if (error) {
      return {
        ok: false,
        error: error.message,
      };
    }

    return {
      ok: true,
      resultado: data,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error al liquidar el sorteo",
    };
  }
}

/**
 * 3. COBRO Y VERIFICACIÓN DE PREMIO CON FIRMA QR O PIN (`pagarTicketGanador`)
 * - Soporta formato QR `BANCAPRO|...`, PIN digital `XXXXXXX-XXXXXXXX`, o código de seguridad.
 * - Transiciona de forma idempotente de `GANADOR` a `PAGADO` e impacta `caja_movimientos`.
 */
export async function pagarTicketGanador(qrOrHashInput: string) {
  try {
    const limpio = qrOrHashInput.trim();
    if (!limpio) {
      return { ok: false, error: "Debe ingresar el código QR o PIN del ticket." };
    }

    const supabase = createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        error: "NO_AUTORIZADO: Debe iniciar sesión para procesar pagos de tickets.",
      };
    }

    // 1. Si proviene del lector QR en formato: BANCAPRO|tenant_id|ticket_id|monto|epoch|hmac_hash
    if (limpio.startsWith("BANCAPRO|")) {
      const partes = limpio.split("|");
      if (partes.length !== 6) {
        return {
          ok: false,
          error: "Formato de código QR corrupto o adulterado.",
        };
      }
      const [, tenantId, ticketId, montoStr, epochStr, hashRecibido] = partes;
      const hashCalculado = await generarFirmaHmacTicket(
        tenantId,
        ticketId,
        parseFloat(montoStr),
        parseInt(epochStr, 10)
      );

      if (hashCalculado !== hashRecibido) {
        return {
          ok: false,
          error:
            "ALERTA ANTI-FRAUDE: La firma criptográfica HMAC-SHA256 del QR no coincide con el secreto del servidor.",
        };
      }

      const { data, error } = await supabase.rpc("pagar_ticket_ganador", {
        p_codigo_seguridad: hashRecibido,
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      return { ok: true, pago: data };
    }

    // 2. Si es un PIN de WhatsApp (ej. 0001042-9F4C2E81) o serial corto:
    // Primero intentar mediante `pagar_ticket_por_pin`
    const { data: dataPin, error: errorPin } = await supabase.rpc(
      "pagar_ticket_por_pin",
      { p_pin: limpio }
    );

    if (!errorPin) {
      return { ok: true, pago: dataPin };
    }

    // Si `pagar_ticket_por_pin` no existe aún o dio error de no encontrado, probar `pagar_ticket_ganador`
    if (errorPin.code === "PGRST202" || errorPin.code === "42883") {
      const { data, error } = await supabase.rpc("pagar_ticket_ganador", {
        p_codigo_seguridad: limpio,
      });

      if (error) {
        return { ok: false, error: error.message };
      }
      return { ok: true, pago: data };
    }

    return {
      ok: false,
      error: errorPin.message || "Error al procesar el pago del ticket",
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error al procesar el pago del ticket",
    };
  }
}

/**
 * 4. ANULACIÓN DE TICKET (< 60 segundos desde emisión Y > 3 minutos antes del sorteo)
 */
export async function anularTicket(ticketId: string) {
  try {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        error: "NO_AUTORIZADO: Debe iniciar sesión para anular tickets.",
      };
    }

    const { data, error } = await supabase.rpc("anular_ticket", {
      p_ticket_id: ticketId,
    });

    if (error) {
      return {
        ok: false,
        error: error.message,
      };
    }

    return {
      ok: true,
      anulacion: data,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al anular el ticket",
    };
  }
}

/**
 * 5. ACTUALIZACIÓN DE TASA BCV (Para Cron / Admin)
 */
export async function actualizarTasaBcv(tasa: number, fecha?: string) {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.rpc("actualizar_tasa_bcv", {
      p_tasa: tasa,
      p_fecha: fecha ?? null,
    });

    if (error) {
      // Fallback a inserción directa si el procedure no está instalado
      if (error.code === "PGRST202" || error.code === "42883") {
        const fechaVigencia = fecha || new Date().toISOString().split("T")[0];
        const { data: insData, error: insErr } = await supabase
          .from("tasas_cambio")
          .insert({
            fuente: "BCV",
            tasa,
            fecha_vigencia: fechaVigencia,
          })
          .select()
          .single();

        if (insErr) return { ok: false, error: insErr.message };
        return { ok: true, tasa: insData };
      }
      return { ok: false, error: error.message };
    }

    return { ok: true, tasa: data };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al actualizar tasa BCV",
    };
  }
}

/**
 * 6. OBTENER SORTEOS PARA CRON
 */
export async function obtenerSorteosCron(fecha?: string) {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.rpc("obtener_sorteos_cron", {
      p_fecha: fecha ?? null,
    });

    if (error) {
      // Fallback a select directo
      const fechaConsulta = fecha || new Date().toISOString().split("T")[0];
      const { data: selData, error: selErr } = await supabase
        .from("sorteos_diarios")
        .select(`
          id, fecha, estado, animal_ganador, horario_id,
          horarios_sorteo (hora_oficial, etiqueta, minutos_cierre_previo)
        `)
        .eq("fecha", fechaConsulta);

      if (selErr) return { ok: false, error: selErr.message };
      return { ok: true, sorteos: selData };
    }

    return { ok: true, sorteos: data };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al consultar sorteos cron",
    };
  }
}

/**
 * 7. OBTENER TASA BCV ACTUAL (Lectura pública para POS)
 */
export async function obtenerTasaBcvActual(): Promise<number> {
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from("tasas_cambio")
      .select("tasa")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data?.tasa && Number(data.tasa) > 0) {
      return Number(data.tasa);
    }
  } catch {
    // fallback
  }
  return 45.85;
}

/**
 * 8. CONSULTAR TICKET POR PARÁMETRO DE URL (?ticket=...)
 * Soporta formato QR BANCAPRO|tenant|ticket|monto|epoch|hash, UUID de ticket o código de seguridad
 */
export async function consultarTicketPorParametro(ticketParam: string) {
  try {
    const supabase = createServerSupabaseClient();
    const limpio = (ticketParam || "").trim();
    if (!limpio) return { ok: false, error: "Parámetro de ticket vacío" };

    let ticketId: string = limpio;
    let qrVerificado = false;

    if (limpio.startsWith("BANCAPRO|")) {
      const parts = limpio.split("|");
      if (parts.length >= 6) {
        const [, tenantId, tId, montoStr, epochStr, hash] = parts;
        ticketId = tId;
        const calcHash = await generarFirmaHmacTicket(
          tenantId,
          tId,
          parseFloat(montoStr),
          parseInt(epochStr, 10)
        );
        qrVerificado = calcHash === hash;
      }
    }

    // 1. Intentar consulta directa a tickets
    const { data: ticket, error: errTicket } = await supabase
      .from("tickets")
      .select("*, tenants(nombre, rif, telefono)")
      .eq("id", ticketId)
      .maybeSingle();

    if (ticket) {
      const { data: detalles } = await supabase
        .from("ticket_detalles")
        .select(`
          id, animal_numero, monto_usd, premio_potencial_usd, es_ganador, premio_liquidado_usd,
          sorteos_diarios (
            fecha, estado, animal_ganador,
            horarios_sorteo (hora_oficial, etiqueta)
          )
        `)
        .eq("ticket_id", ticketId);

      return {
        ok: true,
        ticket: {
          ...ticket,
          detalles: detalles || [],
        },
        qrVerificado,
      };
    }

    // 2. Fallback a RPC SECURITY DEFINER si está configurado
    if (typeof supabase.rpc === "function") {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "consultar_ticket_publico",
        { p_ticket_param: limpio }
      );
      if (!rpcErr && rpcData) {
        return { ok: true, ticket: rpcData, qrVerificado };
      }
    }

    return { ok: false, error: "Ticket no encontrado en el sistema." };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error al consultar ticket",
    };
  }
}
