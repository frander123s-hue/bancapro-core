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

    const { data, error } = await supabase.rpc("emitir_ticket", {
      p_jugadas: jugadas,
      p_secret_key: SERVER_HMAC_SECRET,
      p_cliente_telefono: clienteTelefono ?? null,
      p_canal_entrega: canalEntrega,
    });

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
      return {
        ok: false,
        error: msg,
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
        created_at: data.created_at,
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
 * - Liquida simultáneamente las jugadas de todos los comercios (30x el valor jugado) manteniendo aislamiento de balances.
 */
export async function liquidarSorteo(
  sorteoId: number,
  animalGanador: number,
  metodo: "AUTO_CRON" | "MANUAL_CONTINGENCIA" = "MANUAL_CONTINGENCIA"
) {
  try {
    const supabase = createServerSupabaseClient();

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
 * 3. COBRO Y VERIFICACIÓN DE PREMIO CON FIRMA QR (`pagarTicketGanador`)
 * - Verifica la autenticidad criptográfica del código QR/serial de seguridad y que pertenezca al Tenant actual.
 * - Transiciona de forma idempotente de `GANADOR` a `PAGADO` e impacta `caja_movimientos`.
 */
export async function pagarTicketGanador(qrOrHashInput: string) {
  try {
    const limpio = qrOrHashInput.trim();
    let codigoSeguridad = limpio;

    // Si proviene del lector QR en formato: BANCAPRO|tenant_id|ticket_id|monto|epoch|hmac_hash
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
      codigoSeguridad = hashRecibido;
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.rpc("pagar_ticket_ganador", {
      p_codigo_seguridad: codigoSeguridad,
    });

    if (error) {
      return {
        ok: false,
        error: error.message,
      };
    }

    return {
      ok: true,
      pago: data,
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
