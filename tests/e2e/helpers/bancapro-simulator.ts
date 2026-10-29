import crypto from "crypto";
import { CATALOGO_LOTTO_ACTIVO, HORARIOS_OFICIALES_LOTTO_ACTIVO } from "@/lib/constants/animalitos";

export interface TenantRow {
  id: string;
  nombre: string;
  rif: string;
  telefono: string;
  perdida_maxima_sorteo_usd: number;
  activo: boolean;
  created_at: string;
}

export interface UsuarioRow {
  id: string;
  tenant_id: string | null;
  nombre: string;
  email: string;
  rol: "superadmin" | "admin_comercio" | "cajero";
  activo: boolean;
  created_at: string;
}

export interface TasaCambioRow {
  id: number;
  fuente: string;
  tasa: number;
  fecha_vigencia: string;
  created_at: string;
}

export interface SorteoDiarioRow {
  id: number;
  horario_id: number;
  fecha: string;
  estado: "ABIERTO" | "CERRADO" | "LIQUIDADO";
  animal_ganador: number | null;
  timestamp_resultado: string | null;
  liquidado_por: string | null;
  metodo_liquidacion: "AUTO_CRON" | "MANUAL_CONTINGENCIA";
  hora_oficial: string;
  etiqueta: string;
  minutos_cierre_previo: number;
}

export interface CupoSorteoRow {
  id: number;
  tenant_id: string;
  sorteo_diario_id: number;
  animal_numero: number;
  monto_acumulado_usd: number;
  cupo_maximo_usd: number;
  updated_at: string;
}

export interface TicketRow {
  id: string;
  serial_corto: number;
  tenant_id: string;
  usuario_id: string;
  cliente_telefono: string | null;
  canal_entrega: "WHATSAPP" | "TERMICA_ESCPOS" | "AMBOS";
  codigo_seguridad: string;
  total_usd: number;
  total_bs: number;
  tasa_cambio: number;
  premio_total_usd: number;
  estado: "EMITIDO" | "GANADOR" | "PERDEDOR" | "PAGADO" | "ANULADO";
  created_at: string;
  anulado_at: string | null;
  paid_at: string | null;
  paid_by: string | null;
}

export interface TicketDetalleRow {
  id: number;
  ticket_id: string;
  tenant_id: string;
  sorteo_diario_id: number;
  animal_numero: number;
  monto_usd: number;
  premio_potencial_usd: number;
  es_ganador: boolean | null;
  premio_liquidado_usd: number;
}

export interface CajaMovimientoRow {
  id: number;
  tenant_id: string;
  usuario_id: string;
  tipo: "VENTA" | "ANULACION" | "PAGO_PREMIO";
  monto_usd: number;
  monto_bs: number;
  ticket_id: string;
  concepto: string;
  fecha: string;
}

export const SERVER_HMAC_SECRET =
  process.env.TICKET_HMAC_SECRET ||
  "bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210";

export class BancaProSimulator {
  tenants: Map<string, TenantRow> = new Map();
  usuarios: Map<string, UsuarioRow> = new Map();
  tasas: TasaCambioRow[] = [];
  sorteos: Map<number, SorteoDiarioRow> = new Map();
  cupos: Map<string, CupoSorteoRow> = new Map();
  tickets: Map<string, TicketRow> = new Map();
  detalles: TicketDetalleRow[] = [];
  movimientos: CajaMovimientoRow[] = [];

  serialCounter: number = 1000;
  mockCurrentTimeVe: Date | null = null;
  currentUserId: string | null = null;

  constructor() {
    this.reset();
  }

