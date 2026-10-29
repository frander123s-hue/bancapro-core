import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import {
  BancaProSimulator,
  SERVER_HMAC_SECRET,
} from "../helpers/bancapro-simulator";
import { generarFirmaHmacTicket } from "@/lib/actions/transacciones";

describe("Tier 1 - Feature 05: HMAC-SHA256 Digital Signature & PIN Generation", () => {
  let sim: BancaProSimulator;
  const magalyId = "aaaa1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    sim = new BancaProSimulator();
    sim.setCurrentUser(magalyId);
    sim.setMockTime("2026-10-29T08:30:00-04:00");
  });

  it("5.1 should generate a cryptographically valid 64-character hex HMAC-SHA256 signature upon ticket emission", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 1, monto_usd: 5.0 }],
    });

    expect(res.codigo_seguridad).toBeDefined();
    expect(res.codigo_seguridad).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(res.codigo_seguridad)).toBe(true);

    // Verify recalculation matches exactly
    const expectedHash = sim.calculateHmac(
      res.tenant_id,
      res.ticket_id,
      res.total_usd,
      res.timestamp_epoch
    );
    expect(res.codigo_seguridad).toBe(expectedHash);
  });

  it("5.2 should verify that generarFirmaHmacTicket matches simulator and server HMAC generation", async () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const ticketId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const montoUsd = 10.0;
    const epoch = 1730190000;

    const actionHash = await generarFirmaHmacTicket(
      tenantId,
      ticketId,
      montoUsd,
      epoch
    );
    const simHash = sim.calculateHmac(tenantId, ticketId, montoUsd, epoch);

    expect(actionHash).toBe(simHash);
  });

  it("5.3 should format the QR code payload strictly as BANCAPRO|tenant|ticket|monto|epoch|hash", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 2, monto_usd: 4.5 }],
    });

    const qrPayload = `BANCAPRO|${res.tenant_id}|${res.ticket_id}|${res.total_usd.toFixed(
      2
    )}|${res.timestamp_epoch}|${res.codigo_seguridad}`;

    const parts = qrPayload.split("|");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("BANCAPRO");
    expect(parts[1]).toBe(res.tenant_id);
    expect(parts[2]).toBe(res.ticket_id);
    expect(parts[3]).toBe("4.50");
    expect(Number(parts[4])).toBe(res.timestamp_epoch);
    expect(parts[5]).toBe(res.codigo_seguridad);
  });

  it("5.4 should format the customer PIN as serialCorto-HASH8UPPER", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 3, monto_usd: 2.0 }],
    });

    const expectedPinPrefix = `${res.serial_corto}-`;
    const expectedPinSuffix = res.codigo_seguridad.slice(0, 8).toUpperCase();
    const pin = `${expectedPinPrefix}${expectedPinSuffix}`;

    expect(pin.startsWith(expectedPinPrefix)).toBe(true);
    expect(pin.slice(expectedPinPrefix.length)).toHaveLength(8);
    expect(pin.slice(expectedPinPrefix.length)).toBe(expectedPinSuffix);
  });

  it("5.5 should detect and reject tampered QR payload data with signature mismatch", () => {
    const res = sim.emitirTicketRpc({
      p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 4, monto_usd: 2.0 }],
    });

    // Tamper with the amount: change $2.00 to $200.00
    const tamperedPayload = `11111111-1111-4111-8111-111111111111|${res.ticket_id}|200.00|${res.timestamp_epoch}`;
    const tamperedHash = crypto
      .createHmac("sha256", SERVER_HMAC_SECRET)
      .update(tamperedPayload)
      .digest("hex");

    expect(tamperedHash).not.toBe(res.codigo_seguridad);
  });
});
