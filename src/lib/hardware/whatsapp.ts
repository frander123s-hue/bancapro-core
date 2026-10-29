import { generarMatrizQr } from "./qr-generator";

export interface ItemJugadaWhatsApp {
  sorteoHora: string;
  codigoAnimal: string;
  nombreAnimal: string;
  montoUsd: number;
  montoBs?: number;
  premioPotencialUsd: number;
}

export interface DatosTicketWhatsApp {
  comercioNombre: string;
  comercioRif: string;
  comercioTelefono?: string;
  cajeroNombre?: string;
  serialCorto: string | number;
  fechaHoraEmision: string;
  tasaBcv: number;
  totalUsd: number;
  totalBs: number;
  codigoSeguridadHmac: string;
  qrPayload: string;
  anchoPapel?: "58mm" | "80mm";
  items: ItemJugadaWhatsApp[];
  clienteTelefono: string;
  urlVerificacionPublica?: string;
}

/**
 * Normaliza cualquier número telefónico venezolano o internacional al formato E.164 sin '+'
 * Ejemplos:
 *  - "0414-1234567" -> "584141234567"
 *  - "04121234567"  -> "584121234567"
 *  - "+58 424 9998877" -> "584249998877"
 */
export function normalizarTelefonoVenezuela(input: string): string {
  const soloDigitos = input.replace(/\D/g, "");
  if (!soloDigitos) return "";

  // Si empieza por 0414, 0424, 0412, 0416, 0426 (11 dígitos en Venezuela)
  if (soloDigitos.length === 11 && soloDigitos.startsWith("0")) {
    return `58${soloDigitos.slice(1)}`;
  }

  // Si colocaron solo los 10 dígitos sin el 0 inicial (ej: 4141234567)
  if (
    soloDigitos.length === 10 &&
    /^(412|414|424|416|426)/.test(soloDigitos)
  ) {
    return `58${soloDigitos}`;
  }

  return soloDigitos;
}

/**
 * Construye el mensaje de Comprobante Digital de Lotería para WhatsApp:
 * - CERO enlaces web (`http://` o `https://`) arriba o abajo para que el cliente jamás pueda abrir el panel POS.
 * - Emojis 100% compatibles con BMP Unicode (`✨`, `❖`, `★`, `⏰`, `✔`, `☎`, `⚖`, `⚡`, `▸`, `➜`, `⭐`, `✅`)
 *   que nunca generan signos de interrogación (`?` o ``) en WhatsApp Web / Desktop / Móvil.
 * - Incluye los datos del Código QR Criptográfico (`BANCAPRO|...`) sin usar URLs.
 */
