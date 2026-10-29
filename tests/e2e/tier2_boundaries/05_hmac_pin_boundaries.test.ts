import { describe, it, expect, beforeEach, vi } from "vitest";
import { BancaProSimulator } from "../helpers/bancapro-simulator";
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

describe("Tier 2 - Boundary 05: HMAC QR / PIN Integrity & Anti-Tampering", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("B5.1 should reject QR code payload with fewer than 6 pipe segments", async () => {
    const malformedQr = "BANCAPRO|tenant|ticket|5.00";
    const res = await pagarTicketGanador(malformedQr);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Formato de código QR corrupto/i);
  });

  it("B5.2 should reject QR code payload with more than 6 pipe segments", async () => {
    const malformedQr = "BANCAPRO|tenant|ticket|5.00|1730000000|hash|extra_field";
    const res = await pagarTicketGanador(malformedQr);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Formato de código QR corrupto/i);
  });

  it("B5.3 should reject QR code payload if the HMAC signature does not match computed secret", async () => {
    const tamperedQr =
      "BANCAPRO|11111111-1111-4111-8111-111111111111|11111111-1111-1111-1111-111111111111|5.00|1730000000|0000000000000000000000000000000000000000000000000000000000000000";
    const res = await pagarTicketGanador(tamperedQr);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ALERTA ANTI-FRAUDE/i);
  });

  it("B5.4 should reject QR code payload if amount is altered by 1 cent even with valid format", async () => {
    const resTicket = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 5.0 }],
    });

    // Valid hash for $5.00, but QR claims $5.01
    const tamperedQr = `BANCAPRO|${resTicket.tenant_id}|${resTicket.ticket_id}|5.01|${resTicket.timestamp_epoch}|${resTicket.codigo_seguridad}`;
    const res = await pagarTicketGanador(tamperedQr);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ALERTA ANTI-FRAUDE/i);
  });

  it("B5.5 should reject QR code payload if tenantId is altered in the payload", async () => {
    const resTicket = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 5.0 }],
    });

    const foreignTenant = "99999999-9999-9999-9999-999999999999";
    const tamperedQr = `BANCAPRO|${foreignTenant}|${resTicket.ticket_id}|${resTicket.total_usd.toFixed(
      2
    )}|${resTicket.timestamp_epoch}|${resTicket.codigo_seguridad}`;
    const res = await pagarTicketGanador(tamperedQr);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ALERTA ANTI-FRAUDE/i);
  });
});
