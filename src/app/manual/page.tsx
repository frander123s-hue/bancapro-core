"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Download,
  ArrowLeft,
  Calculator,
  Search,
  CheckCircle2,
  ShieldCheck,
  MessageCircle,
  DollarSign,
  TrendingUp,
  KeyRound,
  ChevronRight,
  Sparkles,
  FileText,
} from "lucide-react";

interface CapituloManual {
  id: string;
  numero: string;
  titulo: string;
  subtitulo: string;
  badge: string;
  colorBadge: string;
  imagenUrl: string;
  resumen: string;
  pasos: {
    numero: number;
    titulo: string;
    descripcion: string;
  }[];
  consejoOperativo: string;
}

const CAPITULOS_MANUAL: CapituloManual[] = [
  {
    id: "pos-bs-usd",
    numero: "01",
    titulo: "Taquilla POS Bimonetaria (Bolívares Bs. y Divisa USD)",
    subtitulo:
      "Cómo registrar jugadas rápidas por teclado, botones de apuesta mínima en Bs. y sincronización BCV.",
    badge: "MÓDULO 1 • VENTAS EN TAQUILLA",
    colorBadge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    imagenUrl: "/manual/screenshots/01-taquilla-pos-bs-usd.png",
    resumen:
      "La pantalla principal de Taquilla POS está diseñada para que el cajero registre jugadas en menos de 2 segundos sin usar el mouse, ingresando el monto directamente en Bolívares (Bs.) o en Dólares ($ USD) con conversión automática a la Tasa Oficial BCV.",
    pasos: [
      {
        numero: 1,
        titulo: "Verifique la Tasa Oficial BCV en la barra superior",
        descripcion:
          "El sistema sincroniza automáticamente la tasa oficial del Banco Central de Venezuela al abrir la taquilla. También puede pulsar el botón de recarga junto a la tasa para actualizarla al instante.",
      },
      {
        numero: 2,
        titulo: "Seleccione el Sorteo Abierto (Regla T - 3m)",
        descripcion:
          "Marque el horario del sorteo (ej. 10:00 AM, 11:00 AM) o use el botón 'Todos los abiertos'. Recuerde que todo sorteo cierra automáticamente 3 minutos antes de la hora oficial.",
      },
      {
        numero: 3,
        titulo: "Ingrese el Animalito y el Monto en Bs. o USD",
        descripcion:
          "Escriba el código del animalito (`0` para Delfín, `00` para Ballena, `01` al `36` para Carnero a Culebra) y digite el monto en Bolívares (o pulse los botones rápidos Bs. 10, Bs. 20, Bs. 30, Bs. 50, Bs. 100). El sistema calcula al instante su equivalente en USD y el premio potencial (30x).",
      },
      {
        numero: 4,
        titulo: "Ingrese el WhatsApp del Cliente y Emita el Ticket",
        descripcion:
          "En el carrito derecho, digite el número WhatsApp del jugador (ej. `04121234567`) y presione F12 o el botón verde 'EMITIR Y ENVIAR POR WHATSAPP'.",
      },
    ],
    consejoOperativo:
      "Atajo de velocidad para cajeros: Escriba el código del animalito → presione ENTER → escriba el monto en Bs. → presione ENTER para agregar al carrito → presione F12 para cobrar y enviar por WhatsApp.",
  },
  {
    id: "ticket-whatsapp",
    numero: "02",
    titulo: "Emisión de Ticket Digital por WhatsApp (Sin Impresora)",
    subtitulo:
      "Comprobante oficial en el celular del cliente con PIN único de cobro y enlace público verificable.",
    badge: "MÓDULO 2 • CERO PAPEL / WHATSAPP",
    colorBadge: "bg-sky-500/20 text-sky-300 border-sky-500/40",
    imagenUrl: "/manual/screenshots/02-ticket-whatsapp-sin-impresora.png",
    resumen:
      "Su comercio NO necesita impresora térmica para operar. Cada jugada genera un Ticket Digital Oficial con firma criptográfica HMAC-SHA256 que llega directo al WhatsApp del cliente.",
    pasos: [
      {
        numero: 1,
        titulo: "Envío Automático (API Cloud) o Envío Directo 1-Clic",
        descripcion:
          "Al emitir la jugada, si tiene configurada la API Cloud de WhatsApp el mensaje sale automáticamente; si opera sin API externa, se abre WhatsApp con el comprobante listo para pulsar 'Enviar' al teléfono del cliente.",
      },
      {
        numero: 2,
        titulo: "PIN Único de Reclamo (Formato N°Ticket-8Hex)",
        descripcion:
          "El cliente recibe en su mensaje el Código para Reclamar Premio (ej. `0001042-8F92A1C4`). Ese código está vinculado criptográficamente a las jugadas y montos en la base de datos.",
      },
      {
        numero: 3,
        titulo: "Enlace Público de Consulta en Tiempo Real",
        descripcion:
          "El mensaje incluye un link único (`/ticket/[uuid]`) donde el cliente puede ver desde su teléfono si su ticket está ACTIVO, GANADOR o PAGADO con su monto tanto en Bolívares como en Dólares.",
      },
    ],
    consejoOperativo:
      "Si el cliente cambia de teléfono o pide reenviar su comprobante, desde la tarjeta verde de confirmación puede pulsar 'Reenviar a WhatsApp del Cliente' o 'Copiar Texto' en cualquier momento.",
  },
  {
    id: "reclamo-premio",
    numero: "03",
    titulo: "Reclamo y Pago de Premios por WhatsApp / PIN",
    subtitulo:
      "Validación antifraude en milisegundos y liquidación en caja con bloqueo de doble cobro.",
    badge: "MÓDULO 3 • AUDITORÍA Y PAGO DE PREMIOS",
    colorBadge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    imagenUrl: "/manual/screenshots/03-reclamo-premio-whatsapp-pin.png",
    resumen:
      "Cuando un cliente resulta ganador, acude al comercio (o se comunica por WhatsApp) y muestra su mensaje con el PIN de Reclamo. El sistema verifica la autenticidad del ticket e impide que un mismo premio sea cobrado dos veces.",
    pasos: [
      {
        numero: 1,
        titulo: "Abra la pestaña '2. Reclamar Premio'",
        descripcion:
          "En la barra superior del comercio, haga clic en '2. Reclamar Premio' para abrir el validador antifraude.",
      },
      {
        numero: 2,
        titulo: "Busque por PIN de WhatsApp, Número de Ticket o Teléfono",
        descripcion:
          "Escriba el PIN corto que aparece en el WhatsApp del cliente (ej. `0001041-9F4C2E81`), el número de ticket (`1041`) o el teléfono del cliente (`04149876543`) y pulse 'Verificar Ticket'.",
      },
      {
        numero: 3,
        titulo: "Verifique el Monto Exacto en Bs. y USD",
        descripcion:
          "El sistema mostrará en verde si el ticket es GANADOR OFICIAL junto con el monto exacto a entregar en Bolívares (Bs.) y su equivalente en Dólares ($ USD).",
      },
      {
        numero: 4,
        titulo: "Presione 'Confirmar y Pagar Premio en Caja'",
        descripcion:
          "Al confirmar el pago, el ticket pasa a estado PAGADO con fecha y hora exacta, descontándose automáticamente del Flujo Neto de Caja del comercio.",
      },
    ],
    consejoOperativo:
      "Seguridad total: Si alguien intenta alterar el texto de un mensaje de WhatsApp, el validador rechazará el cobro porque contrasta el PIN contra el registro inmutable en Supabase.",
  },
  {
    id: "caja-cupos",
    numero: "04",
    titulo: "Configuración del Comercio: Caja, Riesgo y Cupos por Animalito",
    subtitulo:
      "Cómo proteger la banca del comercio ajustando la Pérdida Máxima por Sorteo y liquidando resultados.",
    badge: "MÓDULO 4 • ADMINISTRACIÓN DEL COMERCIO",
    colorBadge: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    imagenUrl: "/manual/screenshots/04-caja-y-cupos-comercio.png",
    resumen:
      "El dueño o encargado del comercio cuenta con el panel '3. Caja & Cupos' para cuadrar la caja del día en Bs. y USD, ajustar el límite de riesgo por sorteo y liquidar sorteos manualmente en caso de contingencia.",
    pasos: [
      {
        numero: 1,
        titulo: "Cuadre de Caja en Tiempo Real (Bs. y USD)",
        descripcion:
          "Observe en la parte superior las 4 tarjetas financieras: Total Ventas Brutas, Premios Generados (30x), Flujo Neto de Caja (Utilidad) y Cupo Máximo por Animalito, expresados simultáneamente en USD y Bolívares.",
      },
      {
        numero: 2,
        titulo: "Configuración Dinámica del Cupo de Riesgo (Fórmula Pérdida Máx ÷ 30)",
        descripcion:
          "Ingrese cuánto es el máximo que su comercio está dispuesto a pagar en premios en un sorteo (ej. $300 USD) y pulse 'Guardar Cupo'. El motor recalcula el tope de venta por cada animalito ($300 ÷ 30 = $10.00 USD ó Bs. 458.50 por animalito).",
      },
      {
        numero: 3,
        titulo: "Liquidación Manual de Contingencia (Confirmación en 2 Pasos)",
        descripcion:
          "Si el proveedor externo de resultados tarda en publicar, el administrador puede seleccionar el sorteo y el animalito ganador oficial y liquidarlo con doble confirmación de seguridad.",
      },
    ],
    consejoOperativo:
      "El motor ACID de BancaPro bloquea automáticamente cualquier jugada que intente sobrepasar el cupo disponible de un animalito, garantizando que su comercio jamás pierda más del límite configurado.",
  },
  {
    id: "portal-superadmin",
    numero: "05",
    titulo: "Portal SuperAdmin Independiente (Multi-Comercio)",
    subtitulo:
      "Acceso exclusivo con credenciales maestras para afiliar nuevos comercios, fijar tasa BCV y auditar la red.",
    badge: "MÓDULO 5 • PORTAL SUPERADMIN",
    colorBadge: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
    imagenUrl: "/manual/screenshots/05-portal-superadmin-independiente.png",
    resumen:
      "El propietario de la plataforma accede a un portal completamente separado dentro de la aplicación mediante el botón 'Portal SuperAdmin', protegido por usuario y contraseña maestra.",
    pasos: [
      {
        numero: 1,
        titulo: "Ingreso con Credenciales Maestras",
        descripcion:
          "Haga clic en 'Portal SuperAdmin' en la esquina superior derecha e ingrese el usuario `admin` y la contraseña maestra configurada para desbloquear la consola global.",
      },
      {
        numero: 2,
        titulo: "Control Maestro de Tasa Oficial BCV",
        descripcion:
          "Fije manualmente una tasa global en Bolívares para toda la red de comercios o dispare la sincronización inmediata contra la API oficial del BCV.",
      },
      {
        numero: 3,
        titulo: "Afiliación Instantánea de Nuevos Comercios (Tenants)",
        descripcion:
          "Complete Razón Social, RIF, Correo del Administrador y Pérdida Máxima en USD. El sistema crea el nuevo comercio aislado con Row-Level Security (RLS) y calcula su cupo por animalito.",
      },
    ],
    consejoOperativo:
      "Cada comercio afiliado opera en su propio espacio aislado (Multi-Tenant RLS): los tickets, cajeros y cierres de caja de un comercio son invisibles para los demás comercios.",
  },
];

