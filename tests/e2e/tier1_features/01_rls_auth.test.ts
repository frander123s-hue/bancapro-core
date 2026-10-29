import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 01: Multi-Tenant RLS & GoTrue Auth Isolation", () => {
  let sim: BancaProSimulator;

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("1.1 should authenticate seeded tenant admin (Magaly Rodríguez) and load tenant context", () => {
    const magalyId = "aaaa1111-1111-4111-8111-111111111111";
    sim.setCurrentUser(magalyId);

    const user = sim.usuarios.get(magalyId);
    expect(user).toBeDefined();
    expect(user?.email).toBe("magaly.rodriguez@bancapro.local");
    expect(user?.rol).toBe("admin_comercio");
    expect(user?.tenant_id).toBe("11111111-1111-4111-8111-111111111111");

    const tenant = sim.tenants.get(user!.tenant_id!);
    expect(tenant?.nombre).toBe("Bodega Piloto Magaly");
    expect(tenant?.rif).toBe("J-40123987-1");
    expect(tenant?.perdida_maxima_sorteo_usd).toBe(300.0);
  });

  it("1.2 should strictly prevent anonymous (unauthenticated) users from emitting tickets", () => {
    sim.setCurrentUser(null);

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }],
      })
    ).toThrowError(/NO_AUTORIZADO/);
  });

  it("1.3 should prevent users with inactive tenant from emitting tickets", () => {
    const magalyId = "aaaa1111-1111-4111-8111-111111111111";
    sim.setCurrentUser(magalyId);

    const tenant = sim.tenants.get("11111111-1111-4111-8111-111111111111")!;
    tenant.activo = false;

    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }],
      })
    ).toThrowError(/TENANT_INVALIDO/);
  });

  it("1.4 should isolate ticket records under RLS so Tenant 1 operator cannot cancel Tenant 2 ticket", () => {
    // Tenant 2 cashier issues ticket
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);
    const resT2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 3.0 }],
    });
    expect(resT2.ticket_id).toBeDefined();

    // Tenant 1 operator attempts to cancel Tenant 2's ticket
    const cajeroT1 = "bbbb2222-2222-4222-8222-222222222222";
    sim.setCurrentUser(cajeroT1);

    expect(() => sim.anularTicketRpc(resT2.ticket_id)).toThrowError(
      /TICKET_NO_ENCONTRADO/
    );
  });

  it("1.5 should isolate winning ticket payout so Tenant 1 cashier cannot pay Tenant 2 ticket", () => {
    // Tenant 2 cashier issues ticket
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);
    const ticketT2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 7, monto_usd: 1.0 }],
    });

    // Liquidate draw with animal 7 -> ticketT2 wins
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, animal_ganador: 7 });

    const ticketInDb = sim.tickets.get(ticketT2.ticket_id)!;
    expect(ticketInDb.estado).toBe("GANADOR");

    // Tenant 1 cashier attempts to claim and pay Tenant 2's ticket
    const cajeroT1 = "bbbb2222-2222-4222-8222-222222222222";
    sim.setCurrentUser(cajeroT1);

    expect(() =>
      sim.pagarTicketGanadorRpc(ticketT2.codigo_seguridad)
    ).toThrowError(/TICKET_NO_ENCONTRADO/);
  });
});
