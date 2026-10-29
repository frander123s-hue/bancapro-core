import { describe, it, expect, beforeEach } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";

describe("Tier 1 - Feature 04: Atomic Risk Quota Calculation & Rollback", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("4.1 should correctly calculate Max Quota per Animal = Acceptable Max Loss / 30 ($10.00 for $300 loss)", () => {
    const tenant = sim.tenants.get("11111111-1111-4111-8111-111111111111")!;
    expect(tenant.perdida_maxima_sorteo_usd).toBe(300.0);

    const calculatedQuota = Number((tenant.perdida_maxima_sorteo_usd / 30).toFixed(2));
    expect(calculatedQuota).toBe(10.0);
  });

  it("4.2 should track cumulative bets per animal and allow sequential bets within quota", () => {
    // Bet 1: $4.00 on Animal 10 (Tigre)
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 4.0 }],
    });

    // Bet 2: $5.00 on Animal 10 (Total = $9.00 <= $10.00)
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 5.0 }],
    });

    const cupoKey = "11111111-1111-4111-8111-111111111111_1_10";
    const cupo = sim.cupos.get(cupoKey);
    expect(cupo?.monto_acumulado_usd).toBe(9.0);
    expect(cupo?.cupo_maximo_usd).toBe(10.0);
  });

  it("4.3 should reject bet exceeding available quota and trigger atomic rollback with CUPO_AGOTADO", () => {
    // Fill quota to $8.00 on Animal 15 (Zorro)
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 15, monto_usd: 8.0 }],
    });

    const initialTicketsCount = sim.tickets.size;
    const initialMovimientosCount = sim.movimientos.length;

    // Attempt to bet $3.00 (8.0 + 3.0 = 11.0 > 10.0 max)
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 15, monto_usd: 3.0 }],
      })
    ).toThrowError(/CUPO_AGOTADO/);

    // Verify atomic rollback: no new ticket or ledger entry created
    expect(sim.tickets.size).toBe(initialTicketsCount);
    expect(sim.movimientos.length).toBe(initialMovimientosCount);

    // Cumulative amount remains at $8.00
    const cupoKey = "11111111-1111-4111-8111-111111111111_1_15";
    expect(sim.cupos.get(cupoKey)?.monto_acumulado_usd).toBe(8.0);
  });

  it("4.4 should track quotas for different animals independently within the same draw", () => {
    // Bet full $10.00 on Animal 5 (León)
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 10.0 }],
    });

    // Betting $10.00 on Animal 6 (Rana) should succeed because quotas are per-animal
    const resRana = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 6, monto_usd: 10.0 }],
    });

    expect(resRana.ticket_id).toBeDefined();

    const cupoLeon = sim.cupos.get("11111111-1111-4111-8111-111111111111_1_5");
    const cupoRana = sim.cupos.get("11111111-1111-4111-8111-111111111111_1_6");
    expect(cupoLeon?.monto_acumulado_usd).toBe(10.0);
    expect(cupoRana?.monto_acumulado_usd).toBe(10.0);
  });

  it("4.5 should isolate quotas between different tenants so Tenant 1 does not exhaust Tenant 2 quota", () => {
    // Tenant 1 bets $10.00 on Animal 20 (Cochino)
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 20, monto_usd: 10.0 }],
    });

    // Tenant 1 quota is now exhausted for Animal 20
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 20, monto_usd: 1.0 }],
      })
    ).toThrowError(/CUPO_AGOTADO/);

    // Switch to Tenant 2 cashier: Tenant 2 has $600 loss limit -> $20.00 quota
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);

    const resT2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 20, monto_usd: 15.0 }],
    });

    expect(resT2.ticket_id).toBeDefined();
    const cupoT2 = sim.cupos.get("22222222-2222-4222-8222-222222222222_1_20");
    expect(cupoT2?.monto_acumulado_usd).toBe(15.0);
    expect(cupoT2?.cupo_maximo_usd).toBe(20.0);
  });
});
