import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 07: Exact Cancellation Time Boundaries (59s / 60s / 61s)", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
  });

  it("B7.1 should allow ticket cancellation at exactly 59 seconds post-issuance", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 2, monto_usd: 1.0 }],
    });

    // Advance by 59 seconds
    sim.setMockTime("2026-10-29T08:30:59-04:00");
    const anulacion = sim.anularTicketRpc(res.ticket_id);

    expect(anulacion.estado).toBe("ANULADO");
  });

  it("B7.2 should allow ticket cancellation at exactly 60 seconds post-issuance", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 3, monto_usd: 1.0 }],
    });

    // Advance by exactly 60 seconds
    sim.setMockTime("2026-10-29T08:31:00-04:00");
    const anulacion = sim.anularTicketRpc(res.ticket_id);

    expect(anulacion.estado).toBe("ANULADO");
  });

  it("B7.3 should reject ticket cancellation at exactly 61 seconds post-issuance", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 4, monto_usd: 1.0 }],
    });

    // Advance by 61 seconds
    sim.setMockTime("2026-10-29T08:31:01-04:00");

    expect(() => sim.anularTicketRpc(res.ticket_id)).toThrowError(
      /TIEMPO_ANULACION_EXPIRADO/
    );
  });

  it("B7.4 should reject cancellation at exactly 08:57:00 AM (start of 3-min lockdown) even if issued 5 seconds ago", () => {
    // Sorteo 1 is at 09:00:00 AM. Issue at 08:56:55 AM
    sim.setMockTime("2026-10-29T08:56:55-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
    });

    // Advance by only 5 seconds to 08:57:00 AM (lockdown starts)
    sim.setMockTime("2026-10-29T08:57:00-04:00");

    expect(() => sim.anularTicketRpc(res.ticket_id)).toThrowError(
      /SORTEO_EN_LOCKDOWN/
    );
  });

  it("B7.5 should reject attempting to cancel an already-cancelled ticket", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 6, monto_usd: 1.0 }],
    });

    sim.setMockTime("2026-10-29T08:30:10-04:00");
    sim.anularTicketRpc(res.ticket_id);

    // Second cancellation attempt
    expect(() => sim.anularTicketRpc(res.ticket_id)).toThrowError(
      /ESTADO_NO_ANULABLE/
    );
  });
});
