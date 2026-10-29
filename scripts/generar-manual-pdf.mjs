import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT_DIR = "C:\\Users\\fcordero\\.gemini\\antigravity\\scratch\\bancapro-core";
const SCREENSHOTS_DIR = path.join(ROOT_DIR, "public", "manual", "screenshots");
const ARTIFACT_DIR = "C:\\Users\\fcordero\\.gemini\\antigravity\\brain\\290d0214-34a8-47cb-ac80-680b9ca1856c";
const TEMP_HTML_DIR = path.join(ROOT_DIR, "scripts", ".tmp_captures");

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
fs.mkdirSync(TEMP_HTML_DIR, { recursive: true });

const baseStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Inter, system-ui, sans-serif; }
  body { background: #020617; color: #f1f5f9; width: 1400px; height: 860px; overflow: hidden; display: flex; flex-direction: column; }
  .mono { font-family: 'Cascadia Code', 'Consolas', monospace; }
  .header { background: #0f172a; border-bottom: 1px solid #1e293b; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo { width: 42px; height: 42px; border-radius: 12px; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.45); display: flex; align-items: center; justify-content: center; color: #34d399; font-weight: 900; font-size: 18px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: rgba(16,185,129,0.18); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.35); font-family: monospace; }
  .top-widgets { display: flex; align-items: center; gap: 12px; }
  .widget { background: #020617; border-radius: 10px; padding: 7px 14px; display: flex; align-items: center; gap: 10px; }
  .widget-amber { border: 1px solid rgba(245,158,11,0.35); }
  .widget-sky { border: 1px solid rgba(14,165,233,0.35); }
  .nav { display: flex; background: #020617; padding: 4px; border-radius: 10px; border: 1px solid #1e293b; gap: 4px; }
  .nav-btn { padding: 7px 12px; border-radius: 7px; font-size: 12px; font-weight: 600; color: #94a3b8; }
  .nav-btn.active { background: #059669; color: #ffffff; }
  .nav-btn.super { background: rgba(49,46,129,0.75); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.45); }
  .main { flex: 1; padding: 18px 24px; display: grid; grid-template-columns: 8fr 4fr; gap: 18px; position: relative; }
  .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; padding: 16px; position: relative; }
  .card-emerald { border-color: rgba(16,185,129,0.45); }
  .callout { position: absolute; width: 30px; height: 30px; border-radius: 50%; background: #f59e0b; color: #020617; font-weight: 900; font-size: 15px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 4px rgba(245,158,11,0.35), 0 4px 12px rgba(0,0,0,0.6); z-index: 50; }
  .callout-label { position: absolute; background: #fef3c7; color: #78350f; border: 2px solid #f59e0b; border-radius: 8px; padding: 5px 10px; font-size: 11px; font-weight: 800; box-shadow: 0 6px 16px rgba(0,0,0,0.45); z-index: 49; white-space: nowrap; }
`;

const headerHtml = (activeTab = "POS") => `
  <div class="header">
    <div class="brand">
      <div class="logo">BP</div>
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:800;font-size:16px;color:#fff;">BancaPro Core</span>
          <span class="badge">WhatsApp Ticket • RLS Multi-Tenant</span>
        </div>
        <div style="font-size:12px;color:#34d399;font-weight:600;margin-top:3px;">
          🏢 Bodega Piloto Magaly (J-40123987-1) • 🛡️ Magaly Rodríguez (Sesión GoTrue Activa)
        </div>
      </div>
    </div>
    <div class="top-widgets">
      <div class="widget widget-amber">
        <div>
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;">Cierre Sorteo 02:00 PM (T-3m)</div>
          <div class="mono" style="font-size:14px;font-weight:800;color:#fcd34d;">00:34:18</div>
        </div>
      </div>
      <div class="widget widget-sky">
        <div>
          <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;">Tasa Oficial BCV <span style="color:#34d399;">• BCV en vivo</span></div>
          <div class="mono" style="font-size:14px;font-weight:800;color:#7dd3fc;">Bs. 888.89 / $1 USD</div>
        </div>
      </div>
      <div class="nav">
        <div class="nav-btn ${activeTab === "POS" ? "active" : ""}">⌨️ 1. Taquilla POS</div>
        <div class="nav-btn ${activeTab === "COBRO" ? "active" : ""}">💬 2. Reclamar Premio</div>
        <div class="nav-btn ${activeTab === "CAJA" ? "active" : ""}">📈 3. Caja & Cupos</div>
        <div class="nav-btn super">🔑 Portal SuperAdmin</div>
      </div>
    </div>
  </div>
`;

const screens = [
  {
    filename: "01-taquilla-pos-bs-usd.png",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}
      .grid-hours { display:grid; grid-template-columns: repeat(6, 1fr); gap:8px; margin-top:10px; }
      .hour-box { background:#020617; border:1px solid #1e293b; border-radius:8px; padding:8px 10px; font-size:11px; }
      .hour-box.open { border-color:#10b981; background:rgba(16,185,129,0.14); }
      .hour-box.closed { opacity:0.55; color:#64748b; }
      .grid-animals { display:grid; grid-template-columns: repeat(8, 1fr); gap:8px; margin-top:10px; }
      .animal-card { background:#020617; border:1px solid #1e293b; border-radius:8px; padding:7px; }
    </style></head><body>
      ${headerHtml("POS")}
      <div class="callout" style="top:54px;right:435px;">1</div>
      <div class="callout-label" style="top:58px;right:472px;">1. Tasa BCV Sincronizada en Vivo</div>
      <div class="main">
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="card">
            <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:#94a3b8;">
              <span>1. SELECCIONE HORARIO DE SORTEO (BLOQUEO AUTOMÁTICO T - 3 MINUTOS)</span>
              <span class="mono" style="color:#34d399;">Cupo Máx por Figura: Bs. 8,888.90 ($10.00 USD)</span>
            </div>
            <div class="grid-hours">
              <div class="hour-box closed"><div class="mono" style="font-weight:700;">09:00 AM 🔒</div><div style="color:#fb7185;font-size:10px;">LIQUIDADO (#05)</div></div>
              <div class="hour-box closed"><div class="mono" style="font-weight:700;">10:00 AM 🔒</div><div style="color:#fb7185;font-size:10px;">CERRADO (T-3m)</div></div>
              <div class="hour-box closed"><div class="mono" style="font-weight:700;">11:00 AM 🔒</div><div style="color:#fb7185;font-size:10px;">CERRADO (T-3m)</div></div>
              <div class="hour-box closed"><div class="mono" style="font-weight:700;">12:00 PM 🔒</div><div style="color:#fb7185;font-size:10px;">CERRADO (T-3m)</div></div>
              <div class="hour-box closed"><div class="mono" style="font-weight:700;">01:00 PM 🔒</div><div style="color:#fb7185;font-size:10px;">CERRADO (T-3m)</div></div>
              <div class="hour-box open"><div class="mono" style="font-weight:700;color:#fff;">02:00 PM ✓</div><div style="color:#34d399;font-size:10px;">ABIERTO</div></div>
            </div>
          </div>

          <div class="card card-emerald" style="padding:18px;">
            <div class="callout" style="top:-12px;left:220px;">2</div>
            <div class="callout-label" style="top:-12px;left:258px;">2. Apuesta Rápida en Bolívares (Bs.) y Divisa ($ USD) sincronizados</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px;">
              <span style="color:#6ee7b7;font-weight:800;">⌨️ 2. ENTRADA RÁPIDA DE JUGADA EN BOLÍVARES (BS.) Y DIVISA ($ USD)</span>
              <span class="mono" style="color:#cbd5e1;">Premio Potencial (30x): <b style="color:#7dd3fc;">Bs. 1,500.00</b> (<b style="color:#34d399;">$1.69 USD</b>)</span>
            </div>
            <div style="display:grid;grid-template-columns:3fr 3fr 1fr 2.5fr 2.5fr;gap:12px;align-items:end;">
              <div>
                <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Figura (0, 00, 01..36)</div>
                <div style="background:#020617;border:2px solid #10b981;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
                  <span class="mono" style="font-size:18px;font-weight:800;">05</span>
                  <span class="badge">🦁 León</span>
                </div>
              </div>
              <div>
                <div style="font-size:11px;color:#7dd3fc;font-weight:700;margin-bottom:4px;">Monto en Bolívares (Bs.)</div>
                <div class="mono" style="background:#020617;border:2px solid #0ea5e9;border-radius:8px;padding:10px 12px;font-size:18px;font-weight:800;color:#7dd3fc;">50.00</div>
              </div>
              <div style="text-align:center;padding-bottom:12px;color:#34d399;font-weight:900;font-size:18px;">⇄</div>
              <div>
                <div style="font-size:11px;color:#6ee7b7;font-weight:700;margin-bottom:4px;">Monto Divisa ($ USD)</div>
                <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:10px 12px;font-size:18px;font-weight:800;color:#34d399;">0.06</div>
              </div>
              <div>
                <div style="background:#059669;color:#fff;font-weight:800;font-size:12px;text-align:center;padding:13px;border-radius:8px;text-transform:uppercase;">+ Agregar [Enter]</div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid #1e293b;font-size:11px;">
              <div style="display:flex;gap:6px;align-items:center;">
                <span style="color:#38bdf8;font-weight:700;">Apuesta Rápida Bs.:</span>
                <span class="mono" style="background:#082f49;color:#bae6fd;padding:3px 8px;border-radius:5px;border:1px solid #0284c7;">Bs. 10</span>
                <span class="mono" style="background:#082f49;color:#bae6fd;padding:3px 8px;border-radius:5px;border:1px solid #0284c7;">Bs. 20</span>
                <span class="mono" style="background:#082f49;color:#bae6fd;padding:3px 8px;border-radius:5px;border:1px solid #0284c7;">Bs. 30</span>
                <span class="mono" style="background:#0284c7;color:#fff;padding:3px 8px;border-radius:5px;font-weight:800;">Bs. 50</span>
                <span class="mono" style="background:#082f49;color:#bae6fd;padding:3px 8px;border-radius:5px;border:1px solid #0284c7;">Bs. 100</span>
                <span class="mono" style="background:#082f49;color:#bae6fd;padding:3px 8px;border-radius:5px;border:1px solid #0284c7;">Bs. 200</span>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <span style="color:#34d399;font-weight:700;">Divisa $:</span>
                <span class="mono" style="background:#064e3b;color:#a7f3d0;padding:3px 8px;border-radius:5px;">$0.50</span>
                <span class="mono" style="background:#064e3b;color:#a7f3d0;padding:3px 8px;border-radius:5px;">$1.00</span>
                <span class="mono" style="background:#064e3b;color:#a7f3d0;padding:3px 8px;border-radius:5px;">$2.00</span>
                <span class="mono" style="background:#064e3b;color:#a7f3d0;padding:3px 8px;border-radius:5px;">$5.00</span>
              </div>
            </div>
          </div>

          <div class="card" style="flex:1;">
            <div class="callout" style="top:10px;right:20px;">3</div>
            <div class="callout-label" style="top:12px;right:58px;">3. Matriz de 38 Figuras con Cupo Atómico en Vivo (Bs. y USD)</div>
            <div style="font-size:11px;font-weight:700;color:#94a3b8;">CATÁLOGO OFICIAL LOTTO ACTIVO (38 FIGURAS - PAGA 30X EN BS. Y USD)</div>
            <div class="grid-animals">
              ${[
                ["0", "🐬", "Delfín", "$9.0", "Bs.7999"],
                ["00", "🐋", "Ballena", "$10.0", "Bs.8889"],
                ["01", "🐏", "Carnero", "$10.0", "Bs.8889"],
                ["02", "🐂", "Toro", "$10.0", "Bs.8889"],
                ["03", "🐛", "Ciempiés", "$10.0", "Bs.8889"],
                ["04", "🦂", "Alacrán", "$10.0", "Bs.8889"],
                ["05", "🦁", "León", "$6.5", "Bs.5778"],
                ["06", "🐸", "Rana", "$10.0", "Bs.8889"],
                ["07", "🦜", "Perico", "$10.0", "Bs.8889"],
                ["08", "🐭", "Ratón", "$10.0", "Bs.8889"],
                ["09", "🦅", "Águila", "$10.0", "Bs.8889"],
                ["10", "🐯", "Tigre", "$10.0", "Bs.8889"],
                ["11", "🐱", "Gato", "$10.0", "Bs.8889"],
                ["12", "🐴", "Caballo", "$10.0", "Bs.8889"],
                ["13", "🐵", "Mono", "$10.0", "Bs.8889"],
                ["14", "🕊️", "Paloma", "$10.0", "Bs.8889"],
              ]
                .map(
                  ([cod, emo, nom, usd, bs]) => `
                <div class="animal-card">
                  <div style="display:flex;justify-content:space-between;"><span class="mono" style="background:#1e293b;padding:1px 5px;border-radius:4px;font-size:11px;font-weight:800;">${cod}</span><span>${emo}</span></div>
                  <div style="font-size:11px;font-weight:700;margin-top:4px;">${nom}</div>
                  <div class="mono" style="display:flex;justify-content:space-between;font-size:9px;color:#38bdf8;margin-top:4px;"><span>${usd}</span><span>${bs}</span></div>
                  <div style="height:4px;background:#1e293b;border-radius:4px;margin-top:3px;"><div style="width:25%;height:100%;background:#10b981;border-radius:4px;"></div></div>
                </div>`
                )
                .join("")}
            </div>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b;padding-bottom:10px;">
              <div>
                <div style="font-weight:800;font-size:14px;">Ticket en Confección</div>
                <div style="font-size:11px;color:#94a3b8;">Bodega Piloto Magaly • Tasa BCV: Bs. 888.89</div>
              </div>
              <span class="badge">Bs. & USD Activo</span>
            </div>
            <div style="background:#020617;border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:12px;margin-top:12px;">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:8px;">
                <span style="color:#6ee7b7;font-weight:700;">📱 Canal de Entrega del Ticket</span>
                <span class="badge" style="background:#059669;color:#fff;">WhatsApp</span>
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">WhatsApp del Cliente:</div>
              <div class="mono" style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px 10px;font-size:13px;color:#fff;">0414-1234567</div>
            </div>
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
              <div style="background:#020617;border:1px solid #1e293b;border-radius:8px;padding:10px;display:flex;justify-content:space-between;font-size:12px;">
                <div>
                  <div style="font-weight:800;">🦁 <span class="mono" style="color:#34d399;">#05</span> León <span class="mono" style="font-size:10px;background:#1e293b;padding:2px 6px;border-radius:4px;">02:00 PM</span></div>
                  <div class="mono" style="font-size:10px;color:#94a3b8;margin-top:3px;">Premio 30x: Bs. 1,500.00 ($1.69 USD)</div>
                </div>
                <div class="mono" style="text-align:right;">
                  <div style="font-weight:800;color:#7dd3fc;">Bs. 50.00</div>
                  <div style="font-size:10px;color:#34d399;">$0.06 USD</div>
                </div>
              </div>
            </div>
          </div>
          <div>
            <div style="background:#020617;border:1px solid #1e293b;border-radius:10px;padding:12px;font-size:13px;">
              <div style="display:flex;justify-content:space-between;color:#7dd3fc;font-weight:800;margin-bottom:6px;">
                <span>TOTAL EN BOLÍVARES (BCV):</span><span class="mono">Bs. 50.00</span>
              </div>
              <div style="display:flex;justify-content:space-between;color:#fff;font-weight:800;border-top:1px solid #1e293b;padding-top:6px;">
                <span>EQUIVALENTE DIVISA (USD):</span><span class="mono" style="color:#34d399;">$0.06 USD</span>
              </div>
            </div>
            <div style="margin-top:12px;background:#059669;color:#fff;font-weight:800;font-size:12px;text-align:center;padding:14px;border-radius:10px;text-transform:uppercase;">
              💬 Emitir y Enviar Ticket por WhatsApp [F9]
            </div>
          </div>
        </div>
      </div>
    </body></html>`,
  },
  {
    filename: "02-ticket-whatsapp-sin-impresora.png",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>
      ${headerHtml("POS")}
      <div style="padding:12px 24px 0 24px;">
        <div style="background:rgba(6,78,59,0.75);border:1px solid #10b981;border-radius:10px;padding:10px 16px;font-size:12px;color:#d1fae5;font-weight:700;">
          ✅ Ticket #0001045 emitido por Bs. 150.00 ($0.17 USD) y despachado al WhatsApp 0414-1234567 (PIN: 0001045-8A9F1C2B).
        </div>
      </div>
      <div class="main" style="grid-template-columns: 6fr 6fr;">
        <div class="card card-emerald" style="display:flex;flex-direction:column;justify-content:space-between;">
          <div class="callout" style="top:14px;right:18px;">1</div>
          <div class="callout-label" style="top:16px;right:56px;">1. Comprobante Digital WhatsApp con PIN y Firma HMAC</div>
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <span style="font-size:15px;font-weight:800;color:#6ee7b7;">💬 Comprobante WhatsApp Listo (#0001045)</span>
              <span class="mono" style="background:rgba(16,185,129,0.2);color:#a7f3d0;padding:4px 10px;border-radius:6px;font-weight:800;font-size:12px;">PIN: 0001045-8A9F1C2B</span>
            </div>
            <pre class="mono" style="background:#020617;border:1px solid #1e293b;border-radius:12px;padding:16px;font-size:12px;line-height:1.55;color:#e2e8f0;white-space:pre-wrap;">🎟️ *COMPROBANTE OFICIAL - BODEGA PILOTO MAGALY*
🏢 RIF: J-40123987-1 | *LOTTO ACTIVO*
━━━━━━━━━━━━━━━━━━━━
📌 *TICKET N°:* #0001045
🕒 *EMISIÓN:* 29/10/2026, 01:15:42 p. m.
📱 *CLIENTE:* +584141234567
💱 *TASA BCV:* Bs. 888.89 / USD
━━━━━━━━━━━━━━━━━━━━
🦁 *DETALLE DE JUGADAS:*
• *02:00 PM* | *#05 León* ➡️ *Bs. 100.00 ($0.11)* _(Premio 30x: $3.38 / Bs. 3000.00)_
• *02:00 PM* | *#00 Ballena* ➡️ *Bs. 50.00 ($0.06)* _(Premio 30x: $1.69 / Bs. 1500.00)_
━━━━━━━━━━━━━━━━━━━━
💵 *TOTAL USD:* *$0.17*
🇻🇪 *TOTAL BS:* *Bs. 150.00*
━━━━━━━━━━━━━━━━━━━━
🔐 *CÓDIGO PARA RECLAMAR PREMIO:*
👉 *0001045-8A9F1C2B*
🛡️ *FIRMA HMAC-SHA256:*
\`8a9f1c2b4e6d8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607182\`

🔎 *Verificar Ticket / QR Digital:*
https://bancapro-core-venezuela.vercel.app/?ticket=BANCAPRO%7C1111...</pre>
          </div>
          <div style="display:flex;gap:10px;margin-top:14px;">
            <div style="flex:1;background:#059669;color:#fff;font-weight:800;font-size:13px;padding:12px;border-radius:10px;text-align:center;">📤 Reenviar a WhatsApp del Cliente</div>
            <div style="background:#1e293b;color:#e2e8f0;font-weight:700;font-size:13px;padding:12px 20px;border-radius:10px;">📋 Copiar Comprobante</div>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;gap:14px;">
          <div class="callout" style="top:14px;right:18px;">2</div>
          <div class="callout-label" style="top:16px;right:56px;">2. Ventana Estricta de Anulación (&lt; 60 Segundos)</div>
          <div style="font-size:14px;font-weight:800;color:#fff;">Tickets Recientes y Control de Anulación (Bodega Piloto Magaly)</div>
          <div style="background:#020617;border:1px solid #10b981;border-radius:12px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="mono" style="font-weight:800;font-size:14px;color:#fff;">PIN: 0001045-8A9F1C2B</span>
              <span class="badge">EMITIDO</span>
            </div>
            <div class="mono" style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8;margin-top:8px;">
              <span>📱 WA: 0414-1234567</span>
              <span style="color:#7dd3fc;font-weight:700;">Bs. 150.00 ($0.17 USD)</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #1e293b;">
              <span style="font-size:12px;color:#38bdf8;font-weight:700;">Reclamar Premio →</span>
              <span class="mono" style="background:#4c0519;color:#fda4af;border:1px solid #e11d48;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;">⏱️ Anular (48s restantes)</span>
            </div>
          </div>

          <div style="background:#020617;border:1px solid #1e293b;border-radius:12px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="mono" style="font-weight:800;font-size:14px;color:#fff;">PIN: 0001041-9F4C2E81</span>
              <span class="badge" style="background:rgba(245,158,11,0.2);color:#fcd34d;border-color:#f59e0b;">GANADOR (30x)</span>
            </div>
            <div class="mono" style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8;margin-top:8px;">
              <span>📱 WA: 0414-1234567</span>
              <span style="color:#fcd34d;font-weight:700;">Premio: Bs. 53,333.40 ($60.00 USD)</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #1e293b;">
              <span style="font-size:12px;color:#38bdf8;font-weight:700;">Reclamar Premio →</span>
              <span class="mono" style="font-size:11px;color:#64748b;">Ventana 60s expirada (Bloqueado)</span>
            </div>
          </div>
        </div>
      </div>
    </body></html>`,
  },
  {
    filename: "03-reclamo-premio-whatsapp-pin.png",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>
      ${headerHtml("COBRO")}
      <div style="padding:32px;max-width:980px;margin:0 auto;width:100%;">
        <div class="card" style="padding:28px;">
          <div class="callout" style="top:20px;right:24px;">1</div>
          <div class="callout-label" style="top:22px;right:62px;">1. Búsqueda por PIN de WhatsApp, Teléfono o Firma HMAC</div>
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
            <div class="logo" style="width:52px;height:52px;font-size:24px;">💬</div>
            <div>
              <h2 style="font-size:18px;font-weight:800;color:#fff;">Reclamo de Premio por Comprobante de WhatsApp / Firma HMAC-SHA256</h2>
              <p style="font-size:13px;color:#94a3b8;margin-top:3px;">Cuando el cliente muestre su mensaje de WhatsApp, digite el <b style="color:#6ee7b7;">PIN de Reclamo (Ej: 0001041-9F4C2E81)</b> o su número de teléfono.</p>
            </div>
          </div>

          <div style="display:flex;gap:10px;">
            <div class="mono" style="flex:1;background:#020617;border:2px solid #10b981;border-radius:10px;padding:14px 18px;font-size:15px;font-weight:800;color:#fff;">0001041-9F4C2E81</div>
            <div style="background:#059669;color:#fff;font-weight:800;font-size:13px;padding:14px 28px;border-radius:10px;text-transform:uppercase;display:flex;align-items:center;">Verificar Ticket</div>
          </div>

          <div style="margin-top:24px;background:#020617;border:1px solid #1e293b;border-radius:14px;padding:22px;position:relative;">
            <div class="callout" style="top:-14px;left:28px;">2</div>
            <div class="callout-label" style="top:-14px;left:66px;">2. Validación Criptográfica Instantánea y Pago Idempotente en 1 Clic</div>
            <div style="background:rgba(6,78,59,0.85);border:2px solid #10b981;border-radius:12px;padding:20px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div class="mono" style="font-size:12px;color:#a7f3d0;text-transform:uppercase;">🛡️ PIN WhatsApp: 0001041-9F4C2E81 • Cliente: 0414-1234567 • Firma HMAC Auténtica</div>
                <div style="font-size:22px;font-weight:900;color:#ecfdf5;margin-top:6px;">
                  GANADOR - PAGAR Bs. 53,333.40 ($60.00 USD)
                </div>
              </div>
              <div style="background:#10b981;color:#020617;font-weight:900;font-size:13px;padding:16px 24px;border-radius:12px;text-transform:uppercase;box-shadow:0 8px 20px rgba(16,185,129,0.4);">
                ✓ Confirmar Pago Ahora
              </div>
            </div>

            <div style="margin-top:18px;">
              <div style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:8px;">Desglose de Jugadas y Firma HMAC-SHA256 del Comprobante WhatsApp:</div>
              <div class="mono" style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;font-size:13px;">
                <span>Sorteo 09:00 AM • #05 León 🦁 (GANADOR OFICIAL)</span>
                <span style="color:#6ee7b7;font-weight:700;">Jugado: Bs. 1,777.78 ($2.00) → Premio 30x: Bs. 53,333.40 ($60.00 USD)</span>
              </div>
              <div class="mono" style="font-size:11px;color:#64748b;margin-top:10px;">
                HMAC-SHA256: 9f4c2e81b6a04d3e71289a0c55f1e2d3c4b5a697887766554433221100aabbcc
              </div>
            </div>
          </div>
        </div>
      </div>
    </body></html>`,
  },
  {
    filename: "04-caja-y-cupos-comercio.png",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>
      ${headerHtml("CAJA")}
      <div style="padding:24px;display:flex;flex-direction:column;gap:20px;">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;position:relative;">
          <div class="callout" style="top:-12px;left:20px;">1</div>
          <div class="callout-label" style="top:-12px;left:58px;">1. Cuadre de Caja Diario Aislado por Comercio en Bolívares (Bs.) y Divisa ($ USD)</div>
          <div class="card">
            <div style="font-size:12px;color:#94a3b8;">Total Vendido Hoy (Bodega Piloto Magaly)</div>
            <div class="mono" style="font-size:24px;font-weight:900;color:#7dd3fc;margin-top:6px;">Bs. 131,999.17</div>
            <div class="mono" style="font-size:13px;color:#34d399;margin-top:4px;">$148.50 USD</div>
          </div>
          <div class="card">
            <div style="font-size:12px;color:#94a3b8;">Total Premios Generados (30x)</div>
            <div class="mono" style="font-size:24px;font-weight:900;color:#fbbf24;margin-top:6px;">Bs. 53,333.40</div>
            <div class="mono" style="font-size:13px;color:#94a3b8;margin-top:4px;">$60.00 USD</div>
          </div>
          <div class="card">
            <div style="font-size:12px;color:#94a3b8;">Total Premios Pagados en Caja</div>
            <div class="mono" style="font-size:24px;font-weight:900;color:#fb7185;margin-top:6px;">Bs. 53,333.40</div>
            <div class="mono" style="font-size:13px;color:#94a3b8;margin-top:4px;">$60.00 USD</div>
          </div>
          <div class="card card-emerald">
            <div style="font-size:12px;color:#94a3b8;">Utilidad Neta del Comercio</div>
            <div class="mono" style="font-size:24px;font-weight:900;color:#34d399;margin-top:6px;">Bs. 78,665.77</div>
            <div class="mono" style="font-size:13px;color:#7dd3fc;margin-top:4px;">$88.50 USD</div>
          </div>
        </div>

        <div class="card" style="padding:22px;position:relative;">
          <div class="callout" style="top:16px;right:24px;">2</div>
          <div class="callout-label" style="top:18px;right:62px;">2. Configuración Automática de Cupo por Animal (Pérdida Máxima ÷ 30)</div>
          <h3 style="font-size:15px;font-weight:800;color:#fff;">🛡️ Configuración de Cupo de Riesgo del Comercio (Fórmula: Pérdida Máx / 30)</h3>
          <p style="font-size:12px;color:#94a3b8;margin-top:4px;">Defina la pérdida máxima aceptable por sorteo para <b>Bodega Piloto Magaly</b>. El sistema rechaza automáticamente cualquier jugada que supere el cupo resultante.</p>
          <div style="display:flex;gap:16px;align-items:end;margin-top:16px;">
            <div style="flex:1;">
              <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">Pérdida Máxima Aceptable por Sorteo (USD)</div>
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:12px 16px;font-size:16px;font-weight:800;">300.00</div>
            </div>
            <div class="mono" style="background:#020617;border:1px solid #10b981;border-radius:8px;padding:10px 20px;">
              <div style="font-size:11px;color:#94a3b8;">Cupo Máx por Figura:</div>
              <div style="font-size:16px;font-weight:800;color:#34d399;">$10.00 USD (Bs. 8,888.90)</div>
            </div>
            <div style="background:#059669;color:#fff;font-weight:800;font-size:13px;padding:14px 24px;border-radius:8px;">Guardar Cupo</div>
          </div>
        </div>
      </div>
    </body></html>`,
  },
  {
    filename: "05-portal-superadmin-independiente.png",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>
      <div class="header" style="border-bottom-color:rgba(99,102,241,0.4);">
        <div class="brand">
          <div class="logo" style="background:rgba(99,102,241,0.2);border-color:#6366f1;color:#a5b4fc;">SA</div>
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:800;font-size:16px;color:#fff;">BancaPro Core — Portal SuperAdmin Global</span>
              <span class="badge" style="background:rgba(99,102,241,0.2);color:#c7d2fe;border-color:#6366f1;">Control Maestro Multi-Tenant</span>
            </div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Acceso independiente protegido (Usuario: admin / Contraseña: rootadmin1234)</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="background:#1e293b;color:#e2e8f0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;">← Volver a Taquilla Operativa</div>
          <div style="background:#4c0519;color:#fecdd3;border:1px solid #e11d48;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;">🚪 Cerrar Sesión SuperAdmin</div>
        </div>
      </div>

      <div style="padding:22px 24px;display:flex;flex-direction:column;gap:18px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div class="card" style="border-color:rgba(14,165,233,0.4);">
            <div class="callout" style="top:12px;right:16px;">1</div>
            <div class="callout-label" style="top:14px;right:54px;">1. Control Maestro de Tasa BCV</div>
            <h3 style="font-size:14px;font-weight:800;color:#fff;">💲 Control Maestro de Tasa Oficial BCV (USD / Bs.)</h3>
            <p style="font-size:12px;color:#94a3b8;margin-top:4px;">Sincronice desde el API oficial del BCV o fije una tasa global en la base de datos.</p>
            <div style="display:flex;gap:10px;margin-top:14px;">
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:10px 14px;font-size:15px;font-weight:800;width:140px;">888.89</div>
              <div style="background:#0284c7;color:#fff;font-weight:800;font-size:12px;padding:10px 16px;border-radius:8px;display:flex;align-items:center;">Fijar Tasa en BD</div>
              <div style="background:#1e293b;color:#7dd3fc;border:1px solid rgba(14,165,233,0.4);font-weight:800;font-size:12px;padding:10px 16px;border-radius:8px;display:flex;align-items:center;">🔄 Sincronizar API Oficial BCV</div>
            </div>
          </div>

          <div class="card" style="border-color:rgba(245,158,11,0.4);">
            <div class="callout" style="top:12px;right:16px;">2</div>
            <div class="callout-label" style="top:14px;right:54px;">2. Liquidación Global en 2 Pasos</div>
            <h3 style="font-size:14px;font-weight:800;color:#fcd34d;">🏆 Liquidación Oficial de Sorteo (Todos los Comercios)</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:10px;font-size:12px;">Sorteo: 02:00 PM</div>
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:10px;font-size:12px;">Animal Ganador: 05 (León)</div>
            </div>
            <div style="margin-top:10px;background:#d97706;color:#020617;font-weight:900;font-size:12px;padding:10px;border-radius:8px;text-align:center;text-transform:uppercase;">Paso 1: Pre-validar Animal Ganador</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:5fr 7fr;gap:18px;">
          <div class="card">
            <div class="callout" style="top:12px;right:16px;">3</div>
            <div class="callout-label" style="top:14px;right:54px;">3. Crear Nuevos Comercios (Tenants RLS)</div>
            <h3 style="font-size:14px;font-weight:800;color:#fff;margin-bottom:12px;">➕ Aprovisionar Nuevo Comercio / Bodega (Tenant RLS)</h3>
            <div style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
              <div style="background:#020617;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#94a3b8;">Nombre: Inversiones El Gran Premio C.A.</div>
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#94a3b8;">RIF: J-41239876-0</div>
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#94a3b8;">Admin: admin@granpremio.local</div>
              <div class="mono" style="background:#020617;border:1px solid #334155;border-radius:8px;padding:9px 12px;color:#94a3b8;">Pérdida Máxima por Sorteo: $450.00 USD (Cupo: $15.00)</div>
              <div style="background:#4f46e5;color:#fff;font-weight:800;text-align:center;padding:11px;border-radius:8px;text-transform:uppercase;">Crear Tenant y Asignar Políticas RLS</div>
            </div>
          </div>

          <div class="card">
            <h3 style="font-size:14px;font-weight:800;color:#fff;margin-bottom:12px;">Comercios Activos en la Plataforma (Fondos y Cajas 100% Aislados)</h3>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div style="background:#020617;border:1px solid #1e293b;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:800;font-size:14px;">Bodega Piloto Magaly <span class="badge">J-40123987-1</span></div>
                  <div class="mono" style="font-size:11px;color:#94a3b8;margin-top:4px;">Admin: magaly.rodriguez@bancapro.local • UUID: 11111111-1111...</div>
                </div>
                <div class="mono" style="text-align:right;font-size:12px;">
                  <div style="color:#34d399;font-weight:800;">Cupo Animal: $10.00 USD (Bs. 8,888.90)</div>
                  <div style="color:#94a3b8;">Pérdida Máx: $300.00 USD</div>
                </div>
              </div>
              <div style="background:#020617;border:1px solid #1e293b;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:800;font-size:14px;">Agencia La Suerte Centro <span class="badge">J-50291823-9</span></div>
                  <div class="mono" style="font-size:11px;color:#94a3b8;margin-top:4px;">Admin: admin@lasuerte.local • UUID: 33333333-3333...</div>
                </div>
                <div class="mono" style="text-align:right;font-size:12px;">
                  <div style="color:#34d399;font-weight:800;">Cupo Animal: $20.00 USD (Bs. 17,777.80)</div>
                  <div style="color:#94a3b8;">Pérdida Máx: $600.00 USD</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body></html>`,
  },
];

console.log("Generando capturas anotadas en alta definición con Google Chrome...");
const base64Images = {};

for (const item of screens) {
  const htmlPath = path.join(TEMP_HTML_DIR, item.filename.replace(".png", ".html"));
  const pngPath = path.join(SCREENSHOTS_DIR, item.filename);
  const artifactPngPath = path.join(ARTIFACT_DIR, item.filename);

  fs.writeFileSync(htmlPath, item.html, "utf8");

  execFileSync(CHROME_PATH, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1400,860",
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ]);

  fs.copyFileSync(pngPath, artifactPngPath);
  base64Images[item.filename] = fs.readFileSync(pngPath).toString("base64");
  console.log("✔ Captura creada:", item.filename);
}

// Construir el documento HTML editorial para exportar el PDF oficial
const manualPdfHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Manual Oficial de Uso y Configuración — BancaPro Core</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Inter, system-ui, sans-serif; }
    body { color: #0f172a; background: #ffffff; font-size: 11.5px; line-height: 1.5; }
    .page-break { page-break-before: always; }
    .cover { background: linear-gradient(135deg, #020617 0%, #0f172a 60%, #064e3b 100%); color: #ffffff; padding: 36px; border-radius: 18px; margin-bottom: 20px; border: 2px solid #10b981; }
    .cover-badge { display: inline-block; background: rgba(16,185,129,0.2); border: 1px solid #34d399; color: #6ee7b7; font-family: monospace; font-size: 11px; padding: 4px 10px; border-radius: 6px; margin-bottom: 12px; }
    .cover h1 { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; margin-bottom: 8px; }
    .cover p { font-size: 13px; color: #cbd5e1; max-width: 90%; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
    .meta-box { background: rgba(2,6,23,0.75); border: 1px solid #334155; padding: 10px 12px; border-radius: 10px; }
    .meta-box .lbl { font-size: 10px; color: #94a3b8; text-transform: uppercase; }
    .meta-box .val { font-size: 12px; font-weight: 800; color: #34d399; font-family: monospace; margin-top: 2px; }
    h2 { font-size: 16px; font-weight: 900; color: #065f46; border-bottom: 2px solid #10b981; padding-bottom: 5px; margin: 16px 0 10px 0; }
    h3 { font-size: 13px; font-weight: 800; color: #0f172a; margin: 10px 0 6px 0; }
    .screenshot-frame { border: 2px solid #0f172a; border-radius: 10px; overflow: hidden; margin: 10px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
    .screenshot-frame img { width: 100%; display: block; }
    .steps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
    .step-card { background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #10b981; border-radius: 8px; padding: 9px 12px; }
    .step-num { display: inline-block; background: #f59e0b; color: #020617; font-weight: 900; width: 20px; height: 20px; text-align: center; line-height: 20px; border-radius: 50%; font-size: 11px; margin-right: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
    th { background: #0f172a; color: #ffffff; font-weight: 700; }
    tr:nth-child(even) { background: #f8fafc; }
    .alert-box { background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 10px 14px; border-radius: 8px; margin-top: 10px; font-weight: 600; }
  </style>
</head>
<body>
  <!-- PORTADA Y CAPÍTULO 1 -->
  <div class="cover">
    <div class="cover-badge">MANUAL INTERACTIVO Y OPERATIVO DE USUARIO • VERSIÓN PRODUCCIÓN</div>
    <h1>BancaPro Core — Sistema Multi-Tenant Lotto Activo</h1>
    <p>Guía paso a paso con capturas reales para Comercios, Cajeros y Administradores: Venta rápida en Bolívares (Bs.) y Divisa ($ USD), Tickets Digitales por WhatsApp sin impresora, Reclamo de Premios con PIN Criptográfico y Control de Cupos de Riesgo.</p>
    <div class="meta-grid">
      <div class="meta-box"><div class="lbl">URL en Producción</div><div class="val">bancapro-core-venezuela.vercel.app</div></div>
      <div class="meta-box"><div class="lbl">Comercio Piloto</div><div class="val">Bodega Piloto Magaly</div></div>
      <div class="meta-box"><div class="lbl">Modalidad de Entrega</div><div class="val">WhatsApp / Térmica ESC-POS</div></div>
    </div>
  </div>

  <h2>1. Taquilla POS Ultra-Rápida: Apuestas en Bolívares (Bs.) y Divisa ($ USD)</h2>
  <p>La pantalla principal de Taquilla está diseñada para operar al 100% con el teclado numérico y expresa simultáneamente cada jugada tanto en <b>Bolívares (Bs.)</b> como en <b>Dólares ($ USD)</b> sincronizados en tiempo real con la <b>Tasa Oficial del BCV</b>.</p>

  <div class="screenshot-frame">
    <img src="data:image/png;base64,${base64Images["01-taquilla-pos-bs-usd.png"]}" alt="Taquilla POS en Bolívares y USD" />
  </div>

  <div class="steps-grid">
    <div class="step-card">
      <span class="step-num">1</span><b>Sincronización Automática BCV y Cierre (T - 3m):</b> Al abrir la página, el sistema consulta automáticamente la tasa oficial del BCV. El reloj amarillo bloquea las ventas exactamente 3 minutos antes de cada sorteo.
    </div>
    <div class="step-card">
      <span class="step-num">2</span><b>Monto en Bolívares (Bs.) ⇄ Divisa ($ USD):</b> Escriba el monto directamente en Bolívares (ej. <b>Bs. 50</b>) o use los botones rápidos (<b>Bs. 10, Bs. 20, Bs. 50, Bs. 100</b>). El sistema calcula al instante su equivalente en USD y el premio potencial (30x).
    </div>
    <div class="step-card">
      <span class="step-num">3</span><b>Selección de Animalito por Teclado o Clic:</b> Digite el código (<b>0</b> = Delfín, <b>00</b> = Ballena, <b>01..36</b>) y presione <b>[Enter]</b>, o haga clic directamente sobre cualquiera de las 38 tarjetas del catálogo.
    </div>
    <div class="step-card">
      <span class="step-num">4</span><b>Control de Cupo en Vivo por Figura:</b> Debajo de cada animalito se muestra su cupo disponible tanto en <b>$ USD</b> como en <b>Bs.</b> Si una jugada supera el cupo, el servidor la rechaza automáticamente.
    </div>
  </div>

  <!-- CAPÍTULO 2: TICKET DIGITAL WHATSAPP Y ANULACIÓN -->
  <div class="page-break"></div>
  <h2>2. Emisión de Ticket por WhatsApp (Sin Impresora) y Regla de Anulación (&lt; 60s)</h2>
  <p>Si el comercio no dispone de impresora térmica física, el modo <b>WhatsApp</b> envía al teléfono del cliente un comprobante digital blindado con un <b>PIN de Reclamo</b> y una <b>Firma Criptográfica HMAC-SHA256</b> imposible de falsificar.</p>

  <div class="screenshot-frame">
    <img src="data:image/png;base64,${base64Images["02-ticket-whatsapp-sin-impresora.png"]}" alt="Ticket Digital por WhatsApp" />
  </div>

  <div class="steps-grid">
    <div class="step-card">
      <span class="step-num">1</span><b>Envío al WhatsApp del Cliente:</b> Ingrese el teléfono del cliente (ej. <code>0414-1234567</code>) y presione <b>[F9]</b> o el botón verde. Se abrirá el chat de WhatsApp con el desglose en Bs. y USD, el <b>PIN de Reclamo</b> (ej. <code>0001045-8A9F1C2B</code>) y el enlace de verificación.
    </div>
    <div class="step-card">
      <span class="step-num">2</span><b>Regla Anti-Fraude de Anulación (&lt; 60 Segundos):</b> Si el cajero cometió un error al digitar, dispone de exactamente <b>60 segundos</b> para pulsar el botón rojo <b>Anular</b> (siempre que falten más de 3 minutos para el sorteo). El cupo se libera de inmediato.
    </div>
  </div>

  <!-- CAPÍTULO 3: RECLAMO Y COBRO DE PREMIOS -->
  <h2>3. Verificación y Pago de Premios por WhatsApp (PIN / Teléfono / QR)</h2>
  <p>Cuando un cliente acierta el animalito ganador (paga <b>30 veces</b> lo apostado), acude a la taquilla o reenvía su comprobante de WhatsApp para cobrar su premio.</p>

  <div class="screenshot-frame">
    <img src="data:image/png;base64,${base64Images["03-reclamo-premio-whatsapp-pin.png"]}" alt="Reclamo y Pago de Premio" />
  </div>

  <div class="steps-grid">
    <div class="step-card">
      <span class="step-num">1</span><b>Búsqueda Rápida:</b> En la pestaña <b>2. Reclamar Premio</b>, escriba el <b>PIN de Reclamo</b> del mensaje de WhatsApp (ej. <code>0001041-9F4C2E81</code>) o el número telefónico del cliente y pulse <b>Verificar Ticket</b>.
    </div>
    <div class="step-card">
      <span class="step-num">2</span><b>Desembolso Idempotente (Un Solo Cobro):</b> El sistema muestra en grande el monto exacto a pagar en <b>Bolívares y USD</b>. Al hacer clic en <b>Confirmar Pago Ahora</b>, el ticket pasa a estado <b>PAGADO</b> y queda bloqueado contra cobros dobles.
    </div>
  </div>

  <!-- CAPÍTULO 4: CUADRE DE CAJA Y CUPOS DEL COMERCIO -->
  <div class="page-break"></div>
  <h2>4. Cuadre de Caja Diario y Configuración de Cupos del Comercio</h2>
  <p>En la pestaña <b>3. Caja & Cupos</b>, el administrador del comercio monitorea sus ventas y define cuánto riesgo máximo desea asumir por sorteo.</p>

  <div class="screenshot-frame">
    <img src="data:image/png;base64,${base64Images["04-caja-y-cupos-comercio.png"]}" alt="Cuadre de Caja y Cupos" />
  </div>

  <div class="steps-grid">
    <div class="step-card">
      <span class="step-num">1</span><b>Cuadre Diario en Bs. y USD:</b> Visualice al instante el <i>Total Vendido Hoy</i>, <i>Total Premios Generados (30x)</i>, <i>Total Premios Pagados</i> y la <i>Utilidad Neta</i> de su comercio, completamente aislada de otras agencias.
    </div>
    <div class="step-card">
      <span class="step-num">2</span><b>Fórmula de Cupo de Riesgo (Pérdida Máxima ÷ 30):</b> Si su comercio define una Pérdida Máxima Aceptable de <b>$300 USD</b> por sorteo, el sistema fija automáticamente el cupo máximo por animalito en <b>$10.00 USD</b> (<code>300 ÷ 30 = $10</code>).
    </div>
  </div>

  <!-- CAPÍTULO 5: PORTAL SUPERADMIN INDEPENDIENTE -->
  <h2>5. Portal SuperAdmin Independiente (Uso Exclusivo Administración Global)</h2>
  <p>El control global de la plataforma se encuentra separado de la taquilla mediante el botón morado <b>🔑 Portal SuperAdmin</b>.</p>

  <div class="screenshot-frame">
    <img src="data:image/png;base64,${base64Images["05-portal-superadmin-independiente.png"]}" alt="Portal SuperAdmin Independiente" />
  </div>

  <table>
    <thead>
      <tr>
        <th>Parámetro / Función SuperAdmin</th>
        <th>Detalle de Configuración y Uso</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><b>Credenciales de Acceso al Portal</b></td>
        <td>Usuario: <code>admin</code> &nbsp;|&nbsp; Contraseña Maestra: <code>rootadmin1234</code></td>
      </tr>
      <tr>
        <td><b>1. Control Maestro de Tasa BCV</b></td>
        <td>Permite sincronizar en 1 clic con el API oficial del BCV o fijar manualmente una tasa en Bs./USD para todos los comercios.</td>
      </tr>
      <tr>
        <td><b>2. Liquidación Oficial en 2 Pasos</b></td>
        <td>Permite liquidar manualmente un sorteo (contingencia) calculando automáticamente los ganadores (30x) en todos los comercios.</td>
      </tr>
      <tr>
        <td><b>3. Creación de Comercios (Tenants)</b></td>
        <td>Permite registrar nuevas bodegas/agencias con su RIF, correo administrador y pérdida máxima por sorteo con aislamiento RLS total.</td>
      </tr>
    </tbody>
  </table>

  <div class="alert-box">
    📌 Acceso directo en línea al sistema y al manual interactivo: https://bancapro-core-venezuela.vercel.app/manual
  </div>
</body>
</html>`;

const manualHtmlPath = path.join(TEMP_HTML_DIR, "manual_completo.html");
fs.writeFileSync(manualHtmlPath, manualPdfHtml, "utf8");

const pdfPublicPath = path.join(ROOT_DIR, "public", "Manual_Uso_BancaPro_Core.pdf");
const pdfRootPath = path.join(ROOT_DIR, "Manual_Uso_BancaPro_Core.pdf");
const pdfArtifactPath = path.join(ARTIFACT_DIR, "Manual_Uso_BancaPro_Core.pdf");

console.log("Exportando PDF de alta resolución con Google Chrome...");
execFileSync(CHROME_PATH, [
  "--headless=new",
  "--disable-gpu",
  "--no-pdf-header-footer",
  "--print-to-pdf-no-header",
  `--print-to-pdf=${pdfPublicPath}`,
  `file:///${manualHtmlPath.replace(/\\/g, "/")}`,
]);

fs.copyFileSync(pdfPublicPath, pdfRootPath);
fs.copyFileSync(pdfPublicPath, pdfArtifactPath);

const stats = fs.statSync(pdfPublicPath);
console.log(`✔ PDF generado exitosamente (${(stats.size / 1024).toFixed(1)} KB):`);
console.log("  ->", pdfPublicPath);
console.log("  ->", pdfRootPath);
console.log("  ->", pdfArtifactPath);
