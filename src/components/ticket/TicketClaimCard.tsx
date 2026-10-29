"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  Award,
  XCircle,
  Copy,
  ArrowLeft,
  Check,
  Building2,
  DollarSign,
  AlertTriangle,
  QrCode,
} from "lucide-react";
import { obtenerFiguraPorDbNumber } from "@/lib/constants/animalitos";

export interface JugadaDetalleTicket {
  id?: number | string;
  sorteoHora: string;
  sorteoEstado?: string;
  animalNumero: number;
  animalNombre?: string;
  montoUsd: number;
  montoBs?: number;
  premioPotencialUsd: number;
  premioPotencialBs?: number;
  esGanador?: boolean | null;
}

export interface TicketClaimData {
  ticketId: string;
  serialCorto: number | string;
  tenantId?: string;
  tenantNombre: string;
  tenantRif: string;
  fechaHoraEmision: string;
  tasaBcv: number;
  totalUsd: number;
  totalBs: number;
  estado: "EMITIDO" | "GANADOR" | "PAGADO" | "PERDEDOR" | "ANULADO";
  premioTotalUsd?: number;
  premioTotalBs?: number;
  codigoSeguridad: string;
  qrPayload?: string;
  qrVerificado?: boolean;
  jugadas: JugadaDetalleTicket[];
}

interface TicketClaimCardProps {
  ticket: TicketClaimData;
  onVolver?: () => void;
}

