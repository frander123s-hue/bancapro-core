import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 03: 3-Minute Draw Lockdown Enforcement", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
  });

  it("3.1 should allow bet placement before the 3-minute lockdown window (e.g., at 08:50 AM for 09:00 AM draw)", () => {
    // Sorteo 1 is at 09:00:00 AM. Set time to 08:50:00 AM
    sim.setMockTime("2026-10-29T08:50:00-04:00");

    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 2.0 }],
    });

    expect(res.ok === undefined || res.ticket_id !== undefined).toBe(true);
    expect(res.ticket_id).toBeDefined();
  });

  it("3.2 should reject bet placement attempted during the 3-minute lockdown window (e.g., at 08:58 AM for 09:00 AM draw)", () => {
    // 08:58:00 AM is 2 minutes before 09:00:00 AM (within the 3m lockdown)
    sim.setMockTime("2026-10-29T08:58:00-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 2.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });

  it("3.3 should reject bet placement attempted at or after draw time (e.g., at 09:01 AM for 09:00 AM draw)", () => {
    sim.setMockTime("2026-10-29T09:01:00-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 2.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });

  it("3.4 should reject multi-draw ticket if any single draw has entered its 3-minute lockdown", () => {
    // Sorteo 1 (09:00 AM) is in lockdown at 08:58 AM, but Sorteo 2 (10:00 AM) is open
    sim.setMockTime("2026-10-29T08:58:00-04:00");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [
          { sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }, // Locked
          { sorteo_diario_id: 2, animal_numero: 5, monto_usd: 1.0 }, // Open
        ],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);
  });

  it("3.5 should reject bet if draw state is explicitly closed or liquidated", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");

    // Close sorteo 1
    const sorteo1 = sim.sorteos.get(1)!;
    sorteo1.estado = "CERRADO";

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
      })
    ).toThrowError(/SORTEO_CERRADO/);
  });
});