export function construirMensajeWhatsAppTicket(
  ticket: DatosTicketWhatsApp
): string {
  const pinReclamo = `${ticket.serialCorto}-${ticket.codigoSeguridadHmac
    .slice(0, 8)
    .toUpperCase()}`;

  const lineasJugadas = ticket.items
    .map((it) => {
      const montoBsExacto =
        typeof it.montoBs === "number" && it.montoBs > 0
          ? Number(it.montoBs.toFixed(2))
          : Number((it.montoUsd * ticket.tasaBcv).toFixed(2));
      const premioBsExacto = Number((montoBsExacto * 30).toFixed(2));
      const montoUsdExacto =
        ticket.tasaBcv > 0
          ? Number((montoBsExacto / ticket.tasaBcv).toFixed(2))
          : Number(it.montoUsd.toFixed(2));
      const premioUsdExacto =
        ticket.tasaBcv > 0
          ? Number((premioBsExacto / ticket.tasaBcv).toFixed(2))
          : Number(it.premioPotencialUsd.toFixed(2));

      return `▸ *${it.sorteoHora}* | *#${it.codigoAnimal} ${
        it.nombreAnimal
      }* ➜ *Bs. ${montoBsExacto.toFixed(2)} ($${montoUsdExacto.toFixed(
        2
      )})* _(Premio 30x: $${premioUsdExacto.toFixed(
        2
      )} / Bs. ${premioBsExacto.toFixed(2)})_`;
    })
    .join("\n");

  return [
    `✨ *COMPROBANTE OFICIAL - ${ticket.comercioNombre.toUpperCase()}* ✨`,
    `❖ *RIF:* ${ticket.comercioRif} | *LOTTO ACTIVO*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `★ *TICKET N°:* #${ticket.serialCorto}`,
    `⏰ *EMISIÓN:* ${ticket.fechaHoraEmision}`,
    ticket.cajeroNombre ? `✔ *CAJERO EN CAJA:* ${ticket.cajeroNombre}` : "",
    `☎ *CLIENTE:* +${normalizarTelefonoVenezuela(ticket.clienteTelefono)}`,
    `⚖ *TASA BCV:* Bs. ${ticket.tasaBcv.toFixed(2)} / USD`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⚡ *DETALLE DE JUGADAS:*`,
    lineasJugadas,
    `━━━━━━━━━━━━━━━━━━━━`,
    `⭐ *TOTAL BS:* *Bs. ${ticket.totalBs.toFixed(2)}*`,
    `⭐ *TOTAL USD:* *$${ticket.totalUsd.toFixed(2)}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `✅ *CÓDIGO PIN PARA RECLAMAR PREMIO:*`,
    `➜ *${pinReclamo}*`,
    `❖ *CÓDIGO QR CRIPTOGRÁFICO (SIN ENLACES):*`,
    `\`${ticket.qrPayload}\``,
    `❖ *FIRMA HMAC-SHA256:*`,
    `\`${ticket.codigoSeguridadHmac}\``,
    `\n✅ _Presente este comprobante, su código PIN o su imagen QR en taquilla para cobrar su premio. Válido por 3 días._`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Genera una imagen PNG (Data URL) del Ticket completo con su Código QR Escaneable incrustado
 * (codificando exclusivamente el payload criptográfico `BANCAPRO|...` y el PIN, SIN NINGÚN LINK WEB).
 * Permite enviarlo o pegarlo (`Ctrl + V`) como imagen en WhatsApp o descargarlo.
 */
export function generarImagenTicketConQrDataUrl(
  ticket: DatosTicketWhatsApp
): string {
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  const width = 440;
  const baseHeight = 470 + ticket.items.length * 32;
  canvas.width = width;
  canvas.height = baseHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Fondo blanco tipo ticket térmico de alta resolución
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, baseHeight);

  // Borde superior decorativo verde esmeralda
  ctx.fillStyle = "#059669";
  ctx.fillRect(0, 0, width, 10);

  // Encabezado del Comercio
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px monospace";
  ctx.textAlign = "center";
  ctx.fillText(ticket.comercioNombre.toUpperCase(), width / 2, 38);

  ctx.font = "12px monospace";
  ctx.fillStyle = "#334155";
  ctx.fillText(`RIF: ${ticket.comercioRif} • LOTTO ACTIVO`, width / 2, 56);

  // Línea separadora
  ctx.strokeStyle = "#cbd5e1";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(20, 68);
  ctx.lineTo(width - 20, 68);
  ctx.stroke();

  // Metadatos del ticket
  ctx.textAlign = "left";
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 13px monospace";
  ctx.fillText(`TICKET N°: #${ticket.serialCorto}`, 24, 90);
  ctx.font = "12px monospace";
  ctx.fillText(`EMISIÓN  : ${ticket.fechaHoraEmision}`, 24, 108);
  ctx.fillText(
    `CAJERO   : ${ticket.cajeroNombre || "Taquilla Principal"}`,
    24,
    126
  );
  ctx.fillText(
    `CLIENTE  : +${normalizarTelefonoVenezuela(ticket.clienteTelefono)}`,
    24,
    144
  );
  ctx.fillText(`TASA BCV : Bs. ${ticket.tasaBcv.toFixed(2)} / $1 USD`, 24, 162);

  ctx.beginPath();
  ctx.moveTo(20, 174);
  ctx.lineTo(width - 20, 174);
  ctx.stroke();

  // Detalle de Jugadas
  ctx.font = "bold 12px monospace";
  ctx.fillStyle = "#0f172a";
  ctx.fillText("SORTEO     ANIMALITO          APUESTA (BS / USD)", 24, 194);

  let y = 216;
  ctx.font = "12px monospace";
  for (const it of ticket.items) {
    const montoBs =
      typeof it.montoBs === "number" && it.montoBs > 0
        ? Number(it.montoBs.toFixed(2))
        : Number((it.montoUsd * ticket.tasaBcv).toFixed(2));
    const premioBs = Number((montoBs * 30).toFixed(2));
    ctx.fillStyle = "#0f172a";
    ctx.fillText(
      `${it.sorteoHora.padEnd(9, " ")} #${it.codigoAnimal} ${it.nombreAnimal.slice(
        0,
        12
      )}`,
      24,
      y
    );
    ctx.textAlign = "right";
    ctx.font = "bold 12px monospace";
    ctx.fillText(
      `Bs. ${montoBs.toFixed(2)} (Premio: Bs. ${premioBs.toFixed(0)})`,
      width - 24,
      y
    );
    ctx.textAlign = "left";
    ctx.font = "12px monospace";
    y += 28;
  }

  ctx.beginPath();
  ctx.moveTo(20, y - 8);
  ctx.lineTo(width - 20, y - 8);
  ctx.stroke();

  // Totales en Bs. y USD
  y += 14;
  ctx.font = "bold 15px monospace";
  ctx.fillStyle = "#0f172a";
  ctx.fillText(`TOTAL BS : Bs. ${ticket.totalBs.toFixed(2)}`, 24, y);
  ctx.textAlign = "right";
  ctx.fillText(`USD: $${ticket.totalUsd.toFixed(2)}`, width - 24, y);
  ctx.textAlign = "left";

  // PIN de Reclamo
  y += 26;
  const pinReclamo = `${ticket.serialCorto}-${ticket.codigoSeguridadHmac
    .slice(0, 8)
    .toUpperCase()}`;
  ctx.fillStyle = "#059669";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`PIN DE RECLAMO: ${pinReclamo}`, width / 2, y);

  // Dibujar Código QR Criptográfico Real en el Centro (Sin enlaces web)
  y += 16;
  const matrix = generarMatrizQr(ticket.qrPayload);
  const qrModules = matrix.length;
  const moduleSize = 5;
  const qrPixelSize = qrModules * moduleSize;
  const qrStartX = Math.floor((width - qrPixelSize) / 2);

  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(qrStartX - 8, y - 4, qrPixelSize + 16, qrPixelSize + 16);
  ctx.strokeStyle = "#0f172a";
  ctx.strokeRect(qrStartX - 8, y - 4, qrPixelSize + 16, qrPixelSize + 16);

  ctx.fillStyle = "#000000";
  for (let r = 0; r < qrModules; r++) {
    for (let c = 0; c < qrModules; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(
          qrStartX + c * moduleSize,
          y + 4 + r * moduleSize,
          moduleSize,
          moduleSize
        );
      }
    }
  }

  y += qrPixelSize + 28;
  ctx.fillStyle = "#475569";
  ctx.font = "10px monospace";
  ctx.fillText(
    "QR CRIPTOGRÁFICO OFICIAL (SIN ENLACES EXTERNOS)",
    width / 2,
    y
  );
  ctx.fillText(
    `HMAC: ${ticket.codigoSeguridadHmac.slice(0, 32)}...`,
    width / 2,
    y + 15
  );

  return canvas.toDataURL("image/png");
}

