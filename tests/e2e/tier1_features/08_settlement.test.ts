import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 08: Contingency Draw Settlement & 30x Payout", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("8.1 should settle draw and mark winning tickets with exact 30x payout calculation", () => {
    // Bet $3.50 on Animal 12 (Caballo)
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 12, monto_usd: 3.5 }],
    });

    const liq = sim.liquidarSorteoRpc({
      p_sorteo_id: 1,
      animal_ganador: 12,
      p_metodo: "MANUAL_CONTINGENCIA",
    });

    expect(liq.estado).toBe("LIQUIDADO");
    expect(liq.jugadas_ganadoras).toBe(1);
    expect(liq.premios_generados_usd).toBe(105.0); // 3.5 * 30

    const ticketInDb = sim.tickets.get(res.ticket_id)!;
    expect(ticketInDb.estado).toBe("GANADOR");
    expect(ticketInDb.premio_total_usd).toBe(105.0);
  });

  it("8.2 should mark ticket as PERDEDOR when all included draws are resolved and none won", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 18, monto_usd: 2.0 }],
    });

    // Draw 1 outcome is animal 20 (not 18)
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 20 });

    const ticketInDb = sim.tickets.get(res.ticket_id)!;
    expect(ticketInDb.estado).toBe("PERDEDOR");
    expect(ticketInDb.premio_total_usd).toBe(0.0);
  });

  it("8.3 should keep ticket in EMITIDO state if it is multi-sorteo and subsequent draws are still open", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [
        { sorteo_diario_id: 1, animal_numero: 1, monto_usd: 1.0 }, // Draw 1 (09:00 AM)
        { sorteo_diario_id: 2, animal_numero: 2, monto_usd: 1.0 }, // Draw 2 (10:00 AM)
      ],
    });

    // Liquidate draw 1 with animal 5 (play 1 loses)
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 5 });

    // Draw 2 is still ABIERTO, so ticket must remain EMITIDO
    const ticketInDb = sim.tickets.get(res.ticket_id)!;
    expect(ticketInDb.estado).toBe("EMITIDO");

    // Liquidate draw 2 with animal 2 (play 2 wins) -> Ticket transitions to GANADOR
    sim.liquidarSorteoRpc({ p_sorteo_id: 2, animal_ganador: 2 });
    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("GANADOR");
    expect(sim.tickets.get(res.ticket_id)?.premio_total_usd).toBe(30.0);
  });

  it("8.4 should reject re-settling an already liquidated draw with SORTEO_YA_LIQUIDADO", () => {
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 10 });

    expect(() =>
      sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 10 })
    ).toThrowError(/SORTEO_YA_LIQUIDADO/);
  });

  it("8.5 should settle plays simultaneously for all tenants without cross-tenant balance leakage", () => {
    // Tenant 1 cashier bets $2.00 on Animal 16
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 16, monto_usd: 2.0 }],
    });

    // Tenant 2 cashier bets $5.00 on Animal 16
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 16, monto_usd: 5.0 }],
    });

    // Settle draw 1 with animal 16
    const liq = sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 16 });
    expect(liq.jugadas_ganadoras).toBe(2);
    expect(liq.premios_generados_usd).toBe(210.0); // (2*30) + (5*30) = 60 + 150 = 210
  });
});
