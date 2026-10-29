import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 06: Winning Ticket Payout State Machine Boundaries", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("B6.1 should reject payout for non-existent security code or non-matching PIN", () => {
    expect(() =>
      sim.pagarTicketGanadorRpc("9999-NONEXISTENTPIN")
    ).toThrowError(/TICKET_NO_ENCONTRADO/);
  });

  it("B6.2 should reject payout for ticket still in EMITIDO state before draw is held", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
    });

    // Draw has not been liquidated yet -> state is EMITIDO
    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_NO_PREMIADO/);
  });

  it("B6.3 should reject payout for losing ticket (PERDEDOR)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
    });

    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 20 }); // Lost

    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_NO_PREMIADO/);
  });

  it("B6.4 should reject payout for cancelled ticket (ANULADO)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 15, monto_usd: 1.0 }],
    });

    sim.anularTicketRpc(res.ticket_id);
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 15 }); // Would have won if not cancelled

    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_ANULADO/);
  });

  it("B6.5 should reject payout for ticket already paid (idempotency guard)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 15, monto_usd: 1.0 }],
    });

    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 15 });

    // First payout
    const pago1 = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago1.estado).toBe("PAGADO");

    // Second payout MUST fail
    expect(() =>
      sim.pagarTicketGanadorRpc(res.codigo_seguridad)
    ).toThrowError(/TICKET_YA_PAGADO/);
  });
});
