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
            id: 1,
            fuente: "BCV",
            tasa: 48.75,
            fecha_vigencia: "2026-10-29",
            created_at: new Date().toISOString(),
          },
          error: null,
        }),
      }),
    }),
  };
});

describe("Tier 1 - Feature 10: Scheduled BCV Exchange Rate Synchronization", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, CRON_SECRET: "test_bcv_secret_123" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("10.1 should reject cron request without authorization header or secret key with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/bcv");
    const res = await bcvCronGet(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("10.2 should reject cron request with invalid secret with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/bcv", {
      headers: { authorization: "Bearer invalid_secret_token" },
    });
    const res = await bcvCronGet(req);

    expect(res.status).toBe(401);
  });

  it("10.3 should accept cron request authenticated via Bearer token in authorization header", async () => {
    // Mock external DolarApi response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ promedio: 48.75 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest("http://localhost:3000/api/cron/bcv", {
      headers: { authorization: "Bearer test_bcv_secret_123" },
    });
    const res = await bcvCronGet(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("10.4 should accept cron request authenticated via URL query param key (?key=...)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ promedio: 49.12 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/bcv?key=test_bcv_secret_123"
    );
    const res = await bcvCronGet(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("10.5 should handle external DolarApi failure gracefully without crashing and return fallback rate", async () => {
    // Mock fetch to simulate network failure or timeout
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network timeout or connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/bcv?key=test_bcv_secret_123"
    );
    const res = await bcvCronGet(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.actualizado_desde_fuente_externa).toBe(false);
  });
});
