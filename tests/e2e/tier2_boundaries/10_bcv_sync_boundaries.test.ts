import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as bcvCronGet } from "@/app/api/cron/bcv/route";

vi.mock("@/lib/supabase/server", () => {
  return {
    createServerSupabaseClient: () => ({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 99,
            fuente: "BCV",
            tasa: 45.85,
            fecha_vigencia: "2026-10-29",
            created_at: new Date().toISOString(),
          },
          error: null,
        }),
      }),
    }),
  };
});

describe("Tier 2 - Boundary 10: BCV Cron Authentication & API Payload Boundaries", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, CRON_SECRET: "boundary_secret_999" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("B10.1 should reject empty Bearer token ('Bearer ')", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/bcv", {
      headers: { authorization: "Bearer " },
    });
    const res = await bcvCronGet(req);
    expect(res.status).toBe(401);
  });

  it("B10.2 should reject request with empty query param (?key=)", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/bcv?key=");
    const res = await bcvCronGet(req);
    expect(res.status).toBe(401);
  });

  it("B10.3 should fallback safely when external API returns HTTP 500 error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Server Error" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/bcv?key=boundary_secret_999"
    );
    const res = await bcvCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.actualizado_desde_fuente_externa).toBe(false);
  });

  it("B10.4 should reject zero exchange rate from external feed and preserve previous rate", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ promedio: 0.0 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/bcv?key=boundary_secret_999"
    );
    const res = await bcvCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.actualizado_desde_fuente_externa).toBe(false);
  });

  it("B10.5 should handle empty JSON object {} from external feed without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/bcv?key=boundary_secret_999"
    );
    const res = await bcvCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.actualizado_desde_fuente_externa).toBe(false);
  });
});
