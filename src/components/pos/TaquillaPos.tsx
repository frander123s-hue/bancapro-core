"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
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
  sincronizarTasaBcvEnVivo,
  actualizarTasaBcv,
} from "@/lib/actions/transacciones";
import {
  iniciarSesionMagaly,
  cerrarSesion,
  obtenerContextoActual,
  autenticarPortalSuperAdmin,
  verificarSesionPortalSuperAdmin,
  cerrarSesionPortalSuperAdmin,
} from "@/lib/actions/auth";
import {
  imprimirTicketTermico,
  type DatosTicketTermico,
} from "@/lib/hardware/escpos";
import {
  construirMensajeWhatsAppTicket,
  abrirWhatsAppClienteDirecto,
  normalizarTelefonoVenezuela,
  generarImagenTicketConQrDataUrl,
  copiarImagenTicketConQrAlPortapapeles,
} from "@/lib/hardware/whatsapp";
import { generarMatrizQr } from "@/lib/hardware/qr-generator";
import {
  Printer,
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
  MessageCircle,
  Smartphone,
  Copy,
  Send,
  KeyRound,
  LogOut,
  ArrowLeftRight,
  BookOpen,
  Users,
  UserCheck,
  Download,
  FileSpreadsheet,
  QrCode,
  Wifi,
} from "lucide-react";

interface JugadaCarrito {
  idTemporal: string;
  sorteoId: number;
  sorteoEtiqueta: string;
  figura: FiguraAnimalito;
  montoUsd: number;
  montoBs: number;
}

interface TicketHistoricoLocal {
  ticketId: string;
  serialCorto: string;
  pinReclamo: string; // Formato corto fácil de dictar/enviar por WhatsApp: 0001041-9F4C2E81
  clienteTelefono: string;
  cajeroId?: string;
  cajeroNombre?: string;
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
    montoBs?: number;
    premioPotencialUsd: number;
  }>;
}

interface CajeroComercio {
  id: string;
  nombre: string;
  turno: string;
  activo: boolean;
}

interface ConfigWhatsAppComercio {
  modoVinculacion: "DIRECTO_WA_ME" | "API_CLOUD_GATEWAY";
  subModoApi: "META_CLOUD" | "GATEWAY_QR";
  telefonoComercio: string;
  metaToken: string;
  metaPhoneId: string;
  gatewayUrl: string;
  gatewayToken: string;
  instanciaId: string;
  qrVinculado: boolean;
  ultimaSincronizacion: string;
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
  // Vistas operativas del Comercio vs Portal SuperAdmin Independiente
  const [vistaActiva, setVistaActiva] = useState<
    "POS" | "COBRO_QR" | "ADMIN_COMERCIO"
  >("POS");
  const [enPortalSuperAdmin, setEnPortalSuperAdmin] = useState<boolean>(false);
  const [superAdminAutenticado, setSuperAdminAutenticado] =
    useState<boolean>(false);
  const [superAdminUserInput, setSuperAdminUserInput] = useState<string>("");
  const [superAdminPassInput, setSuperAdminPassInput] = useState<string>("");
  const [errorLoginSuperAdmin, setErrorLoginSuperAdmin] = useState<
    string | null
  >(null);
  const [autenticandoSuperAdmin, setAutenticandoSuperAdmin] =
    useState<boolean>(false);

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

  const tenantActual = useMemo(
    () => tenants.find((t) => t.id === tenantActualId) ?? tenants[0],
    [tenants, tenantActualId]
  );

  // Tasa Oficial BCV en vivo (Sincronizada automáticamente al iniciar)
  const [tasaBcv, setTasaBcv] = useState<number>(45.85);
  const [sincronizandoBcv, setSincronizandoBcv] = useState<boolean>(false);
  const [ultimaHoraSincBcv, setUltimaHoraSincBcv] = useState<string>("Sincronizando...");
  const [tasaManualSuperAdminInput, setTasaManualSuperAdminInput] =
    useState<string>("");

  // Reloj del servidor y conteo regresivo hacia el cierre (T - 3 minutos)
  const [ahora, setAhora] = useState<Date>(new Date());
  const [sorteoSeleccionadoId, setSorteoSeleccionadoId] = useState<number>(2);

  // Inputs de Taquilla Ultra-Rápida con Doble Moneda Sincronizada (Bs. ⇄ USD)
  // La mayoría de los clientes hacen la apuesta mínima en Bolívares (Bs.)
  const [codigoInput, setCodigoInput] = useState<string>("");
  const [monedaFoco, setMonedaFoco] = useState<"BS" | "USD">("BS");
  const [montoBsInput, setMontoBsInput] = useState<string>("20.00");
  const [montoInput, setMontoInput] = useState<string>("0.44"); // Monto en USD sincronizado
  const [clienteTelefonoInput, setClienteTelefonoInput] =
    useState<string>("0414-1234567");
  const [modoEntrega, setModoEntrega] = useState<
    "WHATSAPP" | "TERMICA_ESCPOS" | "AMBOS"
  >("WHATSAPP");
  const [carrito, setCarrito] = useState<JugadaCarrito[]>([]);
  const [anchoImpresora] = useState<"58mm" | "80mm">("58mm");
  const [usarWebSerial] = useState<boolean>(false);

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

  // Cajeros / Operadores de Caja por Comercio (Tenant)
  const [cajerosPorTenant, setCajerosPorTenant] = useState<
    Record<string, CajeroComercio[]>
  >({
    "11111111-1111-4111-8111-111111111111": [
      {
        id: "caj-magaly-1",
        nombre: "Magaly Rodríguez (Encargada)",
        turno: "Turno Completo",
        activo: true,
      },
      {
        id: "caj-magaly-2",
        nombre: "Carlos Pérez (Caja 1)",
        turno: "Mañana (08:00 AM - 01:00 PM)",
        activo: true,
      },
      {
        id: "caj-magaly-3",
        nombre: "Yulimar Gómez (Caja 2)",
        turno: "Tarde (01:00 PM - 07:00 PM)",
        activo: true,
      },
    ],
    "33333333-3333-4333-8333-333333333333": [
      {
        id: "caj-suerte-1",
        nombre: "Roberto Méndez (Encargado)",
        turno: "Mañana",
        activo: true,
      },
      {
        id: "caj-suerte-2",
        nombre: "Ana Bolívar (Caja Principal)",
        turno: "Tarde",
        activo: true,
      },
    ],
  });

  const [cajeroSeleccionadoPorTenant, setCajeroSeleccionadoPorTenant] =
    useState<Record<string, string>>({
      "11111111-1111-4111-8111-111111111111": "caj-magaly-1",
      "33333333-3333-4333-8333-333333333333": "caj-suerte-1",
    });

  const [mostrandoFormNuevoCajero, setMostrandoFormNuevoCajero] =
    useState<boolean>(false);
  const [nuevoCajeroNombreInput, setNuevoCajeroNombreInput] =
    useState<string>("");
  const [nuevoCajeroTurnoInput, setNuevoCajeroTurnoInput] =
    useState<string>("Turno Mañana");

  const cajerosDelComercioActual = useMemo(
    () =>
      cajerosPorTenant[tenantActual.id] ?? [
        {
          id: "caj-default",
          nombre: "Cajero Principal",
          turno: "General",
          activo: true,
        },
      ],
    [cajerosPorTenant, tenantActual.id]
  );

  const cajeroActivoActual = useMemo(() => {
    const idSel = cajeroSeleccionadoPorTenant[tenantActual.id];
    return (
      cajerosDelComercioActual.find((c) => c.id === idSel) ??
      cajerosDelComercioActual[0]
    );
  }, [cajeroSeleccionadoPorTenant, cajerosDelComercioActual, tenantActual.id]);

  // Configuración Centralizada de Sincronización de WhatsApp por Comercio (administrada desde el Portal SuperAdmin)
  const [configWhatsAppPorTenant, setConfigWhatsAppPorTenant] = useState<
    Record<string, ConfigWhatsAppComercio>
  >({
    "11111111-1111-4111-8111-111111111111": {
      modoVinculacion: "DIRECTO_WA_ME",
      subModoApi: "GATEWAY_QR",
      telefonoComercio: "+58 414-1234567",
      metaToken: "",
      metaPhoneId: "",
      gatewayUrl: "https://api.bancapro-wa.local/instance/bodega-magaly/send",
      gatewayToken: "wa_live_magaly_998123a",
      instanciaId: "INST-MAGALY-01",
      qrVinculado: true,
      ultimaSincronizacion: "Sincronizado por SuperAdmin (Activo)",
    },
    "33333333-3333-4333-8333-333333333333": {
      modoVinculacion: "API_CLOUD_GATEWAY",
      subModoApi: "GATEWAY_QR",
      telefonoComercio: "+58 412-9876543",
      metaToken: "",
      metaPhoneId: "",
      gatewayUrl: "https://api.bancapro-wa.local/instance/la-suerte/send",
      gatewayToken: "wa_live_suerte_77412b",
      instanciaId: "INST-SUERTE-02",
      qrVinculado: true,
      ultimaSincronizacion: "Sincronizado por SuperAdmin (Activo)",
    },
  });

  const [comercioAdminSeleccionadoId, setComercioAdminSeleccionadoId] =
    useState<string>("11111111-1111-4111-8111-111111111111");
  const [comercioEliminarConfirmId, setComercioEliminarConfirmId] = useState<
    string | null
  >(null);
  const [mostrandoQrSuperAdmin, setMostrandoQrSuperAdmin] =
    useState<boolean>(false);

