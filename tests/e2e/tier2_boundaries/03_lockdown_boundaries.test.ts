import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 03: Exact Lockdown Window Boundaries (T-3m)", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
  });

  it("B3.1 should allow bet at exactly T - 181 seconds (08:56:59 AM for 09:00:00 AM draw)", () => {
    // Sorteo 1 is at 09:00:00 AM. 3 minutes prior is 08:57:00 AM.
    // 08:56:59 AM is 181 seconds prior (still open).
    sim.setMockTime("2026-10-29T08:56:59-04:00");

    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
    });

    expect(res.ticket_id).toBeDefined();
  });

  it("B3.2 should reject bet at exact T - 180 seconds boundary (08:57:00 AM for 09:00:00 AM draw)", () => {
    // Exact lockdown start: 08:57:00 AM
    sim.setMockTime("2026-10-29T08:57:00-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });

  it("B3.3 should reject bet at T - 179 seconds (08:57:01 AM for 09:00:00 AM draw)", () => {
    sim.setMockTime("2026-10-29T08:57:01-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });

  it("B3.4 should reject bet placed at exact draw time (09:00:00 AM for 09:00:00 AM draw)", () => {
    sim.setMockTime("2026-10-29T09:00:00-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });

  it("B3.5 should reject bet placed after draw time (09:00:01 AM for 09:00:00 AM draw)", () => {
    sim.setMockTime("2026-10-29T09:00:01-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });
});
