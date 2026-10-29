import { describe, it, expect } from "vitest";
import {
  normalizarTelefonoVenezuela,
  construirMensajeWhatsAppTicket,
  type DatosTicketWhatsApp,
} from "@/lib/hardware/whatsapp";

describe("Tier 2 - Boundary 09: WhatsApp Phone Normalization & Receipt Edge Cases", () => {
  it("B9.1 should normalize phone with parenthesis, dashes and spaces '(0414) 123-4567'", () => {
    expect(normalizarTelefonoVenezuela("(0414) 123-4567")).toBe("584141234567");
  });

  it("B9.2 should normalize 10-digit number without leading 0 ('4249998877' -> '584249998877')", () => {
    expect(normalizarTelefonoVenezuela("4249998877")).toBe("584249998877");
  });

  it("B9.3 should return empty string when input is empty or contains no digits", () => {
    expect(normalizarTelefonoVenezuela("")).toBe("");
    expect(normalizarTelefonoVenezuela("   ")).toBe("");
    expect(normalizarTelefonoVenezuela("INVALID_PHONE")).toBe("");
  });

  it("B9.4 should preserve existing international E.164 digits without country prefix alteration", () => {
    // Already in 58 format
    expect(normalizarTelefonoVenezuela("584141234567")).toBe("584141234567");
    // International number (e.g. Colombia +57)
    expect(normalizarTelefonoVenezuela("+57 300 1234567")).toBe("573001234567");
  });

  it("B9.5 should properly encode special characters and spaces when building WhatsApp claim URLs", () => {
    const ticketWithSpecialChars: DatosTicketWhatsApp = {
      comercioNombre: "Bodega & Inversiones Los Ángeles C.A.",
      comercioRif: "J-12345678-9",
      comercioTelefono: "04121234567",
      serialCorto: 9999,
      fechaHoraEmision: "29/10/2026 12:00:00 PM",
      tasaBcv: 45.85,
      totalUsd: 10.0,
      totalBs: 458.5,
      codigoSeguridadHmac: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      qrPayload: "BANCAPRO|tenant|ticket|10.00|1730000000|fedcba9876543210",
      clienteTelefono: "0412-123-4567",
      urlVerificacionPublica: "https://bancapro.local/verificar?store=A&B",
      items: [
        {
          sorteoHora: "12:00 PM",
          codigoAnimal: "37",
          nombreAnimal: "Ballena (00)",
          montoUsd: 10.0,
          premioPotencialUsd: 300.0,
        },
      ],
    };

    const msg = construirMensajeWhatsAppTicket(ticketWithSpecialChars);
    expect(msg).toContain("BODEGA & INVERSIONES LOS ÁNGELES C.A.");
    expect(msg).toContain("#37 Ballena (00)");
    expect(msg).toContain(ticketWithSpecialChars.qrPayload);
    expect(msg).not.toContain("https://");
  });
});
