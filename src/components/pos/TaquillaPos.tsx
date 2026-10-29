"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  CATALOGO_LOTTO_ACTIVO,
  HORARIOS_OFICIALES_LOTTO_ACTIVO,
  resolverFiguraPorInput,
  obtenerFiguraPorDbNumber,
  type FiguraAnimalito,
} from "@/lib/constants/animalitos";
import {
  emitirTicket,
  pagarTicketGanador,
  anularTicket,
  liquidarSorteo,
  obtenerTasaBcvActual,
} from "@/lib/actions/transacciones";
import {
  iniciarSesion,
  iniciarSesionMagaly,
  cerrarSesion,
  obtenerContextoActual,
} from "@/lib/actions/auth";
import {
  imprimirTicketTermico,
  type DatosTicketTermico,
} from "@/lib/hardware/escpos";
import {
  construirMensajeWhatsAppTicket,
  abrirWhatsAppClienteDirecto,
  normalizarTelefonoVenezuela,
} from "@/lib/hardware/whatsapp";
import {
  Printer,
  QrCode,
  ShieldCheck,
  Clock,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Building2,
  Keyboard,
  Lock,
  TrendingUp,
  Award,
  PlusCircle,
  Users,
  MessageCircle,
  Smartphone,
  Copy,
  Send,
} from "lucide-react";

interface JugadaCarrito {
  idTemporal: string;
  sorteoId: number;
  sorteoEtiqueta: string;
  figura: FiguraAnimalito;
  montoUsd: number;
}

interface TicketHistoricoLocal {
  ticketId: string;
  serialCorto: string;
  pinReclamo: string; // Formato corto fácil de dictar/enviar por WhatsApp: 0001041-9F4C2E81
  clienteTelefono: string;
  canalEntrega: "WHATSAPP" | "TERMICA_ESCPOS" | "AMBOS";
  tenantNombre: string;
  tenantRif: string;
  fechaHora: string;
  timestampEmisionMs: number;
  tasaBcv: number;
  totalUsd: number;
  totalBs: number;
  codigoSeguridad: string;
  qrPayload: string;
  mensajeWhatsApp: string;
  estado: "EMITIDO" | "GANADOR" | "PAGADO" | "PERDEDOR" | "ANULADO";
  premioTotalUsd: number;
  items: Array<{
    sorteoId: number;
    sorteoHora: string;
    dbNumber: number;
    codigoAnimal: string;
    nombreAnimal: string;
    montoUsd: number;
    premioPotencialUsd: number;
  }>;
}

interface TenantComercio {
  id: string;
  nombre: string;
  rif: string;
  telefono: string;
  adminEmail: string;
  perdidaMaximaUsd: number;
  cupoAnimalUsd: number;
  ventasHoyUsd: number;
  activo: boolean;
}

