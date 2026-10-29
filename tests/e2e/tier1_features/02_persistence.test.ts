import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 02: Transactional Persistence", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("2.1 should atomically persist ticket, details, and cash drawer movements on issuance", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [
        { sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 },
        { sorteo_diario_id: 1, animal_numero: 12, monto_usd: 1.5 },
      ],
      p_cliente_telefono: "04141234567",
      p_canal_entrega: "WHATSAPP",
    });

    // 1. Verify tickets table entry
    const ticketInDb = sim.tickets.get(res.ticket_id);
    expect(ticketInDb).toBeDefined();
    expect(ticketInDb?.total_usd).toBe(3.5);
    expect(ticketInDb?.total_bs).toBe(Number((3.5 * 45.85).toFixed(2)));
    expect(ticketInDb?.tasa_cambio).toBe(45.85);
    expect(ticketInDb?.estado).toBe("EMITIDO");

    // 2. Verify ticket_detalles table entries (each with 30x potential prize)
    const detalles = sim.detalles.filter((d) => d.ticket_id === res.ticket_id);
    expect(detalles).toHaveLength(2);
    expect(detalles[0].animal_numero).toBe(5);
    expect(detalles[0].monto_usd).toBe(2.0);
    expect(detalles[0].premio_potencial_usd).toBe(60.0); // 2.0 * 30
    expect(detalles[1].animal_numero).toBe(12);
    expect(detalles[1].monto_usd).toBe(1.5);
    expect(detalles[1].premio_potencial_usd).toBe(45.0); // 1.5 * 30

    // 3. Verify caja_movimientos table entry
    const mov = sim.movimientos.find((m) => m.ticket_id === res.ticket_id);
    expect(mov).toBeDefined();
    expect(mov?.tipo).toBe("VENTA");
    expect(mov?.monto_usd).toBe(3.5);
  });

  it("2.2 should generate unique and sequential serial_corto numbers", () => {
    const t1 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 1.0 }],
    });
    const t2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 2, monto_usd: 1.0 }],
    });

    expect(t2.serial_corto).toBe(t1.serial_corto + 1);
  });

  it("2.3 should freeze official BCV rate at emission timestamp and persist to ticket", () => {
    // Update BCV rate to 52.4000
    sim.actualizarTasaBcv(52.4);

    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 3, monto_usd: 10.0 }],
    });

    const ticketInDb = sim.tickets.get(res.ticket_id)!;
    expect(ticketInDb.tasa_cambio).toBe(52.4);
    expect(ticketInDb.total_bs).toBe(524.0);

    // Later BCV rate change should NOT affect already persisted ticket
    sim.actualizarTasaBcv(60.0);
    expect(sim.tickets.get(res.ticket_id)?.tasa_cambio).toBe(52.4);
    expect(sim.tickets.get(res.ticket_id)?.total_bs).toBe(524.0);
  });

  it("2.4 should maintain state transition from EMITIDO to GANADOR or PERDEDOR upon settlement", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 2.0 }],
    });

    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("EMITIDO");

    // Liquidate with animal 10 -> Ticket becomes GANADOR
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 10 });
    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("GANADOR");
    expect(sim.tickets.get(res.ticket_id)?.premio_total_usd).toBe(60.0);
  });

  it("2.5 should transition ticket from GANADOR to PAGADO and record cash drawer disbursement", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 25, monto_usd: 1.0 }],
    });

    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 25 });
    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("GANADOR");

    // Pay ticket
    const pago = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago.estado).toBe("PAGADO");
    expect(pago.premio_pagado_usd).toBe(30.0);

    const ticketInDb = sim.tickets.get(res.ticket_id)!;
    expect(ticketInDb.estado).toBe("PAGADO");
    expect(ticketInDb.paid_at).toBeDefined();

    // Verify cash movement for prize payment
    const pagoMov = sim.movimientos.find(
      (m) => m.ticket_id === res.ticket_id && m.tipo === "PAGO_PREMIO"
    );
    expect(pagoMov).toBeDefined();
    expect(pagoMov?.monto_usd).toBe(-30.0);
  });
});