  reset() {
    this.tenants.clear();
    this.usuarios.clear();
    this.tasas = [];
    this.sorteos.clear();
    this.cupos.clear();
    this.tickets.clear();
    this.detalles = [];
    this.movimientos = [];
    this.serialCounter = 1000;
    this.mockCurrentTimeVe = null;
    this.currentUserId = null;

    // Seed Tenant 1 (Magaly)
    const t1Id = "11111111-1111-4111-8111-111111111111";
    this.tenants.set(t1Id, {
      id: t1Id,
      nombre: "Bodega Piloto Magaly",
      rif: "J-40123987-1",
      telefono: "+58 414-1234567",
      perdida_maxima_sorteo_usd: 300.0, // Quota = $10.00
      activo: true,
      created_at: new Date().toISOString(),
    });

    // Seed Tenant 2 (Agencia El Centro)
    const t2Id = "22222222-2222-4222-8222-222222222222";
    this.tenants.set(t2Id, {
      id: t2Id,
      nombre: "Agencia El Centro",
      rif: "J-50987654-2",
      telefono: "+58 424-9998877",
      perdida_maxima_sorteo_usd: 600.0, // Quota = $20.00
      activo: true,
      created_at: new Date().toISOString(),
    });

    // Seed Usuarios
    const uMagaly = "aaaa1111-1111-4111-8111-111111111111";
    this.usuarios.set(uMagaly, {
      id: uMagaly,
      tenant_id: t1Id,
      nombre: "Magaly Rodríguez",
      email: "magaly.rodriguez@bancapro.local",
      rol: "admin_comercio",
      activo: true,
      created_at: new Date().toISOString(),
    });

    const uCajeroT1 = "bbbb2222-2222-4222-8222-222222222222";
    this.usuarios.set(uCajeroT1, {
      id: uCajeroT1,
      tenant_id: t1Id,
      nombre: "Juan Cajero",
      email: "juan.cajero@bancapro.local",
      rol: "cajero",
      activo: true,
      created_at: new Date().toISOString(),
    });

    const uCajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    this.usuarios.set(uCajeroT2, {
      id: uCajeroT2,
      tenant_id: t2Id,
      nombre: "Pedro Cajero T2",
      email: "pedro.cajero@agenciacentro.local",
      rol: "cajero",
      activo: true,
      created_at: new Date().toISOString(),
    });

    const uSuperadmin = "dddd4444-4444-4444-8444-444444444444";
    this.usuarios.set(uSuperadmin, {
      id: uSuperadmin,
      tenant_id: null,
      nombre: "Super Administrador",
      email: "admin@bancapro.com",
      rol: "superadmin",
      activo: true,
      created_at: new Date().toISOString(),
    });

    // Default current user = Magaly
    this.currentUserId = uMagaly;

    // Seed Tasa BCV
    const hoyCaracas = this.getTodayCaracasString();
    this.tasas.push({
      id: 1,
      fuente: "BCV",
      tasa: 45.85,
      fecha_vigencia: hoyCaracas,
      created_at: new Date().toISOString(),
    });

    // Seed 11 Sorteos Diarios
    HORARIOS_OFICIALES_LOTTO_ACTIVO.forEach((h) => {
      this.sorteos.set(h.id, {
        id: h.id,
        horario_id: h.id,
        fecha: hoyCaracas,
        estado: "ABIERTO",
        animal_ganador: null,
        timestamp_resultado: null,
        liquidado_por: null,
        metodo_liquidacion: "AUTO_CRON",
        hora_oficial: h.hora24,
        etiqueta: h.etiqueta,
        minutos_cierre_previo: 3,
      });
    });
  }

  setMockTime(date: Date | string | null) {
    this.mockCurrentTimeVe = date ? new Date(date) : null;
  }

  setCurrentUser(userId: string | null) {
    this.currentUserId = userId;
  }

  getCurrentTime(): Date {
    return this.mockCurrentTimeVe || new Date();
  }

