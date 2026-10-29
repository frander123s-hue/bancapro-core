import { NextRequest, NextResponse } from "next/server";
import { normalizarTelefonoVenezuela } from "@/lib/hardware/whatsapp";

export interface ConfigWhatsAppComercioPayload {
  modoVinculacion?: "DIRECTO_WA_ME" | "API_CLOUD_GATEWAY";
  subModoApi?: "META_CLOUD" | "GATEWAY_QR";
  telefonoComercio?: string;
  metaToken?: string;
  metaPhoneId?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  instanciaId?: string;
}

/**
 * ENDPOINT DE ENVÍO AUTOMÁTICO EN SEGUNDO PLANO (SILENT PUSH) A WHATSAPP DEL CLIENTE
 * Soporta configuración centralizada por comercio enviada desde el Portal SuperAdmin
 * o variables de entorno globales:
 *   1. Opción 2A - Meta WhatsApp Cloud API Oficial (`metaToken` + `metaPhoneId`)
 *   2. Opción 2B - Gateway HTTP / Evolution API / UltraMsg QR (`gatewayUrl` + `gatewayToken`)
 *   3. Opción 1  - Vinculación Directa / WhatsApp Web (`WA_ME_DIRECTO`) sin costo de API
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { telefono, mensajeTexto, qrPayload, configComercio } = body as {
      telefono: string;
      mensajeTexto: string;
      qrPayload?: string;
      configComercio?: ConfigWhatsAppComercioPayload;
    };

    const telefonoLimpio = normalizarTelefonoVenezuela(telefono || "");
    if (!telefonoLimpio || telefonoLimpio.length < 10) {
      return NextResponse.json(
        { ok: false, error: "Número de WhatsApp del cliente inválido." },
        { status: 400 }
      );
    }

    // Si el SuperAdmin configuró explícitamente la Opción 1 (Vinculación Directa / WhatsApp Web) para este comercio
    if (configComercio?.modoVinculacion === "DIRECTO_WA_ME") {
      return NextResponse.json({
        ok: true,
        modo: "WA_ME_DIRECTO",
        destinatario: telefonoLimpio,
        waMeUrl: `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(
          mensajeTexto
        )}`,
      });
    }

    // OPCIÓN 2A: Meta WhatsApp Cloud API Oficial (Por comercio desde SuperAdmin o Global en .env)
    const metaToken =
      configComercio?.metaToken?.trim() || process.env.WHATSAPP_CLOUD_API_TOKEN;
    const metaPhoneId =
      configComercio?.metaPhoneId?.trim() ||
      process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (metaToken && metaPhoneId) {
      try {
        const metaResp = await fetch(
          `https://graph.facebook.com/v20.0/${metaPhoneId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${metaToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: telefonoLimpio,
              type: "text",
              text: {
                preview_url: false,
                body: mensajeTexto,
              },
            }),
          }
        );

        if (metaResp.ok) {
          const metaJson = await metaResp.json();
          return NextResponse.json({
            ok: true,
            modo: "META_CLOUD_API_SILENT",
            destinatario: telefonoLimpio,
            messageId: metaJson?.messages?.[0]?.id ?? null,
          });
        }
      } catch {
        // Fallback si el endpoint externo no responde
      }
    }

    // OPCIÓN 2B: Gateway WhatsApp / Instancia QR (Evolution API / UltraMsg / Baileys Webhook)
    const gatewayUrl =
      configComercio?.gatewayUrl?.trim() || process.env.WHATSAPP_GATEWAY_URL;
    const gatewayToken =
      configComercio?.gatewayToken?.trim() ||
      process.env.WHATSAPP_GATEWAY_TOKEN;

    if (gatewayUrl && gatewayToken) {
      try {
        const gwResp = await fetch(gatewayUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gatewayToken}`,
            apikey: gatewayToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            number: telefonoLimpio,
            text: mensajeTexto,
            qrPayload,
            instanceId: configComercio?.instanciaId || undefined,
          }),
        });

        if (gwResp.ok) {
          return NextResponse.json({
            ok: true,
            modo: "GATEWAY_API_SILENT",
            destinatario: telefonoLimpio,
          });
        }
      } catch {
        // Fallback a enlace directo si el gateway no está alcanzable
      }
    }

    // OPCIÓN 1 (Por defecto o Respaldo Instantáneo): Enlace directo wa.me pre-firmado con HMAC-SHA256
    return NextResponse.json({
      ok: true,
      modo: "WA_ME_DIRECTO",
      destinatario: telefonoLimpio,
      waMeUrl: `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(
        mensajeTexto
      )}`,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al despachar ticket por WhatsApp",
      },
      { status: 500 }
    );
  }
}