const PREGUNTAS_FRECUENTES = [
  {
    pregunta: "¿Cuál es la apuesta mínima recomendada en Bolívares?",
    respuesta:
      "El comercio puede recibir jugadas desde Bs. 5, Bs. 10, Bs. 20, Bs. 30, Bs. 50 o cualquier monto en Bolívares. La taquilla convierte automáticamente el monto en Bs. a USD según la Tasa Oficial BCV vigente y muestra ambos valores en el ticket.",
  },
  {
    pregunta: "¿Qué pasa si no tengo impresora térmica en el local?",
    respuesta:
      "No necesita impresora. Al emitir la jugada e ingresar el teléfono del cliente, el sistema genera un Ticket Digital con código PIN único y se lo envía por WhatsApp al instante. El cliente reclama su premio mostrando ese mensaje.",
  },
  {
    pregunta: "¿Cómo se calcula cuánto paga un animalito ganador?",
    respuesta:
      "En Lotto Activo (38 animalitos: 0, 00 y 01 al 36), cada jugada ganadora multiplica por 30 (30x) el monto apostado. Por ejemplo, una jugada de Bs. 20.00 genera un premio exacto de Bs. 600.00.",
  },
  {
    pregunta: "¿Cómo evito que apuesten demasiado a un solo animalito ('dato')?",
    respuesta:
      "En '3. Caja & Cupos', configure su 'Pérdida Máxima por Sorteo'. Si coloca $300 USD, el sistema divide $300 ÷ 30 = $10 USD de cupo máximo por animalito. Cuando un animalito llega a $10 USD vendidos en ese sorteo, el sistema bloquea más ventas de ese número automáticamente.",
  },
  {
    pregunta: "¿Por qué el sorteo se cierra 3 minutos antes de la hora?",
    respuesta:
      "Por seguridad antifraude (Regla T - 3m). Un sorteo de las 10:00 AM bloquea las ventas exactamente a las 09:57:00 AM en el servidor para impedir que alguien registre jugadas conociendo el resultado oficial.",
  },
];