  getTodayCaracasString(): string {
    const d = this.getCurrentTime();
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  getCurrentTimeVeString(): string {
    const d = this.getCurrentTime();
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Caracas",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  }

  getLatestTasa(): number {
    if (this.tasas.length === 0) return 45.85;
    return this.tasas[this.tasas.length - 1].tasa;
  }

  calculateHmac(
    tenantId: string,
    ticketId: string,
    montoUsd: number,
    epoch: number
  ): string {
    const payload = `${tenantId}|${ticketId}|${montoUsd.toFixed(2)}|${epoch}`;
    return crypto
      .createHmac("sha256", SERVER_HMAC_SECRET)
      .update(payload)
      .digest("hex");
  }

  // Stored Procedure 1: emitir_ticket
  emitirTicketRpc(params: {
    p_jugadas: Array<{
      sorteo_diario_id: number;
      animal_numero: number;
      monto_usd: number;
    }>;
    p_secret_key?: string;
    p_cliente_telefono?: string | null;
    p_canal_entrega?: "WHATSAPP" | "TERMICA_ESCPOS" | "AMBOS";
  }) {
    const { p_jugadas, p_cliente_telefono, p_canal_entrega } = params;

    if (!this.currentUserId) {
      throw new Error("NO_AUTORIZADO: Sesión inválida o expirada.");
    }

    const usuario = this.usuarios.get(this.currentUserId);
    if (!usuario || !usuario.activo) {
      throw new Error("NO_AUTORIZADO: Usuario no encontrado o inactivo.");
    }

    if (!usuario.tenant_id) {
      throw new Error(
        "TENANT_INVALIDO: El usuario no tiene un comercio activo asignado."
      );
    }

    const tenant = this.tenants.get(usuario.tenant_id);
    if (!tenant || !tenant.activo) {
      throw new Error(
        "TENANT_INVALIDO: El usuario no tiene un comercio activo asignado."
      );
    }

    if (!p_jugadas || p_jugadas.length === 0) {
      throw new Error("ERROR_TRANSACCIONAL: El ticket debe incluir al menos una jugada.");
    }

    // Validate plays
    for (const j of p_jugadas) {
      if (typeof j.monto_usd !== "number" || j.monto_usd <= 0 || isNaN(j.monto_usd)) {
        throw new Error(
          `MONTO_INVALIDO: El monto jugado ($${j.monto_usd}) debe ser mayor a cero.`
        );
      }
      if (
        typeof j.animal_numero !== "number" ||
        j.animal_numero < 0 ||
        j.animal_numero > 37
      ) {
        throw new Error(
          `ANIMAL_INVALIDO: Figura #${j.animal_numero} inválida. Debe estar entre 0 y 37.`
        );
      }
    }

    const tasaBcv = this.getLatestTasa();
    const cupoDefaultPorAnimal = Number(
      (tenant.perdida_maxima_sorteo_usd / 30).toFixed(2)
    );
    const now = this.getCurrentTime();
    const hoyCaracas = this.getTodayCaracasString();
    const horaActualVe = this.getCurrentTimeVeString();

    // Check lockdown and quotas for each play
    for (const j of p_jugadas) {
      const sorteo = this.sorteos.get(j.sorteo_diario_id);
      if (!sorteo || sorteo.estado !== "ABIERTO") {
        throw new Error(
          "SORTEO_CERRADO: El sorteo seleccionado no está disponible."
        );
      }

      // Check 3-minute lockdown
      const [sh, sm, ss] = sorteo.hora_oficial.split(":").map(Number);
      const sorteoTotalSec = sh * 3600 + sm * 60 + (ss || 0);
      const cierreTotalSec = sorteoTotalSec - sorteo.minutos_cierre_previo * 60;

      const [ah, am, as] = horaActualVe.split(":").map(Number);
      const actualTotalSec = ah * 3600 + am * 60 + (as || 0);

      if (sorteo.fecha === hoyCaracas && actualTotalSec >= cierreTotalSec) {
        throw new Error(
          `LOCKDOWN_ACTIVO: Sorteo ${sorteo.etiqueta} cerrado por horario límite.`
        );
      }

      // Quota check
      const cupoKey = `${tenant.id}_${j.sorteo_diario_id}_${j.animal_numero}`;
      let cupo = this.cupos.get(cupoKey);
      if (!cupo) {
        cupo = {
          id: this.cupos.size + 1,
          tenant_id: tenant.id,
          sorteo_diario_id: j.sorteo_diario_id,
          animal_numero: j.animal_numero,
          monto_acumulado_usd: 0.0,
          cupo_maximo_usd: cupoDefaultPorAnimal,
          updated_at: now.toISOString(),
        };
        this.cupos.set(cupoKey, cupo);
      }

      const nuevoAcumulado = Number(
        (cupo.monto_acumulado_usd + j.monto_usd).toFixed(2)
      );
      if (nuevoAcumulado > cupo.cupo_maximo_usd) {
        const disponible = Math.max(
          0,
          Number((cupo.cupo_maximo_usd - cupo.monto_acumulado_usd).toFixed(2))
        );
        const animalNom = j.animal_numero === 37 ? "00" : String(j.animal_numero).padStart(2, "0");
        throw new Error(
          `CUPO_AGOTADO: Cupo agotado para esta figura (#${animalNom} en sorteo ${sorteo.etiqueta}). Disponible: $${disponible.toFixed(2)} USD.`
        );
      }
    }

    // All validations passed -> Commit transaction
    const ticketId = crypto.randomUUID();
    this.serialCounter += 1;
    const serialCorto = this.serialCounter;

    let totalUsd = 0;
    for (const j of p_jugadas) {
      totalUsd += j.monto_usd;
    }
    totalUsd = Number(totalUsd.toFixed(2));
    const totalBs = Number((totalUsd * tasaBcv).toFixed(2));
    const timestampEpoch = Math.floor(now.getTime() / 1000);

    const secret = params.p_secret_key || SERVER_HMAC_SECRET;
    const codigoSeguridad = this.calculateHmac(
      tenant.id,
      ticketId,
      totalUsd,
      timestampEpoch
    );

    // Update quotas and insert details
    for (const j of p_jugadas) {
      const cupoKey = `${tenant.id}_${j.sorteo_diario_id}_${j.animal_numero}`;
      const cupo = this.cupos.get(cupoKey)!;
      cupo.monto_acumulado_usd = Number(
        (cupo.monto_acumulado_usd + j.monto_usd).toFixed(2)
      );
      cupo.updated_at = now.toISOString();

      this.detalles.push({
        id: this.detalles.length + 1,
        ticket_id: ticketId,
        tenant_id: tenant.id,
        sorteo_diario_id: j.sorteo_diario_id,
        animal_numero: j.animal_numero,
        monto_usd: j.monto_usd,
        premio_potencial_usd: Number((j.monto_usd * 30.0).toFixed(2)),
        es_ganador: null,
        premio_liquidado_usd: 0.0,
      });
    }

    const ticket: TicketRow = {
      id: ticketId,
      serial_corto: serialCorto,
      tenant_id: tenant.id,
      usuario_id: usuario.id,
      cliente_telefono: p_cliente_telefono || null,
      canal_entrega: p_canal_entrega || "WHATSAPP",
      codigo_seguridad: codigoSeguridad,
      total_usd: totalUsd,
      total_bs: totalBs,
      tasa_cambio: tasaBcv,
      premio_total_usd: 0.0,
      estado: "EMITIDO",
      created_at: now.toISOString(),
      anulado_at: null,
      paid_at: null,
      paid_by: null,
    };

    this.tickets.set(ticketId, ticket);

    // Register caja movimiento
    this.movimientos.push({
      id: this.movimientos.length + 1,
      tenant_id: tenant.id,
      usuario_id: usuario.id,
      tipo: "VENTA",
      monto_usd: totalUsd,
      monto_bs: totalBs,
      ticket_id: ticketId,
      concepto: `Venta Ticket #${String(serialCorto).padStart(7, "0")}`,
      fecha: now.toISOString(),
    });

    return {
      ok: true,
      ticket_id: ticketId,
      serial_corto: serialCorto,
      tenant_id: tenant.id,
      codigo_seguridad: codigoSeguridad,
      cliente_telefono: p_cliente_telefono || null,
      canal_entrega: p_canal_entrega || "WHATSAPP",
      total_usd: totalUsd,
      total_bs: totalBs,
      tasa_cambio: tasaBcv,
      timestamp_epoch: timestampEpoch,
      created_at: now.toISOString(),
    };
  }

  // Stored Procedure 2: anular_ticket
  anularTicketRpc(ticketId: string) {
    if (!this.currentUserId) {
      throw new Error("NO_AUTORIZADO: Sesión inválida o expirada.");
    }
    const usuario = this.usuarios.get(this.currentUserId);
    if (!usuario || !usuario.tenant_id) {
      throw new Error("NO_AUTORIZADO: Operador sin comercio asignado.");
    }

    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.tenant_id !== usuario.tenant_id) {
      throw new Error("TICKET_NO_ENCONTRADO: El ticket no existe en este comercio.");
    }

    if (ticket.estado !== "EMITIDO") {
      throw new Error(
        `ESTADO_NO_ANULABLE: Solo se pueden anular tickets en estado EMITIDO (Estado actual: ${ticket.estado}).`
      );
    }

    const now = this.getCurrentTime();
    const ticketCreatedAt = new Date(ticket.created_at);
    const segundosTranscurridos = (now.getTime() - ticketCreatedAt.getTime()) / 1000;

    if (segundosTranscurridos > 60) {
      throw new Error(
        `TIEMPO_ANULACION_EXPIRADO: Han transcurrido ${Math.round(
          segundosTranscurridos
        )} segundos desde la emisión (límite máximo: 60 segundos).`
      );
    }

    // Check lockdown on any included sorteo
    const ticketDetalles = this.detalles.filter((d) => d.ticket_id === ticketId);
    const hoyCaracas = this.getTodayCaracasString();
    const horaActualVe = this.getCurrentTimeVeString();

    for (const d of ticketDetalles) {
      const sorteo = this.sorteos.get(d.sorteo_diario_id);
      if (!sorteo || sorteo.estado !== "ABIERTO") {
        throw new Error(
          `SORTEO_EN_LOCKDOWN: No se puede anular porque el sorteo ${
            sorteo?.etiqueta || ""
          } ya no está abierto.`
        );
      }

      const [sh, sm, ss] = sorteo.hora_oficial.split(":").map(Number);
      const sorteoTotalSec = sh * 3600 + sm * 60 + (ss || 0);
      const cierreTotalSec = sorteoTotalSec - sorteo.minutos_cierre_previo * 60;

      const [ah, am, as] = horaActualVe.split(":").map(Number);
      const actualTotalSec = ah * 3600 + am * 60 + (as || 0);

      if (sorteo.fecha === hoyCaracas && actualTotalSec >= cierreTotalSec) {
        throw new Error(
          `SORTEO_EN_LOCKDOWN: No se puede anular porque el sorteo ${sorteo.etiqueta} ya entró en los 3 minutos previos al cierre.`
        );
      }
    }

    // Revert quotas
    for (const d of ticketDetalles) {
      const cupoKey = `${usuario.tenant_id}_${d.sorteo_diario_id}_${d.animal_numero}`;
      const cupo = this.cupos.get(cupoKey);
      if (cupo) {
        cupo.monto_acumulado_usd = Math.max(
          0,
          Number((cupo.monto_acumulado_usd - d.monto_usd).toFixed(2))
        );
        cupo.updated_at = now.toISOString();
      }
    }

    ticket.estado = "ANULADO";
    ticket.anulado_at = now.toISOString();

    // Ledger entry
    this.movimientos.push({
      id: this.movimientos.length + 1,
      tenant_id: usuario.tenant_id,
      usuario_id: usuario.id,
      tipo: "ANULACION",
      monto_usd: -ticket.total_usd,
      monto_bs: -ticket.total_bs,
      ticket_id: ticket.id,
      concepto: `Anulación Ticket #${String(ticket.serial_corto).padStart(7, "0")}`,
      fecha: now.toISOString(),
    });

    return {
      ticket_id: ticket.id,
      serial_corto: ticket.serial_corto,
      estado: "ANULADO",
      reverso_usd: ticket.total_usd,
      anulado_at: now.toISOString(),
    };
  }

  // Stored Procedure 3: liquidar_sorteo
  liquidarSorteoRpc(params: {
    p_sorteo_id?: number;
    sorteo_id?: number;
    p_animal_ganador?: number;
    animal_ganador?: number;
    p_metodo?: "AUTO_CRON" | "MANUAL_CONTINGENCIA";
    metodo?: "AUTO_CRON" | "MANUAL_CONTINGENCIA";
  }) {
    const p_sorteo_id = params.p_sorteo_id ?? params.sorteo_id!;
    const p_animal_ganador = params.p_animal_ganador ?? params.animal_ganador!;
    const p_metodo = params.p_metodo ?? params.metodo;

    if (
      typeof p_animal_ganador !== "number" ||
      p_animal_ganador < 0 ||
      p_animal_ganador > 37
    ) {
      throw new Error(
        `ANIMAL_INVALIDO: El código de figura ${p_animal_ganador} está fuera del rango permitido (0..37).`
      );
    }

    const sorteo = this.sorteos.get(p_sorteo_id);
    if (!sorteo) {
      throw new Error(`SORTEO_NO_ENCONTRADO: El sorteo ${p_sorteo_id} no existe.`);
    }

    if (sorteo.estado === "LIQUIDADO") {
      throw new Error(
        `SORTEO_YA_LIQUIDADO: El sorteo ${p_sorteo_id} ya fue liquidado previamente con la figura ${sorteo.animal_ganador}.`
      );
    }

    const now = this.getCurrentTime();
    sorteo.estado = "LIQUIDADO";
    sorteo.animal_ganador = p_animal_ganador;
    sorteo.timestamp_resultado = now.toISOString();
    sorteo.liquidado_por = this.currentUserId;
    sorteo.metodo_liquidacion = p_metodo || "AUTO_CRON";

    let jugadasGanadoras = 0;
    let premiosGeneradosUsd = 0;

    // Update details for all non-cancelled tickets
    const affectedTicketIds = new Set<string>();
    for (const d of this.detalles) {
      if (d.sorteo_diario_id === p_sorteo_id) {
        const ticket = this.tickets.get(d.ticket_id);
        if (ticket && ticket.estado !== "ANULADO") {
          d.es_ganador = d.animal_numero === p_animal_ganador;
          if (d.es_ganador) {
            d.premio_liquidado_usd = Number((d.monto_usd * 30.0).toFixed(2));
            jugadasGanadoras += 1;
            premiosGeneradosUsd += d.premio_liquidado_usd;
          } else {
            d.premio_liquidado_usd = 0.0;
          }
          affectedTicketIds.add(d.ticket_id);
        }
      }
    }

    // Update status of affected tickets
    let ticketsGanadores = 0;
    affectedTicketIds.forEach((tid) => {
      const ticket = this.tickets.get(tid)!;
      if (ticket.estado === "PAGADO" || ticket.estado === "ANULADO") {
        return;
      }

      const allDetalles = this.detalles.filter((d) => d.ticket_id === tid);
      const hasWinner = allDetalles.some((d) => d.es_ganador === true);
      const allResolved = allDetalles.every((d) => d.es_ganador !== null);
      const totalPremio = allDetalles.reduce(
        (acc, cur) => acc + cur.premio_liquidado_usd,
        0
      );

      ticket.premio_total_usd = Number(totalPremio.toFixed(2));
      if (hasWinner) {
        ticket.estado = "GANADOR";
        ticketsGanadores += 1;
      } else if (allResolved) {
        ticket.estado = "PERDEDOR";
      } else {
        ticket.estado = "EMITIDO";
      }
    });

    return {
      sorteo_id: p_sorteo_id,
      animal_ganador: p_animal_ganador,
      estado: "LIQUIDADO",
      jugadas_ganadoras: jugadasGanadoras,
      premios_generados_usd: Number(premiosGeneradosUsd.toFixed(2)),
      tickets_actualizados: affectedTicketIds.size,
      timestamp: now.toISOString(),
    };
  }

  // Stored Procedure 4: pagar_ticket_ganador
  pagarTicketGanadorRpc(codigoSeguridadOrPin: string) {
    if (!this.currentUserId) {
      throw new Error("NO_AUTORIZADO: Operador sin sesión.");
    }
    const usuario = this.usuarios.get(this.currentUserId);
    if (!usuario || !usuario.tenant_id) {
      throw new Error("NO_AUTORIZADO: Operador sin comercio asignado.");
    }

    const clean = codigoSeguridadOrPin.trim();

    // Resolve ticket: could be 64-char security hash, or PIN format like "1001-A1B2C3D4", or serial number
    let foundTicket: TicketRow | undefined;
    for (const t of this.tickets.values()) {
      const pin = `${t.serial_corto}-${t.codigo_seguridad.slice(0, 8).toUpperCase()}`;
      if (
        t.codigo_seguridad === clean ||
        pin === clean.toUpperCase() ||
        String(t.serial_corto) === clean
      ) {
        foundTicket = t;
        break;
      }
    }

    if (!foundTicket || foundTicket.tenant_id !== usuario.tenant_id) {
      throw new Error(
        "TICKET_NO_ENCONTRADO: El código de seguridad QR no existe o pertenece a otro comercio."
      );
    }

    if (foundTicket.estado === "PAGADO") {
      throw new Error(
        `TICKET_YA_PAGADO: Este ticket ya fue cobrado el ${foundTicket.paid_at}.`
      );
    }

    if (foundTicket.estado === "ANULADO") {
      throw new Error(
        "TICKET_ANULADO: Este ticket se encuentra anulado y carece de validez."
      );
    }

    if (foundTicket.estado !== "GANADOR" || foundTicket.premio_total_usd <= 0) {
      throw new Error(
        `TICKET_NO_PREMIADO: El estado actual del ticket es ${foundTicket.estado} y no posee premios exigibles.`
      );
    }

    // Check if multi-sorteo ticket has unresolved plays
    const unresolved = this.detalles.filter(
      (d) => d.ticket_id === foundTicket!.id && d.es_ganador === null
    );
    if (unresolved.length > 0) {
      throw new Error(
        `SORTEOS_PENDIENTES: El ticket aún tiene ${unresolved.length} jugada(s) en sorteos abiertos sin liquidar.`
      );
    }

    const tasaActual = this.getLatestTasa();
    const premioBs = Number((foundTicket.premio_total_usd * tasaActual).toFixed(2));
    const now = this.getCurrentTime();

    foundTicket.estado = "PAGADO";
    foundTicket.paid_at = now.toISOString();
    foundTicket.paid_by = usuario.id;

    // Movement
    this.movimientos.push({
      id: this.movimientos.length + 1,
      tenant_id: usuario.tenant_id,
      usuario_id: usuario.id,
      tipo: "PAGO_PREMIO",
      monto_usd: -foundTicket.premio_total_usd,
      monto_bs: -premioBs,
      ticket_id: foundTicket.id,
      concepto: `Pago Premio Ticket #${String(foundTicket.serial_corto).padStart(7, "0")}`,
      fecha: now.toISOString(),
    });

    return {
      ticket_id: foundTicket.id,
      serial_corto: foundTicket.serial_corto,
      estado: "PAGADO",
      premio_pagado_usd: foundTicket.premio_total_usd,
      premio_pagado_bs: premioBs,
      tasa_aplicada: tasaActual,
      paid_at: now.toISOString(),
    };
  }

  // Cron BCV helper
  actualizarTasaBcv(tasa: number, fecha?: string) {
    if (tasa <= 0 || isNaN(tasa)) {
      throw new Error("TASA_INVALIDA: La tasa debe ser un número positivo.");
    }
    const fechaVigencia = fecha || this.getTodayCaracasString();
    const newTasaRow: TasaCambioRow = {
      id: this.tasas.length + 1,
      fuente: "BCV",
      tasa: Number(tasa.toFixed(4)),
      fecha_vigencia: fechaVigencia,
      created_at: this.getCurrentTime().toISOString(),
    };
    this.tasas.push(newTasaRow);
    return newTasaRow;
  }
}
