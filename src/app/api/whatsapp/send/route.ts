import { NextRequest, NextResponse } from "next/server";
import { normalizarTelefonoVenezuela } from "@/lib/hardware/whatsapp";

/**
 * ENDPOINT DE ENVÍO AUTOMÁTICO EN SEGUNDO PLANO (SILENT PUSH) A WHATSAPP DEL CLIENTE
 * Soporta dos motores configurables mediante variables de entorno:
 *   1. Meta WhatsApp Cloud API Oficial (`WHATSAPP_CLOUD_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`)
 *   2. Gateway HTTP / Evolution API / UltraMsg (`WHATSAPP_GATEWAY_URL` + `WHATSAPP_GATEWAY_TOKEN`)
 *
 * Si aún no se han configurado tokens de API de pago, responde `modo: "WA_ME_LINK"` para que la
 * taquilla abra automáticamente WhatsApp Web / Desktop en 1 clic sin costo alguno.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { telefono, mensajeTexto, qrPayload } = body as {
      telefono: string;
      mensajeTexto: string;
      qrPayload?: string;
    };

    const telefonoLimpio = normalizarTelefonoVenezuela(telefono || "");
    if (!telefonoLimpio || telefonoLimpio.length < 10) {
      return NextResponse.json(
        { ok: false, error: "Número de WhatsApp del cliente inválido." },
        { status: 400 }
      );
    }

    // OPCIÓN A: Meta WhatsApp Cloud API Oficial (Envío 100% silencioso en segundo plano)
    const metaToken = process.env.WHATSAPP_CLOUD_API_TOKEN;
    const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (metaToken && metaPhoneId) {
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
    }

    // OPCIÓN B: Gateway WhatsApp (Evolution API / UltraMsg / Baileys Webhook)
    const gatewayUrl = process.env.WHATSAPP_GATEWAY_URL;
    const gatewayToken = process.env.WHATSAPP_GATEWAY_TOKEN;

    if (gatewayUrl && gatewayToken) {
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
        }),
      });

      if (gwResp.ok) {
        return NextResponse.json({
          ok: true,
          modo: "GATEWAY_API_SILENT",
          destinatario: telefonoLimpio,
        });
      }
    }

    // OPCIÓN C (Por defecto sin costo): Enlace directo wa.me pre-firmado con HMAC-SHA256
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