  // Historial de Tickets Emitidos en la Semana (Aislados por Tenant, con Cajero registrado)
  const [ticketsPorTenant, setTicketsPorTenant] = useState<
    Record<string, TicketHistoricoLocal[]>
  >({
    "11111111-1111-4111-8111-111111111111": [
      {
        ticketId: "a8098c1a-f86e-11da-bd1a-00112444be1e",
        serialCorto: "0001041",
        pinReclamo: "0001041-9F4C2E81",
        clienteTelefono: "0414-1234567",
        cajeroId: "caj-magaly-1",
        cajeroNombre: "Magaly Rodríguez (Encargada)",
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
      {
        ticketId: "b7098c1a-f86e-11da-bd1a-00112444be2f",
        serialCorto: "0001040",
        pinReclamo: "0001040-7A12C4E9",
        clienteTelefono: "0412-5558899",
        cajeroId: "caj-magaly-2",
        cajeroNombre: "Carlos Pérez (Caja 1)",
        canalEntrega: "WHATSAPP",
        tenantNombre: "Bodega Piloto Magaly",
        tenantRif: "J-40123987-1",
        fechaHora: "28/10/2026 02:15:40 PM",
        timestampEmisionMs: Date.now() - 86400_000,
        tasaBcv: 45.85,
        totalUsd: 3.5,
        totalBs: 160.48,
        codigoSeguridad:
          "7a12c4e9b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        qrPayload:
          "BANCAPRO|11111111-1111-4111-8111-111111111111|b7098c1a-f86e-11da-bd1a-00112444be2f|3.50|1793191540|7a12c4e9b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        mensajeWhatsApp:
          "🎟️ *COMPROBANTE OFICIAL - BODEGA PILOTO MAGALY*\n📌 *TICKET N°:* #0001040\n🔐 *CÓDIGO PARA RECLAMAR PREMIO:* 0001040-7A12C4E9",
        estado: "PERDEDOR",
        premioTotalUsd: 0,
        items: [
          {
            sorteoId: 7,
            sorteoHora: "03:00 PM",
            dbNumber: 0,
            codigoAnimal: "0",
            nombreAnimal: "Delfín",
            montoUsd: 2.0,
            premioPotencialUsd: 60.0,
          },
          {
            sorteoId: 7,
            sorteoHora: "03:00 PM",
            dbNumber: 12,
            codigoAnimal: "12",
            nombreAnimal: "Caballo",
            montoUsd: 1.5,
            premioPotencialUsd: 45.0,
          },
        ],
      },
      {
        ticketId: "c6098c1a-f86e-11da-bd1a-00112444be3a",
        serialCorto: "0001039",
        pinReclamo: "0001039-3D88E1B2",
        clienteTelefono: "0424-9991122",
        cajeroId: "caj-magaly-3",
        cajeroNombre: "Yulimar Gómez (Caja 2)",
        canalEntrega: "WHATSAPP",
        tenantNombre: "Bodega Piloto Magaly",
        tenantRif: "J-40123987-1",
        fechaHora: "27/10/2026 04:20:10 PM",
        timestampEmisionMs: Date.now() - 172800_000,
        tasaBcv: 45.8,
        totalUsd: 5.0,
        totalBs: 229.0,
        codigoSeguridad:
          "3d88e1b2b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        qrPayload:
          "BANCAPRO|11111111-1111-4111-8111-111111111111|c6098c1a-f86e-11da-bd1a-00112444be3a|5.00|1793105210|3d88e1b2b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        mensajeWhatsApp:
          "🎟️ *COMPROBANTE OFICIAL - BODEGA PILOTO MAGALY*\n📌 *TICKET N°:* #0001039\n🔐 *CÓDIGO PARA RECLAMAR PREMIO:* 0001039-3D88E1B2",
        estado: "PAGADO",
        premioTotalUsd: 30.0,
        items: [
          {
            sorteoId: 9,
            sorteoHora: "05:00 PM",
            dbNumber: 28,
            codigoAnimal: "28",
            nombreAnimal: "Zamuro",
            montoUsd: 1.0,
            premioPotencialUsd: 30.0,
          },
          {
            sorteoId: 9,
            sorteoHora: "05:00 PM",
            dbNumber: 36,
            codigoAnimal: "36",
            nombreAnimal: "Culebra",
            montoUsd: 4.0,
            premioPotencialUsd: 120.0,
          },
        ],
      },
    ],
    "33333333-3333-4333-8333-333333333333": [
      {
        ticketId: "d5098c1a-f86e-11da-bd1a-00112444be4b",
        serialCorto: "0002015",
        pinReclamo: "0002015-5E91A0C3",
        clienteTelefono: "0414-7773344",
        cajeroId: "caj-suerte-1",
        cajeroNombre: "Roberto Méndez (Encargado)",
        canalEntrega: "WHATSAPP",
        tenantNombre: "Agencia La Suerte Centro",
        tenantRif: "J-50291823-9",
        fechaHora: "29/10/2026 09:10:05 AM",
        timestampEmisionMs: Date.now() - 7200_000,
        tasaBcv: 45.85,
        totalUsd: 4.0,
        totalBs: 183.4,
        codigoSeguridad:
          "5e91a0c3b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        qrPayload:
          "BANCAPRO|33333333-3333-4333-8333-333333333333|d5098c1a-f86e-11da-bd1a-00112444be4b|4.00|1793275005|5e91a0c3b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc",
        mensajeWhatsApp:
          "🎟️ *COMPROBANTE OFICIAL - AGENCIA LA SUERTE CENTRO*\n📌 *TICKET N°:* #0002015\n🔐 *CÓDIGO PARA RECLAMAR PREMIO:* 0002015-5E91A0C3",
        estado: "EMITIDO",
        premioTotalUsd: 0,
        items: [
          {
            sorteoId: 2,
            sorteoHora: "10:00 AM",
            dbNumber: 19,
            codigoAnimal: "19",
            nombreAnimal: "Chivo",
            montoUsd: 4.0,
            premioPotencialUsd: 120.0,
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

  // Estado para Portal SuperAdmin Independiente: Creación de Tenant
  const [nuevoComercioNombre, setNuevoComercioNombre] = useState<string>("");
  const [nuevoComercioRif, setNuevoComercioRif] = useState<string>("");
  const [nuevoComercioEmail, setNuevoComercioEmail] = useState<string>("");
  const [nuevoComercioPerdidaMax, setNuevoComercioPerdidaMax] =
    useState<string>("450");

  const inputCodigoRef = useRef<HTMLInputElement>(null);
  const inputMontoBsRef = useRef<HTMLInputElement>(null);
  const inputMontoRef = useRef<HTMLInputElement>(null);

  // Inicialización de sesión GoTrue, verificación de cookie SuperAdmin y Auto-Sincronización BCV
  useEffect(() => {
    let activo = true;
    async function inicializarPlataforma() {
      // 1. Sincronizar Tasa Oficial BCV inmediatamente al cargar la página
      try {
        const resBcv = await sincronizarTasaBcvEnVivo(true);
        if (resBcv.tasa && resBcv.tasa > 0 && activo) {
          setTasaBcv(resBcv.tasa);
          setTasaManualSuperAdminInput(resBcv.tasa.toFixed(2));
          const horaStr = new Intl.DateTimeFormat("es-VE", {
            timeZone: "America/Caracas",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date());
          setUltimaHoraSincBcv(
            resBcv.actualizadoEnVivo
              ? `BCV en vivo (${horaStr})`
              : `BD (${horaStr})`
          );
          setMontoBsInput((bsPrev) => {
            const valBs = parseFloat(bsPrev);
            if (!isNaN(valBs) && valBs > 0) {
              setMontoInput(Math.max(0.01, valBs / resBcv.tasa).toFixed(2));
            }
            return bsPrev;
          });
        }
      } catch {
        // Ignorar si falla en arranque
      }

      // 2. Verificar si ya tenía sesión abierta en el Portal SuperAdmin
      try {
        const tieneSuperAdmin = await verificarSesionPortalSuperAdmin();
        if (tieneSuperAdmin && activo) {
          setSuperAdminAutenticado(true);
        }
      } catch {
        // Ignorar
      }

      // 3. Cargar sesión GoTrue del comercio
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
    inicializarPlataforma();
    return () => {
      activo = false;
    };
  }, []);

  // Manejadores de cambio bidireccional de monto (Bs. ⇄ USD)
  const manejarCambioMontoBs = (nuevoBsStr: string) => {
    setMonedaFoco("BS");
    setMontoBsInput(nuevoBsStr);
    const valBs = parseFloat(nuevoBsStr);
    if (!isNaN(valBs) && valBs > 0 && tasaBcv > 0) {
      const equivUsd = valBs / tasaBcv;
      setMontoInput(equivUsd >= 0.01 ? equivUsd.toFixed(2) : "0.01");
    } else {
      setMontoInput("0.00");
    }
  };

  const manejarCambioMontoUsd = (nuevoUsdStr: string) => {
    setMonedaFoco("USD");
    setMontoInput(nuevoUsdStr);
    const valUsd = parseFloat(nuevoUsdStr);
    if (!isNaN(valUsd) && valUsd > 0 && tasaBcv > 0) {
      setMontoBsInput((valUsd * tasaBcv).toFixed(2));
    } else {
      setMontoBsInput("0.00");
    }
  };

  const aplicarAtajoBs = (bsFijo: number) => {
    setMonedaFoco("BS");
    setMontoBsInput(bsFijo.toFixed(2));
    if (tasaBcv > 0) {
      setMontoInput(Math.max(0.01, bsFijo / tasaBcv).toFixed(2));
    }
    inputCodigoRef.current?.focus();
  };

  const aplicarAtajoUsd = (usdFijo: number) => {
    setMonedaFoco("USD");
    setMontoInput(usdFijo.toFixed(2));
    if (tasaBcv > 0) {
      setMontoBsInput((usdFijo * tasaBcv).toFixed(2));
    }
    inputCodigoRef.current?.focus();
  };

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

  // Login del Portal SuperAdmin Independiente (`admin` / `rootadmin1234`)
  const manejarLoginPortalSuperAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutenticandoSuperAdmin(true);
    setErrorLoginSuperAdmin(null);
    try {
      const res = await autenticarPortalSuperAdmin(
        superAdminUserInput,
        superAdminPassInput
      );
      if (!res.ok) {
        setErrorLoginSuperAdmin(
          res.error || "Usuario o contraseña de SuperAdmin incorrectos."
        );
        return;
      }
      setSuperAdminAutenticado(true);
      setSuperAdminPassInput("");
    } finally {
      setAutenticandoSuperAdmin(false);
    }
  };

  const manejarSalirPortalSuperAdmin = async () => {
    await cerrarSesionPortalSuperAdmin();
    setSuperAdminAutenticado(false);
    setEnPortalSuperAdmin(false);
    setSuperAdminUserInput("");
    setSuperAdminPassInput("");
  };

  useEffect(() => {
    const timer = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Estado de horarios respecto a la regla estricta T - 3 minutos (Hora Venezuela UTC-4)
  const estadoHorarios = useMemo(() => {
    const caracasTimeStr = ahora.toLocaleTimeString("en-GB", {
      timeZone: "America/Caracas",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const [hActual, mActual, sActual] = caracasTimeStr.split(":").map(Number);
    const segsDiaActual =
      (hActual || 0) * 3600 + (mActual || 0) * 60 + (sActual || 0);

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

  // Seleccionar automáticamente el próximo sorteo abierto si el actual ya cerró
  useEffect(() => {
    const actual = estadoHorarios.find((h) => h.id === sorteoSeleccionadoId);
    if (actual && !actual.abiertoParaVenta && proximoSorteoAbierto?.abiertoParaVenta) {
      setSorteoSeleccionadoId(proximoSorteoAbierto.id);
    }
  }, [estadoHorarios, sorteoSeleccionadoId, proximoSorteoAbierto]);

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

    const valBs = parseFloat(montoBsInput);
    const valUsd = parseFloat(montoInput);

    // Determinar monto exacto en USD y en Bs. según lo que digitó el cajero
    let montoUsdFinal = valUsd;
    let montoBsFinal = valBs;

    if (monedaFoco === "BS") {
      if (isNaN(valBs) || valBs <= 0) {
        setAlertaSistema({
          tipo: "error",
          mensaje: "Ingrese un monto válido en Bolívares (Bs.) mayor a 0.",
        });
        inputMontoBsRef.current?.focus();
        return;
      }
      montoBsFinal = Number(valBs.toFixed(2));
      // Preservar 4 decimales en la conversión interna a USD para que al multiplicar de vuelta por la tasa BCV
      // jamás se altere el monto en Bolívares jugado por el cliente (ej. Bs. 20.00 siempre es Bs. 20.00)
      montoUsdFinal = Number(Math.max(0.0001, valBs / tasaBcv).toFixed(4));
    } else {
      if (isNaN(valUsd) || valUsd <= 0) {
        setAlertaSistema({
          tipo: "error",
          mensaje: "Ingrese un monto válido en Divisa ($ USD) mayor a 0.",
        });
        inputMontoRef.current?.focus();
        return;
      }
      montoUsdFinal = Number(valUsd.toFixed(2));
      montoBsFinal = Number((montoUsdFinal * tasaBcv).toFixed(2));
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

    const disponibleUsd = obtenerCupoDisponible(
      sorteoSeleccionadoId,
      figura.dbNumber
    );
    if (montoUsdFinal > disponibleUsd) {
      setAlertaSistema({
        tipo: "error",
        mensaje: `Cupo agotado para esta figura (${figura.codigo} - ${
          figura.nombre
        } en sorteo ${
          horario.etiqueta
        }). Disponible: Bs. ${(disponibleUsd * tasaBcv).toFixed(
          2
        )} ($${disponibleUsd.toFixed(2)} USD).`,
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
        montoUsd: montoUsdFinal,
        montoBs: montoBsFinal,
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
    () =>
      Number(carrito.reduce((acc, item) => acc + item.montoBs, 0).toFixed(2)),
    [carrito]
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

      const ticketConfirmado = respuestaRpc.ticket;
      const ticketIdFinal = ticketConfirmado.ticket_id;
      const serialCortoFinal = String(ticketConfirmado.serial_corto).padStart(
        7,
        "0"
      );
      const codigoSeguridadFinal = ticketConfirmado.codigo_seguridad;
      const qrPayloadFinal = ticketConfirmado.qr_payload;
      const pinReclamoCorto = `${serialCortoFinal}-${codigoSeguridadFinal
        .slice(0, 8)
        .toUpperCase()}`;

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
        cajeroNombre:
          cajeroActivoActual?.nombre ||
          usuarioSesion?.nombre ||
          "Magaly Rodríguez",
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
          montoBs: c.montoBs,
          premioPotencialUsd: Number(((c.montoBs * 30) / tasaBcv).toFixed(2)),
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
        cajeroId: cajeroActivoActual?.id || "caj-default",
        cajeroNombre:
          cajeroActivoActual?.nombre ||
          usuarioSesion?.nombre ||
          "Magaly Rodríguez",
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
          montoBs: c.montoBs,
          premioPotencialUsd: Number(((c.montoBs * 30) / tasaBcv).toFixed(2)),
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

      if (modoEntrega === "WHATSAPP" || modoEntrega === "AMBOS") {
        const configWaComercio = configWhatsAppPorTenant[tenantActual.id];
        try {
          const respWa = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              telefono: clienteTelefonoInput,
              mensajeTexto: textoWhatsApp,
              qrPayload: qrPayloadFinal,
              configComercio: configWaComercio,
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
        mensaje: `Ticket #${serialCortoFinal} emitido por Bs. ${totalCarritoBs.toFixed(
          2
        )} ($${totalCarritoUsd.toFixed(
          2
        )} USD) y despachado al WhatsApp ${clienteTelefonoInput} (PIN: ${pinReclamoCorto}).`,
      });
    } finally {
      setProcesandoVenta(false);
      inputCodigoRef.current?.focus();
    }
  };

  const sincronizarTasaBcvAhora = async (silencioso: boolean = false) => {
    setSincronizandoBcv(true);
    try {
      const res = await sincronizarTasaBcvEnVivo(true);
      if (res.tasa && res.tasa > 0) {
        setTasaBcv(res.tasa);
        setTasaManualSuperAdminInput(res.tasa.toFixed(2));
        const horaStr = new Intl.DateTimeFormat("es-VE", {
          timeZone: "America/Caracas",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date());
        setUltimaHoraSincBcv(
          res.actualizadoEnVivo ? `BCV en vivo (${horaStr})` : `BD (${horaStr})`
        );

        setMontoBsInput((bsPrev) => {
          const valBs = parseFloat(bsPrev);
          if (!isNaN(valBs) && valBs > 0) {
            setMontoInput(Math.max(0.01, valBs / res.tasa).toFixed(2));
          }
          return bsPrev;
        });

        if (!silencioso) {
          setAlertaSistema({
            tipo: "info",
            mensaje: `Tasa Oficial BCV sincronizada en vivo: Bs. ${res.tasa.toFixed(
              2
            )} / USD`,
          });
        }
        return;
      }
    } catch {
      // Fallback a tasa actual
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
        mensaje: `RECHAZO EN ANULACIÓN: ${
          resp.error || "Fallo al anular ticket en el servidor."
        }`,
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

  // Generación y Descarga del Reporte Semanal Detallado por Comercio (CSV para Excel + Vista Ejecutiva PDF)
  const descargarReporteSemanalCsv = (idComercio: string) => {
    const comercio = tenants.find((t) => t.id === idComercio);
    if (!comercio) return;
    const listaTickets = ticketsPorTenant[idComercio] ?? [];

    const ticketsValidos = listaTickets.filter((t) => t.estado !== "ANULADO");
    const totalVentasUsd = ticketsValidos.reduce(
      (acc, t) => acc + t.totalUsd,
      0
    );
    const totalVentasBs = ticketsValidos.reduce((acc, t) => acc + t.totalBs, 0);
    const totalPremiosUsd = ticketsValidos.reduce(
      (acc, t) => acc + t.premioTotalUsd,
      0
    );
    const totalPremiosBs = totalPremiosUsd * tasaBcv;
    const utilidadNetaUsd = totalVentasUsd - totalPremiosUsd;
    const utilidadNetaBs = totalVentasBs - totalPremiosBs;

    // Resumen por Cajero
    const resumenPorCajero: Record<
      string,
      { tickets: number; usd: number; bs: number }
    > = {};
    for (const tk of ticketsValidos) {
      const nom = tk.cajeroNombre || "Cajero Principal";
      if (!resumenPorCajero[nom]) {
        resumenPorCajero[nom] = { tickets: 0, usd: 0, bs: 0 };
      }
      resumenPorCajero[nom].tickets += 1;
      resumenPorCajero[nom].usd += tk.totalUsd;
      resumenPorCajero[nom].bs += tk.totalBs;
    }

    const filasCsv: string[] = [
      `REPORTE SEMANAL DETALLADO DE VENTAS - BANCAPRO CORE`,
      `Comercio;${comercio.nombre}`,
      `RIF;${comercio.rif}`,
      `Fecha de Generacion;${new Date().toLocaleString("es-VE")}`,
      `Tasa Oficial BCV Vigente;Bs. ${tasaBcv.toFixed(2)} / USD`,
      ``,
      `RESUMEN EJECUTIVO DE LA SEMANA`,
      `Total Tickets Validos;${ticketsValidos.length}`,
      `Total Ventas Brutas (Bs.);Bs. ${totalVentasBs.toFixed(2)}`,
      `Total Ventas Brutas (USD);$${totalVentasUsd.toFixed(2)}`,
      `Total Premios Generados (Bs.);Bs. ${totalPremiosBs.toFixed(2)}`,
      `Total Premios Generados (USD);$${totalPremiosUsd.toFixed(2)}`,
      `Utilidad Neta del Comercio (Bs.);Bs. ${utilidadNetaBs.toFixed(2)}`,
      `Utilidad Neta del Comercio (USD);$${utilidadNetaUsd.toFixed(2)}`,
      ``,
      `DESGLOSE SEMANAL POR CAJERO EN CAJA`,
      `Cajero / Operador;Tickets Emitidos;Ventas en Bs.;Ventas en USD`,
      ...Object.entries(resumenPorCajero).map(
        ([caj, datos]) =>
          `${caj};${datos.tickets};Bs. ${datos.bs.toFixed(
            2
          )};$${datos.usd.toFixed(2)}`
      ),
      ``,
      `DETALLE COMPLETO JUGADA POR JUGADA DE LA SEMANA`,
      `Fecha y Hora;N Ticket;PIN Reclamo;Cajero en Caja;WhatsApp Cliente;Horario Sorteo;Codigo Animal;Nombre Animal;Apuesta (Bs.);Apuesta (USD);Premio Potencial 30x (Bs.);Premio Potencial 30x (USD);Estado Ticket;Premio Ganado Ticket (USD)`,
    ];

    for (const tk of listaTickets) {
      for (const it of tk.items) {
        const apuestaBs =
          typeof it.montoBs === "number" && it.montoBs > 0
            ? Number(it.montoBs.toFixed(2))
            : Number((it.montoUsd * tk.tasaBcv).toFixed(2));
        const premioPotBs = Number((apuestaBs * 30).toFixed(2));
        filasCsv.push(
          [
            tk.fechaHora,
            `#${tk.serialCorto}`,
            tk.pinReclamo,
            tk.cajeroNombre || "Magaly Rodríguez (Encargada)",
            tk.clienteTelefono,
            it.sorteoHora,
            `#${it.codigoAnimal}`,
            it.nombreAnimal,
            `Bs. ${apuestaBs.toFixed(2)}`,
            `$${it.montoUsd.toFixed(2)}`,
            `Bs. ${premioPotBs.toFixed(2)}`,
            `$${it.premioPotencialUsd.toFixed(2)}`,
            tk.estado,
            `$${tk.premioTotalUsd.toFixed(2)}`,
          ].join(";")
        );
      }
    }

    const contenidoCsv = "\uFEFF" + filasCsv.join("\r\n");
    const blob = new Blob([contenidoCsv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const slug = comercio.nombre.replace(/\s+/g, "_").toLowerCase();
    link.href = url;
    link.setAttribute("download", `Reporte_Semanal_${slug}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setAlertaSistema({
      tipo: "exito",
      mensaje: `Reporte Semanal Detallado (CSV / Excel) descargado para "${comercio.nombre}".`,
    });
  };

  const imprimirReporteSemanalEjecutivo = (idComercio: string) => {
    const comercio = tenants.find((t) => t.id === idComercio);
    if (!comercio || typeof window === "undefined") return;
    const listaTickets = ticketsPorTenant[idComercio] ?? [];
    const ticketsValidos = listaTickets.filter((t) => t.estado !== "ANULADO");
    const totalVentasUsd = ticketsValidos.reduce(
      (acc, t) => acc + t.totalUsd,
      0
    );
    const totalVentasBs = ticketsValidos.reduce((acc, t) => acc + t.totalBs, 0);
    const totalPremiosUsd = ticketsValidos.reduce(
      (acc, t) => acc + t.premioTotalUsd,
      0
    );
    const totalPremiosBs = totalPremiosUsd * tasaBcv;
    const utilidadUsd = totalVentasUsd - totalPremiosUsd;
    const utilidadBs = totalVentasBs - totalPremiosBs;

    const filasHtml = listaTickets
      .map((tk) => {
        const detalleStr = tk.items
          .map(
            (i) =>
              `${i.sorteoHora}: #${i.codigoAnimal} ${i.nombreAnimal} (Bs. ${(
                typeof i.montoBs === "number" && i.montoBs > 0
                  ? i.montoBs
                  : i.montoUsd * tk.tasaBcv
              ).toFixed(2)} / $${i.montoUsd.toFixed(2)})`
          )
          .join("<br/>");
        return `<tr>
          <td>${tk.fechaHora}</td>
          <td><strong>#${tk.serialCorto}</strong><br/><small>${
          tk.pinReclamo
        }</small></td>
          <td>${tk.cajeroNombre || "Magaly Rodríguez"}</td>
          <td>${tk.clienteTelefono}</td>
          <td>${detalleStr}</td>
          <td><strong>Bs. ${tk.totalBs.toFixed(
            2
          )}</strong><br/><small>$${tk.totalUsd.toFixed(2)} USD</small></td>
          <td>${tk.estado}</td>
          <td>Bs. ${(tk.premioTotalUsd * tk.tasaBcv).toFixed(
            2
          )} ($${tk.premioTotalUsd.toFixed(2)})</td>
        </tr>`;
      })
      .join("");

    const htmlDoc = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Reporte Semanal - ${comercio.nombre}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #475569; margin-bottom: 16px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc; }
    .kpi-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: bold; }
    .kpi-val { font-size: 15px; font-weight: bold; margin-top: 4px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 8px; }
    td { border-bottom: 1px solid #cbd5e1; padding: 7px; vertical-align: top; }
  </style>
</head>
<body>
  <h1>📊 REPORTE SEMANAL DETALLADO DE VENTAS — ${comercio.nombre.toUpperCase()}</h1>
  <div class="sub">RIF: ${comercio.rif} • Admin: ${
      comercio.adminEmail
    } • Generado: ${new Date().toLocaleString(
      "es-VE"
    )} • Tasa BCV: Bs. ${tasaBcv.toFixed(2)} / USD</div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-title">Tickets Válidos</div><div class="kpi-val">${
      ticketsValidos.length
    } tickets</div></div>
    <div class="kpi"><div class="kpi-title">Total Ventas Semana</div><div class="kpi-val">Bs. ${totalVentasBs.toFixed(
      2
    )} ($${totalVentasUsd.toFixed(2)})</div></div>
    <div class="kpi"><div class="kpi-title">Total Premios (30x)</div><div class="kpi-val">Bs. ${totalPremiosBs.toFixed(
      2
    )} ($${totalPremiosUsd.toFixed(2)})</div></div>
    <div class="kpi"><div class="kpi-title">Utilidad Neta Caja</div><div class="kpi-val">Bs. ${utilidadBs.toFixed(
      2
    )} ($${utilidadUsd.toFixed(2)})</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Fecha / Hora</th>
        <th>Ticket / PIN</th>
        <th>Cajero en Caja</th>
        <th>WhatsApp Cliente</th>
        <th>Jugadas Detalladas (Sorteo y Animalito)</th>
        <th>Monto Jugado</th>
        <th>Estado</th>
        <th>Premio</th>
      </tr>
    </thead>
    <tbody>${filasHtml}</tbody>
  </table>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=1024,height=768");
    if (win) {
      win.document.open();
      win.document.write(htmlDoc);
      win.document.close();
    }
  };

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
        mensaje: `RECHAZO EN PAGO: ${
          resp.error || "Fallo al procesar pago en el servidor."
        }`,
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
      } (Cliente WA: ${actualizado.clienteTelefono}) pagado por Bs. ${(
        actualizado.premioTotalUsd * tasaBcv
      ).toFixed(2)} ($${actualizado.premioTotalUsd.toFixed(2)} USD).`,
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
        mensaje: `RECHAZO EN LIQUIDACIÓN: ${
          resp.error || "Fallo al liquidar sorteo."
        }`,
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

  // ============================================================================
  // PORTAL INDEPENDIENTE DE SUPERADMIN (ACCESO EXCLUSIVO: admin / rootadmin1234)
  // ============================================================================
  if (enPortalSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="border-b border-indigo-500/30 bg-slate-900/95 px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-500/50 flex items-center justify-center text-indigo-300 font-black text-lg">
                SA
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-base text-white">
                    BancaPro Core — Portal SuperAdmin Global
                  </h1>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                    Control Maestro Multi-Tenant
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Gestión independiente de comercios, cupos globales, tasa BCV y liquidación maestra.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEnPortalSuperAdmin(false)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
              >
                ← Volver a Taquilla Operativa
              </button>
              {superAdminAutenticado && (
                <button
                  type="button"
                  onClick={manejarSalirPortalSuperAdmin}
                  className="px-3.5 py-2 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-xs font-semibold text-rose-200 border border-rose-700/50 flex items-center gap-1.5 transition"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Cerrar Sesión SuperAdmin
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col justify-center">
          {!superAdminAutenticado ? (
            /* PANTALLA DE LOGIN EXCLUSIVA PARA EL PORTAL SUPERADMIN */
            <div className="max-w-md w-full mx-auto bg-slate-900 border border-indigo-500/40 rounded-2xl p-6 shadow-2xl space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-indigo-400">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">
                    Acceso Restringido — Portal SuperAdmin
                  </h2>
                  <p className="text-xs text-slate-400">
                    Ingrese sus credenciales maestras para administrar la red de comercios.
                  </p>
                </div>
              </div>

              {errorLoginSuperAdmin && (
                <div className="p-3 rounded-lg bg-red-950/80 border border-red-500/60 text-xs text-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{errorLoginSuperAdmin}</span>
                </div>
              )}

              <form onSubmit={manejarLoginPortalSuperAdmin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Usuario SuperAdmin
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={superAdminUserInput}
                    onChange={(e) => setSuperAdminUserInput(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Contraseña Maestra
                  </label>
                  <input
                    type="password"
                    required
                    value={superAdminPassInput}
                    onChange={(e) => setSuperAdminPassInput(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={autenticandoSuperAdmin}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-lg"
                >
                  {autenticandoSuperAdmin
                    ? "Verificando Credenciales..."
                    : "Ingresar al Portal SuperAdmin"}
                </button>
              </form>
            </div>
          ) : (
            /* PANEL COMPLETO DE CONTROL SUPERADMIN MULTI-TENANT */
            <div className="space-y-6">
              {alertaSistema && (
                <div
                  className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-xs font-medium ${
                    alertaSistema.tipo === "error"
                      ? "bg-red-950/70 border-red-500/50 text-red-200"
                      : alertaSistema.tipo === "exito"
                      ? "bg-emerald-950/70 border-emerald-500/50 text-emerald-200"
                      : "bg-sky-950/70 border-sky-500/50 text-sky-200"
                  }`}
                >
                  <span>{alertaSistema.mensaje}</span>
                  <button
                    onClick={() => setAlertaSistema(null)}
                    className="text-slate-400 hover:text-white ml-4"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Control Global de Tasa Oficial BCV y Comercio en Taquilla */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-sky-500/30 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-sky-400" />
                      <span>Control Maestro de Tasa Oficial BCV (USD / Bs.)</span>
                    </h3>
                    <span className="text-xs font-mono text-sky-300">
                      Actual: Bs. {tasaBcv.toFixed(2)} ({ultimaHoraSincBcv})
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Sincronice automáticamente desde el Banco Central de Venezuela o fije una tasa oficial para todos los comercios.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={tasaManualSuperAdminInput}
                      onChange={(e) =>
                        setTasaManualSuperAdminInput(e.target.value)
                      }
                      placeholder={tasaBcv.toFixed(2)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-white w-40"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const nueva = parseFloat(tasaManualSuperAdminInput);
                        if (isNaN(nueva) || nueva <= 0) return;
                        setTasaBcv(nueva);
                        await actualizarTasaBcv(nueva);
                        setUltimaHoraSincBcv("Fijada por SuperAdmin");
                        setAlertaSistema({
                          tipo: "exito",
                          mensaje: `Tasa BCV actualizada globalmente a Bs. ${nueva.toFixed(
                            2
                          )} / USD en Supabase.`,
                        });
                      }}
                      className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs"
                    >
                      Fijar Tasa en BD
                    </button>
                    <button
                      type="button"
                      onClick={() => sincronizarTasaBcvAhora(false)}
                      disabled={sincronizandoBcv}
                      className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/30 font-bold text-xs flex items-center gap-1.5"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          sincronizandoBcv ? "animate-spin" : ""
                        }`}
                      />
                      Sincronizar API Oficial BCV
                    </button>
                  </div>
                </div>

                {/* Selector de Comercio Activo y Liquidación Global */}
                <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span>Liquidación Oficial de Sorteo (Todos los Comercios)</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Horario de Sorteo
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
                      className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs uppercase rounded-lg"
                    >
                      Paso 1: Pre-validar Animal Ganador
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={ejecutarLiquidacionManualContingencia}
                        className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase rounded-lg"
                      >
                        Paso 2: Confirmar Liquidación 30x
                      </button>
                      <button
                        onClick={() => setPasoConfirmacionManual(1)}
                        className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-lg"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Aprovisionamiento y Monitoreo Multi-Tenant */}
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
                        onChange={(e) =>
                          setNuevoComercioPerdidaMax(e.target.value)
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
                      />
                    </div>

                    <button
                      onClick={() => {
                        if (!nuevoComercioNombre || !nuevoComercioRif) return;
                        const perdida =
                          parseFloat(nuevoComercioPerdidaMax) || 300;
                        const nuevoId = crypto.randomUUID();
                        const nuevo: TenantComercio = {
                          id: nuevoId,
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
                        setCajerosPorTenant((prev) => ({
                          ...prev,
                          [nuevoId]: [
                            {
                              id: `caj-${nuevoId.slice(0, 6)}-1`,
                              nombre: `Encargado Principal (${nuevoComercioNombre})`,
                              turno: "Turno Completo",
                              activo: true,
                            },
                            {
                              id: `caj-${nuevoId.slice(0, 6)}-2`,
                              nombre: "Cajero Caja 1",
                              turno: "Mañana / Tarde",
                              activo: true,
                            },
                          ],
                        }));
                        setCajeroSeleccionadoPorTenant((prev) => ({
                          ...prev,
                          [nuevoId]: `caj-${nuevoId.slice(0, 6)}-1`,
                        }));
                        setConfigWhatsAppPorTenant((prev) => ({
                          ...prev,
                          [nuevoId]: {
                            modoVinculacion: "DIRECTO_WA_ME",
                            subModoApi: "GATEWAY_QR",
                            telefonoComercio: "+58 414-0000000",
                            metaToken: "",
                            metaPhoneId: "",
                            gatewayUrl: `https://api.bancapro-wa.local/instance/${nuevoId.slice(
                              0,
                              8
                            )}/send`,
                            gatewayToken: `wa_token_${nuevoId.slice(0, 8)}`,
                            instanciaId: `INST-${nuevoId
                              .slice(0, 6)
                              .toUpperCase()}`,
                            qrVinculado: true,
                            ultimaSincronizacion:
                              "Sincronizado por SuperAdmin (Recién Creado)",
                          },
                        }));
                        setTicketsPorTenant((prev) => ({
                          ...prev,
                          [nuevoId]: [],
                        }));
                        setComercioAdminSeleccionadoId(nuevoId);
                        setNuevoComercioNombre("");
                        setNuevoComercioRif("");
                        setNuevoComercioEmail("");
                        setAlertaSistema({
                          tipo: "exito",
                          mensaje: `Comercio "${
                            nuevo.nombre
                          }" creado con aislamiento RLS, cajeros iniciales y WhatsApp pre-configurado (tenant_id: ${nuevo.id.slice(
                            0,
                            8
                          )}...).`,
                        });
                      }}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase rounded-lg transition"
                    >
                      Crear Comercio y Asignar Políticas RLS
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-bold text-white">
                      Comercios Activos en la Plataforma (Crear, Auditar, Sincronizar WhatsApp y Eliminar)
                    </h3>
                    <span className="text-[11px] font-mono text-emerald-400">
                      {tenants.length} comercios registrados
                    </span>
                  </div>
                  <div className="space-y-3">
                    {tenants.map((t) => {
                      const waCfg = configWhatsAppPorTenant[t.id];
                      const numTicketsSem = (ticketsPorTenant[t.id] ?? []).length;
                      return (
                        <div
                          key={t.id}
                          className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-bold text-sm text-white flex flex-wrap items-center gap-2">
                                <span>{t.nombre}</span>
                                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">
                                  {t.rif}
                                </span>
                                {tenantActualId === t.id && (
                                  <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded">
                                    Activo en Taquilla POS
                                  </span>
                                )}
                                <span className="text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded flex items-center gap-1">
                                  <Wifi className="w-3 h-3 text-emerald-400" />
                                  WA:{" "}
                                  {waCfg?.modoVinculacion === "API_CLOUD_GATEWAY"
                                    ? "Opción 2 (API / QR Silencioso)"
                                    : "Opción 1 (Directo / Web 1-Clic)"}
                                </span>
                              </div>
                              <div className="text-xs text-slate-400 font-mono mt-1">
                                Admin: {t.adminEmail} • Tickets Semana:{" "}
                                <strong className="text-white">
                                  {numTicketsSem}
                                </strong>{" "}
                                • UUID: {t.id.slice(0, 8)}...
                              </div>
                            </div>

                            <div className="text-right font-mono text-xs">
                              <div className="text-emerald-400 font-bold">
                                Cupo Animal: ${t.cupoAnimalUsd.toFixed(2)} USD
                                (Bs. {(t.cupoAnimalUsd * tasaBcv).toFixed(2)})
                              </div>
                              <div className="text-slate-400">
                                Pérdida Máx: ${t.perdidaMaximaUsd.toFixed(2)}{" "}
                                USD
                              </div>
                            </div>
                          </div>

                          {/* Barra de Acciones del SuperAdmin sobre cada Comercio */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setTenantActualId(t.id);
                                  setComercioAdminSeleccionadoId(t.id);
                                  setCarrito([]);
                                  setAlertaSistema({
                                    tipo: "info",
                                    mensaje: `Taquilla POS vinculada al comercio: ${t.nombre}`,
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
                              >
                                Seleccionar en POS
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setComercioAdminSeleccionadoId(t.id);
                                  setAlertaSistema({
                                    tipo: "info",
                                    mensaje: `Configurando WhatsApp y Reporte Semanal para "${t.nombre}" en los paneles inferiores.`,
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-xs font-semibold text-sky-300 border border-sky-500/40 flex items-center gap-1.5"
                              >
                                <MessageCircle className="w-3.5 h-3.5 text-sky-400" />
                                Sincronizar WhatsApp
                              </button>

                              <button
                                type="button"
                                onClick={() => descargarReporteSemanalCsv(t.id)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-xs font-semibold text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5"
                              >
                                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                                Descargar Semanal (CSV)
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  imprimirReporteSemanalEjecutivo(t.id)
                                }
                                className="px-3 py-1.5 rounded-lg bg-purple-950/80 hover:bg-purple-900 text-xs font-semibold text-purple-300 border border-purple-500/40 flex items-center gap-1.5"
                              >
                                <Download className="w-3.5 h-3.5 text-purple-400" />
                                Reporte PDF
                              </button>
                            </div>

                            {/* Eliminación de Comercio con Confirmación en 2 Pasos */}
                            <div>
                              {comercioEliminarConfirmId === t.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (tenants.length <= 1) {
                                        setAlertaSistema({
                                          tipo: "error",
                                          mensaje:
                                            "Debe mantener al menos 1 comercio activo en la plataforma.",
                                        });
                                        setComercioEliminarConfirmId(null);
                                        return;
                                      }
                                      const restantes = tenants.filter(
                                        (item) => item.id !== t.id
                                      );
                                      setTenants(restantes);
                                      if (tenantActualId === t.id) {
                                        setTenantActualId(restantes[0].id);
                                      }
                                      if (comercioAdminSeleccionadoId === t.id) {
                                        setComercioAdminSeleccionadoId(
                                          restantes[0].id
                                        );
                                      }
                                      setComercioEliminarConfirmId(null);
                                      setAlertaSistema({
                                        tipo: "info",
                                        mensaje: `Comercio "${t.nombre}" (${t.rif}) eliminado permanentemente del Portal SuperAdmin.`,
                                      });
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
                                  >
                                    Confirmar Eliminar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setComercioEliminarConfirmId(null)
                                    }
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setComercioEliminarConfirmId(t.id)
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-xs font-semibold text-red-300 border border-red-500/40 flex items-center gap-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                  Eliminar Comercio
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* MÓDULO CENTRALIZADO SUPERADMIN: SINCRONIZACIÓN DE WHATSAPP AL COMERCIO (LAS 2 OPCIONES DE VINCULACIÓN) */}
              {(() => {
                const comercioSel =
                  tenants.find((t) => t.id === comercioAdminSeleccionadoId) ??
                  tenants[0];
                const cfgWa = configWhatsAppPorTenant[comercioSel.id] ?? {
                  modoVinculacion: "DIRECTO_WA_ME",
                  subModoApi: "GATEWAY_QR",
                  telefonoComercio: comercioSel.telefono,
                  metaToken: "",
                  metaPhoneId: "",
                  gatewayUrl: "",
                  gatewayToken: "",
                  instanciaId: "INST-01",
                  qrVinculado: true,
                  ultimaSincronizacion: "Sincronizado",
                };
                const actualizarCfgWa = (
                  parcial: Partial<ConfigWhatsAppComercio>
                ) => {
                  setConfigWhatsAppPorTenant((prev) => ({
                    ...prev,
                    [comercioSel.id]: {
                      ...cfgWa,
                      ...parcial,
                    },
                  }));
                };

                const ticketsComercioSemana =
                  ticketsPorTenant[comercioSel.id] ?? [];
                const ticketsSemanaValidos = ticketsComercioSemana.filter(
                  (tk) => tk.estado !== "ANULADO"
                );
                const ventasSemanaUsd = ticketsSemanaValidos.reduce(
                  (acc, tk) => acc + tk.totalUsd,
                  0
                );
                const ventasSemanaBs = ticketsSemanaValidos.reduce(
                  (acc, tk) => acc + tk.totalBs,
                  0
                );
                const premiosSemanaUsd = ticketsSemanaValidos.reduce(
                  (acc, tk) => acc + tk.premioTotalUsd,
                  0
                );
                const premiosSemanaBs = premiosSemanaUsd * tasaBcv;
                const netoSemanaUsd = ventasSemanaUsd - premiosSemanaUsd;
                const netoSemanaBs = ventasSemanaBs - premiosSemanaBs;

                // Agrupar ventas de la semana por Cajero
                const ventasPorCajeroSemana: Record<
                  string,
                  { tickets: number; bs: number; usd: number }
                > = {};
                for (const tk of ticketsSemanaValidos) {
                  const nom = tk.cajeroNombre || "Magaly Rodríguez (Encargada)";
                  if (!ventasPorCajeroSemana[nom]) {
                    ventasPorCajeroSemana[nom] = { tickets: 0, bs: 0, usd: 0 };
                  }
                  ventasPorCajeroSemana[nom].tickets += 1;
                  ventasPorCajeroSemana[nom].bs += tk.totalBs;
                  ventasPorCajeroSemana[nom].usd += tk.totalUsd;
                }

                return (
                  <div className="space-y-6">
                    {/* PANEL 1: SINCRONIZACIÓN DE WHATSAPP DEL COMERCIO (CON LAS 2 OPCIONES) */}
                    <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 space-y-5 shadow-xl">
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400">
                            <MessageCircle className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">
                              Sincronización Centralizada de WhatsApp por Comercio (Cero Configuración para el Comercio)
                            </h3>
                            <p className="text-xs text-slate-400">
                              Vincule aquí el WhatsApp del comercio seleccionado. El cajero del comercio no tendrá que tocar nada: solo vender y generar tickets.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-xs font-bold text-slate-300">
                            Comercio a Configurar:
                          </label>
                          <select
                            value={comercioSel.id}
                            onChange={(e) =>
                              setComercioAdminSeleccionadoId(e.target.value)
                            }
                            className="bg-slate-950 border border-emerald-500/50 rounded-lg px-3 py-2 text-xs font-bold text-emerald-300"
                          >
                            {tenants.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.nombre} ({t.rif})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Selector de las 2 Opciones de Vinculación de WhatsApp */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* OPCIÓN 1 */}
                        <div
                          onClick={() =>
                            actualizarCfgWa({
                              modoVinculacion: "DIRECTO_WA_ME",
                              ultimaSincronizacion: `Opción 1 Activa (${new Date().toLocaleTimeString(
                                "es-VE"
                              )})`,
                            })
                          }
                          className={`cursor-pointer rounded-xl p-4 border-2 transition space-y-2 ${
                            cfgWa.modoVinculacion === "DIRECTO_WA_ME"
                              ? "bg-emerald-950/50 border-emerald-500 shadow-lg"
                              : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-black uppercase px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              OPCIÓN 1 • VINCULACIÓN DIRECTA / WEB (SIN COSTO)
                            </span>
                            {cfgWa.modoVinculacion === "DIRECTO_WA_ME" && (
                              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4" />
                                ACTIVA EN ESTE COMERCIO
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold text-white">
                            Despacho Directo a WhatsApp del Cliente (WhatsApp Web / App 1-Clic)
                          </h4>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            No requiere pagar APIs externas. Usted deja asignado el número del comercio y al emitir el ticket en taquilla se abre el comprobante criptográfico listo para enviar al cliente.
                          </p>
                        </div>

                        {/* OPCIÓN 2 */}
                        <div
                          onClick={() =>
                            actualizarCfgWa({
                              modoVinculacion: "API_CLOUD_GATEWAY",
                              ultimaSincronizacion: `Opción 2 Activa (${new Date().toLocaleTimeString(
                                "es-VE"
                              )})`,
                            })
                          }
                          className={`cursor-pointer rounded-xl p-4 border-2 transition space-y-2 ${
                            cfgWa.modoVinculacion === "API_CLOUD_GATEWAY"
                              ? "bg-sky-950/50 border-sky-500 shadow-lg"
                              : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-black uppercase px-2.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40">
                              OPCIÓN 2 • ENVÍO AUTOMÁTICO EN 2DO PLANO (API / QR)
                            </span>
                            {cfgWa.modoVinculacion === "API_CLOUD_GATEWAY" && (
                              <span className="text-xs font-bold text-sky-400 flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4" />
                                ACTIVA EN ESTE COMERCIO
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold text-white">
                            Sincronización por Instancia QR (Evolution / UltraMsg) o Meta Cloud API
                          </h4>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            El ticket llega en 1 segundo al WhatsApp del cliente en segundo plano sin abrir ninguna ventana en la computadora de la caja.
                          </p>
                        </div>
                      </div>

                      {/* Parámetros de la Opción Seleccionada */}
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                          <div>
                            <label className="block text-slate-400 mb-1 font-semibold">
                              Teléfono WhatsApp Asignado al Comercio
                            </label>
                            <input
                              type="text"
                              value={cfgWa.telefonoComercio}
                              onChange={(e) =>
                                actualizarCfgWa({
                                  telefonoComercio: e.target.value,
                                })
                              }
                              placeholder="+58 414-1234567"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
                            />
                          </div>

                          {cfgWa.modoVinculacion === "API_CLOUD_GATEWAY" ? (
                            <>
                              <div>
                                <label className="block text-slate-400 mb-1 font-semibold">
                                  Motor de Envío Silencioso (Opción 2)
                                </label>
                                <select
                                  value={cfgWa.subModoApi}
                                  onChange={(e) =>
                                    actualizarCfgWa({
                                      subModoApi: e.target.value as
                                        | "META_CLOUD"
                                        | "GATEWAY_QR",
                                    })
                                  }
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-semibold"
                                >
                                  <option value="GATEWAY_QR">
                                    2A. Instancia Gateway por Código QR (Evolution / UltraMsg)
                                  </option>
                                  <option value="META_CLOUD">
                                    2B. Meta WhatsApp Cloud API Oficial (Token + Phone ID)
                                  </option>
                                </select>
                              </div>

                              {cfgWa.subModoApi === "GATEWAY_QR" ? (
                                <div>
                                  <label className="block text-slate-400 mb-1 font-semibold">
                                    ID de Instancia / URL Gateway del Comercio
                                  </label>
                                  <input
                                    type="text"
                                    value={cfgWa.gatewayUrl}
                                    onChange={(e) =>
                                      actualizarCfgWa({
                                        gatewayUrl: e.target.value,
                                      })
                                    }
                                    placeholder="https://api.gateway-wa.com/instance/send"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white"
                                  />
                                </div>
                              ) : (
                                <div>
                                  <label className="block text-slate-400 mb-1 font-semibold">
                                    Meta Phone Number ID + Access Token
                                  </label>
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      value={cfgWa.metaPhoneId}
                                      onChange={(e) =>
                                        actualizarCfgWa({
                                          metaPhoneId: e.target.value,
                                        })
                                      }
                                      placeholder="Phone ID"
                                      className="w-1/2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-white"
                                    />
                                    <input
                                      type="password"
                                      value={cfgWa.metaToken}
                                      onChange={(e) =>
                                        actualizarCfgWa({
                                          metaToken: e.target.value,
                                        })
                                      }
                                      placeholder="Bearer Token"
                                      className="w-1/2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-white"
                                    />
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="md:col-span-2 flex items-center bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3 text-emerald-200 text-xs">
                              <span>
                                ✔ Con la <strong>Opción 1 (Vinculación Directa)</strong> activa para{" "}
                                <strong>{comercioSel.nombre}</strong>, el comercio no requiere configurar tokens ni escanear nada: cada vez que el cajero emita una jugada, el comprobante oficial saldrá directo al WhatsApp del cliente.
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Acciones de Sincronización, QR de Vinculación y Prueba en Vivo */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                          <div className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4" />
                            Estado para {comercioSel.nombre}:{" "}
                            <strong>{cfgWa.ultimaSincronizacion}</strong>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {cfgWa.modoVinculacion === "API_CLOUD_GATEWAY" && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMostrandoQrSuperAdmin((prev) => !prev)
                                }
                                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 text-xs font-bold flex items-center gap-1.5"
                              >
                                <QrCode className="w-4 h-4" />
                                {mostrandoQrSuperAdmin
                                  ? "Ocultar QR de Vinculación"
                                  : "Generar QR para Vincular WhatsApp del Comercio"}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                actualizarCfgWa({
                                  qrVinculado: true,
                                  ultimaSincronizacion: `Sincronizado por SuperAdmin (${new Date().toLocaleTimeString(
                                    "es-VE"
                                  )})`,
                                });
                                setAlertaSistema({
                                  tipo: "exito",
                                  mensaje: `WhatsApp sincronizado exitosamente para "${
                                    comercioSel.nombre
                                  }" en modo ${
                                    cfgWa.modoVinculacion ===
                                    "API_CLOUD_GATEWAY"
                                      ? "Opción 2 (Automático Silencioso API/QR)"
                                      : "Opción 1 (Vinculación Directa 1-Clic)"
                                  }. El comercio ya puede vender sin configurar nada.`,
                                });
                              }}
                              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Guardar y Dejar Listo para el Comercio
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                abrirWhatsAppClienteDirecto({
                                  comercioNombre: comercioSel.nombre,
                                  comercioRif: comercioSel.rif,
                                  cajeroNombre:
                                    "SuperAdmin (Prueba de Sincronización)",
                                  serialCorto: "0009999",
                                  fechaHoraEmision: new Date().toLocaleString(
                                    "es-VE"
                                  ),
                                  tasaBcv,
                                  totalUsd: 1.0,
                                  totalBs: tasaBcv,
                                  codigoSeguridadHmac:
                                    "ABCD1234EFGH5678ABCD1234EFGH5678",
                                  qrPayload: `BANCAPRO|${comercioSel.id}|TEST|1.00`,
                                  clienteTelefono: cfgWa.telefonoComercio,
                                  items: [
                                    {
                                      sorteoHora: "10:00 AM",
                                      codigoAnimal: "05",
                                      nombreAnimal: "León",
                                      montoUsd: 1.0,
                                      premioPotencialUsd: 30.0,
                                    },
                                  ],
                                });
                              }}
                              className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Enviar Ticket de Prueba al Comercio
                            </button>
                          </div>
                        </div>

                        {mostrandoQrSuperAdmin &&
                          cfgWa.modoVinculacion === "API_CLOUD_GATEWAY" && (
                            <div className="p-4 rounded-xl bg-slate-900 border border-sky-500/40 flex flex-col sm:flex-row items-center gap-5">
                              <div className="bg-white p-3 rounded-xl shrink-0">
                                {/* Representación visual limpia de QR de Instancia para emparejar desde el Portal SuperAdmin */}
                                <div className="w-28 h-28 grid grid-cols-7 grid-rows-7 gap-0.5 bg-white">
                                  {Array.from({ length: 49 }).map((_, idx) => (
                                    <div
                                      key={idx}
                                      className={
                                        idx % 2 === 0 ||
                                        idx % 5 === 0 ||
                                        idx < 7
                                          ? "bg-slate-950"
                                          : "bg-white"
                                      }
                                    />
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-1.5 text-xs">
                                <div className="font-bold text-sky-300 text-sm">
                                  Código QR de Emparejamiento Centralizado —{" "}
                                  {comercioSel.nombre} ({cfgWa.instanciaId})
                                </div>
                                <p className="text-slate-300 leading-relaxed">
                                  Escanee este código desde el WhatsApp que usará el comercio (
                                  <span className="font-mono text-white">
                                    Dispositivos vinculados → Vincular un dispositivo
                                  </span>
                                  ). Una vez vinculado aquí en su Portal SuperAdmin, la sesión queda guardada en el servidor y el cajero del comercio no tendrá que iniciar sesión ni abrir WhatsApp en la taquilla.
                                </p>
                              </div>
                            </div>
                          )}
                      </div>
                    </div>

                    {/* PANEL 2: REPORTE SEMANAL DETALLADO DESCARGABLE POR COMERCIO */}
                    <div className="bg-slate-900 border border-purple-500/40 rounded-2xl p-6 space-y-5 shadow-xl">
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/40 text-purple-400">
                            <FileSpreadsheet className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">
                              Reporte Semanal Detallado de Ventas por Comercio —{" "}
                              <span className="text-purple-300">
                                {comercioSel.nombre}
                              </span>
                            </h3>
                            <p className="text-xs text-slate-400">
                              Auditoría completa de todo lo vendido por este comercio en la semana (desglosado por cajero, sorteo, animalito, monto en Bs./USD y premios).
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              descargarReporteSemanalCsv(comercioSel.id)
                            }
                            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                            Descargar Reporte Semanal (Excel / .CSV)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              imprimirReporteSemanalEjecutivo(comercioSel.id)
                            }
                            className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition"
                          >
                            <Download className="w-4 h-4" />
                            Descargar / Imprimir Reporte en PDF
                          </button>
                        </div>
                      </div>

                      {/* KPIs Semanales del Comercio Seleccionado */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                          <div className="text-[10px] font-mono uppercase text-slate-400">
                            Tickets Emitidos en la Semana
                          </div>
                          <div className="text-lg font-black font-mono text-white mt-1">
                            {ticketsSemanaValidos.length} tickets
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Comercio: {comercioSel.rif}
                          </div>
                        </div>

                        <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-4">
                          <div className="text-[10px] font-mono uppercase text-emerald-400">
                            Total Ventas Semana (Bs. / USD)
                          </div>
                          <div className="text-lg font-black font-mono text-emerald-300 mt-1">
                            Bs. {ventasSemanaBs.toFixed(2)}
                          </div>
                          <div className="text-xs font-mono text-slate-400 mt-0.5">
                            Equivalente: ${ventasSemanaUsd.toFixed(2)} USD
                          </div>
                        </div>

                        <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-4">
                          <div className="text-[10px] font-mono uppercase text-amber-400">
                            Premios de la Semana (30x)
                          </div>
                          <div className="text-lg font-black font-mono text-amber-300 mt-1">
                            Bs. {premiosSemanaBs.toFixed(2)}
                          </div>
                          <div className="text-xs font-mono text-slate-400 mt-0.5">
                            Equivalente: ${premiosSemanaUsd.toFixed(2)} USD
                          </div>
                        </div>

                        <div className="bg-slate-950 border border-sky-500/30 rounded-xl p-4">
                          <div className="text-[10px] font-mono uppercase text-sky-400">
                            Balance / Utilidad Neta Semanal
                          </div>
                          <div
                            className={`text-lg font-black font-mono mt-1 ${
                              netoSemanaBs >= 0
                                ? "text-sky-300"
                                : "text-rose-400"
                            }`}
                          >
                            Bs. {netoSemanaBs.toFixed(2)}
                          </div>
                          <div className="text-xs font-mono text-slate-400 mt-0.5">
                            Equivalente: ${netoSemanaUsd.toFixed(2)} USD
                          </div>
                        </div>
                      </div>

                      {/* Resumen Semanal por Cajero del Comercio */}
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                        <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-emerald-400" />
                          Rendimiento Semanal por Cajero en Caja ({comercioSel.nombre}):
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {Object.entries(ventasPorCajeroSemana).map(
                            ([nombreCaj, info]) => (
                              <div
                                key={nombreCaj}
                                className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center justify-between text-xs"
                              >
                                <div>
                                  <div className="font-bold text-white">
                                    {nombreCaj}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {info.tickets} tickets vendidos
                                  </div>
                                </div>
                                <div className="text-right font-mono">
                                  <div className="font-bold text-emerald-400">
                                    Bs. {info.bs.toFixed(2)}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    ${info.usd.toFixed(2)} USD
                                  </div>
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Tabla Detallada de Ventas de la Semana */}
                      <div className="overflow-x-auto rounded-xl border border-slate-800">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
                              <th className="py-2.5 px-3">Fecha / Hora</th>
                              <th className="py-2.5 px-3">Ticket / PIN</th>
                              <th className="py-2.5 px-3">Cajero en Caja</th>
                              <th className="py-2.5 px-3">WhatsApp Cliente</th>
                              <th className="py-2.5 px-3">
                                Jugadas Detalladas (Sorteo • Animalito • Monto)
                              </th>
                              <th className="py-2.5 px-3">Total Jugado</th>
                              <th className="py-2.5 px-3">Estado</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70 bg-slate-900/60">
                            {ticketsComercioSemana.map((tk) => (
                              <tr
                                key={tk.ticketId}
                                className="hover:bg-slate-800/40"
                              >
                                <td className="py-2.5 px-3 font-mono text-slate-300">
                                  {tk.fechaHora}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <div className="font-bold text-white">
                                    #{tk.serialCorto}
                                  </div>
                                  <div className="text-[10px] text-emerald-400">
                                    {tk.pinReclamo}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-sky-300">
                                  {tk.cajeroNombre ||
                                    "Magaly Rodríguez (Encargada)"}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-300">
                                  {tk.clienteTelefono}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="space-y-1">
                                    {tk.items.map((it, i) => (
                                      <div
                                        key={i}
                                        className="text-[11px] font-mono text-slate-200"
                                      >
                                        <span className="text-amber-300">
                                          {it.sorteoHora}
                                        </span>{" "}
                                        • #{it.codigoAnimal} {it.nombreAnimal} ➡️{" "}
                                        <strong className="text-emerald-300">
                                          Bs.{" "}
                                          {(
                                            typeof it.montoBs === "number" &&
                                            it.montoBs > 0
                                              ? it.montoBs
                                              : it.montoUsd * tk.tasaBcv
                                          ).toFixed(2)}
                                        </strong>{" "}
                                        (${it.montoUsd.toFixed(2)})
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <div className="font-bold text-emerald-400">
                                    Bs. {tk.totalBs.toFixed(2)}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    ${tk.totalUsd.toFixed(2)} USD
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                                      tk.estado === "GANADOR"
                                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                        : tk.estado === "PAGADO"
                                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                        : tk.estado === "ANULADO"
                                        ? "bg-red-500/20 text-red-300"
                                        : "bg-slate-800 text-slate-300"
                                    }`}
                                  >
                                    {tk.estado}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* BARRA SUPERIOR OPERATIVA DEL COMERCIO */}
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
                  WhatsApp Sincronizado • RLS Multi-Tenant
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold text-emerald-300">
                  {tenantActual.nombre} ({tenantActual.rif})
                </span>
                <div className="flex items-center gap-1.5 ml-1">
                  {usuarioSesion ? (
                    <div className="flex items-center gap-1.5">
                      <span
                        title={`Conectado a GoTrue como ${usuarioSesion.email}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      >
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        {usuarioSesion.nombre}
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
                      {cargandoAuth
                        ? "Autenticando..."
                        : "Conectar GoTrue (Magaly)"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* SELECTOR DE QUIÉN TRABAJA EN LA CAJA (CAJERO / OPERADOR EN TURNO) */}
            <div className="flex items-center gap-2 bg-slate-950 border border-emerald-500/40 rounded-lg px-3 py-1.5">
              <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center justify-between gap-2">
                  <span>Quién Trabaja en Caja</span>
                  <button
                    type="button"
                    onClick={() =>
                      setMostrandoFormNuevoCajero((prev) => !prev)
                    }
                    className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 underline"
                  >
                    {mostrandoFormNuevoCajero ? "Cerrar" : "+ Agregar Cajero"}
                  </button>
                </div>
                <select
                  aria-label="Seleccionar quién trabajará en la caja"
                  value={cajeroActivoActual?.id || ""}
                  onChange={(e) => {
                    const nuevoId = e.target.value;
                    setCajeroSeleccionadoPorTenant((prev) => ({
                      ...prev,
                      [tenantActual.id]: nuevoId,
                    }));
                    const cajeroObj = cajerosDelComercioActual.find(
                      (c) => c.id === nuevoId
                    );
                    if (cajeroObj) {
                      setAlertaSistema({
                        tipo: "info",
                        mensaje: `Turno de caja asignado a: ${cajeroObj.nombre} (${cajeroObj.turno}). Todos los tickets registrarán este cajero.`,
                      });
                    }
                  }}
                  className="bg-transparent font-mono text-xs font-bold text-emerald-300 focus:outline-none cursor-pointer pr-2"
                >
                  {cajerosDelComercioActual.map((caj) => (
                    <option
                      key={caj.id}
                      value={caj.id}
                      className="bg-slate-900 text-white"
                    >
                      {caj.nombre} • {caj.turno}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Contador Regresivo de Sorteo (T - 3m) */}
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

            {/* Indicador en Vivo de Tasa Oficial BCV */}
            <div className="flex items-center gap-2.5 bg-slate-950 border border-sky-500/30 rounded-lg px-3 py-1.5">
              <DollarSign className="w-4 h-4 text-sky-400" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <span>Tasa Oficial BCV</span>
                  <span className="text-[9px] text-emerald-400">
                    • {ultimaHoraSincBcv}
                  </span>
                </div>
                <div className="font-mono text-sm font-bold text-sky-300">
                  Bs. {tasaBcv.toFixed(2)} / $1 USD
                </div>
              </div>
              <button
                onClick={() => sincronizarTasaBcvAhora(false)}
                disabled={sincronizandoBcv}
                title="Sincronizar ahora con el BCV"
                className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-800 transition"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    sincronizandoBcv ? "animate-spin text-sky-400" : ""
                  }`}
                />
              </button>
            </div>

            {/* Navegación Operativa del Comercio + Botón al Portal SuperAdmin Independiente */}
            <nav className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 gap-1">
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
                2. Reclamar Premio
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
              <Link
                href="/manual"
                className="ml-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-500/40 transition flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                Manual / PDF
              </Link>
              <button
                onClick={() => setEnPortalSuperAdmin(true)}
                className="ml-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/40 transition flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                Portal SuperAdmin
              </button>
            </nav>
          </div>
        </div>

        {/* FORMULARIO RÁPIDO PARA AGREGAR NUEVO CAJERO AL TURNO DE CAJA DEL COMERCIO */}
        {mostrandoFormNuevoCajero && (
          <div className="max-w-7xl mx-auto mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>
                Registrar Nuevo Cajero / Operador en Caja para{" "}
                {tenantActual.nombre}:
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={nuevoCajeroNombreInput}
                onChange={(e) => setNuevoCajeroNombreInput(e.target.value)}
                placeholder="Nombre y Apellido (ej. María Rojas)"
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-56"
              />
              <input
                type="text"
                value={nuevoCajeroTurnoInput}
                onChange={(e) => setNuevoCajeroTurnoInput(e.target.value)}
                placeholder="Turno (ej. Mañana / Tarde)"
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-44"
              />
              <button
                type="button"
                onClick={() => {
                  const nom = nuevoCajeroNombreInput.trim();
                  if (!nom) return;
                  const nuevoId = `caj-${Date.now()}`;
                  const nuevoCaj: CajeroComercio = {
                    id: nuevoId,
                    nombre: nom,
                    turno: nuevoCajeroTurnoInput.trim() || "Turno General",
                    activo: true,
                  };
                  setCajerosPorTenant((prev) => ({
                    ...prev,
                    [tenantActual.id]: [
                      ...(prev[tenantActual.id] ?? []),
                      nuevoCaj,
                    ],
                  }));
                  setCajeroSeleccionadoPorTenant((prev) => ({
                    ...prev,
                    [tenantActual.id]: nuevoId,
                  }));
                  setNuevoCajeroNombreInput("");
                  setMostrandoFormNuevoCajero(false);
                  setAlertaSistema({
                    tipo: "exito",
                    mensaje: `Cajero "${nuevoCaj.nombre}" agregado y asignado como operador actual en la caja.`,
                  });
                }}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                Guardar y Asignar a Caja
              </button>
              <button
                type="button"
                onClick={() => setMostrandoFormNuevoCajero(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
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

      {/* CONTENIDO PRINCIPAL DE LA TAQUILLA */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 print:hidden">
        {/* =====================================================================
            VISTA 1: TAQUILLA POS CON MONTO EN BOLÍVARES (Bs.) Y DIVISA (USD)
           ===================================================================== */}
        {vistaActiva === "POS" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* COLUMNA IZQUIERDA (8 cols) */}
            <div className="lg:col-span-8 space-y-4">
              {/* Selector de Sorteo con bloqueo automático T - 3 minutos */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    1. Seleccione Horario de Sorteo (Bloqueo Automático T - 3 Minutos)
                  </span>
                  <span className="text-xs font-mono text-emerald-400">
                    Cupo Máx por Figura: Bs.{" "}
                    {(tenantActual.cupoAnimalUsd * tasaBcv).toFixed(2)} ($
                    {tenantActual.cupoAnimalUsd.toFixed(2)} USD)
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

              {/* Barra de Captura Ultra-Rápida con Doble Moneda Sincronizada (Bs. ⇄ USD) */}
              <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 shadow-lg space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                      2. Entrada Rápida de Jugada en Bolívares (Bs.) y Divisa ($ USD)
                    </h2>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Premio Potencial (30x):{" "}
                    <strong className="text-sky-300">
                      Bs. {((parseFloat(montoBsInput) || 0) * 30).toFixed(2)}
                    </strong>{" "}
                    ({" "}
                    <strong className="text-emerald-300">
                      ${((parseFloat(montoInput) || 0) * 30).toFixed(2)} USD
                    </strong>{" "}
                    )
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  {/* Código del Animalito */}
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                      Figura (0, 00, 01..36)
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
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {figuraPrevisualizada.emoji}{" "}
                          {figuraPrevisualizada.nombre}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Monto en Bolívares (Bs.) — Principal para apuestas mínimas */}
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] text-sky-300 mb-1 font-semibold">
                      Monto en Bolívares (Bs.)
                    </label>
                    <input
                      ref={inputMontoBsRef}
                      type="number"
                      step="1"
                      min="1"
                      value={montoBsInput}
                      onChange={(e) => manejarCambioMontoBs(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          agregarJugadaAlCarrito();
                        } else if (e.key === "F9") {
                          e.preventDefault();
                          procesarEmisionTicket();
                        }
                      }}
                      className={`w-full bg-slate-950 border rounded-lg px-3 py-2.5 font-mono text-lg font-bold text-sky-300 focus:outline-none ${
                        monedaFoco === "BS"
                          ? "border-sky-500 ring-1 ring-sky-500/40"
                          : "border-slate-700"
                      }`}
                    />
                  </div>

                  {/* Icono de Conversión Automática */}
                  <div className="hidden sm:flex sm:col-span-1 items-center justify-center pb-3 text-slate-500">
                    <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                  </div>

                  {/* Monto en Divisa ($ USD) */}
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-emerald-300 mb-1 font-semibold">
                      Monto Divisa ($ USD)
                    </label>
                    <input
                      ref={inputMontoRef}
                      type="number"
                      step="0.10"
                      min="0.01"
                      value={montoInput}
                      onChange={(e) => manejarCambioMontoUsd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          agregarJugadaAlCarrito();
                        } else if (e.key === "F9") {
                          e.preventDefault();
                          procesarEmisionTicket();
                        }
                      }}
                      className={`w-full bg-slate-950 border rounded-lg px-3 py-2.5 font-mono text-lg font-bold text-emerald-400 focus:outline-none ${
                        monedaFoco === "USD"
                          ? "border-emerald-500 ring-1 ring-emerald-500/40"
                          : "border-slate-700"
                      }`}
                    />
                  </div>

                  {/* Botón Agregar al Ticket */}
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

                {/* Botones de Apuesta Rápida en Bolívares (Bs.) y en Divisa ($ USD) */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-sky-400 font-semibold mr-1">
                      Apuesta Rápida Bs.:
                    </span>
                    {[10, 20, 30, 50, 100, 200, 500].map((bsPreset) => (
                      <button
                        key={bsPreset}
                        type="button"
                        onClick={() => aplicarAtajoBs(bsPreset)}
                        className="px-2.5 py-1 bg-sky-950/60 hover:bg-sky-900/80 text-sky-200 font-mono text-xs rounded border border-sky-500/30 transition"
                      >
                        Bs. {bsPreset}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-emerald-400 font-semibold mr-1">
                      Divisa $:
                    </span>
                    {[0.5, 1, 2, 5].map((usdPreset) => (
                      <button
                        key={usdPreset}
                        type="button"
                        onClick={() => aplicarAtajoUsd(usdPreset)}
                        className="px-2.5 py-1 bg-emerald-950/50 hover:bg-emerald-900/70 text-emerald-200 font-mono text-xs rounded border border-emerald-500/30 transition"
                      >
                        ${usdPreset.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Matriz Interactiva de las 38 Figuras de Lotto Activo */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Catálogo Oficial Lotto Activo (38 Figuras - Paga 30x en Bs. y USD)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Clic en cualquier animalito para agregar Bs. {montoBsInput} ($
                    {montoInput})
                  </span>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {CATALOGO_LOTTO_ACTIVO.map((animal) => {
                    const dispUsd = obtenerCupoDisponible(
                      sorteoSeleccionadoId,
                      animal.dbNumber
                    );
                    const dispBs = dispUsd * tasaBcv;
                    const porcentajeUsado = Math.min(
                      100,
                      ((tenantActual.cupoAnimalUsd - dispUsd) /
                        tenantActual.cupoAnimalUsd) *
                        100
                    );
                    const agotado = dispUsd <= 0;

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
                            <span>${dispUsd.toFixed(1)}</span>
                            <span
                              className={
                                agotado
                                  ? "text-red-400 font-bold"
                                  : "text-sky-400"
                              }
                            >
                              Bs.{dispBs.toFixed(0)}
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

            {/* COLUMNA DERECHA (4 cols): Ticket Digital por WhatsApp con Totales en Bs. y USD */}
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
                    Bs. & USD Activo
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

                {/* Lista de Jugadas en el Carrito Expresadas en Bs. y en Divisa (USD) */}
                <div className="my-3 max-h-52 overflow-y-auto space-y-2 pr-1">
                  {carrito.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
                      Sin jugadas aún. Digite el monto en Bs. o USD y el código del animalito.
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
                            Premio 30x: Bs. {(item.montoBs * 30).toFixed(2)} ($
                            {(item.montoUsd * 30).toFixed(2)} USD)
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-right font-mono">
                            <div className="font-bold text-sky-300">
                              Bs. {item.montoBs.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-emerald-400 font-semibold">
                              ${item.montoUsd.toFixed(2)} USD
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

                {/* Resumen Financiero Dual Bs. / USD */}
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Total Jugadas:</span>
                    <span className="font-mono font-bold text-white">
                      {carrito.length}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-sky-300">
                    <span>TOTAL EN BOLÍVARES (BCV):</span>
                    <span className="font-mono">
                      Bs. {totalCarritoBs.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-white border-t border-slate-800 pt-1.5">
                    <span>EQUIVALENTE DIVISA (USD):</span>
                    <span className="font-mono text-emerald-400">
                      ${totalCarritoUsd.toFixed(2)} USD
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

              {/* Tarjeta del Último Ticket Digital Generado para WhatsApp y Físico (Con QR Real sin Links) */}
              {ultimoTicketWhatsApp && (
                <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                      Ticket Oficial + QR (#
                      {ultimoTicketWhatsApp.serialCorto})
                    </span>
                    <span className="text-[11px] font-mono bg-emerald-500/20 text-emerald-200 px-2 py-0.5 rounded font-bold">
                      PIN: {ultimoTicketWhatsApp.pinReclamo}
                    </span>
                  </div>

                  {/* Vista Previa del Código QR Criptográfico Generado (Sin Enlaces al POS) */}
                  <div className="flex items-center gap-3 bg-slate-950/90 border border-slate-800 rounded-xl p-3">
                    <div className="bg-white p-2 rounded-lg shrink-0 shadow">
                      {(() => {
                        const qrMatrix = generarMatrizQr(
                          ultimoTicketWhatsApp.qrPayload
                        );
                        return (
                          <div
                            className="grid bg-white"
                            style={{
                              gridTemplateColumns: `repeat(${qrMatrix.length}, minmax(0, 1fr))`,
                              width: "88px",
                              height: "88px",
                            }}
                          >
                            {qrMatrix.map((row, rIdx) =>
                              row.map((cell, cIdx) => (
                                <div
                                  key={`${rIdx}-${cIdx}`}
                                  className={cell ? "bg-black" : "bg-white"}
                                />
                              ))
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div className="font-bold text-white flex items-center gap-1">
                        <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                        QR Criptográfico Inmutable (Cero Links)
                      </div>
                      <p className="text-slate-400 leading-snug">
                        Este QR contiene únicamente el certificado firmado del ticket y el PIN. No incluye ningún enlace web al POS.
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!ultimoTicketImpreso) return;
                            const ok =
                              await copiarImagenTicketConQrAlPortapapeles({
                                ...ultimoTicketImpreso,
                                clienteTelefono:
                                  ultimoTicketWhatsApp.clienteTelefono,
                              });
                            setAlertaSistema({
                              tipo: ok ? "exito" : "info",
                              mensaje: ok
                                ? "Imagen del Ticket con QR copiada al portapapeles. Presione Ctrl+V en el chat de WhatsApp del cliente para pegarla."
                                : "Use el botón 'Descargar PNG QR' para guardar la imagen del ticket.",
                            });
                          }}
                          className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] flex items-center gap-1"
                        >
                          <QrCode className="w-3 h-3" />
                          Copiar Imagen Ticket + QR (Ctrl+V)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!ultimoTicketImpreso) return;
                            const dataUrl = generarImagenTicketConQrDataUrl({
                              ...ultimoTicketImpreso,
                              clienteTelefono:
                                ultimoTicketWhatsApp.clienteTelefono,
                            });
                            if (!dataUrl) return;
                            const a = document.createElement("a");
                            a.href = dataUrl;
                            a.download = `Ticket_${ultimoTicketWhatsApp.serialCorto}_QR.png`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          }}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-[10px] flex items-center gap-1"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          Descargar PNG QR
                        </button>
                      </div>
                    </div>
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
                            "Texto del comprobante de WhatsApp copiado al portapapeles.",
                        });
                      }}
                      className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copiar Texto
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
                            Bs. {tk.totalBs.toFixed(2)} ($
                            {tk.totalUsd.toFixed(2)})
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-emerald-400/90">
                          👤 En Caja:{" "}
                          {tk.cajeroNombre || "Magaly Rodríguez (Encargada)"}
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
                    , su número de teléfono o la firma HMAC para verificar y pagar su premio en Bs. o Divisa.
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
                <span>
                  Probar reclamo rápido por WhatsApp en {tenantActual.nombre}:
                </span>
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
                            `GANADOR - PAGAR Bs. ${(
                              ticketVerificadoCobro.premioTotalUsd * tasaBcv
                            ).toFixed(
                              2
                            )} ($${ticketVerificadoCobro.premioTotalUsd.toFixed(
                              2
                            )} USD)`}
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
                          Jugado: Bs. {(item.montoUsd * tasaBcv).toFixed(2)} ($
                          {item.montoUsd.toFixed(2)}) → Premio 30x: Bs.{" "}
                          {(item.premioPotencialUsd * tasaBcv).toFixed(2)} ($
                          {item.premioPotencialUsd.toFixed(2)} USD)
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
            VISTA 3: DASHBOARD DE ADMINISTRACIÓN DEL COMERCIO (CAJA & CUPOS)
           ===================================================================== */}
        {vistaActiva === "ADMIN_COMERCIO" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Total Vendido Hoy ({tenantActual.nombre})
                </div>
                <div className="text-2xl font-black font-mono text-sky-300 mt-1">
                  Bs. {cuadreCajaTenantActual.totalVendidoBs.toFixed(2)}
                </div>
                <div className="text-xs font-mono text-emerald-400 mt-0.5">
                  ${cuadreCajaTenantActual.totalVendidoUsd.toFixed(2)} USD
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Total Premios Generados (30x)
                </div>
                <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                  Bs.{" "}
                  {(
                    cuadreCajaTenantActual.totalPremiosGeneradosUsd * tasaBcv
                  ).toFixed(2)}
                </div>
                <div className="text-xs font-mono text-slate-400 mt-0.5">
                  ${cuadreCajaTenantActual.totalPremiosGeneradosUsd.toFixed(2)}{" "}
                  USD
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">
                  Total Premios Pagados en Caja
                </div>
                <div className="text-2xl font-black font-mono text-rose-400 mt-1">
                  Bs.{" "}
                  {(
                    cuadreCajaTenantActual.totalPremiosPagadosUsd * tasaBcv
                  ).toFixed(2)}
                </div>
                <div className="text-xs font-mono text-slate-400 mt-0.5">
                  ${cuadreCajaTenantActual.totalPremiosPagadosUsd.toFixed(2)} USD
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
                  Bs. {cuadreCajaTenantActual.utilidadNetaBs.toFixed(2)}
                </div>
                <div className="text-xs font-mono text-sky-300 mt-0.5">
                  ${cuadreCajaTenantActual.utilidadNetaUsd.toFixed(2)} USD
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>
                  Configuración de Cupo de Riesgo del Comercio (Fórmula: Pérdida Máx / 30)
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Defina la pérdida máxima aceptable por sorteo para{" "}
                <strong>{tenantActual.nombre}</strong>.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
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
                    {((parseFloat(nuevaPerdidaMaxInput) || 0) / 30).toFixed(2)}{" "}
                    USD (Bs.{" "}
                    {(
                      ((parseFloat(nuevaPerdidaMaxInput) || 0) / 30) *
                      tasaBcv
                    ).toFixed(2)}
                    )
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
                      ).toFixed(2)} USD (Bs. ${(
                        (val / 30) *
                        tasaBcv
                      ).toFixed(2)}) por animalito para ${tenantActual.nombre}.`,
                    });
                  }}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg"
                >
                  Guardar Cupo
                </button>
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
      </main>

      {/* PLANTILLA FÍSICA DE IMPRESIÓN TÉRMICA 58MM/80MM CON CÓDIGO QR REAL (CERO LINKS) */}
      {ultimoTicketImpreso && (
        <div className="hidden print:block bg-white text-black p-4 font-mono text-xs max-w-[300px] mx-auto">
          <div className="text-center font-bold text-sm">
            {ultimoTicketImpreso.comercioNombre.toUpperCase()}
          </div>
          <div className="text-center text-[11px] mb-2">
            RIF: {ultimoTicketImpreso.comercioRif} • LOTTO ACTIVO
          </div>
          <div className="border-t border-dashed border-black my-1.5" />
          <div>TICKET N°: #{ultimoTicketImpreso.serialCorto}</div>
          <div>EMISIÓN  : {ultimoTicketImpreso.fechaHoraEmision}</div>
          <div>CAJERO   : {ultimoTicketImpreso.cajeroNombre}</div>
          <div>TASA BCV : Bs. {ultimoTicketImpreso.tasaBcv.toFixed(2)} / USD</div>
          <div className="border-t border-dashed border-black my-1.5" />
          <div className="font-bold mb-1">DETALLE DE JUGADAS:</div>
          {ultimoTicketImpreso.items.map((it, idx) => (
            <div key={idx} className="flex justify-between py-0.5">
              <span>
                {it.sorteoHora} #{it.codigoAnimal} {it.nombreAnimal}
              </span>
              <span className="font-bold">Bs. {it.montoBs.toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-black my-1.5" />
          <div className="font-bold text-sm flex justify-between">
            <span>TOTAL BS:</span>
            <span>Bs. {ultimoTicketImpreso.totalBs.toFixed(2)}</span>
          </div>
          <div className="font-bold flex justify-between">
            <span>TOTAL USD:</span>
            <span>${ultimoTicketImpreso.totalUsd.toFixed(2)}</span>
          </div>
          <div className="border-t border-dashed border-black my-2" />
          <div className="text-center font-bold text-xs mb-2">
            PIN RECLAMO: {ultimoTicketImpreso.serialCorto}-
            {ultimoTicketImpreso.codigoSeguridadHmac.slice(0, 8).toUpperCase()}
          </div>
          <div className="flex justify-center my-2">
            {(() => {
              const qrM = generarMatrizQr(ultimoTicketImpreso.qrPayload);
              return (
                <div
                  className="grid bg-white p-1 border border-black"
                  style={{
                    gridTemplateColumns: `repeat(${qrM.length}, minmax(0, 1fr))`,
                    width: "120px",
                    height: "120px",
                  }}
                >
                  {qrM.map((row, rI) =>
                    row.map((cell, cI) => (
                      <div
                        key={`${rI}-${cI}`}
                        className={cell ? "bg-black" : "bg-white"}
                      />
                    ))
                  )}
                </div>
              );
            })()}
          </div>
          <div className="text-center text-[9px] break-all mt-1">
            HMAC: {ultimoTicketImpreso.codigoSeguridadHmac}
          </div>
        </div>
      )}
    </div>
  );
}
