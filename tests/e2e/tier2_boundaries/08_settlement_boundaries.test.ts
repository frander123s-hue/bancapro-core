import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 08: Draw Settlement Value & Code Boundaries (0..37)", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("B8.1 should correctly settle draw with lower boundary animal 0 (Delfín)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 0, monto_usd: 1.0 }],
    });

    const liq = sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 0 });
    expect(liq.animal_ganador).toBe(0);
    expect(liq.jugadas_ganadoras).toBe(1);

    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("GANADOR");
    expect(sim.tickets.get(res.ticket_id)?.premio_total_usd).toBe(30.0);
  });

  it("B8.2 should correctly settle draw with upper boundary animal 37 (Ballena 00)", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 2, animal_numero: 37, monto_usd: 2.0 }],
    });

    const liq = sim.liquidarSorteoRpc({ p_sorteo_id: 2, p_animal_ganador: 37 });
    expect(liq.animal_ganador).toBe(37);
    expect(liq.jugadas_ganadoras).toBe(1);

    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("GANADOR");
    expect(sim.tickets.get(res.ticket_id)?.premio_total_usd).toBe(60.0);
  });

  it("B8.3 should reject settlement with negative animal number (-1)", () => {
    expect(() =>
      sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: -1 })
    ).toThrowError(/ANIMAL_INVALIDO/);
  });

  it("B8.4 should reject settlement with animal number exceeding 37 (e.g. 38 or 99)", () => {
    expect(() =>
      sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 38 })
    ).toThrowError(/ANIMAL_INVALIDO/);

    expect(() =>
      sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 99 })
    ).toThrowError(/ANIMAL_INVALIDO/);
  });

  it("B8.5 should reject settlement for non-existent sorteo_diario_id (e.g. 99999)", () => {
    expect(() =>
      sim.liquidarSorteoRpc({ p_sorteo_id: 99999, p_animal_ganador: 10 })
    ).toThrowError(/SORTEO_NO_ENCONTRADO/);
  });
});
