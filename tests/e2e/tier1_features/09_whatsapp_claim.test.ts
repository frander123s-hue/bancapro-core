import { describe, it, expect } from "vitest";
import {
  normalizarTelefonoVenezuela,
  construirMensajeWhatsAppTicket,
  abrirWhatsAppClienteDirecto,
  type DatosTicketWhatsApp,
} from "@/lib/hardware/whatsapp";

describe("Tier 1 - Feature 09: WhatsApp Ticket Format & Digital Claim Flow", () => {
  const dummyTicket: DatosTicketWhatsApp = {
    comercioNombre: "Bodega Piloto Magaly",
    comercioRif: "J-40123987-1",
    comercioTelefono: "+58 414-1234567",
    serialCorto: 1042,
    fechaHoraEmision: "29/10/2026 08:30:00 AM",
    tasaBcv: 45.85,
    totalUsd: 5.0,
    totalBs: 229.25,
    codigoSeguridadHmac:
      "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    qrPayload:
      "BANCAPRO|11111111-1111-4111-8111-111111111111|mock-uuid|5.00|1730190000|a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    clienteTelefono: "0414-1234567",
    urlVerificacionPublica: "https://bancapro-core-venezuela.vercel.app",
    items: [
      {
        sorteoHora: "09:00 AM",
        codigoAnimal: "10",
        nombreAnimal: "Tigre",
        montoUsd: 5.0,
        premioPotencialUsd: 150.0,
      },
    ],
  };

  it("9.1 should normalize Venezuelan phone numbers to E.164 digits without '+' (e.g. 0414-1234567 -> 584141234567)", () => {
    expect(normalizarTelefonoVenezuela("0414-1234567")).toBe("584141234567");
    expect(normalizarTelefonoVenezuela("04121234567")).toBe("584121234567");
    expect(normalizarTelefonoVenezuela("+58 424 9998877")).toBe("584249998877");
    expect(normalizarTelefonoVenezuela("4161112233")).toBe("584161112233");
  });

  it("9.2 should include customer claim PIN (serialCorto-HASH8) and HMAC signature in WhatsApp message", () => {
    const msg = construirMensajeWhatsAppTicket(dummyTicket);

    expect(msg).toContain("1042-A1B2C3D4");
    expect(msg).toContain(
      "`a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90`"
    );
  });

  it("9.3 should include complete plays breakdown with 30x prize potential in WhatsApp message", () => {
    const msg = construirMensajeWhatsAppTicket(dummyTicket);

    expect(msg).toContain("*09:00 AM* | *#10 Tigre*");
    expect(msg).toContain("Premio 30x: $150.00");
    expect(msg).toContain("*TOTAL USD:* *$5.00*");
    expect(msg).toContain("*TOTAL BS:* *Bs. 229.25*");
  });

  it("9.4 should embed the public claim link with encoded QR payload in WhatsApp message", () => {
    const msg = construirMensajeWhatsAppTicket(dummyTicket);

    expect(msg).toContain("https://bancapro-core-venezuela.vercel.app/?ticket=");
    expect(msg).toContain(encodeURIComponent(dummyTicket.qrPayload));
  });

  it("9.5 should generate a valid wa.me URL with normalized phone and encoded message text", () => {
    const waUrl = abrirWhatsAppClienteDirecto(dummyTicket);

    expect(waUrl.startsWith("https://wa.me/584141234567?text=")).toBe(true);
    expect(waUrl).toContain(encodeURIComponent("COMPROBANTE OFICIAL"));
    expect(waUrl).toContain(encodeURIComponent("1042-A1B2C3D4"));
  });
});
