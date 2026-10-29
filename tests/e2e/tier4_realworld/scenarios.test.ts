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

describe("Tier 4 - Real-World Application Workload Scenarios", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  // Scenario 1: Complete Betting Lifecycle from Login to Prize Disbursement
  it("Scenario 1 (Full Lifecycle): Cashier login -> Multi-item ticket -> WhatsApp dispatch -> Claim inspect -> Draw lockdown -> Settlement -> QR/PIN payout -> Cash drawer reconciliation", async () => {
    // 1. Authenticate Cashier
    const cashier = sim.usuarios.get(magalyId)!;
    expect(cashier.rol).toBe("admin_comercio");
    const tenant = sim.tenants.get(cashier.tenant_id!)!;
    expect(tenant.nombre).toBe("Bodega Piloto Magaly");

    // 2. Customer places multi-item bet:
    //    - Draw 1 (09:00 AM): #10 Tigre, $3.00
    //    - Draw 1 (09:00 AM): #25 Gallina, $2.00
    const resTicket = sim.emitirTicketRpc({
      p_jugadas: [
        { sorteo_diario_id: 1, animal_numero: 10, monto_usd: 3.0 },
        { sorteo_diario_id: 1, animal_numero: 25, monto_usd: 2.0 },
      ],
      p_cliente_telefono: "0414-9988776",
      p_canal_entrega: "WHATSAPP",
    });

    expect(resTicket.serial_corto).toBeDefined();
    expect(resTicket.total_usd).toBe(5.0);
    expect(resTicket.total_bs).toBe(Number((5.0 * 45.85).toFixed(2)));

    // 3. Format and dispatch digital WhatsApp receipt
    const waText = construirMensajeWhatsAppTicket({
      comercioNombre: tenant.nombre,
      comercioRif: tenant.rif,
      comercioTelefono: tenant.telefono,
      serialCorto: resTicket.serial_corto,
      fechaHoraEmision: "29/10/2026 08:30:00 AM",
      tasaBcv: resTicket.tasa_cambio,
      totalUsd: resTicket.total_usd,
      totalBs: resTicket.total_bs,
      codigoSeguridadHmac: resTicket.codigo_seguridad,
      qrPayload: `BANCAPRO|${resTicket.tenant_id}|${resTicket.ticket_id}|${resTicket.total_usd.toFixed(2)}|${resTicket.timestamp_epoch}|${resTicket.codigo_seguridad}`,
      clienteTelefono: "0414-9988776",
      urlVerificacionPublica: "https://bancapro-core-venezuela.vercel.app",
      items: [
        {
          sorteoHora: "09:00 AM",
          codigoAnimal: "10",
          nombreAnimal: "Tigre",
          montoUsd: 3.0,
          premioPotencialUsd: 90.0,
        },
        {
          sorteoHora: "09:00 AM",
          codigoAnimal: "25",
          nombreAnimal: "Gallina",
          montoUsd: 2.0,
          premioPotencialUsd: 60.0,
        },
      ],
    });

    expect(waText).toContain(String(resTicket.serial_corto));
    expect(waText).toContain("Premio 30x: $90.00");
    expect(waText).toContain("Premio 30x: $60.00");

    // 4. Time advances to 08:58:00 AM (Lockdown is now active for 09:00 AM draw)
    sim.setMockTime("2026-10-29T08:58:00-04:00");
    expect(() =>
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.0 }],
      })
    ).toThrowError(/LOCKDOWN_ACTIVO/);

    // 5. Draw results arrive: winning animal is #10 (Tigre)
    sim.setMockTime("2026-10-29T09:05:00-04:00");
    const settlement = sim.liquidarSorteoRpc({
      p_sorteo_id: 1,
      p_animal_ganador: 10,
      p_metodo: "AUTO_CRON",
    });

    expect(settlement.jugadas_ganadoras).toBe(1);
    expect(settlement.premios_generados_usd).toBe(90.0); // 3.0 * 30

    // Ticket in database should now be GANADOR with $90.00 prize
    const ticketInDb = sim.tickets.get(resTicket.ticket_id)!;
    expect(ticketInDb.estado).toBe("GANADOR");
    expect(ticketInDb.premio_total_usd).toBe(90.0);

    // 6. Customer arrives at cashier to claim prize using customer PIN (serial-HASH8)
    const pin = `${resTicket.serial_corto}-${resTicket.codigo_seguridad.slice(0, 8).toUpperCase()}`;
    const pago = sim.pagarTicketGanadorRpc(pin);

    expect(pago.estado).toBe("PAGADO");
    expect(pago.premio_pagado_usd).toBe(90.0);
    expect(pago.premio_pagado_bs).toBe(Number((90.0 * 45.85).toFixed(2)));

    // 7. Re-payout attempt is rejected idempotently
    expect(() => sim.pagarTicketGanadorRpc(pin)).toThrowError(/TICKET_YA_PAGADO/);

    // 8. Reconcile cash drawer ledger
    const ticketMovs = sim.movimientos.filter((m) => m.ticket_id === resTicket.ticket_id);
    expect(ticketMovs).toHaveLength(2); // VENTA (+5.00) and PAGO_PREMIO (-90.00)
    const ventaMov = ticketMovs.find((m) => m.tipo === "VENTA")!;
    const pagoMov = ticketMovs.find((m) => m.tipo === "PAGO_PREMIO")!;
    expect(ventaMov.monto_usd).toBe(5.0);
    expect(pagoMov.monto_usd).toBe(-90.0);
    const balanceNeto = ventaMov.monto_usd + pagoMov.monto_usd;
    expect(balanceNeto).toBe(-85.0);
  });

  // Scenario 2: Cashier Rush Hour with Quota Limits & Overrun Handling
  it("Scenario 2 (Rush Hour & Quotas): Rapid bets on popular animal -> Quota exceeded -> Atomic rollback prevents ghost ticket -> Customer places valid residual bet", () => {
    // Bodega Piloto Magaly has $300 loss limit -> $10.00 quota per animal per draw
    // Customer 1 bets $4.00 on Animal 10 (Tigre)
    const t1 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 4.0 }],
    });
    expect(t1.ticket_id).toBeDefined();

    // Customer 2 bets $4.50 on Animal 10 (Total = $8.50 <= $10.00)
    const t2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 4.5 }],
    });
    expect(t2.ticket_id).toBeDefined();

    // Customer 3 attempts to bet $3.00 on Animal 10 ($8.50 + $3.00 = $11.50 > $10.00)
    const ticketsBefore = sim.tickets.size;
    const movimientosBefore = sim.movimientos.length;

    let errorThrown: string | undefined;
    try {
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 3.0 }],
      });
    } catch (e: any) {
      errorThrown = e.message;
    }

    expect(errorThrown).toContain("CUPO_AGOTADO");
    expect(errorThrown).toContain("Disponible: $1.50 USD");

    // Atomic Rollback Verification: no ghost ticket created, no ledger entry
    expect(sim.tickets.size).toBe(ticketsBefore);
    expect(sim.movimientos.length).toBe(movimientosBefore);

    // Customer 3 adapts: bets the remaining $1.50 available quota
    const t3 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 10, monto_usd: 1.5 }],
    });
    expect(t3.ticket_id).toBeDefined();

    // Total accumulated on Animal 10 is now exactly $10.00 (100% capacity)
    const cupo = sim.cupos.get("11111111-1111-4111-8111-111111111111_1_10")!;
    expect(cupo.monto_acumulado_usd).toBe(10.0);
  });

  // Scenario 3: Ticket Cancellation Race & Lockdown Precedence
  it("Scenario 3 (Cancellation Race): Customer cancels within 20s (succeeds) -> Buys second ticket -> Sorteo enters lockdown -> Cancellation attempt fails due to lockdown precedence", () => {
    // Sorteo 1 is at 09:00:00 AM (lockdown starts at 08:57:00 AM)
    sim.setMockTime("2026-10-29T08:50:00-04:00");

    // Issue ticket 1 ($4.00 on Animal 2)
    const t1 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 2, monto_usd: 4.0 }],
    });

    // 20 seconds later (08:50:20 AM), customer changes their mind and cancels
    sim.setMockTime("2026-10-29T08:50:20-04:00");
    const anular1 = sim.anularTicketRpc(t1.ticket_id);
    expect(anular1.estado).toBe("ANULADO");
    expect(sim.cupos.get("11111111-1111-4111-8111-111111111111_1_2")?.monto_acumulado_usd).toBe(0.0);

    // Customer decides to play Animal 5 instead, issued at 08:56:50 AM (10s before lockdown)
    sim.setMockTime("2026-10-29T08:56:50-04:00");
    const t2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 5.0 }],
    });

    // 15 seconds later (08:57:05 AM), customer asks to cancel.
    // Elapsed time is only 15 seconds (<60s), BUT lockdown has started (08:57:00 AM)
    sim.setMockTime("2026-10-29T08:57:05-04:00");

    expect(() => sim.anularTicketRpc(t2.ticket_id)).toThrowError(/SORTEO_EN_LOCKDOWN/);

    // Ticket remains active in EMITIDO state
    expect(sim.tickets.get(t2.ticket_id)?.estado).toBe("EMITIDO");
  });

  // Scenario 4: Multi-Tenant Cross-Access Isolation & Security Breach Attempt
  it("Scenario 4 (Multi-Tenant Security): Tenant 1 & Tenant 2 concurrent bets -> Malicious cross-tenant cancellation & payout breaches are strictly prevented", () => {
    // 1. Tenant 1 cashier Magaly issues Ticket 1
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const t1 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 7, monto_usd: 5.0 }],
    });

    // 2. Tenant 2 cashier Pedro issues Ticket 2 on the same animal
    const pedroT2Id = "cccc3333-3333-4333-8333-333333333333";
    sim.setCurrentUser(pedroT2Id);
    const t2 = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 7, monto_usd: 12.0 }],
    });

    // 3. Security Breach Attempt 1: Tenant 2 cashier tries to cancel Tenant 1's ticket
    expect(() => sim.anularTicketRpc(t1.ticket_id)).toThrowError(/TICKET_NO_ENCONTRADO/);

    // 4. Draw settles: Animal 7 wins! Both tickets are winners.
    sim.liquidarSorteoRpc({ p_sorteo_id: 1, p_animal_ganador: 7 });

    expect(sim.tickets.get(t1.ticket_id)?.estado).toBe("GANADOR");
    expect(sim.tickets.get(t2.ticket_id)?.estado).toBe("GANADOR");

    // 5. Security Breach Attempt 2: Tenant 2 cashier tries to pay Tenant 1's ticket at Tenant 2 taquilla
    expect(() => sim.pagarTicketGanadorRpc(t1.codigo_seguridad)).toThrowError(/TICKET_NO_ENCONTRADO/);

    // 6. Tenant 2 pays their own ticket: succeeds
    const pagoT2 = sim.pagarTicketGanadorRpc(t2.codigo_seguridad);
    expect(pagoT2.estado).toBe("PAGADO");
    expect(pagoT2.premio_pagado_usd).toBe(360.0); // 12.0 * 30

    // 7. Switch back to Tenant 1: Tenant 1 pays their own ticket: succeeds
    sim.setCurrentUser(magalyId);
    const pagoT1 = sim.pagarTicketGanadorRpc(t1.codigo_seguridad);
    expect(pagoT1.estado).toBe("PAGADO");
    expect(pagoT1.premio_pagado_usd).toBe(150.0); // 5.0 * 30
  });

  // Scenario 5: Automated Daily Cron Cycle (BCV Sync & Daily Results Liquidation)
  it("Scenario 5 (Automation Cycle): BCV rate updates -> Day schedules 11 draws -> Tickets issued -> Cron liquidates draws automatically with 30x prizes", () => {
    // 1. Scheduled BCV Cron runs at 06:00 AM: updates rate to 49.50
    sim.setMockTime("2026-10-29T06:00:00-04:00");
    const nuevaTasa = sim.actualizarTasaBcv(49.5);
    expect(nuevaTasa.tasa).toBe(49.5);
    expect(sim.getLatestTasa()).toBe(49.5);

    // 2. Daily draws (11 draws from 09:00 AM to 07:00 PM) are open
    expect(sim.sorteos.size).toBe(11);

    // 3. Morning tickets are issued at 08:30 AM
    sim.setMockTime("2026-10-29T08:30:00-04:00");
    const tMorning = sim.emitirTicketRpc({
      p_jugadas: [
        { sorteo_diario_id: 1, animal_numero: 21, monto_usd: 2.0 }, // 09:00 AM
        { sorteo_diario_id: 2, animal_numero: 31, monto_usd: 3.0 }, // 10:00 AM
      ],
    });
    expect(tMorning.tasa_cambio).toBe(49.5);
    expect(tMorning.total_bs).toBe(Number((5.0 * 49.5).toFixed(2)));

    // 4. Automated Results Cron runs at 09:10 AM for Draw 1: Animal 21 wins
    sim.setMockTime("2026-10-29T09:10:00-04:00");
    const liqDraw1 = sim.liquidarSorteoRpc({
      p_sorteo_id: 1,
      p_animal_ganador: 21,
      p_metodo: "AUTO_CRON",
    });
    expect(liqDraw1.estado).toBe("LIQUIDADO");
    expect(liqDraw1.jugadas_ganadoras).toBe(1);

    // 5. Automated Results Cron runs at 10:10 AM for Draw 2: Animal 31 wins
    sim.setMockTime("2026-10-29T10:10:00-04:00");
    const liqDraw2 = sim.liquidarSorteoRpc({
      p_sorteo_id: 2,
      p_animal_ganador: 31,
      p_metodo: "AUTO_CRON",
    });
    expect(liqDraw2.estado).toBe("LIQUIDADO");
    expect(liqDraw2.jugadas_ganadoras).toBe(1);

    // Both plays won: total prize = (2*30) + (3*30) = $60 + $90 = $150.00 USD
    const ticketInDb = sim.tickets.get(tMorning.ticket_id)!;
    expect(ticketInDb.estado).toBe("GANADOR");
    expect(ticketInDb.premio_total_usd).toBe(150.0);

    // Payout converts at latest BCV rate
    const payout = sim.pagarTicketGanadorRpc(tMorning.codigo_seguridad);
    expect(payout.estado).toBe("PAGADO");
    expect(payout.premio_pagado_usd).toBe(150.0);
    expect(payout.premio_pagado_bs).toBe(Number((150.0 * 49.5).toFixed(2)));
  });
});
