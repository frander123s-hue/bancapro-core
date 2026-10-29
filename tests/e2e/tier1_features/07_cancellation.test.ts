import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 07: Ticket Cancellation Rules (<60s & Prior to Lockdown)", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
  });

  it("7.1 should allow cancellation within 60 seconds of issuance when draw is outside lockdown", () => {
    // Sorteo 1 is at 09:00:00 AM. Issue at 08:30:00 AM
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 11, monto_usd: 5.0 }],
    });

    // Cancel 30 seconds later (at 08:30:30 AM)
    sim.setMockTime("2026-10-29T08:30:30-04:00");
    const anularRes = sim.anularTicketRpc(res.ticket_id);

    expect(anularRes.estado).toBe("ANULADO");
    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("ANULADO");
  });

  it("7.2 should atomically revert risk quota upon successful cancellation", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 20, monto_usd: 4.0 }],
    });

    const cupoKey = "11111111-1111-4111-8111-111111111111_1_20";
    expect(sim.cupos.get(cupoKey)?.monto_acumulado_usd).toBe(4.0);

    // Cancel within 20s
    sim.setMockTime("2026-10-29T08:30:20-04:00");
    sim.anularTicketRpc(res.ticket_id);

    // Quota should revert to $0.00
    expect(sim.cupos.get(cupoKey)?.monto_acumulado_usd).toBe(0.0);
  });

  it("7.3 should record negative cash movement for drawer refund upon cancellation", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 22, monto_usd: 3.0 }],
    });

    sim.setMockTime("2026-10-29T08:30:15-04:00");
    sim.anularTicketRpc(res.ticket_id);

    const movAnulacion = sim.movimientos.find(
      (m) => m.ticket_id === res.ticket_id && m.tipo === "ANULACION"
    );
    expect(movAnulacion).toBeDefined();
    expect(movAnulacion?.monto_usd).toBe(-3.0);
  });

  it("7.4 should reject cancellation attempted more than 60 seconds post-issuance", () => {
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 30, monto_usd: 2.0 }],
    });

    // Advance time by 65 seconds (08:31:05 AM)
    sim.setMockTime("2026-10-29T08:31:05-04:00");

    expect(() => sim.anularTicketRpc(res.ticket_id)).toThrowError(
      /TIEMPO_ANULACION_EXPIRADO/
    );
  });

  it("7.5 should reject cancellation attempted during 3-minute lockdown even if under 60 seconds post-issuance", () => {
    // Sorteo 1 is at 09:00:00 AM (lockdown starts at 08:57:00 AM)
    // Issue ticket at 08:56:50 AM (10s before lockdown)
    sim.setMockTime("2026-10-29T08:56:50-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 33, monto_usd: 2.0 }],
    });

    // 20 seconds later (at 08:57:10 AM), only 20s have elapsed (<60s) BUT lockdown is active
    sim.setMockTime("2026-10-29T08:57:10-04:00");

    expect(() => sim.anularTicketRpc(res.ticket_id)).toThrowError(
      /SORTEO_EN_LOCKDOWN/
    );
  });
});
