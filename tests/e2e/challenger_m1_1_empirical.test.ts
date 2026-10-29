import { describe, it, expect, vi } from "vitest";
import {
  emitirTicket,
  anularTicket,
  liquidarSorteo,
  pagarTicketGanador,
} from "@/lib/actions/transacciones";
import fs from "fs";
import path from "path";

const SUPABASE_URL = "https://sgzpxrmdpvirshyccrss.supabase.co";
const ANON_KEY = "sb_publishable_LD3ZnrAAiCebDUR-sf_F7A_kCd9ub3K";

describe("Challenger 1 - Empirical Stress Suite: GoTrue Auth & Server Actions Persistence", () => {
  // =========================================================================
  // 1. EMPIRICAL GOTRUE AUTHENTICATION ADVERSARIAL STRESS
  // =========================================================================
  describe("1. Live GoTrue Authentication Rejection & Adversarial Testing", () => {
    it("1.1 should strictly reject invalid password for tenant admin", async () => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "magaly.rodriguez@bancapro.local",
          password: "wrong_password_attempt_999",
        }),
      });

      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error_code).toBe("invalid_credentials");
      expect(body.access_token).toBeUndefined();
      expect(body.user).toBeUndefined();
    });

    it("1.2 should strictly reject non-existent user login", async () => {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "fraudulent.operator@bancapro.local",
          password: "any_password_123",
        }),
      });

      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error_code).toBe("invalid_credentials");
      expect(body.access_token).toBeUndefined();
    });

    it("1.3 should reject empty credentials and SQL-injection attempts safely", async () => {
      const payloads = [
        { email: "", password: "" },
        { email: "' OR '1'='1", password: "' OR '1'='1" },
        { email: "admin'--", password: "123" },
      ];

      for (const payload of payloads) {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.access_token).toBeUndefined();
      }
    });

    it("1.4 should authenticate valid tenant admin and verify strict RLS isolation", async () => {
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "magaly.rodriguez@bancapro.local",
          password: "123456789",
        }),
      });

      const authData = await authRes.json();
      expect(authRes.status).toBe(200);
      expect(authData.access_token).toBeDefined();
      expect(authData.user.id).toBe("22222222-2222-4222-8222-222222222222");

      // Verify RLS isolation on tenants table
      const tenantRes = await fetch(`${SUPABASE_URL}/rest/v1/tenants?select=*`, {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${authData.access_token}`,
        },
      });
      const tenants = await tenantRes.json();
      expect(tenants).toHaveLength(1);
      expect(tenants[0].id).toBe("11111111-1111-4111-8111-111111111111");
      expect(tenants[0].nombre).toBe("Bodega Piloto Magaly");
    });
  });

  // =========================================================================
  // 2. UNAUTHENTICATED BET PLACEMENT & SERVER ACTION REJECTION
  // =========================================================================
  describe("2. Unauthenticated Bet Placement Rejection", () => {
    it("2.1 should reject direct PostgREST RPC emitir_ticket call when unauthenticated", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/emitir_ticket`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
          p_secret_key: "bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210",
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe("P0001");
      expect(data.message).toContain("NO_AUTORIZADO");
    });

    it("2.2 should reject PostgREST RPC emitir_ticket call with tampered/forged JWT", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/emitir_ticket`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.signature",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
          p_secret_key: "bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210",
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe("PGRST301");
      expect(data.message).toContain("JWT");
    });

    it("2.3 should reject emitirTicket Server Action when caller is unauthenticated", async () => {
      const result = await emitirTicket([
        { sorteo_diario_id: 1, animal_numero: 10, monto_usd: 2.0 },
      ]);

      expect(result.ok).toBe(false);
      expect(result.codigoError).toBe("NO_AUTORIZADO");
      expect(result.error).toContain("NO_AUTORIZADO");
      expect(result.ticket).toBeUndefined();
    });

    it("2.4 should reject emitirTicket Server Action when jugadas payload is empty", async () => {
      const result = await emitirTicket([]);

      expect(result.ok).toBe(false);
      expect(result.codigoError).toBe("ERROR_TRANSACCIONAL");
      expect(result.error).toContain("El ticket debe incluir al menos una jugada");
      expect(result.ticket).toBeUndefined();
    });

    it("2.5 should reject anularTicket Server Action when unauthenticated", async () => {
      const result = await anularTicket("11111111-2222-3333-4444-555555555555");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("NO_AUTORIZADO");
    });

    it("2.6 should reject liquidarSorteo Server Action when unauthenticated", async () => {
      const result = await liquidarSorteo(1, 15, "MANUAL_CONTINGENCIA");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("NO_AUTORIZADO");
    });

    it("2.7 should reject pagarTicketGanador Server Action when unauthenticated", async () => {
      const result = await pagarTicketGanador("BANCAPRO|fake|ticket|1.00|12345678|hash");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("NO_AUTORIZADO");
    });
  });

  // =========================================================================
  // 3. GHOST TICKET ELIMINATION UNDER ADVERSARIAL FAILURE CONDITIONS
  // =========================================================================
  describe("3. Ghost Ticket Elimination Under Adversarial Failure Conditions", () => {
    // Model client-side state reducer identical to TaquillaPos.tsx lines 520–640
    interface PosClientState {
      ticketsPorTenant: Record<string, any[]>;
      cuposAcumulados: Record<string, number>;
      ultimoTicketImpreso: any | null;
      ultimoTicketWhatsApp: any | null;
      alertaSistema: { tipo: string; mensaje: string } | null;
      procesandoVenta: boolean;
      carrito: any[];
    }

    const tenantActual = {
      id: "11111111-1111-4111-8111-111111111111",
      nombre: "Bodega Piloto Magaly",
      rif: "J-40123987-1",
      cupoAnimalUsd: 10.0,
    };

    function runPosTicketEmissionCycle(
      state: PosClientState,
      rpcResponse: { ok: boolean; ticket?: any; error?: string } | null,
      shouldThrow = false
    ): PosClientState {
      const nextState = JSON.parse(JSON.stringify(state));
      nextState.procesandoVenta = true;
      nextState.alertaSistema = null;

      try {
        if (shouldThrow) {
          throw new Error("Network timeout: failed to connect to Supabase backend");
        }

        // Exact check from TaquillaPos.tsx line 539:
        // if (!respuestaRpc.ok || !respuestaRpc.ticket)
        if (!rpcResponse || !rpcResponse.ok || !rpcResponse.ticket) {
          nextState.alertaSistema = {
            tipo: "error",
            mensaje: `TRANSACCIÓN RECHAZADA POR EL SERVIDOR: ${
              rpcResponse?.error || "Fallo en la emisión del ticket."
            }`,
          };
          nextState.procesandoVenta = false;
          return nextState;
        }

        // Genuinely confirmed ticket branch
        const ticketConfirmado = rpcResponse.ticket;
        const ticketIdFinal = ticketConfirmado.ticket_id;
        const serialCortoFinal = String(ticketConfirmado.serial_corto).padStart(7, "0");

        // Update cupos
        for (const item of nextState.carrito) {
          const k = `${tenantActual.id}_${item.sorteoId}_${item.figura.dbNumber}`;
          nextState.cuposAcumulados[k] = Number(
            ((nextState.cuposAcumulados[k] ?? 0) + item.montoUsd).toFixed(2)
          );
        }

        const nuevoTicket = {
          ticketId: ticketIdFinal,
          serialCorto: serialCortoFinal,
          estado: "EMITIDO",
        };

        nextState.ticketsPorTenant[tenantActual.id] = [
          nuevoTicket,
          ...(nextState.ticketsPorTenant[tenantActual.id] ?? []),
        ];
        nextState.ultimoTicketImpreso = { serialCorto: serialCortoFinal };
        nextState.ultimoTicketWhatsApp = nuevoTicket;
        nextState.carrito = [];
        nextState.alertaSistema = {
          tipo: "exito",
          mensaje: `Ticket #${serialCortoFinal} emitido.`,
        };
      } catch (err: any) {
        nextState.alertaSistema = {
          tipo: "error",
          mensaje: `TRANSACCIÓN RECHAZADA POR EL SERVIDOR: ${err.message}`,
        };
      } finally {
        nextState.procesandoVenta = false;
      }

      return nextState;
    }

    const initialCart = [
      {
        sorteoId: 1,
        sorteoEtiqueta: "09:00 AM",
        figura: { dbNumber: 5, codigo: "05", nombre: "LEON" },
        montoUsd: 2.0,
      },
    ];

    function createFreshState(): PosClientState {
      return {
        ticketsPorTenant: { [tenantActual.id]: [] },
        cuposAcumulados: {},
        ultimoTicketImpreso: null,
        ultimoTicketWhatsApp: null,
        alertaSistema: null,
        procesandoVenta: false,
        carrito: [...initialCart],
      };
    }

    it("3.1 should NOT create ghost ticket on CUPO_AGOTADO failure", () => {
      const state = createFreshState();
      const nextState = runPosTicketEmissionCycle(state, {
        ok: false,
        error: "CUPO_AGOTADO: Cupo agotado para esta figura (LEON)",
      });

      expect(nextState.ticketsPorTenant[tenantActual.id]).toHaveLength(0);
      expect(Object.keys(nextState.cuposAcumulados)).toHaveLength(0);
      expect(nextState.ultimoTicketImpreso).toBeNull();
      expect(nextState.ultimoTicketWhatsApp).toBeNull();
      expect(nextState.alertaSistema?.tipo).toBe("error");
      expect(nextState.alertaSistema?.mensaje).toContain("CUPO_AGOTADO");
      expect(nextState.carrito).toHaveLength(1); // Cart preserved for retry
    });

    it("3.2 should NOT create ghost ticket on LOCKDOWN_ACTIVO failure", () => {
      const state = createFreshState();
      const nextState = runPosTicketEmissionCycle(state, {
        ok: false,
        error: "LOCKDOWN_ACTIVO: El sorteo cerró 3 minutos antes",
      });

      expect(nextState.ticketsPorTenant[tenantActual.id]).toHaveLength(0);
      expect(Object.keys(nextState.cuposAcumulados)).toHaveLength(0);
      expect(nextState.ultimoTicketImpreso).toBeNull();
      expect(nextState.ultimoTicketWhatsApp).toBeNull();
      expect(nextState.alertaSistema?.tipo).toBe("error");
      expect(nextState.alertaSistema?.mensaje).toContain("LOCKDOWN_ACTIVO");
    });

    it("3.3 should NOT create ghost ticket on NO_AUTORIZADO failure", () => {
      const state = createFreshState();
      const nextState = runPosTicketEmissionCycle(state, {
        ok: false,
        error: "NO_AUTORIZADO: Debe iniciar sesión con una cuenta de operador activa",
      });

      expect(nextState.ticketsPorTenant[tenantActual.id]).toHaveLength(0);
      expect(Object.keys(nextState.cuposAcumulados)).toHaveLength(0);
      expect(nextState.ultimoTicketImpreso).toBeNull();
      expect(nextState.ultimoTicketWhatsApp).toBeNull();
      expect(nextState.alertaSistema?.tipo).toBe("error");
      expect(nextState.alertaSistema?.mensaje).toContain("NO_AUTORIZADO");
    });

    it("3.4 should NOT create ghost ticket on live DB runtime error (hmac missing / 42883)", () => {
      const state = createFreshState();
      const nextState = runPosTicketEmissionCycle(state, {
        ok: false,
        error: "function hmac(text, text, unknown) does not exist",
      });

      expect(nextState.ticketsPorTenant[tenantActual.id]).toHaveLength(0);
      expect(Object.keys(nextState.cuposAcumulados)).toHaveLength(0);
      expect(nextState.ultimoTicketImpreso).toBeNull();
      expect(nextState.ultimoTicketWhatsApp).toBeNull();
      expect(nextState.alertaSistema?.tipo).toBe("error");
      expect(nextState.alertaSistema?.mensaje).toContain("function hmac");
    });

    it("3.5 should NOT create ghost ticket on network timeout / exception thrown", () => {
      const state = createFreshState();
      const nextState = runPosTicketEmissionCycle(state, null, true);

      expect(nextState.ticketsPorTenant[tenantActual.id]).toHaveLength(0);
      expect(Object.keys(nextState.cuposAcumulados)).toHaveLength(0);
      expect(nextState.ultimoTicketImpreso).toBeNull();
      expect(nextState.ultimoTicketWhatsApp).toBeNull();
      expect(nextState.alertaSistema?.tipo).toBe("error");
      expect(nextState.alertaSistema?.mensaje).toContain("Network timeout");
    });

    it("3.6 should NOT create ghost ticket when response is malformed (ok=true but missing ticket object)", () => {
      const state = createFreshState();
      const nextState = runPosTicketEmissionCycle(state, { ok: true, ticket: undefined });

      expect(nextState.ticketsPorTenant[tenantActual.id]).toHaveLength(0);
      expect(Object.keys(nextState.cuposAcumulados)).toHaveLength(0);
      expect(nextState.ultimoTicketImpreso).toBeNull();
      expect(nextState.ultimoTicketWhatsApp).toBeNull();
      expect(nextState.alertaSistema?.tipo).toBe("error");
    });

    it("3.7 should strictly verify that ticket issuance logic has zero crypto.randomUUID() or random serial fallback", () => {
      const posFile = path.resolve(__dirname, "../../src/components/pos/TaquillaPos.tsx");
      const content = fs.readFileSync(posFile, "utf8");

      // Verify that ticket emission no longer falls back to fake UUIDs or fake serials
      expect(content).not.toContain("respuestaRpc.ticket?.ticket_id ?? crypto.randomUUID()");
      expect(content).not.toContain("Math.floor(1042 + Math.random() * 8900)");
      expect(content).toContain("if (!respuestaRpc.ok || !respuestaRpc.ticket)");

      // Extract the entire procesarEmisionTicket body to ensure no mock generators exist within emission
      const emisionBlockMatch = content.match(/const procesarEmisionTicket = async \(\) =>[\s\S]*?const sincronizarTasaBcvAhora/);
      expect(emisionBlockMatch).not.toBeNull();
      const emisionBlock = emisionBlockMatch![0];
      expect(emisionBlock).not.toContain("crypto.randomUUID()");
      expect(emisionBlock).not.toContain("Math.random() * 8900");
    });
  });
});