export default function TicketClaimCard({
  ticket,
  onVolver,
}: TicketClaimCardProps) {
  const [copiado, setCopiado] = useState(false);

  const hash8 = (ticket.codigoSeguridad || "").slice(0, 8).toUpperCase();
  const serialFormateado = String(ticket.serialCorto).padStart(7, "0");
  const pinReclamo = `${serialFormateado}-${hash8}`;

  const copiarPin = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(pinReclamo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  };

  const getEstadoBadge = () => {
    switch (ticket.estado) {
      case "GANADOR":
        return {
          bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          icon: Award,
          label: "¡TICKET GANADOR!",
          subtext: "Listo para cobrar en taquilla",
        };
      case "PAGADO":
        return {
          bg: "bg-blue-500/20 text-blue-300 border-blue-500/40",
          icon: CheckCircle2,
          label: "PREMIO PAGADO",
          subtext: "Cobrado satisfactoriamente",
        };
      case "PERDEDOR":
        return {
          bg: "bg-slate-700 text-slate-300 border-slate-600",
          icon: XCircle,
          label: "NO PREMIADO",
          subtext: "Sorteo finalizado",
        };
      case "ANULADO":
        return {
          bg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
          icon: AlertTriangle,
          label: "TICKET ANULADO",
          subtext: "Transacción sin validez comercial",
        };
      case "EMITIDO":
      default:
        return {
          bg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          icon: Clock,
          label: "EN JUEGO (EMITIDO)",
          subtext: "A la espera de resultados oficiales",
        };
    }
  };

  const estadoBadge = getEstadoBadge();
  const IconoEstado = estadoBadge.icon;

  const totalPremioUsd =
    ticket.premioTotalUsd && ticket.premioTotalUsd > 0
      ? ticket.premioTotalUsd
      : ticket.estado === "GANADOR"
      ? ticket.jugadas.reduce(
          (acc, j) => acc + (j.esGanador ? j.premioPotencialUsd : 0),
          0
        )
      : 0;
  const totalPremioBs =
    ticket.premioTotalBs && ticket.premioTotalBs > 0
      ? ticket.premioTotalBs
      : totalPremioUsd * ticket.tasaBcv;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Cabecera del Comercio */}
        <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-slate-900 p-6 text-white border-b border-emerald-700/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Building2 className="w-5 h-5 text-emerald-300" />
              <span className="text-xs uppercase tracking-wider font-semibold text-emerald-200">
                Lotto Activo • BancaPro
              </span>
            </div>
            {ticket.qrVerificado !== false && (
              <div className="flex items-center space-x-1 bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 px-2.5 py-1 rounded-full text-xs font-mono font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>HMAC Válida</span>
              </div>
            )}
          </div>

          <h1 className="text-2xl font-black tracking-tight text-white">
            {ticket.tenantNombre}
          </h1>
          <p className="text-sm text-emerald-100/80 font-mono mt-0.5">
            RIF: {ticket.tenantRif}
          </p>

          <div className="mt-4 pt-3 border-t border-emerald-600/30 flex items-center justify-between text-xs text-emerald-100/90 font-mono">
            <div>
              <span className="text-emerald-300 font-bold">Ticket:</span> #
              {serialFormateado}
            </div>
            <div>
              <span className="text-emerald-300 font-bold">Emisión:</span>{" "}
              {ticket.fechaHoraEmision}
            </div>
          </div>
        </div>

        {/* Estado del Ticket */}
        <div className="p-6 space-y-6">
          <div
            className={`border rounded-xl p-4 flex items-center space-x-4 ${estadoBadge.bg}`}
          >
            <div className="p-3 rounded-full bg-slate-950/40 border border-current">
              <IconoEstado className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold leading-tight">
                {estadoBadge.label}
              </h2>
              <p className="text-xs opacity-90 mt-0.5">{estadoBadge.subtext}</p>
            </div>
          </div>

          {/* Banner de Premio si es Ganador */}
          {ticket.estado === "GANADOR" && totalPremioUsd > 0 && (
            <div className="bg-gradient-to-r from-amber-500/20 to-emerald-500/20 border border-amber-500/40 rounded-xl p-4 text-center">
              <p className="text-xs uppercase tracking-widest font-semibold text-amber-300">
                Premio Oficial a Cobrar
              </p>
              <div className="text-3xl font-black text-white mt-1">
                ${totalPremioUsd.toFixed(2)}{" "}
                <span className="text-sm font-normal text-amber-200">USD</span>
              </div>
              <div className="text-sm text-amber-300 font-mono mt-0.5">
                Bs. {totalPremioBs.toFixed(2)} (Tasa: Bs. {ticket.tasaBcv.toFixed(2)})
              </div>
            </div>
          )}

          {/* Desglose de Jugadas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Jugadas Registradas ({ticket.jugadas.length})
              </h3>
              <span className="text-xs font-mono text-slate-400">
                Multiplicador 30x
              </span>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {ticket.jugadas.map((jugada, idx) => {
                const figura = obtenerFiguraPorDbNumber(jugada.animalNumero);
                const nombreAnimal =
                  jugada.animalNombre ||
                  (figura
                    ? `#${figura.codigo} ${figura.nombre}`
                    : `#${jugada.animalNumero}`);

                return (
                  <div
                    key={jugada.id ?? idx}
                    className={`p-3 rounded-lg border text-sm flex items-center justify-between ${
                      jugada.esGanador
                        ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
                        : "bg-slate-850 bg-slate-800/50 border-slate-700/60 text-slate-200"
                    }`}
                  >
                    <div>
                      <div className="font-bold flex items-center space-x-2">
                        <span>{nombreAnimal}</span>
                        {jugada.esGanador && (
                          <span className="bg-emerald-500 text-slate-950 text-[10px] px-1.5 py-0.5 rounded font-black">
                            ¡GANÓ!
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 font-mono">
                        Sorteo: {jugada.sorteoHora}
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="font-bold text-white">
                        ${jugada.montoUsd.toFixed(2)}
                      </div>
                      <div className="text-xs text-emerald-400">
                        Premio: ${jugada.premioPotencialUsd.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Resumen de Montos */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5 space-y-1.5 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Total Jugado USD:</span>
              <span className="font-bold text-slate-200">
                ${ticket.totalUsd.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Total Jugado VES:</span>
              <span className="font-bold text-slate-200">
                Bs. {ticket.totalBs.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-700/50">
              <span>Tasa Oficial BCV:</span>
              <span className="text-slate-300">
                Bs. {ticket.tasaBcv.toFixed(2)} / USD
              </span>
            </div>
          </div>

          {/* PIN de Cobro Digital */}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-bold text-slate-400">
                PIN de Cobro en Taquilla
              </span>
              <span className="text-[11px] text-slate-500">
                Dictar en Taquilla
              </span>
            </div>

            <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="font-mono font-black text-lg sm:text-xl text-emerald-400 tracking-wider">
                {pinReclamo}
              </span>
              <button
                type="button"
                onClick={copiarPin}
                className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 px-3 py-1.5 rounded-md text-xs font-bold transition-colors"
              >
                {copiado ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>

            <div className="pt-2 text-[11px] text-slate-400 font-mono truncate">
              <span className="text-slate-500">Firma HMAC:</span>{" "}
              {ticket.codigoSeguridad}
            </div>
          </div>

          {/* Aviso Legal */}
          <p className="text-[11px] text-slate-400 text-center leading-relaxed">
            Presente este comprobante digital o su código de seguridad en taquilla
            para cobrar premios válidos por 3 días hábiles.
          </p>

          {/* Botón de Retorno */}
          {onVolver && (
            <button
              type="button"
              onClick={onVolver}
              className="w-full flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-3 rounded-xl font-bold text-sm transition-colors border border-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a la Taquilla POS</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