export default function ManualInteractivoPage() {
  const [capituloActivoId, setCapituloActivoId] = useState<string>(
    CAPITULOS_MANUAL[0].id
  );
  const [busquedaFaq, setBusquedaFaq] = useState<string>("");

  // Estados del Simulador Interactivo para Comercios
  const [simTasaBcv, setSimTasaBcv] = useState<number>(45.85);
  const [simPerdidaMaxUsd, setSimPerdidaMaxUsd] = useState<number>(300);
  const [simApuestaBs, setSimApuestaBs] = useState<number>(20);

  const cupoAnimalUsd = simPerdidaMaxUsd / 30;
  const cupoAnimalBs = cupoAnimalUsd * simTasaBcv;
  const apuestaUsd = simTasaBcv > 0 ? simApuestaBs / simTasaBcv : 0;
  const premioBs = simApuestaBs * 30;
  const premioUsd = apuestaUsd * 30;

  const capituloActual =
    CAPITULOS_MANUAL.find((c) => c.id === capituloActivoId) ||
    CAPITULOS_MANUAL[0];

  const faqsFiltradas = PREGUNTAS_FRECUENTES.filter(
    (f) =>
      f.pregunta.toLowerCase().includes(busquedaFaq.toLowerCase()) ||
      f.respuesta.toLowerCase().includes(busquedaFaq.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* BARRA SUPERIOR DEL MANUAL INTERACTIVO */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-emerald-400" />
              Volver a la Taquilla POS
            </Link>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-400">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-white leading-tight">
                  Manual Interactivo de Uso y Configuración — BancaPro Core
                </h1>
                <p className="text-[11px] text-slate-400">
                  Guía paso a paso con capturas anotadas para Comercios, Cajeros y Administradores
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href="/Manual_Uso_BancaPro_Core.pdf"
              download="Manual_Uso_BancaPro_Core.pdf"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-950/60 transition"
            >
              <Download className="w-4 h-4" />
              Descargar Manual en PDF
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* BANNER HERO CON DESCARGA DIRECTA DEL PDF */}
        <section className="rounded-2xl bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-500/30 p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 shadow-xl">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono uppercase">
              <Sparkles className="w-3.5 h-3.5" />
              Edición Oficial para Comercios • Venezuela (Bs. / USD)
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Domine la Taquilla POS, Tickets por WhatsApp y Control de Cupos en 5 Minutos
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Explore cada módulo de forma interactiva seleccionando las pestañas inferiores, pruebe la{" "}
              <span className="text-emerald-300 font-semibold">
                Calculadora de Cupos y Premios en Bolívares
              </span>{" "}
              o descargue el documento PDF listo para enviar por WhatsApp a sus encargados y cajeros.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 w-full lg:w-auto">
            <a
              href="/Manual_Uso_BancaPro_Core.pdf"
              download="Manual_Uso_BancaPro_Core.pdf"
              className="px-5 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl transition"
            >
              <Download className="w-4 h-4" />
              Descargar PDF Completo (662 KB)
            </a>
            <a
              href="/Manual_Uso_BancaPro_Core.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition"
            >
              <FileText className="w-4 h-4 text-sky-400" />
              Abrir PDF en Navegador
            </a>
          </div>
        </section>

        {/* NAVEGADOR INTERACTIVO DE LOS 5 CAPÍTULOS CON CAPTURAS ANOTADAS */}
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              Seleccione un Módulo para Ver su Captura Anotada y Guía Paso a Paso
            </h3>
            <span className="text-xs font-mono text-slate-400">
              Capítulo {capituloActual.numero} de 05
            </span>
          </div>

          {/* Botones de selección de capítulo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {CAPITULOS_MANUAL.map((cap) => {
              const activo = cap.id === capituloActivoId;
              return (
                <button
                  key={cap.id}
                  type="button"
                  onClick={() => setCapituloActivoId(cap.id)}
                  className={`text-left p-3.5 rounded-xl border transition flex flex-col justify-between gap-2 ${
                    activo
                      ? "bg-emerald-950/60 border-emerald-500 text-white shadow-lg shadow-emerald-950/50"
                      : "bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-mono font-black px-2 py-0.5 rounded ${
                        activo
                          ? "bg-emerald-500 text-slate-950"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      MÓDULO {cap.numero}
                    </span>
                    <ChevronRight
                      className={`w-4 h-4 ${
                        activo ? "text-emerald-400" : "text-slate-600"
                      }`}
                    />
                  </div>
                  <div className="text-xs font-bold leading-snug line-clamp-2">
                    {cap.titulo}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Vista Detallada del Capítulo Seleccionado */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div className="space-y-1">
                <span
                  className={`inline-block text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded border ${capituloActual.colorBadge}`}
                >
                  {capituloActual.badge}
                </span>
                <h3 className="text-lg sm:text-xl font-black text-white">
                  {capituloActual.numero}. {capituloActual.titulo}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400">
                  {capituloActual.subtitulo}
                </p>
              </div>
            </div>

            {/* Captura de Pantalla Anotada en Alta Definición */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Captura Oficial Anotada del Sistema:
              </div>
              <div className="rounded-xl overflow-hidden border-2 border-slate-800 bg-slate-950 shadow-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capituloActual.imagenUrl}
                  alt={capituloActual.titulo}
                  className="w-full h-auto object-contain"
                />
              </div>
            </div>

            {/* Explicación y Pasos Numerados */}
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                {capituloActual.resumen}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {capituloActual.pasos.map((paso) => (
                  <div
                    key={paso.numero}
                    className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 flex items-start gap-3.5"
                  >
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                      {paso.numero}
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xs sm:text-sm font-bold text-white">
                        {paso.titulo}
                      </h4>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {paso.descripcion}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-amber-950/30 border border-amber-500/40 p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200 leading-relaxed">
                  <strong className="text-amber-300 uppercase font-mono">
                    Recomendación Operativa para el Comercio:{" "}
                  </strong>
                  {capituloActual.consejoOperativo}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SIMULADOR INTERACTIVO DE CUPOS, TASA BCV Y PREMIOS PARA COMERCIOS */}
        <section className="bg-slate-900 border border-sky-500/30 rounded-2xl p-6 space-y-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Simulador Interactivo de Cupos de Riesgo y Premios (Bs. / USD)
                </h3>
                <p className="text-xs text-slate-400">
                  Practique cómo el sistema calcula el cupo máximo por animalito y los premios antes de configurar su comercio.
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
              Fórmula Oficial: Cupo = Pérdida Máx ÷ 30
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-sky-400" />
                1. Tasa Oficial BCV (Bs. / $1 USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={simTasaBcv}
                onChange={(e) =>
                  setSimTasaBcv(Math.max(1, parseFloat(e.target.value) || 0))
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
              />
              <p className="text-[11px] text-slate-500">
                Tasa usada para convertir apuestas en Bolívares a Dólares.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
                2. Pérdida Máxima por Sorteo ($ USD)
              </label>
              <input
                type="number"
                step="10"
                value={simPerdidaMaxUsd}
                onChange={(e) =>
                  setSimPerdidaMaxUsd(
                    Math.max(30, parseFloat(e.target.value) || 0)
                  )
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
              />
              <p className="text-[11px] text-slate-500">
                En Bs.:{" "}
                <strong className="text-slate-300">
                  Bs. {(simPerdidaMaxUsd * simTasaBcv).toFixed(2)}
                </strong>{" "}
                máx. en premios por sorteo.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                3. Jugada del Cliente en Taquilla (Bs.)
              </label>
              <input
                type="number"
                step="5"
                value={simApuestaBs}
                onChange={(e) =>
                  setSimApuestaBs(Math.max(1, parseFloat(e.target.value) || 0))
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
              />
              <p className="text-[11px] text-slate-500">
                Equivale a{" "}
                <strong className="text-emerald-300">
                  ${apuestaUsd.toFixed(2)} USD
                </strong>{" "}
                a tasa BCV.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="rounded-xl bg-purple-950/30 border border-purple-500/40 p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase text-purple-300">
                  Tope Máximo de Venta por cada Animalito
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-white mt-0.5">
                  Bs. {cupoAnimalBs.toFixed(2)}{" "}
                  <span className="text-xs font-normal text-purple-300">
                    (${cupoAnimalUsd.toFixed(2)} USD)
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Al llegar a este monto en un animalito, el sistema bloquea más jugadas de ese número.
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/40 p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase text-emerald-300">
                  Premio a Pagar si el Cliente Acierta (30x)
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-white mt-0.5">
                  Bs. {premioBs.toFixed(2)}{" "}
                  <span className="text-xs font-normal text-emerald-300">
                    (${premioUsd.toFixed(2)} USD)
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Se acredita automáticamente al ticket de WhatsApp del cliente ganador.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PREGUNTAS FRECUENTES CON BUSCADOR EN TIEMPO REAL */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                Preguntas Frecuentes de los Comercios y Cajeros
              </h3>
              <p className="text-xs text-slate-400">
                Respuestas rápidas sobre operación diaria en Bolívares, WhatsApp y cierre de caja.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={busquedaFaq}
                onChange={(e) => setBusquedaFaq(e.target.value)}
                placeholder="Buscar duda (ej. impresora, Bs, cupo)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {faqsFiltradas.map((item, idx) => (
              <div
                key={idx}
                className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1.5"
              >
                <h4 className="text-xs sm:text-sm font-bold text-emerald-300">
                  {item.pregunta}
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {item.respuesta}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