export default function TaquillaPosSystem() {
  const [vistaActiva, setVistaActiva] = useState<
    "POS" | "COBRO_QR" | "ADMIN_COMERCIO" | "SUPERADMIN"
  >("POS");

  // Contexto Multi-Tenant (Por defecto Tenant #1: Bodega Piloto Magaly)
  const [tenants, setTenants] = useState<TenantComercio[]>([
    {
      id: "11111111-1111-4111-8111-111111111111",
      nombre: "Bodega Piloto Magaly",
      rif: "J-40123987-1",
      telefono: "+58 414-1234567",
      adminEmail: "magaly.rodriguez@bancapro.local",
      perdidaMaximaUsd: 300.0,
      cupoAnimalUsd: 10.0, // 300 / 30 = $10.00 USD por figura por sorteo
      ventasHoyUsd: 148.5,
      activo: true,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      nombre: "Agencia La Suerte Centro",
      rif: "J-50291823-9",
      telefono: "+58 412-9876543",
      adminEmail: "admin@lasuerte.local",
      perdidaMaximaUsd: 600.0,
      cupoAnimalUsd: 20.0,
      ventasHoyUsd: 315.0,
      activo: true,
    },
  ]);
  const [tenantActualId, setTenantActualId] = useState<string>(
    "11111111-1111-4111-8111-111111111111"
  );

  // Sesión GoTrue Activa
  const [usuarioSesion, setUsuarioSesion] = useState<{
    id: string;
    email: string;
    nombre: string;
    rol: string;
    tenantId: string;
  } | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState<boolean>(true);

  // Inicialización de sesión GoTrue
  useEffect(() => {
    let activo = true;
    async function cargarSesion() {
      try {
        const ctx = await obtenerContextoActual();
        if (ctx && activo) {
          setUsuarioSesion({
            id: ctx.userId,
            email: ctx.email,
            nombre: ctx.nombreUsuario,
            rol: ctx.rol,
            tenantId: ctx.tenantId,
          });
          setTenantActualId(ctx.tenantId);
          return;
        }

        // Si no hay cookies de sesión, auto-login de Magaly Rodríguez (Tenant #1)
        const loginMagaly = await iniciarSesionMagaly();
        if (loginMagaly.ok && loginMagaly.user && activo) {
          setUsuarioSesion({
            id: loginMagaly.user.id,
            email: loginMagaly.user.email,
            nombre: loginMagaly.user.nombre || "Magaly Rodríguez",
            rol: loginMagaly.user.rol || "admin_comercio",
            tenantId:
              loginMagaly.user.tenantId ||
              "11111111-1111-4111-8111-111111111111",
          });
          if (loginMagaly.user.tenantId) {
            setTenantActualId(loginMagaly.user.tenantId);
          }
        }
      } catch (err) {
        console.warn("Fallo al inicializar sesión GoTrue:", err);
      } finally {
        if (activo) setCargandoAuth(false);
      }
    }
    cargarSesion();
    return () => {
      activo = false;
    };
  }, []);

  const ejecutarLoginMagaly = async () => {
    setCargandoAuth(true);
    const resp = await iniciarSesionMagaly();
    if (resp.ok && resp.user) {
      setUsuarioSesion({
        id: resp.user.id,
        email: resp.user.email,
        nombre: resp.user.nombre || "Magaly Rodríguez",
        rol: resp.user.rol || "admin_comercio",
        tenantId:
          resp.user.tenantId || "11111111-1111-4111-8111-111111111111",
      });
      if (resp.user.tenantId) {
        setTenantActualId(resp.user.tenantId);
      }
      setAlertaSistema({
        tipo: "exito",
        mensaje: `Sesión GoTrue iniciada como ${resp.user.nombre} (${resp.user.rol})`,
      });
    } else {
      setAlertaSistema({
        tipo: "error",
        mensaje: `Error al autenticar: ${resp.error}`,
      });
    }
    setCargandoAuth(false);
  };

  const ejecutarCerrarSesion = async () => {
    setCargandoAuth(true);
    await cerrarSesion();
    setUsuarioSesion(null);
    setCargandoAuth(false);
    setAlertaSistema({
      tipo: "info",
      mensaje: "Sesión GoTrue cerrada correctamente.",
    });
  };

  const tenantActual = useMemo(
    () => tenants.find((t) => t.id === tenantActualId) ?? tenants[0],
    [tenants, tenantActualId]
  );

  // Tasa Oficial BCV en vivo
  const [tasaBcv, setTasaBcv] = useState<number>(45.85);
  const [sincronizandoBcv, setSincronizandoBcv] = useState<boolean>(false);

  // Reloj del servidor y conteo regresivo hacia el cierre (T - 3 minutos)
  const [ahora, setAhora] = useState<Date>(new Date());
  const [sorteoSeleccionadoId, setSorteoSeleccionadoId] = useState<number>(2); // 10:00 AM por defecto

  // Inputs de Taquilla Ultra-Rápida + Canal de Entrega (Por defecto WHATSAPP ya que no hay impresora física aún)
  const [codigoInput, setCodigoInput] = useState<string>("");
  const [montoInput, setMontoInput] = useState<string>("1.00");
  const [clienteTelefonoInput, setClienteTelefonoInput] =
    useState<string>("0414-1234567");
  const [modoEntrega, setModoEntrega] = useState<
    "WHATSAPP" | "TERMICA_ESCPOS" | "AMBOS"
  >("WHATSAPP");
  const [carrito, setCarrito] = useState<JugadaCarrito[]>([]);
  const [anchoImpresora, setAnchoImpresora] = useState<"58mm" | "80mm">("58mm");
  const [usarWebSerial, setUsarWebSerial] = useState<boolean>(false);

  // Control de Cupos Acumulados por Tenant + Sorteo + Animal: clave `${tenantId}_${sorteoId}_${dbNumber}`
  const [cuposAcumulados, setCuposAcumulados] = useState<Record<string, number>>({
    "11111111-1111-4111-8111-111111111111_2_5": 6.5,
    "11111111-1111-4111-8111-111111111111_2_0": 9.0,
  });

  // Resultados Oficiales del Día por Sorteo
  const [resultadosSorteo, setResultadosSorteo] = useState<
    Record<
      number,
      { animalDbNumber: number; metodo: string; horaLiquidacion: string }
    >
  >({
    1: {
      animalDbNumber: 5,
      metodo: "AUTO_CRON",
      horaLiquidacion: "09:02:14 AM",
    },
  });

  // Historial de Tickets Emitidos en la sesión (Aislados por Tenant)
  const [ticketsPorTenant, setTicketsPorTenant] = useState<
    Record<string, TicketHistoricoLocal[]>
  >({
    "11111111-1111-4111-8111-111111111111": [
      {
        ticketId: "a8098c1a-f86e-11da-bd1a-00112444be1e",
        serialCorto: "0001041",
        pinReclamo: "0001041-9F4C2E81",
        clienteTelefono: "0414-1234567",
        canalEntrega: "WHATSAPP",
        tenantNombre: "Bodega Piloto Magaly",
        tenantRif: "J-40123987-1",
        fechaHora: "29/10/2026 08:45:12 AM",
        timestampEmisionMs: Date.now() - 3600_000,
        tasaBcv: 45.85,
        totalUsd: 2.0,
        totalBs: 91.7,
        codigoSeguridad:
          "9f4c2e81b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        qrPayload:
          "BANCAPRO|11111111-1111-4111-8111-111111111111|a8098c1a-f86e-11da-bd1a-00112444be1e|2.00|1793277912|9f4c2e81b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        mensajeWhatsApp:
          "🎟️ *COMPROBANTE OFICIAL - BODEGA PILOTO MAGALY*\n📌 *TICKET N°:* #0001041\n🔐 *CÓDIGO PARA RECLAMAR PREMIO:* 0001041-9F4C2E81",
        estado: "GANADOR",
        premioTotalUsd: 60.0,
        items: [
          {
            sorteoId: 1,
            sorteoHora: "09:00 AM",
            dbNumber: 5,
            codigoAnimal: "05",
            nombreAnimal: "León",
            montoUsd: 2.0,
            premioPotencialUsd: 60.0,
          },
        ],
      },
    ],
  });

  const [ultimoTicketImpreso, setUltimoTicketImpreso] =
    useState<DatosTicketTermico | null>(null);
  const [ultimoTicketWhatsApp, setUltimoTicketWhatsApp] =
    useState<TicketHistoricoLocal | null>(null);
  const [alertaSistema, setAlertaSistema] = useState<{
    tipo: "exito" | "error" | "info";
    mensaje: string;
  } | null>(null);
  const [procesandoVenta, setProcesandoVenta] = useState<boolean>(false);

  // Estado para Pantalla 2: Verificación y Cobro por WhatsApp (PIN, Teléfono o Firma QR)
  const [inputQrCobro, setInputQrCobro] = useState<string>("");
  const [ticketVerificadoCobro, setTicketVerificadoCobro] =
    useState<TicketHistoricoLocal | null>(null);
  const [errorVerificacionQr, setErrorVerificacionQr] = useState<string | null>(
    null
  );

  // Estado para Pantalla 3: Fail-safe Manual de Liquidación (Confirmación en 2 pasos)
  const [sorteoLiquidarId, setSorteoLiquidarId] = useState<number>(2);
  const [animalGanadorManual, setAnimalGanadorManual] = useState<string>("05");
  const [pasoConfirmacionManual, setPasoConfirmacionManual] = useState<1 | 2>(1);
  const [nuevaPerdidaMaxInput, setNuevaPerdidaMaxInput] =
    useState<string>("300");

  // Estado para Pantalla 4: SuperAdmin Creación de Tenant
  const [nuevoComercioNombre, setNuevoComercioNombre] = useState<string>("");
  const [nuevoComercioRif, setNuevoComercioRif] = useState<string>("");
  const [nuevoComercioEmail, setNuevoComercioEmail] = useState<string>("");
  const [nuevoComercioPerdidaMax, setNuevoComercioPerdidaMax] =
    useState<string>("450");

  const inputCodigoRef = useRef<HTMLInputElement>(null);
  const inputMontoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Estado de horarios respecto a la regla estricta T - 3 minutos
  const estadoHorarios = useMemo(() => {
    // Sincronización estricta con la hora oficial de Venezuela (America/Caracas, UTC-4)
    const caracasTimeStr = ahora.toLocaleTimeString("en-GB", {
      timeZone: "America/Caracas",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const [hActual, mActual, sActual] = caracasTimeStr.split(":").map(Number);
    const segsDiaActual = (hActual || 0) * 3600 + (mActual || 0) * 60 + (sActual || 0);

    return HORARIOS_OFICIALES_LOTTO_ACTIVO.map((h) => {
      const [hh, mm] = h.hora24.split(":").map(Number);
      const segsOficial = hh * 3600 + mm * 60;
      const segsLockdown = segsOficial - 3 * 60;
      const segsRestantesCierre = segsLockdown - segsDiaActual;
      const liquidado = Boolean(resultadosSorteo[h.id]);
      const bloqueadoPorHorario = segsRestantesCierre <= 0;

      return {
        ...h,
        segsRestantesCierre,
        abiertoParaVenta: !liquidado && !bloqueadoPorHorario,
        estadoLabel: liquidado
          ? "LIQUIDADO"
          : bloqueadoPorHorario
          ? "CERRADO (T-3m)"
          : "ABIERTO",
      };
    });
  }, [ahora, resultadosSorteo]);

  const proximoSorteoAbierto = useMemo(
    () =>
      estadoHorarios.find((h) => h.abiertoParaVenta) ??
      estadoHorarios[estadoHorarios.length - 1],
    [estadoHorarios]
  );

  const formatearSegundos = (totalSegs: number) => {
    if (totalSegs <= 0) return "00:00:00 (LOCKDOWN)";
    const hrs = Math.floor(totalSegs / 3600);
    const mins = Math.floor((totalSegs % 3600) / 60);
    const segs = totalSegs % 60;
    return [hrs, mins, segs].map((n) => String(n).padStart(2, "0")).join(":");
  };

  const figuraPrevisualizada = useMemo(
    () => resolverFiguraPorInput(codigoInput),
    [codigoInput]
  );

  const obtenerCupoDisponible = (sorteoId: number, dbNumber: number) => {
    const key = `${tenantActual.id}_${sorteoId}_${dbNumber}`;
    const usadoEnDb = cuposAcumulados[key] ?? 0;
    const usadoEnCarrito = carrito
      .filter(
        (item) =>
          item.sorteoId === sorteoId && item.figura.dbNumber === dbNumber
      )
      .reduce((acc, item) => acc + item.montoUsd, 0);

    return Math.max(
      0,
      Number(
        (tenantActual.cupoAnimalUsd - usadoEnDb - usadoEnCarrito).toFixed(2)
      )
    );
  };

  const agregarJugadaAlCarrito = (figuraOverride?: FiguraAnimalito) => {
    setAlertaSistema(null);
    const figura = figuraOverride ?? resolverFiguraPorInput(codigoInput);
    if (!figura) {
      setAlertaSistema({
        tipo: "error",
        mensaje:
          "Código de animalito inválido. Use 0 (Delfín), 00 (Ballena) o del 01 al 36.",
      });
      inputCodigoRef.current?.focus();
      return;
    }

    const monto = parseFloat(montoInput);
    if (isNaN(monto) || monto <= 0) {
      setAlertaSistema({
        tipo: "error",
        mensaje: "Ingrese un monto en USD mayor a $0.00.",
      });
      inputMontoRef.current?.focus();
      return;
    }

    const horario = estadoHorarios.find((h) => h.id === sorteoSeleccionadoId);
    if (!horario) return;

    if (!horario.abiertoParaVenta) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `LOCKDOWN ACTIVO: El sorteo de las ${
          horario.etiqueta
        } cerró a las ${horario.cierre24.slice(
          0,
          5
        )} (3 minutos antes de la hora oficial).`,
      });
      return;
    }

    const disponible = obtenerCupoDisponible(
      sorteoSeleccionadoId,
      figura.dbNumber
    );
    if (monto > disponible) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `Cupo agotado para esta figura (${figura.codigo} - ${
          figura.nombre
        } en sorteo ${
          horario.etiqueta
        }). Cupo disponible: $${disponible.toFixed(2)} USD.`,
      });
      return;
    }

    setCarrito((prev) => [
      ...prev,
      {
        idTemporal: `${Date.now()}-${Math.random()}`,
        sorteoId: sorteoSeleccionadoId,
        sorteoEtiqueta: horario.etiqueta,
        figura,
        montoUsd: Number(monto.toFixed(2)),
      },
    ]);

    setCodigoInput("");
    inputCodigoRef.current?.focus();
  };

  const totalCarritoUsd = useMemo(
    () =>
      Number(carrito.reduce((acc, item) => acc + item.montoUsd, 0).toFixed(2)),
    [carrito]
  );
  const totalCarritoBs = useMemo(
    () => Number((totalCarritoUsd * tasaBcv).toFixed(2)),
    [totalCarritoUsd, tasaBcv]
  );

  // Procesar Emisión Transaccional del Ticket + Despacho por WhatsApp al Cliente
  const procesarEmisionTicket = async () => {
    if (carrito.length === 0 || procesandoVenta) return;

    if (
      (modoEntrega === "WHATSAPP" || modoEntrega === "AMBOS") &&
      normalizarTelefonoVenezuela(clienteTelefonoInput).length < 10
    ) {
      setAlertaSistema({
        tipo: "error",
        mensaje:
          "Ingrese el número de WhatsApp del cliente (ej. 0414-1234567) para enviarle su comprobante digital.",
      });
      return;
    }

    setProcesandoVenta(true);
    setAlertaSistema(null);

    try {
      const payloadRpc = carrito.map((j) => ({
        sorteo_diario_id: j.sorteoId,
        animal_numero: j.figura.dbNumber,
        monto_usd: j.montoUsd,
      }));

      const respuestaRpc = await emitirTicket(
        payloadRpc,
        clienteTelefonoInput,
        modoEntrega
      );

      // Verificación estricta de backend: si la transacción falló, abortar de inmediato sin generar ticket falso
      if (!respuestaRpc.ok || !respuestaRpc.ticket) {
        setAlertaSistema({
          tipo: "error",
          mensaje: `TRANSACCIÓN RECHAZADA POR EL SERVIDOR: ${
            respuestaRpc.error || "Fallo en la emisión del ticket."
          }`,
        });
        setProcesandoVenta(false);
        return;
      }

      // Ticket confirmado genuino proveniente de Supabase
      const ticketConfirmado = respuestaRpc.ticket;
      const ticketIdFinal = ticketConfirmado.ticket_id;
      const serialCortoFinal = String(ticketConfirmado.serial_corto).padStart(7, "0");
      const codigoSeguridadFinal = ticketConfirmado.codigo_seguridad;
      const qrPayloadFinal = ticketConfirmado.qr_payload;
      const pinReclamoCorto = `${serialCortoFinal}-${codigoSeguridadFinal
        .slice(0, 8)
        .toUpperCase()}`;

      // Actualizar el estado de cupos acumulados del comercio únicamente tras confirmación real del servidor
      const nuevosCupos = { ...cuposAcumulados };
      for (const item of carrito) {
        const k = `${tenantActual.id}_${item.sorteoId}_${item.figura.dbNumber}`;
        nuevosCupos[k] = Number(
          ((nuevosCupos[k] ?? 0) + item.montoUsd).toFixed(2)
        );
      }
      setCuposAcumulados(nuevosCupos);

      const fechaStr = new Intl.DateTimeFormat("es-VE", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date());

      const datosImpresion: DatosTicketTermico = {
        comercioNombre: tenantActual.nombre,
        comercioRif: tenantActual.rif,
        cajeroNombre: "Magaly Rodríguez",
        serialCorto: serialCortoFinal,
        fechaHoraEmision: fechaStr,
        tasaBcv,
        totalUsd: totalCarritoUsd,
        totalBs: totalCarritoBs,
        codigoSeguridadHmac: codigoSeguridadFinal,
        qrPayload: qrPayloadFinal,
        anchoPapel: anchoImpresora,
        items: carrito.map((c) => ({
          sorteoHora: c.sorteoEtiqueta,
          codigoAnimal: c.figura.codigo,
          nombreAnimal: c.figura.nombre,
          montoUsd: c.montoUsd,
          montoBs: Number((c.montoUsd * tasaBcv).toFixed(2)),
          premioPotencialUsd: Number((c.montoUsd * 30).toFixed(2)),
        })),
      };

      const textoWhatsApp = construirMensajeWhatsAppTicket({
        ...datosImpresion,
        clienteTelefono: clienteTelefonoInput,
      });

      const nuevoTicketHistorico: TicketHistoricoLocal = {
        ticketId: ticketIdFinal,
        serialCorto: serialCortoFinal,
        pinReclamo: pinReclamoCorto,
        clienteTelefono: clienteTelefonoInput,
        canalEntrega: modoEntrega,
        tenantNombre: tenantActual.nombre,
        tenantRif: tenantActual.rif,
        fechaHora: fechaStr,
        timestampEmisionMs: Date.now(),
        tasaBcv,
        totalUsd: totalCarritoUsd,
        totalBs: totalCarritoBs,
        codigoSeguridad: codigoSeguridadFinal,
        qrPayload: qrPayloadFinal,
        mensajeWhatsApp: textoWhatsApp,
        estado: "EMITIDO",
        premioTotalUsd: 0,
        items: carrito.map((c) => ({
          sorteoId: c.sorteoId,
          sorteoHora: c.sorteoEtiqueta,
          dbNumber: c.figura.dbNumber,
          codigoAnimal: c.figura.codigo,
          nombreAnimal: c.figura.nombre,
          montoUsd: c.montoUsd,
          premioPotencialUsd: Number((c.montoUsd * 30).toFixed(2)),
        })),
      };

      setTicketsPorTenant((prev) => ({
        ...prev,
        [tenantActual.id]: [
          nuevoTicketHistorico,
          ...(prev[tenantActual.id] ?? []),
        ],
      }));

      setUltimoTicketImpreso(datosImpresion);
      setUltimoTicketWhatsApp(nuevoTicketHistorico);
      setCarrito([]);

      // Despacho por WhatsApp (Intenta API silenciosa en /api/whatsapp/send; si no hay token de pago, abre wa.me directo)
      if (modoEntrega === "WHATSAPP" || modoEntrega === "AMBOS") {
        try {
          const respWa = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              telefono: clienteTelefonoInput,
              mensajeTexto: textoWhatsApp,
              qrPayload: qrPayloadFinal,
            }),
          });
          const waJson = await respWa.json();
          if (waJson?.modo === "WA_ME_DIRECTO") {
            abrirWhatsAppClienteDirecto({
              ...datosImpresion,
              clienteTelefono: clienteTelefonoInput,
            });
          }
        } catch {
          abrirWhatsAppClienteDirecto({
            ...datosImpresion,
            clienteTelefono: clienteTelefonoInput,
          });
        }
      }

      if (modoEntrega === "TERMICA_ESCPOS" || modoEntrega === "AMBOS") {
        await imprimirTicketTermico(datosImpresion, usarWebSerial);
      }

      setAlertaSistema({
        tipo: "exito",
        mensaje: `Ticket #${serialCortoFinal} emitido y despachado al WhatsApp ${clienteTelefonoInput} (PIN Reclamo: ${pinReclamoCorto}).`,
      });
    } finally {
      setProcesandoVenta(false);
      inputCodigoRef.current?.focus();
    }
  };

  const sincronizarTasaBcvAhora = async () => {
    setSincronizandoBcv(true);
    try {
      // 1. Obtener tasa oficial vigente mediante Server Action pública
      const tasaVigente = await obtenerTasaBcvActual();
      if (tasaVigente && tasaVigente > 0) {
        setTasaBcv(tasaVigente);
        setAlertaSistema({
          tipo: "info",
          mensaje: `Tasa Oficial BCV sincronizada: Bs. ${tasaVigente.toFixed(
            4
          )} / USD`,
        });
        return;
      }

      // 2. Fallback de contingencia a endpoint de cron con clave de autorización
      const cronKey =
        process.env.NEXT_PUBLIC_CRON_SECRET ||
        "bancapro_cron_job_auth_secret_2026";
      const res = await fetch(`/api/cron/bcv?key=${cronKey}`);
      if (res.ok) {
        const json = await res.json();
        if (json?.tasa_vigente?.tasa) {
          setTasaBcv(Number(json.tasa_vigente.tasa));
          setAlertaSistema({
            tipo: "info",
            mensaje: `Tasa Oficial BCV sincronizada: Bs. ${Number(
              json.tasa_vigente.tasa
            ).toFixed(4)} / USD`,
          });
        }
      }
    } catch {
      // Mantiene tasa actual
    } finally {
      setSincronizandoBcv(false);
    }
  };

  const manejarAnulacionTicket = async (ticket: TicketHistoricoLocal) => {
    const segsTranscurridos = Math.floor(
      (Date.now() - ticket.timestampEmisionMs) / 1000
    );
    if (segsTranscurridos > 60) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `REGLA ANTI-FRAUDE: No se puede anular el Ticket #${ticket.serialCorto}. Han transcurrido ${segsTranscurridos}s (máximo permitido: 60 segundos).`,
      });
      return;
    }

    const resp = await anularTicket(ticket.ticketId);
    if (!resp.ok) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `RECHAZO EN ANULACIÓN: ${resp.error || "Fallo al anular ticket en el servidor."}`,
      });
      return;
    }

    const nuevosCupos = { ...cuposAcumulados };
    for (const item of ticket.items) {
      const k = `${tenantActual.id}_${item.sorteoId}_${item.dbNumber}`;
      nuevosCupos[k] = Math.max(
        0,
        Number(((nuevosCupos[k] ?? 0) - item.montoUsd).toFixed(2))
      );
    }
    setCuposAcumulados(nuevosCupos);

    setTicketsPorTenant((prev) => ({
      ...prev,
      [tenantActual.id]: (prev[tenantActual.id] ?? []).map((t) =>
        t.ticketId === ticket.ticketId ? { ...t, estado: "ANULADO" } : t
      ),
    }));

    setAlertaSistema({
      tipo: "info",
      mensaje: `Ticket #${ticket.serialCorto} ANULADO correctamente dentro de la ventana de 60 segundos. Cupos revertidos.`,
    });
  };

  // Verificación de Ticket Ganador mediante PIN de WhatsApp, Teléfono del Cliente, Serial o Firma HMAC-SHA256
  const verificarQrParaCobro = (valorInput?: string) => {
    const query = (valorInput ?? inputQrCobro).trim();
    setErrorVerificacionQr(null);
    setTicketVerificadoCobro(null);

    if (!query) return;

    const listaTenantActual = ticketsPorTenant[tenantActual.id] ?? [];
    const queryUpper = query.toUpperCase();
    const queryDigits = normalizarTelefonoVenezuela(query);

    const encontrado = listaTenantActual.find(
      (t) =>
        t.pinReclamo.toUpperCase() === queryUpper ||
        t.qrPayload === query ||
        t.codigoSeguridad.toLowerCase() === query.toLowerCase() ||
        t.serialCorto === query.replace(/^#/, "") ||
        (queryDigits.length >= 10 &&
          normalizarTelefonoVenezuela(t.clienteTelefono) === queryDigits)
    );

    if (!encontrado) {
      setErrorVerificacionQr(
        "ALERTA RLS / ANTI-FRAUDE: No se encontró ningún ticket con ese PIN de WhatsApp, Teléfono o Firma HMAC en este comercio."
      );
      return;
    }

    setTicketVerificadoCobro(encontrado);
  };

  const confirmarPagoPremio = async () => {
    if (!ticketVerificadoCobro || ticketVerificadoCobro.estado !== "GANADOR")
      return;

    const resp = await pagarTicketGanador(ticketVerificadoCobro.qrPayload);
    if (!resp.ok) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `RECHAZO EN PAGO: ${resp.error || "Fallo al procesar pago en el servidor."}`,
      });
      return;
    }

    const actualizado: TicketHistoricoLocal = {
      ...ticketVerificadoCobro,
      estado: "PAGADO",
    };

    setTicketsPorTenant((prev) => ({
      ...prev,
      [tenantActual.id]: (prev[tenantActual.id] ?? []).map((t) =>
        t.ticketId === actualizado.ticketId ? actualizado : t
      ),
    }));
    setTicketVerificadoCobro(actualizado);
    setAlertaSistema({
      tipo: "exito",
      mensaje: `PAGO IDEMPOTENTE REGISTRADO: Ticket #${
        actualizado.serialCorto
      } (Cliente WA: ${
        actualizado.clienteTelefono
      }) pagado por $${actualizado.premioTotalUsd.toFixed(2)} USD (Bs. ${(
        actualizado.premioTotalUsd * tasaBcv
      ).toFixed(2)}).`,
    });
  };

  const ejecutarLiquidacionManualContingencia = async () => {
    const figuraGanadora = resolverFiguraPorInput(animalGanadorManual);
    if (!figuraGanadora) return;

    const resp = await liquidarSorteo(
      sorteoLiquidarId,
      figuraGanadora.dbNumber,
      "MANUAL_CONTINGENCIA"
    );

    if (!resp.ok) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `RECHAZO EN LIQUIDACIÓN: ${resp.error || "Fallo al liquidar sorteo."}`,
      });
      return;
    }

    const horaLiq = new Intl.DateTimeFormat("es-VE", {
      timeStyle: "medium",
    }).format(new Date());

    setResultadosSorteo((prev) => ({
      ...prev,
      [sorteoLiquidarId]: {
        animalDbNumber: figuraGanadora.dbNumber,
        metodo: "MANUAL_CONTINGENCIA",
        horaLiquidacion: horaLiq,
      },
    }));

    setTicketsPorTenant((prev) => {
      const nuevoMapa: Record<string, TicketHistoricoLocal[]> = {};
      for (const [tId, lista] of Object.entries(prev)) {
        nuevoMapa[tId] = lista.map((tk) => {
          if (tk.estado === "ANULADO" || tk.estado === "PAGADO") return tk;
          const tieneSorteo = tk.items.some(
            (i) => i.sorteoId === sorteoLiquidarId
          );
          if (!tieneSorteo) return tk;

          let premioAcumulado = 0;
          for (const item of tk.items) {
            const ganadorDeSuSorteo =
              item.sorteoId === sorteoLiquidarId
                ? figuraGanadora.dbNumber
                : resultadosSorteo[item.sorteoId]?.animalDbNumber;
            if (ganadorDeSuSorteo === item.dbNumber) {
              premioAcumulado += Number((item.montoUsd * 30).toFixed(2));
            }
          }

          return {
            ...tk,
            premioTotalUsd: premioAcumulado,
            estado: premioAcumulado > 0 ? "GANADOR" : "PERDEDOR",
          };
        });
      }
      return nuevoMapa;
    });

    setPasoConfirmacionManual(1);
    setAlertaSistema({
      tipo: "exito",
      mensaje: `Sorteo liquidado con la figura ${figuraGanadora.codigo} - ${figuraGanadora.nombre}. Balances y tickets actualizados (30x).`,
    });
  };

  const cuadreCajaTenantActual = useMemo(() => {
    const lista = (ticketsPorTenant[tenantActual.id] ?? []).filter(
      (t) => t.estado !== "ANULADO"
    );
    const totalVendidoUsd = lista.reduce((acc, t) => acc + t.totalUsd, 0);
    const totalPremiosGeneradosUsd = lista
      .filter((t) => t.estado === "GANADOR" || t.estado === "PAGADO")
      .reduce((acc, t) => acc + t.premioTotalUsd, 0);
    const totalPremiosPagadosUsd = lista
      .filter((t) => t.estado === "PAGADO")
      .reduce((acc, t) => acc + t.premioTotalUsd, 0);
    const utilidadNetaUsd = totalVendidoUsd - totalPremiosGeneradosUsd;

    return {
      totalVendidoUsd,
      totalVendidoBs: totalVendidoUsd * tasaBcv,
      totalPremiosGeneradosUsd,
      totalPremiosPagadosUsd,
      utilidadNetaUsd,
      utilidadNetaBs: utilidadNetaUsd * tasaBcv,
    };
  }, [ticketsPorTenant, tenantActual.id, tasaBcv]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* BARRA SUPERIOR OPERATIVA MULTI-TENANT */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 py-3 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black text-lg">
              BP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-tight text-white">
                  BancaPro Core
                </h1>
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  WhatsApp Ticket • RLS Multi-Tenant
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Comercio Activo:</span>
                <select
                  value={tenantActualId}
                  onChange={(e) => {
                    setTenantActualId(e.target.value);
                    setCarrito([]);
                    setTicketVerificadoCobro(null);
                  }}
                  className="bg-slate-800 text-emerald-300 font-semibold rounded px-2 py-0.5 border border-slate-700 focus:outline-none focus:border-emerald-500"
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre} ({t.rif})
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5 ml-2">
                  {usuarioSesion ? (
                    <div className="flex items-center gap-1.5">
                      <span
                        title={`Conectado a GoTrue como ${usuarioSesion.email}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      >
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        {usuarioSesion.nombre} ({usuarioSesion.rol})
                      </span>
                      <button
                        onClick={ejecutarCerrarSesion}
                        disabled={cargandoAuth}
                        title="Cerrar sesión GoTrue"
                        className="text-[10px] text-slate-400 hover:text-rose-400 transition underline"
                      >
                        Salir
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={ejecutarLoginMagaly}
                      disabled={cargandoAuth}
                      className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3" />
                      {cargandoAuth ? "Autenticando..." : "Conectar GoTrue (Magaly)"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5 bg-slate-950 border border-amber-500/30 rounded-lg px-3 py-1.5">
              <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Cierre Sorteo {proximoSorteoAbierto?.etiqueta} (T-3m)
                </div>
                <div className="font-mono text-sm font-bold text-amber-300">
                  {formatearSegundos(
                    proximoSorteoAbierto?.segsRestantesCierre ?? 0
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-slate-950 border border-sky-500/30 rounded-lg px-3 py-1.5">
              <DollarSign className="w-4 h-4 text-sky-400" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Tasa Oficial BCV
                </div>
                <div className="font-mono text-sm font-bold text-sky-300">
                  Bs. {tasaBcv.toFixed(2)} / USD
                </div>
              </div>
              <button
                onClick={sincronizarTasaBcvAhora}
                disabled={sincronizandoBcv}
                title="Sincronizar con BCV"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-300 transition"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    sincronizandoBcv ? "animate-spin text-sky-400" : ""
                  }`}
                />
              </button>
            </div>

            <nav className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setVistaActiva("POS")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                  vistaActiva === "POS"
                    ? "bg-emerald-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
                1. Taquilla POS
              </button>
              <button
                onClick={() => setVistaActiva("COBRO_QR")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                  vistaActiva === "COBRO_QR"
                    ? "bg-emerald-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                2. Reclamar Premio (WhatsApp / QR)
              </button>
              <button
                onClick={() => setVistaActiva("ADMIN_COMERCIO")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                  vistaActiva === "ADMIN_COMERCIO"
                    ? "bg-emerald-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                3. Caja & Cupos
              </button>
              <button
                onClick={() => setVistaActiva("SUPERADMIN")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                  vistaActiva === "SUPERADMIN"
                    ? "bg-emerald-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                4. SuperAdmin
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* BANNER DE FEEDBACK TRANSACCIONAL */}
      {alertaSistema && (
        <div className="max-w-7xl mx-auto w-full mt-3 px-4 print:hidden">
          <div
            className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-xs font-medium ${
              alertaSistema.tipo === "error"
                ? "bg-red-950/70 border-red-500/50 text-red-200"
                : alertaSistema.tipo === "exito"
                ? "bg-emerald-950/70 border-emerald-500/50 text-emerald-200"
                : "bg-sky-950/70 border-sky-500/50 text-sky-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {alertaSistema.tipo === "error" ? (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>{alertaSistema.mensaje}</span>
            </div>
            <button
              onClick={() => setAlertaSistema(null)}
              className="text-slate-400 hover:text-white ml-4"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 print:hidden">
        {/* =====================================================================
            VISTA 1: TAQUILLA POS CON DESPACHO DE TICKET POR WHATSAPP (SIN IMPRESORA)
           ===================================================================== */}
        {vistaActiva === "POS" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* COLUMNA IZQUIERDA (8 cols) */}
            <div className="lg:col-span-8 space-y-4">
              {/* Selector de Sorteo con bloqueo automático T - 3 minutos */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    1. Seleccione Horario de Sorteo (Bloqueo Automático T - 3 Minutos)
                  </span>
                  <span className="text-xs font-mono text-emerald-400">
                    Cupo Máx por Figura: ${tenantActual.cupoAnimalUsd.toFixed(2)} USD
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {estadoHorarios.map((h) => {
                    const seleccionado = sorteoSeleccionadoId === h.id;
                    return (
                      <button
                        key={h.id}
                        onClick={() => setSorteoSeleccionadoId(h.id)}
                        className={`p-2 rounded-lg border text-left transition relative ${
                          !h.abiertoParaVenta
                            ? "bg-slate-950/60 border-slate-800/80 text-slate-500 cursor-not-allowed"
                            : seleccionado
                            ? "bg-emerald-600/20 border-emerald-500 text-white ring-1 ring-emerald-500"
                            : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <div className="font-mono text-xs font-bold flex items-center justify-between">
                          <span>{h.etiqueta}</span>
                          {!h.abiertoParaVenta && (
                            <Lock className="w-3 h-3 text-rose-400" />
                          )}
                        </div>
                        <div
                          className={`text-[10px] mt-0.5 font-mono ${
                            h.abiertoParaVenta
                              ? "text-emerald-400"
                              : "text-rose-400"
                          }`}
                        >
                          {h.estadoLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Barra de Captura Ultra-Rápida 100% Teclado Numérico */}
              <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                      Entrada Rápida por Teclado Numérico (Ej: 05 + Enter = León)
                    </h2>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    [Enter] Agregar Jugada • [F9] Emitir y Enviar por WhatsApp
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                      Código Figura (0, 00, 01..36)
                    </label>
                    <div className="relative">
                      <input
                        ref={inputCodigoRef}
                        type="text"
                        maxLength={2}
                        value={codigoInput}
                        onChange={(e) =>
                          setCodigoInput(e.target.value.replace(/[^0-9]/g, ""))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            agregarJugadaAlCarrito();
                          } else if (e.key === "F9") {
                            e.preventDefault();
                            procesarEmisionTicket();
                          }
                        }}
                        placeholder="Ej: 05"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2.5 font-mono text-lg font-bold text-white focus:outline-none"
                      />
                      {figuraPrevisualizada && (
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {figuraPrevisualizada.emoji}{" "}
                          {figuraPrevisualizada.nombre}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="sm:col-span-5">
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1 font-medium">
                      <span>Monto Jugada (USD)</span>
                      <span className="text-sky-400 font-mono">
                        ≈ Bs.{" "}
                        {((parseFloat(montoInput) || 0) * tasaBcv).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        ref={inputMontoRef}
                        type="number"
                        step="0.50"
                        min="0.10"
                        value={montoInput}
                        onChange={(e) => setMontoInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            agregarJugadaAlCarrito();
                          } else if (e.key === "F9") {
                            e.preventDefault();
                            procesarEmisionTicket();
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2.5 font-mono text-lg font-bold text-emerald-400 focus:outline-none"
                      />
                      {["0.50", "1.00", "2.00", "5.00"].map((Preset) => (
                        <button
                          key={Preset}
                          type="button"
                          onClick={() => setMontoInput(Preset)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-mono rounded border border-slate-700 text-slate-200"
                        >
                          ${Preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      onClick={() => agregarJugadaAlCarrito()}
                      className="w-full py-3 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-md"
                    >
                      + Agregar [Enter]
                    </button>
                  </div>
                </div>
              </div>

              {/* Matriz Interactiva de las 38 Figuras de Lotto Activo */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Catálogo Oficial Lotto Activo (38 Figuras - Paga 30x)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Clic directo en cualquier animalito para agregar
                  </span>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {CATALOGO_LOTTO_ACTIVO.map((animal) => {
                    const disp = obtenerCupoDisponible(
                      sorteoSeleccionadoId,
                      animal.dbNumber
                    );
                    const porcentajeUsado = Math.min(
                      100,
                      ((tenantActual.cupoAnimalUsd - disp) /
                        tenantActual.cupoAnimalUsd) *
                        100
                    );
                    const agotado = disp <= 0;

                    return (
                      <button
                        key={animal.codigo}
                        type="button"
                        disabled={agotado}
                        onClick={() => agregarJugadaAlCarrito(animal)}
                        className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                          agotado
                            ? "bg-red-950/30 border-red-800/50 opacity-60 cursor-not-allowed"
                            : "bg-slate-950 border-slate-800 hover:border-emerald-500/60 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono text-xs font-black text-white bg-slate-800 px-1.5 py-0.5 rounded">
                            {animal.codigo}
                          </span>
                          <span className="text-base">{animal.emoji}</span>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-200 truncate mt-1">
                          {animal.nombre}
                        </div>
                        <div className="mt-1.5 w-full">
                          <div className="flex justify-between text-[9px] font-mono text-slate-400">
                            <span>Cupo:</span>
                            <span
                              className={
                                agotado
                                  ? "text-red-400 font-bold"
                                  : "text-emerald-400"
                              }
                            >
                              ${disp.toFixed(1)}
                            </span>
                          </div>
                          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden mt-0.5">
                            <div
                              className={`h-full ${
                                porcentajeUsado >= 90
                                  ? "bg-red-500"
                                  : porcentajeUsado >= 60
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
                              }`}
                              style={{ width: `${porcentajeUsado}%` }}
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* COLUMNA DERECHA (4 cols): Ticket Digital por WhatsApp + Vista Previa de Mensaje Criptográfico */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-white">
                      Ticket en Confección
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {tenantActual.nombre} • Tasa BCV: Bs. {tasaBcv.toFixed(2)}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded">
                    Modo Sin Impresora Activo
                  </span>
                </div>

                {/* Selector de Canal de Entrega + Teléfono WhatsApp del Cliente */}
                <div className="mt-3 bg-slate-950 border border-emerald-500/30 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5" />
                      Canal de Entrega del Ticket
                    </span>
                    <div className="flex gap-1">
                      {(["WHATSAPP", "TERMICA_ESCPOS", "AMBOS"] as const).map(
                        (modo) => (
                          <button
                            key={modo}
                            type="button"
                            onClick={() => setModoEntrega(modo)}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                              modoEntrega === modo
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-800 text-slate-400 hover:text-white"
                            }`}
                          >
                            {modo === "WHATSAPP"
                              ? "WhatsApp"
                              : modo === "TERMICA_ESCPOS"
                              ? "Impresora"
                              : "Ambos"}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {(modoEntrega === "WHATSAPP" || modoEntrega === "AMBOS") && (
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        WhatsApp del Cliente (Para enviarle su Ticket y PIN de Cobro):
                      </label>
                      <input
                        type="tel"
                        value={clienteTelefonoInput}
                        onChange={(e) =>
                          setClienteTelefonoInput(e.target.value)
                        }
                        placeholder="Ej: 0414-1234567 o +58412..."
                        className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 font-mono text-sm text-white focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* Lista de Jugadas en el Carrito */}
                <div className="my-3 max-h-52 overflow-y-auto space-y-2 pr-1">
                  {carrito.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
                      Sin jugadas aún. Digite el código (ej. 05) y presione Enter.
                    </div>
                  ) : (
                    carrito.map((item) => (
                      <div
                        key={item.idTemporal}
                        className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span>{item.figura.emoji}</span>
                            <span className="font-mono text-emerald-400">
                              #{item.figura.codigo}
                            </span>
                            <span>{item.figura.nombre}</span>
                            <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                              {item.sorteoEtiqueta}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            Premio Potencial (30x): $
                            {(item.montoUsd * 30).toFixed(2)} USD
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right font-mono">
                            <div className="font-bold text-emerald-400">
                              ${item.montoUsd.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Bs. {(item.montoUsd * tasaBcv).toFixed(2)}
                            </div>
                          </div>
                          <button
                            onClick={() =>
                              setCarrito((prev) =>
                                prev.filter(
                                  (x) => x.idTemporal !== item.idTemporal
                                )
                              )
                            }
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Resumen Financiero Dual USD / VES */}
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Total Jugadas:</span>
                    <span className="font-mono font-bold text-white">
                      {carrito.length}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-white">
                    <span>TOTAL A COBRAR (USD):</span>
                    <span className="font-mono text-emerald-400">
                      ${totalCarritoUsd.toFixed(2)} USD
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-sky-300 border-t border-slate-800 pt-1.5">
                    <span>TOTAL EN BOLÍVARES (BCV):</span>
                    <span className="font-mono">
                      Bs. {totalCarritoBs.toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={carrito.length === 0 || procesandoVenta}
                  onClick={procesarEmisionTicket}
                  className="mt-3 w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-lg"
                >
                  {modoEntrega === "WHATSAPP" ? (
                    <MessageCircle className="w-4 h-4" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                  <span>
                    {procesandoVenta
                      ? "Firmando HMAC y Enviando a WhatsApp..."
                      : modoEntrega === "WHATSAPP"
                      ? "Emitir y Enviar Ticket por WhatsApp [F9]"
                      : `Emitir Ticket (${modoEntrega}) [F9]`}
                  </span>
                </button>
              </div>

              {/* Tarjeta del Último Ticket Digital Generado para WhatsApp */}
              {ultimoTicketWhatsApp && (
                <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                      Comprobante WhatsApp Listo (#
                      {ultimoTicketWhatsApp.serialCorto})
                    </span>
                    <span className="text-[11px] font-mono bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded">
                      PIN: {ultimoTicketWhatsApp.pinReclamo}
                    </span>
                  </div>
                  <pre className="text-[10px] font-mono bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {ultimoTicketWhatsApp.mensajeWhatsApp}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (ultimoTicketImpreso) {
                          abrirWhatsAppClienteDirecto({
                            ...ultimoTicketImpreso,
                            clienteTelefono:
                              ultimoTicketWhatsApp.clienteTelefono,
                          });
                        }
                      }}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Reenviar a WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          ultimoTicketWhatsApp.mensajeWhatsApp
                        );
                        setAlertaSistema({
                          tipo: "info",
                          mensaje:
                            "Comprobante de WhatsApp copiado al portapapeles.",
                        });
                      }}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copiar
                    </button>
                  </div>
                </div>
              )}

              {/* Últimos Tickets del Comercio Actual + Reenvío WhatsApp + Anulación (<60s) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5">
                  Tickets Recientes ({tenantActual.nombre})
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(ticketsPorTenant[tenantActual.id] ?? []).map((tk) => {
                    const segsDesdeEmision = Math.floor(
                      (ahora.getTime() - tk.timestampEmisionMs) / 1000
                    );
                    const puedeAnular =
                      tk.estado === "EMITIDO" && segsDesdeEmision <= 60;

                    return (
                      <div
                        key={tk.ticketId}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-white">
                            PIN: {tk.pinReclamo}
                          </span>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                              tk.estado === "GANADOR"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : tk.estado === "PAGADO"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : tk.estado === "ANULADO"
                                ? "bg-rose-500/20 text-rose-300"
                                : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {tk.estado}
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                          <span>WA: {tk.clienteTelefono}</span>
                          <span>
                            ${tk.totalUsd.toFixed(2)} (Bs.{" "}
                            {tk.totalBs.toFixed(2)})
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                          <button
                            onClick={() => {
                              setInputQrCobro(tk.pinReclamo);
                              setVistaActiva("COBRO_QR");
                              verificarQrParaCobro(tk.pinReclamo);
                            }}
                            className="text-[11px] text-sky-400 hover:underline font-medium"
                          >
                            Reclamar Premio →
                          </button>
                          {puedeAnular && (
                            <button
                              onClick={() => manejarAnulacionTicket(tk)}
                              className="text-[11px] bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-700/50 px-2 py-0.5 rounded font-mono"
                            >
                              Anular ({60 - segsDesdeEmision}s)
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            VISTA 2: RECLAMO Y PAGO DE PREMIOS POR WHATSAPP (PIN DE COBRO, TELÉFONO O QR)
           ===================================================================== */}
        {vistaActiva === "COBRO_QR" && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Reclamo de Premio por Comprobante de WhatsApp / Firma HMAC-SHA256
                  </h2>
                  <p className="text-xs text-slate-400">
                    Cuando el cliente muestre su mensaje de WhatsApp, digite el{" "}
                    <strong className="text-emerald-300">
                      PIN de Reclamo (Ej: 0001041-9F4C2E81)
                    </strong>
                    , su número de teléfono o la firma HMAC para verificar y pagar su premio.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputQrCobro}
                  onChange={(e) => setInputQrCobro(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") verificarQrParaCobro();
                  }}
                  placeholder="Ingrese PIN de WhatsApp (ej: 0001041-9F4C2E81), Teléfono (0414-1234567) o Firma..."
                  className="flex-1 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-4 py-3 font-mono text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => verificarQrParaCobro()}
                  className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase rounded-lg transition"
                >
                  Verificar Ticket
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Probar reclamo rápido por WhatsApp en {tenantActual.nombre}:</span>
                {(ticketsPorTenant[tenantActual.id] ?? []).map((tk) => (
                  <button
                    key={tk.ticketId}
                    onClick={() => {
                      setInputQrCobro(tk.pinReclamo);
                      verificarQrParaCobro(tk.pinReclamo);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[11px] border border-slate-700"
                  >
                    PIN: {tk.pinReclamo} ({tk.estado})
                  </button>
                ))}
              </div>

              {errorVerificacionQr && (
                <div className="mt-5 p-4 rounded-xl bg-red-950/80 border border-red-500 flex items-center gap-3 text-red-200">
                  <XCircle className="w-6 h-6 text-red-400 shrink-0" />
                  <div>
                    <div className="font-bold text-sm">
                      VALIDACIÓN RECHAZADA (ANTI-FRAUDE / RLS)
                    </div>
                    <div className="text-xs mt-0.5">{errorVerificacionQr}</div>
                  </div>
                </div>
              )}

              {ticketVerificadoCobro && (
                <div className="mt-5 bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div
                    className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                      ticketVerificadoCobro.estado === "GANADOR"
                        ? "bg-emerald-950/80 border-emerald-500 text-emerald-200"
                        : ticketVerificadoCobro.estado === "PAGADO"
                        ? "bg-sky-950/80 border-sky-500 text-sky-200"
                        : "bg-amber-950/70 border-amber-500/60 text-amber-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="w-7 h-7 shrink-0" />
                      <div>
                        <div className="text-xs uppercase font-mono tracking-wider opacity-80">
                          PIN WhatsApp: {ticketVerificadoCobro.pinReclamo} •
                          Cliente: {ticketVerificadoCobro.clienteTelefono}
                        </div>
                        <div className="text-lg font-black">
                          {ticketVerificadoCobro.estado === "GANADOR" &&
                            `GANADOR - PAGAR $${ticketVerificadoCobro.premioTotalUsd.toFixed(
                              2
                            )} USD o Bs. ${(
                              ticketVerificadoCobro.premioTotalUsd * tasaBcv
                            ).toFixed(2)}`}
                          {ticketVerificadoCobro.estado === "PAGADO" &&
                            "YA COBRADO (PAGO IDEMPOTENTE BLOQUEADO)"}
                          {ticketVerificadoCobro.estado === "EMITIDO" &&
                            "NO PREMIADO AÚN (SORTEO EN CURSO)"}
                          {ticketVerificadoCobro.estado === "PERDEDOR" &&
                            "NO PREMIADO"}
                          {ticketVerificadoCobro.estado === "ANULADO" &&
                            "TICKET ANULADO"}
                        </div>
                      </div>
                    </div>

                    {ticketVerificadoCobro.estado === "GANADOR" && (
                      <button
                        onClick={confirmarPagoPremio}
                        className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg transition"
                      >
                        Confirmar Pago Ahora
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="text-slate-400 font-semibold">
                      Desglose de Jugadas y Firma HMAC-SHA256 del Comprobante WhatsApp:
                    </div>
                    {ticketVerificadoCobro.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between bg-slate-900 px-3 py-2 rounded border border-slate-800 font-mono"
                      >
                        <span>
                          Sorteo {item.sorteoHora} • #{item.codigoAnimal}{" "}
                          {item.nombreAnimal}
                        </span>
                        <span>
                          Jugado: ${item.montoUsd.toFixed(2)} → Premio 30x: $
                          {item.premioPotencialUsd.toFixed(2)} USD
                        </span>
                      </div>
                    ))}
                    <div className="text-[10px] font-mono text-slate-500 pt-1 break-all">
                      HMAC-SHA256: {ticketVerificadoCobro.codigoSeguridad}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =====================================================================
            VISTA 3: DASHBOARD DE ADMINISTRACIÓN DEL COMERCIO
           ===================================================================== */}
        {vistaActiva === "ADMIN_COMERCIO" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Total Vendido Hoy ({tenantActual.nombre})
                </div>
                <div className="text-2xl font-black font-mono text-white mt-1">
                  ${cuadreCajaTenantActual.totalVendidoUsd.toFixed(2)} USD
                </div>
                <div className="text-xs font-mono text-sky-400 mt-0.5">
                  Bs. {cuadreCajaTenantActual.totalVendidoBs.toFixed(2)}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Total Premios Generados (30x)
                </div>
                <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                  ${cuadreCajaTenantActual.totalPremiosGeneradosUsd.toFixed(2)}{" "}
                  USD
                </div>
                <div className="text-xs font-mono text-slate-400 mt-0.5">
                  Bs.{" "}
                  {(
                    cuadreCajaTenantActual.totalPremiosGeneradosUsd * tasaBcv
                  ).toFixed(2)}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Total Premios Pagados en Caja
                </div>
                <div className="text-2xl font-black font-mono text-rose-400 mt-1">
                  ${cuadreCajaTenantActual.totalPremiosPagadosUsd.toFixed(2)}{" "}
                  USD
                </div>
                <div className="text-xs font-mono text-slate-400 mt-0.5">
                  Pendiente por cobrar: $
                  {(
                    cuadreCajaTenantActual.totalPremiosGeneradosUsd -
                    cuadreCajaTenantActual.totalPremiosPagadosUsd
                  ).toFixed(2)}
                </div>
              </div>

              <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Utilidad Neta del Comercio
                </div>
                <div
                  className={`text-2xl font-black font-mono mt-1 ${
                    cuadreCajaTenantActual.utilidadNetaUsd >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  ${cuadreCajaTenantActual.utilidadNetaUsd.toFixed(2)} USD
                </div>
                <div className="text-xs font-mono text-sky-300 mt-0.5">
                  Bs. {cuadreCajaTenantActual.utilidadNetaBs.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>
                    Configuración de Cupo de Riesgo por Sorteo (Fórmula: Pérdida Máx / 30)
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Defina la pérdida máxima aceptable por sorteo para{" "}
                  <strong>{tenantActual.nombre}</strong>.
                </p>

                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-400 mb-1">
                      Pérdida Máxima Aceptable por Sorteo (USD)
                    </label>
                    <input
                      type="number"
                      value={nuevaPerdidaMaxInput}
                      onChange={(e) => setNuevaPerdidaMaxInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-white"
                    />
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-xs font-mono">
                    <div className="text-slate-400">Cupo Máx por Figura:</div>
                    <div className="text-emerald-400 font-bold text-sm">
                      $
                      {((parseFloat(nuevaPerdidaMaxInput) || 0) / 30).toFixed(
                        2
                      )}{" "}
                      USD
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const val = parseFloat(nuevaPerdidaMaxInput);
                      if (isNaN(val) || val <= 0) return;
                      setTenants((prev) =>
                        prev.map((t) =>
                          t.id === tenantActual.id
                            ? {
                                ...t,
                                perdidaMaximaUsd: val,
                                cupoAnimalUsd: Number((val / 30).toFixed(2)),
                              }
                            : t
                        )
                      );
                      setAlertaSistema({
                        tipo: "exito",
                        mensaje: `Cupo máximo actualizado a $${(
                          val / 30
                        ).toFixed(2)} USD por animalito para ${
                          tenantActual.nombre
                        }.`,
                      });
                    }}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg"
                  >
                    Guardar Cupo
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-400" />
                  <span>
                    Fail-Safe Manual de Resultados (Contingencia en 2 Pasos)
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Si el API externo de Lotto Activo presenta demoras, ingrese el animal ganador
                  con confirmación de dos pasos para disparar{" "}
                  <code className="text-amber-300">liquidar_sorteo()</code>.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Sorteo a Liquidar
                    </label>
                    <select
                      value={sorteoLiquidarId}
                      onChange={(e) => {
                        setSorteoLiquidarId(Number(e.target.value));
                        setPasoConfirmacionManual(1);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                    >
                      {HORARIOS_OFICIALES_LOTTO_ACTIVO.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.etiqueta}{" "}
                          {resultadosSorteo[h.id] ? "(YA LIQUIDADO)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Animal Ganador (0, 00, 01..36)
                    </label>
                    <input
                      type="text"
                      maxLength={2}
                      value={animalGanadorManual}
                      onChange={(e) => {
                        setAnimalGanadorManual(e.target.value);
                        setPasoConfirmacionManual(1);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                {pasoConfirmacionManual === 1 ? (
                  <button
                    onClick={() => setPasoConfirmacionManual(2)}
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs uppercase rounded-lg"
                  >
                    Paso 1: Pre-validar Liquidación de Sorteo
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={ejecutarLiquidacionManualContingencia}
                      className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase rounded-lg"
                    >
                      Paso 2: Confirmar y Liquidar 30x Ahora
                    </button>
                    <button
                      onClick={() => setPasoConfirmacionManual(1)}
                      className="px-4 py-2.5 bg-slate-800 text-slate-300 text-xs rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white mb-3">
                Historial de Sorteos y Resultados del Día (Lotto Activo)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                {HORARIOS_OFICIALES_LOTTO_ACTIVO.map((h) => {
                  const res = resultadosSorteo[h.id];
                  const fig = res
                    ? obtenerFiguraPorDbNumber(res.animalDbNumber)
                    : null;
                  return (
                    <div
                      key={h.id}
                      className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs"
                    >
                      <div className="font-mono font-bold text-slate-300">
                        {h.etiqueta}
                      </div>
                      {fig ? (
                        <div className="mt-1.5">
                          <div className="text-base font-black text-emerald-400 flex items-center gap-1">
                            <span>{fig.emoji}</span>
                            <span className="font-mono">#{fig.codigo}</span>
                          </div>
                          <div className="text-white font-semibold">
                            {fig.nombre}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {res.metodo}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] font-mono text-slate-500">
                          Pendiente
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            VISTA 4: SUPERADMIN MULTI-TENANT GLOBAL
           ===================================================================== */}
        {vistaActiva === "SUPERADMIN" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                <span>Aprovisionar Nuevo Comercio / Bodega (Tenant RLS)</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Nombre del Comercio / Agencia
                  </label>
                  <input
                    type="text"
                    value={nuevoComercioNombre}
                    onChange={(e) => setNuevoComercioNombre(e.target.value)}
                    placeholder="Ej: Inversiones El Gran Premio C.A."
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">RIF</label>
                  <input
                    type="text"
                    value={nuevoComercioRif}
                    onChange={(e) => setNuevoComercioRif(e.target.value)}
                    placeholder="J-41239876-0"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Correo del Administrador del Comercio
                  </label>
                  <input
                    type="email"
                    value={nuevoComercioEmail}
                    onChange={(e) => setNuevoComercioEmail(e.target.value)}
                    placeholder="admin@comercio.local"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Pérdida Máxima por Sorteo (USD) → Cupo = Pérdida / 30
                  </label>
                  <input
                    type="number"
                    value={nuevoComercioPerdidaMax}
                    onChange={(e) => setNuevoComercioPerdidaMax(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
                  />
                </div>

                <button
                  onClick={() => {
                    if (!nuevoComercioNombre || !nuevoComercioRif) return;
                    const perdida = parseFloat(nuevoComercioPerdidaMax) || 300;
                    const nuevo: TenantComercio = {
                      id: crypto.randomUUID(),
                      nombre: nuevoComercioNombre,
                      rif: nuevoComercioRif,
                      telefono: "+58 414-0000000",
                      adminEmail:
                        nuevoComercioEmail || "admin@nuevo-comercio.local",
                      perdidaMaximaUsd: perdida,
                      cupoAnimalUsd: Number((perdida / 30).toFixed(2)),
                      ventasHoyUsd: 0,
                      activo: true,
                    };
                    setTenants((prev) => [...prev, nuevo]);
                    setNuevoComercioNombre("");
                    setNuevoComercioRif("");
                    setNuevoComercioEmail("");
                    setAlertaSistema({
                      tipo: "exito",
                      mensaje: `Tenant "${
                        nuevo.nombre
                      }" creado con aislamiento RLS activo (tenant_id: ${nuevo.id.slice(
                        0,
                        8
                      )}...).`,
                    });
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase rounded-lg transition"
                >
                  Crear Tenant y Asignar Políticas RLS
                </button>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-sm font-bold text-white mb-3">
                Comercios Activos en la Plataforma (Fondos y Cajas 100% Aislados)
              </h3>
              <div className="space-y-3">
                {tenants.map((t) => (
                  <div
                    key={t.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-sm text-white flex items-center gap-2">
                        <span>{t.nombre}</span>
                        <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">
                          {t.rif}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-1">
                        Admin: {t.adminEmail} • Tenant UUID:{" "}
                        {t.id.slice(0, 12)}...
                      </div>
                    </div>

                    <div className="text-right font-mono text-xs">
                      <div className="text-emerald-400 font-bold">
                        Cupo Animal: ${t.cupoAnimalUsd.toFixed(2)} USD
                      </div>
                      <div className="text-slate-400">
                        Pérdida Máx: ${t.perdidaMaximaUsd.toFixed(2)} USD
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
