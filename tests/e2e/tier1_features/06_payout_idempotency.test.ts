import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 06: Winning Ticket Payout Idempotency & PIN Lookup", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("6.1 should successfully process payout for a winning ticket using full security hash", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }],
    });

    // Settle draw with animal 5 (30x payout = $60.00)
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 5 });

    const pago = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago.estado).toBe("PAGADO");
    expect(pago.premio_pagado_usd).toBe(60.0);
    expect(pago.premio_pagado_bs).toBe(Number((60.0 * 45.85).toFixed(2)));
  });

  it("6.2 should strictly enforce payout idempotency and reject second payout with TICKET_YA_PAGADO", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 8, monto_usd: 1.0 }],
    });

    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 8 });

    // First payout succeeds
    sim.pagarTicketGanadorRpc(res.codigo_seguridad);

    // Second payout MUST fail with TICKET_YA_PAGADO
    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_YA_PAGADO/);
  });

  it("6.3 should successfully resolve and pay winning ticket using customer 7-digit PIN (serialCorto-HASH8)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 9, monto_usd: 3.0 }],
    });

    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 9 });

    const pin = `${res.serial_corto}-${res.codigo_seguridad.slice(0, 8).toUpperCase()}`;
    const pago = sim.pagarTicketGanadorRpc(pin);

    expect(pago.estado).toBe("PAGADO");
    expect(pago.premio_pagado_usd).toBe(90.0);
  });

  it("6.4 should reject payout if ticket is not in GANADOR state (e.g., losing ticket)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 2.0 }],
    });

    // Liquidate draw with different animal (e.g. 2 instead of 1) -> Ticket becomes PERDEDOR
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 2 });

    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_NO_PREMIADO/);
  });

  it("6.5 should reject payout if ticket was cancelled prior to draw", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 14, monto_usd: 2.0 }],
    });

    // Cancel ticket immediately
    sim.anularTicketRpc(res.ticket_id);

    // Liquidate draw with winning animal
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 14 });

    // Payout attempt must fail with TICKET_ANULADO
    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_ANULADO/);
  });
});
