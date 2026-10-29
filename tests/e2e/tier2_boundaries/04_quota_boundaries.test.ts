import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 04: Exact Quota Limits & Overrun Boundaries", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("B4.1 should allow a single bet at exactly the maximum quota limit ($10.00)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 10.0 }],
    });

    expect(res.ticket_id).toBeDefined();
    const cupo = sim.cupos.get("11111111-1111-4111-8111-111111111111_1_5");
    expect(cupo?.monto_acumulado_usd).toBe(10.0);
  });

  it("B4.2 should reject a single bet exceeding maximum quota limit by one cent ($10.01)", () => {
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 10.01 }],
      })
    ).toThrowError(/CUPO_AGOTADO/);
  });

  it("B4.3 should allow two cumulative bets that sum to exactly the maximum quota ($7.50 + $2.50 = $10.00)", () => {
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 8, monto_usd: 7.5 }],
    });

    const res2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 8, monto_usd: 2.5 }],
    });

    expect(res2.ticket_id).toBeDefined();
    const cupo = sim.cupos.get("11111111-1111-4111-8111-111111111111_1_8");
    expect(cupo?.monto_acumulado_usd).toBe(10.0);
  });

  it("B4.4 should reject an additional $0.01 bet once the quota is exactly exhausted", () => {
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 12, monto_usd: 10.0 }],
    });

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 12, monto_usd: 0.01 }],
      })
    ).toThrowError(/CUPO_AGOTADO/);
  });

  it("B4.5 should atomically reject multi-play ticket when first play is valid but second play overflows quota", () => {
    // Animal 14 has $9.00 accumulated
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 14, monto_usd: 9.0 }],
    });

    const initialTicketsCount = sim.tickets.size;

    // Ticket with Animal 1 (new, valid $1.00) AND Animal 14 ($2.00, which exceeds $10.00 limit)
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [
          { sorteo_diario_id: 1, animal_numero: 1, monto_usd: 1.0 },
          { sorteo_diario_id: 1, animal_numero: 14, monto_usd: 2.0 },
        ],
      })
    ).toThrowError(/CUPO_AGOTADO/);

    // Verify neither play was committed
    expect(sim.tickets.size).toBe(initialTicketsCount);
    const cupoAnimal1 = sim.cupos.get(
      "11111111-1111-4111-8111-111111111111_1_1"
    );
    expect(cupoAnimal1?.monto_acumulado_usd).toBe(0.0);
  });
});
