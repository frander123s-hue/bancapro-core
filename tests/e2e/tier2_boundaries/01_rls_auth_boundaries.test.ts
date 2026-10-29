import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 2 - Boundary 01: Multi-Tenant RLS & Auth Edge Cases", () => {
  let sim: BancaProSimulator;

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("B1.1 should reject ticket emission when session userId is an empty string", () => {
    sim.setCurrentUser("");

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }],
      })
    ).toThrowError(/NO_AUTORIZADO/);
  });

  it("B1.2 should reject ticket emission if a user has no tenant assigned (e.g. superadmin trying cashier role)", () => {
    const superadminId = "dddd4444-4444-4444-8444-444444444444";
    sim.setCurrentUser(superadminId);

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }],
      })
    ).toThrowError(/TENANT_INVALIDO/);
  });

  it("B1.3 should reject operations if user account is deactivated (activo = false)", () => {
    const cajeroId = "bbbb2222-2222-4222-8222-222222222222";
    sim.setCurrentUser(cajeroId);
    const user = sim.usuarios.get(cajeroId)!;
    user.activo = false;

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }],
      })
    ).toThrowError(/NO_AUTORIZADO/);
  });

  it("B1.4 should reject ticket cancellation when caller is authenticated as another tenant", () => {
    // Tenant 1 cashier issues ticket
    const cajeroT1 = "bbbb2222-2222-4222-8222-222222222222";
    sim.setCurrentUser(cajeroT1);
    const resT1 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 1.0 }],
    });

    // Switch to Tenant 2 cashier
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);

    expect(() => sim.anularTicketRpc(resT1.ticket_id)).toThrowError(
      /TICKET_NO_ENCONTRADO/
    );
  });

  it("B1.5 should reject winning ticket payout when caller belongs to a different tenant", () => {
    const cajeroT1 = "bbbb2222-2222-4222-8222-222222222222";
    sim.setCurrentUser(cajeroT1);
    const resT1 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 2, monto_usd: 1.0 }],
    });

    // Settle draw so ticket wins
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 2 });

    // Tenant 2 attempts to redeem Tenant 1's prize
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);

    expect(() =>
      sim.pagarTicketGanadorRpc(resT1.codigo_seguridad)
    ).toThrowError(/TICKET_NO_ENCONTRADO/);
  });
});
