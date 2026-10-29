/**
 * MOTOR NATIVO DE IMPRESIÓN TÉRMICA ESC/POS (58mm y 80mm)
 * Soporta conexión directa vía WebUSB / WebSerial a impresoras térmicas POS (Xprinter, Epson, Bixolon, 3nStar)
 * y fallback instantáneo a diálogo de impresión de alta densidad para rollos térmicos.
 */

export interface ItemImpresionTicket {
  sorteoHora: string;
  codigoAnimal: string;
  nombreAnimal: string;
  montoUsd: number;
  montoBs: number;
  premioPotencialUsd: number;
}

export interface DatosTicketTermico {
  comercioNombre: string;
  comercioRif: string;
  cajeroNombre: string;
  serialCorto: string;
  fechaHoraEmision: string;
  tasaBcv: number;
  totalUsd: number;
  totalBs: number;
  codigoSeguridadHmac: string;
  qrPayload: string;
  anchoPapel: "58mm" | "80mm";
  items: ItemImpresionTicket[];
}

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Construye el buffer binario nativo de comandos ESC/POS (estándar Epson/Xprinter)
 * incluyendo inicialización, centrado, negritas, tabla de jugadas, código QR nativo (GS ( k) y corte de papel.
 */
export function construirBufferEscPos(ticket: DatosTicketTermico): Uint8Array {
  const encoder = new TextEncoder();
  const cols = ticket.anchoPapel === "80mm" ? 48 : 32;
  const separador = "-".repeat(cols) + "\n";

  const chunks: number[] = [];
  const pushBytes = (...bytes: number[]) => chunks.push(...bytes);
  const pushText = (text: string) => {
    const encoded = encoder.encode(
      text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Limpiar tildes para tabla ASCII estándar de impresoras térmicas
    );
     encoded.forEach((b) => chunks.push(b));
  };

  // 1. Inicializar impresora (ESC @)
  pushBytes(ESC, 0x40);

  // 2. Centrar texto (ESC a 1) + Negrita activada (ESC E 1)
  pushBytes(ESC, 0x61, 0x01);
  pushBytes(ESC, 0x45, 0x01);
  pushText(`${ticket.comercioNombre.toUpperCase()}\n`);
  pushBytes(ESC, 0x45, 0x00);
  pushText(`RIF: ${ticket.comercioRif} | LOTTO ACTIVO\n`);
  pushText(separador);

  // 3. Alinear a la izquierda (ESC a 0) - Datos de cabecera
  pushBytes(ESC, 0x61, 0x00);
  pushText(`TICKET: #${ticket.serialCorto}\n`);
  pushText(`FECHA : ${ticket.fechaHoraEmision}\n`);
  pushText(`CAJERO: ${ticket.cajeroNombre}\n`);
  pushText(`TASA  : Bs. ${ticket.tasaBcv.toFixed(2)} / USD (BCV)\n`);
  pushText(separador);

  // 4. Encabezado de Jugadas
  pushBytes(ESC, 0x45, 0x01);
  pushText(
    ticket.anchoPapel === "80mm"
      ? "SORTEO      FIGURA               MONTO($)   PREMIO\n"
      : "SORTEO   FIGURA         USD\n"
  );
  pushBytes(ESC, 0x45, 0x00);

  for (const item of ticket.items) {
    const figLabel = `${item.codigoAnimal}-${item.nombreAnimal.slice(0, 8)}`.padEnd(12, " ");
    const montoStr = `$${item.montoUsd.toFixed(2)}`.padStart(7, " ");
    if (ticket.anchoPapel === "80mm") {
      const premioStr = `$${item.premioPotencialUsd.toFixed(2)}`.padStart(9, " ");
      pushText(`${item.sorteoHora.padEnd(11, " ")} ${figLabel.padEnd(18, " ")} ${montoStr} ${premioStr}\n`);
    } else {
      pushText(`${item.sorteoHora.padEnd(8, " ")} ${figLabel} ${montoStr}\n`);
    }
  }

  pushText(separador);

  // 5. Totales en doble altura/negrita
  pushBytes(ESC, 0x61, 0x02); // Derecha
  pushBytes(ESC, 0x45, 0x01);
  pushText(`TOTAL USD: $${ticket.totalUsd.toFixed(2)}\n`);
  pushText(`TOTAL BS : Bs. ${ticket.totalBs.toFixed(2)}\n`);
  pushBytes(ESC, 0x45, 0x00);
  pushText(separador);

  // 6. Firma HMAC-SHA256 y Código QR nativo ESC/POS (GS ( k)
  pushBytes(ESC, 0x61, 0x01); // Centrado
  pushText(`FIRMA HMAC: ${ticket.codigoSeguridadHmac.slice(0, 20)}...\n`);

  const qrBytes = encoder.encode(ticket.qrPayload);
  const storeLen = qrBytes.length + 3;
  const pL = storeLen % 256;
  const pH = Math.floor(storeLen / 256);

  // Modelo QR 2
  pushBytes(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  // Tamaño de módulo QR (5 dots)
  pushBytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x05);
  // Nivel de corrección de errores M (49)
  pushBytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
  // Almacenar datos en el buffer de símbolo QR
  pushBytes(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30);
  qrBytes.forEach((b) => chunks.push(b));
  // Imprimir símbolo QR almacenado
  pushBytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);

  pushText("\nCADUCA A LOS 3 DIAS. VERIFIQUE SU TICKET.\n\n\n\n");

  // 7. Corte parcial de papel (GS V 66 0)
  pushBytes(GS, 0x56, 0x42, 0x00);

  return new Uint8Array(chunks);
}

/**
 * Envía el ticket directamente al puerto WebSerial (COM/USB-Serial) si el cajero tiene impresora vinculada,
 * o dispara la ventana de impresión térmica de 58mm/80mm sin márgenes.
 */
export async function imprimirTicketTermico(
  ticket: DatosTicketTermico,
  usarWebSerialDirecto: boolean = false
): Promise<{ metodo: "WEBSERIAL_ESCPOS" | "BROWSER_THERMAL"; ok: boolean }> {
  const escPosBytes = construirBufferEscPos(ticket);

  if (
    usarWebSerialDirecto &&
    typeof window !== "undefined" &&
    "serial" in navigator
  ) {
    try {
      // @ts-expect-error Web Serial API en navegadores basados en Chromium
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      await writer.write(escPosBytes);
      writer.releaseLock();
      await port.close();
      return { metodo: "WEBSERIAL_ESCPOS", ok: true };
    } catch {
      // Si el usuario cancela el selector de puerto serial, continúa al fallback térmico visual
    }
  }

  if (typeof window !== "undefined") {
    window.print();
  }
  return { metodo: "BROWSER_THERMAL", ok: true };
}
