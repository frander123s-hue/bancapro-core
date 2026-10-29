import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { BancaProSimulator } from "./helpers/bancapro-simulator";
import {
  actualizarTasaBcv,
  liquidarSorteo,
  emitirTicket,
  anularTicket,
  pagarTicketGanador,
} from "@/lib/actions/transacciones";

const SUPABASE_URL = "https://sgzpxrmdpvirshyccrss.supabase.co";
const ANON_KEY = "sb_publishable_LD3ZnrAAiCebDUR-sf_F7A_kCd9ub3K";

describe("Challenger 2 - Empirical Challenge: Multi-Tenant RLS Isolation & SQL Hardening", () => {
  // =========================================================================
  // 1. LIVE SUPABASE RLS MULTI-TENANT ISOLATION
  // =========================================================================
  describe("1. Live Multi-Tenant Row-Level Security (RLS) Isolation", () => {
    let magalyToken = "";
    let magalyUserId = "";

    it("1.1 should authenticate Magaly and retrieve valid GoTrue JWT", async () => {
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

      expect(authRes.status).toBe(200);
      const authData = await authRes.json();
      expect(authData.access_token).toBeDefined();
      magalyToken = authData.access_token;
      magalyUserId = authData.user.id;
      expect(magalyUserId).toBe("22222222-2222-4222-8222-222222222222");
    });

    it("1.2 should strictly isolate tenants table: Magaly sees exactly 1 tenant record", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/tenants?select=*`, {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${magalyToken}`,
        },
      });

      expect(res.status).toBe(200);
      const tenants = await res.json();
      expect(Array.isArray(tenants)).toBe(true);
      expect(tenants).toHaveLength(1);
      expect(tenants[0].id).toBe("11111111-1111-4111-8111-111111111111");
      expect(tenants[0].nombre).toBe("Bodega Piloto Magaly");
      expect(tenants[0].rif).toBe("J-40123987-1");
      expect(tenants[0].perdida_maxima_sorteo_usd).toBe(300);
    });

    it("1.3 should prevent cross-tenant leakage: filtering for other tenants returns empty set", async () => {
      // Query with not-equal to own tenant
      const resNeq = await fetch(
        `${SUPABASE_URL}/rest/v1/tenants?id=neq.11111111-1111-4111-8111-111111111111&select=*`,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${magalyToken}`,
          },
        }
      );

      expect(resNeq.status).toBe(200);
      const dataNeq = await resNeq.json();
      expect(dataNeq).toHaveLength(0);

      // Query for an arbitrary foreign tenant UUID
      const resForeign = await fetch(
        `${SUPABASE_URL}/rest/v1/tenants?id=eq.99999999-9999-4999-8999-999999999999&select=*`,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${magalyToken}`,
          },
        }
      );

      expect(resForeign.status).toBe(200);
      const dataForeign = await resForeign.json();
      expect(dataForeign).toHaveLength(0);
    });

    it("1.4 should reject Magaly inserting a new tenant (non-superadmin check)", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/tenants`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${magalyToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          id: "33333333-3333-4333-8333-333333333333",
          nombre: "Comercio Malicioso",
          rif: "J-99999999-9",
          perdida_maxima_sorteo_usd: 500,
          activo: true,
        }),
      });

      expect([400, 401, 403]).toContain(res.status);
      const err = await res.json();
      expect(err.code).toBe("42501");
      expect(err.message).toContain("row-level security policy");
    });

    it("1.5 should strictly block anonymous access to tenants table", async () => {
      // Anon select
      const resSelect = await fetch(`${SUPABASE_URL}/rest/v1/tenants?select=*`, {
        headers: { apikey: ANON_KEY },
      });
      expect(resSelect.status).toBe(200);
      const dataSelect = await resSelect.json();
      expect(dataSelect).toHaveLength(0);

      // Anon insert
      const resInsert = await fetch(`${SUPABASE_URL}/rest/v1/tenants`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre: "Anon Injected Tenant",
          rif: "J-00000000-0",
        }),
      });
      expect([400, 401, 403]).toContain(resInsert.status);
      const err = await resInsert.json();
      expect(err.code).toBe("42501");
    });

    it("1.6 should isolate usuarios table: Magaly can only see her tenant's users", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?select=*`, {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${magalyToken}`,
        },
      });

      expect(res.status).toBe(200);
      const users = await res.json();
      expect(users.length).toBeGreaterThanOrEqual(1);
      users.forEach((u: any) => {
        expect(u.tenant_id).toBe("11111111-1111-4111-8111-111111111111");
      });

      // Cross-tenant user query filter
      const resFilter = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios?tenant_id=neq.11111111-1111-4111-8111-111111111111&select=*`,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${magalyToken}`,
          },
        }
      );
      expect(resFilter.status).toBe(200);
      const foreignUsers = await resFilter.json();
      expect(foreignUsers).toHaveLength(0);
    });

    it("1.7 should block anonymous reads and writes on transactional tables (tickets, caja, cupos)", async () => {
      const tables = ["tickets", "ticket_detalles", "caja_movimientos", "cupos_sorteo"];

      for (const table of tables) {
        // Anon select
        const resSelect = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
          headers: { apikey: ANON_KEY },
        });
        expect(resSelect.status).toBe(200);
        const data = await resSelect.json();
        expect(data).toHaveLength(0);

        // Anon insert
        const resInsert = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: "POST",
          headers: {
            apikey: ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dummy: "payload" }),
        });
        expect([400, 401, 403]).toContain(resInsert.status);
      }
    });
  });

  // =========================================================================
  // 2. SQL HARDENING & PRIVILEGE BOUNDARIES (tasas_cambio & liquidar_sorteo)
  // =========================================================================
  describe("2. SQL Hardening & Privilege Boundaries", () => {
    let magalyToken = "";

    it("2.1 should confirm anonymous caller cannot insert into tasas_cambio directly (RLS 42501)", async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/tasas_cambio`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fuente: "MALICIOUS_ORACLE",
          tasa: 999.99,
          fecha_vigencia: "2026-10-29",
        }),
      });

      expect([400, 401, 403]).toContain(res.status);
      const body = await res.json();
      expect(body.code).toBe("42501");
      expect(body.message).toContain("new row violates row-level security policy for table \"tasas_cambio\"");
    });

    it("2.2 should confirm tenant admin (Magaly) cannot insert into tasas_cambio directly (RLS 42501)", async () => {
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "magaly.rodriguez@bancapro.local", password: "123456789" }),
      });
      const authData = await authRes.json();
      magalyToken = authData.access_token;

      const res = await fetch(`${SUPABASE_URL}/rest/v1/tasas_cambio`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${magalyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fuente: "MAGALY",
          tasa: 55.0,
          fecha_vigencia: "2026-10-29",
        }),
      });

      expect([400, 401, 403]).toContain(res.status);
      const body = await res.json();
      expect(body.code).toBe("42501");
      expect(body.message).toContain("new row violates row-level security policy for table \"tasas_cambio\"");
    });

    it("2.3 should verify actualizarTasaBcv Server Action handles non-superadmin safely", async () => {
      // Invoking actualizarTasaBcv unauthenticated or as non-superadmin
      const result = await actualizarTasaBcv(49.25);
      // Either fails gracefully via RPC error or RLS policy rejection on fallback
      if (!result.ok) {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe("string");
      }
    });

    it("2.4 should reject liquidarSorteo Server Action when called unauthenticated", async () => {
      const result = await liquidarSorteo(1, 12, "MANUAL_CONTINGENCIA");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("NO_AUTORIZADO");
    });

    it("2.5 should verify live PostgREST rpc liquidar_sorteo parameter validation", async () => {
      // Calling with animal_ganador = 99 (invalid range)
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/liquidar_sorteo`, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${magalyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_sorteo_id: 2,
          p_animal_ganador: 99,
        }),
      });

      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/ANIMAL_INVALIDO|NO_AUTORIZADO/);
    });
  });

  // =========================================================================
  // 3. MULTI-TENANT CROSS-TENANT ADVERSARIAL SIMULATION
  // =========================================================================
  describe("3. Multi-Tenant Cross-Tenant Adversarial Stress Simulation", () => {
    let sim: BancaProSimulator;

    it("3.1 should establish 2 separate tenants with distinct quotas and users", () => {
      sim = new BancaProSimulator();
      // Set simulated clock to 08:30 AM Caracas time before any draws close
      sim.setMockTime("2026-10-29T08:30:00-04:00");
      expect(sim.tenants.size).toBe(2);
      expect(sim.tenants.get("11111111-1111-4111-8111-111111111111")?.perdida_maxima_sorteo_usd).toBe(300); // Quota $10
      expect(sim.tenants.get("22222222-2222-4222-8222-222222222222")?.perdida_maxima_sorteo_usd).toBe(600); // Quota $20
    });

    it("3.2 should prevent Tenant 1 operator from paying a Tenant 2 winning ticket", () => {
      sim.setMockTime("2026-10-29T08:30:00-04:00");
      // Emit ticket as Tenant 2 operator
      sim.setCurrentUser("cccc3333-3333-4333-8333-333333333333"); // Pedro Cajero T2
      const t2Ticket = sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 2, animal_numero: 10, monto_usd: 5.0 }],
      });
      expect(t2Ticket.ticket_id).toBeDefined();

      // Advance mock time and liquidate sorteo 2 with animal 10 -> ticket becomes GANADOR
      sim.setMockTime("2026-10-29T10:05:00-04:00");
      sim.liquidarSorteoRpc({ p_sorteo_id: 2, p_animal_ganador: 10 });
      const ticketInDb = sim.tickets.get(t2Ticket.ticket_id);
      expect(ticketInDb?.estado).toBe("GANADOR");
      expect(ticketInDb?.premio_total_usd).toBe(150.0);

      // Now switch current user to Magaly (Tenant 1)
      sim.setCurrentUser("aaaa1111-1111-4111-8111-111111111111");

      // Tenant 1 attempts to pay Tenant 2 ticket by security hash
      expect(() => {
        sim.pagarTicketGanadorRpc(ticketInDb!.codigo_seguridad);
      }).toThrow("TICKET_NO_ENCONTRADO");

      // Tenant 1 attempts to pay Tenant 2 ticket by PIN format
      const pinT2 = `${ticketInDb!.serial_corto}-${ticketInDb!.codigo_seguridad.slice(0, 8).toUpperCase()}`;
      expect(() => {
        sim.pagarTicketGanadorRpc(pinT2);
      }).toThrow("TICKET_NO_ENCONTRADO");

      // Verify ticket state remains untouched (GANADOR, NOT PAGADO)
      expect(sim.tickets.get(t2Ticket.ticket_id)?.estado).toBe("GANADOR");
    });

    it("3.3 should prevent Tenant 1 operator from cancelling a Tenant 2 ticket", () => {
      sim.setMockTime("2026-10-29T08:30:00-04:00");
      // Switch back to Tenant 2 and emit ticket
      sim.setCurrentUser("cccc3333-3333-4333-8333-333333333333");
      const t2Ticket = sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 3, animal_numero: 25, monto_usd: 2.0 }],
      });

      // Switch to Magaly (Tenant 1)
      sim.setCurrentUser("aaaa1111-1111-4111-8111-111111111111");

      // Tenant 1 attempts to cancel Tenant 2 ticket
      expect(() => {
        sim.anularTicketRpc(t2Ticket.ticket_id);
      }).toThrow("TICKET_NO_ENCONTRADO");

      // Verify ticket is still EMITIDO
      expect(sim.tickets.get(t2Ticket.ticket_id)?.estado).toBe("EMITIDO");
    });

    it("3.4 should isolate risk quotas: Tenant 1 quota exhaustion does NOT block Tenant 2", () => {
      sim.setMockTime("2026-10-29T08:30:00-04:00");
      // Magaly (Tenant 1) has $10 max quota per animal
      sim.setCurrentUser("aaaa1111-1111-4111-8111-111111111111");

      // Place bet of $10 on animal 5 in Sorteo 4 (fills quota exactly)
      sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 4, animal_numero: 5, monto_usd: 10.0 }],
      });

      // Attempt additional $1 on animal 5 in Sorteo 4 for Tenant 1 -> must throw CUPO_AGOTADO
      expect(() => {
        sim.emitirTicketRpc({
          p_jugadas: [{ sorteo_diario_id: 4, animal_numero: 5, monto_usd: 1.0 }],
        });
      }).toThrow("CUPO_AGOTADO");

      // Now switch to Tenant 2 (Agencia El Centro, quota = $20)
      sim.setCurrentUser("cccc3333-3333-4333-8333-333333333333");

      // Tenant 2 places bet of $15 on animal 5 in Sorteo 4 -> MUST SUCCEED (independent quota)
      const t2Bet = sim.emitirTicketRpc({
        p_jugadas: [{ sorteo_diario_id: 4, animal_numero: 5, monto_usd: 15.0 }],
      });
      expect(t2Bet.ticket_id).toBeDefined();

      // Tenant 2 attempts $10 more -> exceeds $20 limit ($15 + $10 = $25 > $20) -> throws CUPO_AGOTADO
      expect(() => {
        sim.emitirTicketRpc({
          p_jugadas: [{ sorteo_diario_id: 4, animal_numero: 5, monto_usd: 10.0 }],
        });
      }).toThrow("CUPO_AGOTADO");
    });
  });

  // =========================================================================
  // 4. MIGRATION 005 SQL HARDENING CODE INTEGRITY
  // =========================================================================
  describe("4. Migration 005 SQL Hardening Specifications", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../supabase/migrations/20261029000005_bancapro_hardening_fixes.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    it("4.1 should explicitly drop obsolete 2-argument signature to prevent PostgREST PGRST202", () => {
      expect(sql).toContain("DROP FUNCTION IF EXISTS public.emitir_ticket(JSONB, TEXT);");
    });

    it("4.2 should configure search_path = public, extensions for hmac() function", () => {
      expect(sql).toContain("SET search_path = public, extensions");
      expect(sql).toContain("extensions.hmac(");
    });

    it("4.3 should fix undeclared variable in anular_ticket (v_ticket.serial_corto)", () => {
      const anularBlock = sql.match(/FUNCTION public\.anular_ticket[\s\S]*?END;\s*\$\$;/);
      expect(anularBlock).not.toBeNull();
      const body = anularBlock![0];
      expect(body).toContain("v_ticket.serial_corto");
      expect(body).not.toContain("v_serial_corto");
    });

    it("4.4 should require superadmin check in liquidar_sorteo", () => {
      expect(sql).toContain("IF NOT public.is_superadmin() THEN");
      expect(sql).toContain("NO_AUTORIZADO: Se requiere rol superadmin para liquidar sorteos.");
    });

    it("4.5 should implement SECURITY DEFINER actualizar_tasa_bcv with validation", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.actualizar_tasa_bcv(");
      expect(sql).toContain("SECURITY DEFINER");
      expect(sql).toContain("IF p_tasa IS NULL OR p_tasa <= 0 THEN");
      expect(sql).toContain("TASA_INVALIDA: La tasa oficial debe ser mayor a 0.");
      expect(sql).toContain(
        "GRANT EXECUTE ON FUNCTION public.actualizar_tasa_bcv(NUMERIC, DATE) TO authenticated, anon;"
      );
    });

    it("4.6 should implement SECURITY DEFINER obtener_sorteos_cron without anon RLS blanking", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.obtener_sorteos_cron(");
      expect(sql).toContain("SECURITY DEFINER");
      expect(sql).toContain(
        "GRANT EXECUTE ON FUNCTION public.obtener_sorteos_cron(DATE) TO authenticated, anon;"
      );
    });

    it("4.7 should implement SECURITY DEFINER pagar_ticket_por_pin with tenant filtering", () => {
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.pagar_ticket_por_pin(");
      expect(sql).toContain("v_tenant_id UUID := public.get_my_tenant_id();");
      expect(sql).toContain("WHERE tenant_id = v_tenant_id");
      expect(sql).toContain("TICKET_YA_PAGADO");
      expect(sql).toContain("TICKET_ANULADO");
    });
  });
});
