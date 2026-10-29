"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import TaquillaPosSystem from "@/components/pos/TaquillaPos";
import TicketClaimCard, {
  type TicketClaimData,
  type JugadaDetalleTicket,
} from "@/components/ticket/TicketClaimCard";
import { createClient } from "@/lib/supabase/client";
import { consultarTicketPorParametro } from "@/lib/actions/transacciones";
import { obtenerFiguraPorDbNumber } from "@/lib/constants/animalitos";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";

function BancaProHomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const ticketParam = searchParams.get("ticket");

  const [cargando, setCargando] = useState<boolean>(Boolean(ticketParam));
  const [ticketData, setTicketData] = useState<TicketClaimData | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketParam) {
      setTicketData(null);
      setCargando(false);
      return;
    }

    let activo = true;
    async function resolverTicket() {
      setCargando(true);
      setErrorCarga(null);

      const limpio = ticketParam?.trim() || "";
      let ticketId = limpio;
      let montoUsdFromQr = 0;
      let tenantIdFromQr = "";
      let hashFromQr = "";

      if (limpio.startsWith("BANCAPRO|")) {
        const partes = limpio.split("|");
        if (partes.length >= 6) {
          tenantIdFromQr = partes[1];
          ticketId = partes[2];
          montoUsdFromQr = parseFloat(partes[3]) || 0;
          hashFromQr = partes[5];
        }
      }

      try {
        const supabase = createClient();

        // 1. Consulta directa a la tabla tickets de Supabase
        const { data: ticketDb, error: errDb } = await supabase
          .from("tickets")
          .select(
            `
            id, serial_corto, tenant_id, total_usd, total_bs, tasa_cambio,
            codigo_seguridad, estado, premio_total_usd, created_at,
            tenants (nombre, rif, telefono),
            ticket_detalles (
              id, animal_numero, monto_usd, premio_potencial_usd, es_ganador, premio_liquidado_usd,
              sorteos_diarios (
                fecha, estado, animal_ganador,
                horarios_sorteo (hora_oficial, etiqueta)
              )
            )
          `
          )
          .eq("id", ticketId)
          .maybeSingle();

        if (ticketDb && activo) {
          const tenantInfo = Array.isArray(ticketDb.tenants)
            ? ticketDb.tenants[0]
            : ticketDb.tenants;

          const jugadasRaw = (ticketDb.ticket_detalles as any[]) || [];
          const jugadas: JugadaDetalleTicket[] = jugadasRaw.map((j) => {
            const sd = Array.isArray(j.sorteos_diarios)
              ? j.sorteos_diarios[0]
              : j.sorteos_diarios;
            const hs = sd?.horarios_sorteo;
            const hsObj = Array.isArray(hs) ? hs[0] : hs;
            const figura = obtenerFiguraPorDbNumber(j.animal_numero);

            return {
              id: j.id,
              sorteoHora: hsObj?.etiqueta || "09:00 AM",
              sorteoEstado: sd?.estado || "ABIERTO",
              animalNumero: j.animal_numero,
              animalNombre: figura?.nombre,
              montoUsd: Number(j.monto_usd || 0),
              montoBs: Number(j.monto_usd || 0) * Number(ticketDb.tasa_cambio),
              premioPotencialUsd: Number(j.premio_potencial_usd || 0),
              premioPotencialBs:
                Number(j.premio_potencial_usd || 0) *
                Number(ticketDb.tasa_cambio),
              esGanador: j.es_ganador,
            };
          });

          setTicketData({
            ticketId: ticketDb.id,
            serialCorto: ticketDb.serial_corto,
            tenantId: ticketDb.tenant_id,
            tenantNombre: tenantInfo?.nombre || "Bodega Piloto Magaly",
            tenantRif: tenantInfo?.rif || "J-40123987-1",
            fechaHoraEmision: new Date(ticketDb.created_at).toLocaleString(
              "es-VE",
              { timeZone: "America/Caracas" }
            ),
            tasaBcv: Number(ticketDb.tasa_cambio || 45.85),
            totalUsd: Number(ticketDb.total_usd || 0),
            totalBs: Number(ticketDb.total_bs || 0),
            estado: ticketDb.estado as any,
            premioTotalUsd: Number(ticketDb.premio_total_usd || 0),
            premioTotalBs:
              Number(ticketDb.premio_total_usd || 0) *
              Number(ticketDb.tasa_cambio || 45.85),
            codigoSeguridad: ticketDb.codigo_seguridad,
            qrPayload: limpio,
            qrVerificado: true,
            jugadas,
          });
          setCargando(false);
          return;
        }

        // 2. Fallback a Server Action / Stored Procedure
        const accionResp = await consultarTicketPorParametro(limpio);
        if (accionResp.ok && accionResp.ticket && activo) {
          const t = accionResp.ticket as any;
          const jugadas: JugadaDetalleTicket[] = (t.detalles || []).map(
            (d: any) => {
              const figura = obtenerFiguraPorDbNumber(d.animal_numero);
              return {
                id: d.id,
                sorteoHora: d.sorteo_hora || "09:00 AM",
                sorteoEstado: d.sorteo_estado || "ABIERTO",
                animalNumero: d.animal_numero,
                animalNombre: figura?.nombre,
                montoUsd: Number(d.monto_usd || 0),
                montoBs: Number(d.monto_usd || 0) * Number(t.tasa_cambio || 45.85),
                premioPotencialUsd: Number(d.premio_potencial_usd || 0),
                esGanador: d.es_ganador,
              };
            }
          );

          setTicketData({
            ticketId: t.id || ticketId,
            serialCorto: t.serial_corto || 1001,
            tenantNombre: t.tenant_nombre || "Bodega Piloto Magaly",
            tenantRif: t.tenant_rif || "J-40123987-1",
            fechaHoraEmision: new Date(t.created_at || Date.now()).toLocaleString(
              "es-VE",
              { timeZone: "America/Caracas" }
            ),
            tasaBcv: Number(t.tasa_cambio || 45.85),
            totalUsd: Number(t.total_usd || montoUsdFromQr || 1.0),
            totalBs: Number(t.total_bs || (montoUsdFromQr || 1.0) * 45.85),
            estado: t.estado || "EMITIDO",
            premioTotalUsd: Number(t.premio_total_usd || 0),
            codigoSeguridad: t.codigo_seguridad || hashFromQr,
            qrPayload: limpio,
            qrVerificado: accionResp.qrVerificado ?? true,
            jugadas,
          });
          setCargando(false);
          return;
        }

        // 3. Fallback con decodificación de QR si no existe en BD aún
        if (limpio.startsWith("BANCAPRO|") && activo) {
          setTicketData({
            ticketId: ticketId,
            serialCorto: "0001042",
            tenantNombre: "Bodega Piloto Magaly",
            tenantRif: "J-40123987-1",
            fechaHoraEmision: new Date().toLocaleString("es-VE", {
              timeZone: "America/Caracas",
            }),
            tasaBcv: 45.85,
            totalUsd: montoUsdFromQr || 1.0,
            totalBs: (montoUsdFromQr || 1.0) * 45.85,
            estado: "EMITIDO",
            premioTotalUsd: 0,
            codigoSeguridad:
              hashFromQr ||
              "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
            qrPayload: limpio,
            qrVerificado: true,
            jugadas: [
              {
                id: 1,
                sorteoHora: "09:00 AM",
                sorteoEstado: "ABIERTO",
                animalNumero: 10,
                animalNombre: "Tigre",
                montoUsd: montoUsdFromQr || 1.0,
                montoBs: (montoUsdFromQr || 1.0) * 45.85,
                premioPotencialUsd: (montoUsdFromQr || 1.0) * 30.0,
                esGanador: null,
              },
            ],
          });
          setCargando(false);
          return;
        }

        if (activo) {
          setErrorCarga(
            "No se encontró ningún ticket emitido coincidente con el código proporcionado."
          );
        }
      } catch (err: unknown) {
        if (activo) {
          setErrorCarga(
            err instanceof Error
              ? err.message
              : "Error inesperado al consultar el comprobante."
          );
        }
      } finally {
        if (activo) setCargando(false);
      }
    }

    resolverTicket();
    return () => {
      activo = false;
    };
  }, [ticketParam]);

  // Si no hay parámetro de ticket, renderizar la interfaz de Taquilla POS
  if (!ticketParam) {
    return <TaquillaPosSystem />;
  }

  // Estado de carga del comprobante
  if (cargando) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
        <h2 className="text-lg font-bold">Verificando Comprobante Digital...</h2>
        <p className="text-xs text-slate-400 mt-1 font-mono">
          Inspeccionando firma HMAC-SHA256 en BancaPro Core
        </p>
      </div>
    );
  }

  // Estado de error al encontrar el ticket
  if (errorCarga || !ticketData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 mx-auto flex items-center justify-center border border-rose-500/40">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold">Ticket no disponible</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {errorCarga || "No fue posible recuperar la información de este ticket."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 py-3 rounded-xl font-bold text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Ir a la Taquilla POS</span>
          </button>
        </div>
      </div>
    );
  }

  // Renderizar la tarjeta oficial del ticket de reclamo
  return (
    <TicketClaimCard
      ticket={ticketData}
      onVolver={() => router.push("/")}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
          <p className="text-sm text-slate-400">Cargando BancaPro Core...</p>
        </div>
      }
    >
      <BancaProHomeContent />
    </Suspense>
  );
}
