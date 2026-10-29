import { describe, it, expect, beforeEach, vi } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";
import { construirMensajeWhatsAppTicket } from "@/lib/hardware/whatsapp";
import { pagarTicketGanador } from "@/lib/actions/transacciones";

vi.mock("@/lib/supabase/server", () => {
  return {
    createServerSupabaseClient: () => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "aaaa1111-1111-4111-8111-111111111111" } },
          error: null,
        }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  };
});

describe("Tier 3 - Cross-Feature Pairwise Combinations", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  // Pairwise 1: Bet + WhatsApp + Cancel
  it("C1. Bet + WhatsApp + Cancellation: issue ticket with WhatsApp, dispatch receipt, then cancel within 60s and verify quota release", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 5.0 }],
      p_cliente_telefono: "0414-1234567",
      p_canal_entrega: "WHATSAPP",
    });

    const msg = construirMensajeWhatsAppTicket({
      comercioNombre: "Bodega Piloto Magaly",
      comercioRif: "J-40123987-1",
      comercioTelefono: "+58 414-1234567",
      serialCorto: res.serial_corto,
      fechaHoraEmision: "29/10/2026 08:30:00 AM",
      tasaBcv: res.tasa_cambio,
      totalUsd: res.total_usd,
      totalBs: res.total_bs,
      codigoSeguridadHmac: res.codigo_seguridad,
      qrPayload: `BANCAPRO|${res.tenant_id}|${res.ticket_id}|${res.total_usd.toFixed(2)}|${res.timestamp_epoch}|${res.codigo_seguridad}`,
      clienteTelefono: "0414-1234567",
      items: [
        {
          sorteoHora: "09:00 AM",
          codigoAnimal: "05",
          nombreAnimal: "León",
          montoUsd: 5.0,
          premioPotencialUsd: 150.0,
        },
      ],
    });

    expect(msg).toContain(String(res.serial_corto));
    expect(sim.cupos.get("11111111-1111-4111-8111-111111111111_1_5")?.monto_acumulado_usd).toBe(5.0);

    // Cancel 30 seconds later
    sim.setMockTime("2026-10-29T08:30:30-04:00");
    const anular = sim.anularTicketRpc(res.ticket_id);
    expect(anular.estado).toBe("ANULADO");

    // Verify quota reverted to 0
    expect(sim.cupos.get("11111111-1111-4111-8111-111111111111_1_5")?.monto_acumulado_usd).toBe(0.0);
  });

  // Pairwise 2: Bet + Lockdown + Attempted Cancel (Precedence of Lockdown over 60s rule)
  it("C2. Bet + Lockdown + Cancel: ticket issued 10s before lockdown cannot be cancelled once lockdown is entered", () => {
    // Sorteo 1 is at 09:00:00 AM (lockdown at 08:57:00 AM)
    sim.setMockTime("2026-10-29T08:56:50-04:00");
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 2.0 }],
    });

    // Advance to 08:57:15 AM (25s elapsed, <60s, but lockdown active)
    sim.setMockTime("2026-10-29T08:57:15-04:00");

    expect(() => sim.anularTicketRpc(res.ticket_id)).toThrowError(/SORTEO_EN_LOCKDOWN/);
  });

  // Pairwise 3: Multi-Bet + Quota Exhaustion + Atomic Rollback
  it("C3. Multi-Bet + Quota Exhaustion + Rollback: ticket with valid Play A and overflowing Play B leaves both unpersisted", () => {
    // Set Animal 12 at $9.00
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 12, monto_usd: 9.0 }],
    });

    const initialTickets = sim.tickets.size;

    // Bet $1.00 on Animal 14 (valid) and $2.00 on Animal 12 (overflows $10.00 limit)
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [
          { sorteo_diario_id: 1, animal_numero: 14, monto_usd: 1.0 },
          { sorteo_diario_id: 1, animal_numero: 12, monto_usd: 2.0 },
        ],
      })
    ).toThrowError(/CUPO_AGOTADO/);

    expect(sim.tickets.size).toBe(initialTickets);
    // Animal 14 should NOT have accumulated any quota
    expect(sim.cupos.get("11111111-1111-4111-8111-111111111111_1_14")?.monto_acumulado_usd).toBe(0.0);
  });

  // Pairwise 4: Settlement + Payout + Duplicate Payout (Idempotency)
  it("C4. Settlement + Payout + Idempotency: draw settled, prize paid, subsequent attempt rejected with TICKET_YA_PAGADO", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 20, monto_usd: 3.0 }],
    });

    sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 20 });

    const pago = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago.estado).toBe("PAGADO");
    expect(pago.premio_pagado_usd).toBe(90.0);

    // Duplicate attempt
    expect(() => sim.pagarTicketGanadorRpc(res.codigo_seguridad)).toThrowError(/TICKET_YA_PAGADO/);
  });

  // Pairwise 5: Multi-Sorteo Ticket + Partial Settlement + Payout Blocked until all draws resolved
  it("C5. Multi-Draw Ticket + Partial Settlement: won Draw 1 cannot be paid while Draw 2 is open; paying succeeds once Draw 2 resolves", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [
        { sorteo_diario_id: 1, animal_numero: 5, monto_usd: 2.0 }, // Draw 1 (09:00 AM)
        { sorteo_diario_id: 2, animal_numero: 8, monto_usd: 2.0 }, // Draw 2 (10:00 AM)
      ],
    });

    // Liquidate Draw 1: animal 5 wins!
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 5 });

    // Payout attempt while Draw 2 is still pending MUST be rejected with SORTEOS_PENDIENTES
    expect(() => sim.pagarTicketGanadorRpc(res.codigo_seguridad)).toThrowError(/SORTEOS_PENDIENTES/);

    // Liquidate Draw 2: animal 10 wins (play 2 loses)
    sim.liquidarSorteoRpc({ p_sorteo_id: 2, p_animal_ganador: 10 });

    // Now all draws are resolved, ticket is GANADOR ($60.00 prize from Draw 1)
    const pago = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago.estado).toBe("PAGADO");
    expect(pago.premio_pagado_usd).toBe(60.0);
  });

  // Pairwise 6: Multi-Tenant Bet + Quota Independence
  it("C6. Multi-Tenant Bet + Quota Isolation: Tenant 1 exhausting quota on animal does not impede Tenant 2", () => {
    // Tenant 1 exhausts Animal 1 ($10.00)
    sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 10.0 }],
    });

    // Tenant 1 rejected
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 1.0 }],
      })
    ).toThrowError(/CUPO_AGOTADO/);

    // Switch to Tenant 2 cashier
    const cajeroT2 = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(cajeroT2);

    const resT2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 10.0 }],
    });
    expect(resT2.ticket_id).toBeDefined();
  });

  // Pairwise 7: BCV Rate Update + Ticket Emission + Payout Rate Alignment
  it("C7. BCV Update + Emission + Payout: ticket captures frozen rate; prize converts at latest BCV rate", () => {
    // Initial rate = 45.85
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 25, monto_usd: 1.0 }],
    });
    expect(sim.tickets.get(res.ticket_id)?.tasa_cambio).toBe(45.85);

    // Liquidate draw -> wins $30.00
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 25 });

    // BCV rate updates to 50.00 before customer comes to claim prize
    sim.actualizarTasaBcv(50.0);

    const pago = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago.premio_pagado_usd).toBe(30.0);
    // Payout in Bolívares uses latest BCV rate (30 * 50 = Bs. 1500)
    expect(pago.premio_pagado_bs).toBe(1500.0);
    expect(pago.tasa_aplicada).toBe(50.0);
  });

  // Pairwise 8: Settlement with Special Animal 00 (Ballena = dbNumber 37) + 30x Multiplier
  it("C8. Settlement with Ballena 00 (37) + 30x Multiplier: validates numeric encoding and prize calculation", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 37, monto_usd: 2.0 }],
    });

    const liq = sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 37 });
    expect(liq.jugadas_ganadoras).toBe(1);
    expect(liq.premios_generados_usd).toBe(60.0); // 2 * 30

    const pago = sim.pagarTicketGanadorRpc(res.codigo_seguridad);
    expect(pago.premio_pagado_usd).toBe(60.0);
  });

  // Pairwise 9: Ticket Cancellation + Subsequent Draw Settlement (Cancelled ticket receives zero prize)
  it("C9. Cancelled Ticket + Settlement: cancelled ticket whose animal wins draw remains ANULADO with 0 prize", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 11, monto_usd: 5.0 }],
    });

    sim.anularTicketRpc(res.ticket_id);
    expect(sim.tickets.get(res.ticket_id)?.estado).toBe("ANULADO");

    // Animal 11 wins draw
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 11 });

    const ticketInDb = sim.tickets.get(res.ticket_id)!;
    expect(ticketInDb.estado).toBe("ANULADO");
    expect(ticketInDb.premio_total_usd).toBe(0.0);
  });

  // Pairwise 10: Anti-Fraud QR Verification + Tampered Amount Rejection before DB lookup
  it("C10. Anti-Fraud QR Verification: forged QR payload with manipulated prize is caught by HMAC verification", async () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 7, monto_usd: 2.0 }],
    });

    // Fraudulent attempt: change $2.00 to $200.00 in QR text
    const forgedQr = `BANCAPRO|${res.tenant_id}|${res.ticket_id}|200.00|${res.timestamp_epoch}|${res.codigo_seguridad}`;
    const payoutRes = await pagarTicketGanador(forgedQr);

    expect(payoutRes.ok).toBe(false);
    expect(payoutRes.error).toMatch(/ALERTA ANTI-FRAUDE/i);
  });

  // Pairwise 11: Consecutive Bets Reaching Exact Quota Capacity + Next Rejected Atomically
  it("C11. Quota Capacity Stress: 10 consecutive $1.00 bets fill quota to exact capacity; 11th bet rejected", () => {
    for (let i = 1; i <= 10; i++) {
      const res = sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 3, monto_usd: 1.0 }],
      });
      expect(res.ticket_id).toBeDefined();
    }

    const cupo = sim.cupos.get("11111111-1111-4111-8111-111111111111_1_3")!;
    expect(cupo.monto_acumulado_usd).toBe(10.0);

    // 11th bet MUST be rejected
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 3, monto_usd: 0.5 }],
      })
    ).toThrowError(/CUPO_AGOTADO/);
  });
});
