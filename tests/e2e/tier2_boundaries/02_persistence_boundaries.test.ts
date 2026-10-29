import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 02: Transactional Persistence Edge Cases", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("B2.1 should reject emission with empty jugadas array", () => {
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [],
      })
    ).toThrowError(/ERROR_TRANSACCIONAL/);
  });

  it("B2.2 should reject play with zero amount ($0.00)", () => {
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 0.0 }],
      })
    ).toThrowError(/MONTO_INVALIDO/);
  });

  it("B2.3 should reject play with negative amount (-$5.00)", () => {
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: -5.0 }],
      })
    ).toThrowError(/MONTO_INVALIDO/);
  });

  it("B2.4 should reject play with NaN or infinite amount", () => {
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: NaN }],
      })
    ).toThrowError(/MONTO_INVALIDO/);
  });

  it("B2.5 should reject play with animal number out of range (< 0 or > 37)", () => {
    // Negative animal
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: -1, monto_usd: 1.0 }],
      })
    ).toThrowError(/ANIMAL_INVALIDO/);

    // Animal 38 (exceeds max 37)
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 38, monto_usd: 1.0 }],
      })
    ).toThrowError(/ANIMAL_INVALIDO/);
  });
});