/**
 * Copia automáticamente la imagen PNG del ticket con su QR al portapapeles del sistema
 * para que el cajero pueda pegarla con `Ctrl + V` directo en el chat de WhatsApp del cliente.
 */
export async function copiarImagenTicketConQrAlPortapapeles(
  ticket: DatosTicketWhatsApp
): Promise<boolean> {
  try {
    if (
      typeof window === "undefined" ||
      !navigator.clipboard ||
      typeof ClipboardItem === "undefined"
    ) {
      return false;
    }
    const dataUrl = generarImagenTicketConQrDataUrl(ticket);
    if (!dataUrl) return false;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre WhatsApp Web / App Móvil con el comprobante criptográfico listo para enviar al cliente
 * (Modo Gratuito Instantáneo sin requerir impresora térmica y sin ningún enlace al POS).
 */
export function abrirWhatsAppClienteDirecto(
  ticket: DatosTicketWhatsApp
): string {
  const telefonoE164 = normalizarTelefonoVenezuela(ticket.clienteTelefono);
  const texto = construirMensajeWhatsAppTicket(ticket);
  const url = `https://wa.me/${telefonoE164}?text=${encodeURIComponent(texto)}`;

  if (typeof window !== "undefined") {
    // Copiar también la imagen del ticket con el QR al portapapeles automáticamente
    copiarImagenTicketConQrAlPortapapeles(ticket).catch(() => {});
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return url;
}
