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
 * Construye el mensaje de Comprobante Digital de Lotería para WhatsApp con:
 * - Identificación del Comercio (Tenant) y RIF
 * - Serial del Ticket y Fecha/Hora exacta del servidor
 * - Desglose de animalitos jugados, horario de sorteo y premio potencial (30x)
 * - Total pagado en USD y Bolívares con la tasa oficial BCV congelada
 * - PIN de Cobro y Firma Criptográfica HMAC-SHA256 Anti-Falsificación para reclamar el premio
 */
export function construirMensajeWhatsAppTicket(
  ticket: DatosTicketWhatsApp
): string {
  const pinReclamo = `${ticket.serialCorto}-${ticket.codigoSeguridadHmac
    .slice(0, 8)
    .toUpperCase()}`;

  const lineasJugadas = ticket.items
    .map(
      (it) =>
        `• *${it.sorteoHora}* | *#${it.codigoAnimal} ${
          it.nombreAnimal
        }* ➡️ *$${it.montoUsd.toFixed(2)}* _(Premio 30x: $${it.premioPotencialUsd.toFixed(
          2
        )})_`
    )
    .join("\n");

  const baseUrl =
    ticket.urlVerificacionPublica ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://bancapro-core-venezuela.vercel.app");

  const linkReclamoDirecto = baseUrl
    ? `${baseUrl}/?ticket=${encodeURIComponent(ticket.qrPayload)}`
    : "";

  return [
    `🎟️ *COMPROBANTE OFICIAL - ${ticket.comercioNombre.toUpperCase()}*`,
    `🏢 RIF: ${ticket.comercioRif} | *LOTTO ACTIVO*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📌 *TICKET N°:* #${ticket.serialCorto}`,
    `🕒 *EMISIÓN:* ${ticket.fechaHoraEmision}`,
    `📱 *CLIENTE:* +${normalizarTelefonoVenezuela(ticket.clienteTelefono)}`,
    `💱 *TASA BCV:* Bs. ${ticket.tasaBcv.toFixed(2)} / USD`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🦁 *DETALLE DE JUGADAS:*`,
    lineasJugadas,
    `━━━━━━━━━━━━━━━━━━━━`,
    `💵 *TOTAL USD:* *$${ticket.totalUsd.toFixed(2)}*`,
    `🇻🇪 *TOTAL BS:* *Bs. ${ticket.totalBs.toFixed(2)}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔐 *CÓDIGO PARA RECLAMAR PREMIO:*`,
    `👉 *${pinReclamo}*`,
    `🛡️ *FIRMA HMAC-SHA256:*`,
    `\`${ticket.codigoSeguridadHmac}\``,
    linkReclamoDirecto
      ? `\n🔎 *Verificar Ticket / QR Digital:*\n${linkReclamoDirecto}`
      : "",
    `\n⚠️ _Presente este mensaje o su código de seguridad en taquilla para cobrar su premio. Válido por 3 días._`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Abre WhatsApp Web / App Móvil con el comprobante criptográfico listo para enviar al cliente
 * (Modo Gratuito Instantáneo sin requerir impresora térmica).
 */
export function abrirWhatsAppClienteDirecto(
  ticket: DatosTicketWhatsApp
): string {
  const telefonoE164 = normalizarTelefonoVenezuela(ticket.clienteTelefono);
  const texto = construirMensajeWhatsAppTicket(ticket);
  const url = `https://wa.me/${telefonoE164}?text=${encodeURIComponent(texto)}`;

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return url;
}
