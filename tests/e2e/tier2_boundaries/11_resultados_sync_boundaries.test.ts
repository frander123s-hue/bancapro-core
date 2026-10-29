import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as resultadosCronGet } from "@/app/api/cron/resultados/route";

vi.mock("@/lib/supabase/server", () => {
  return {
    createServerSupabaseClient: () => ({
      rpc: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [
            {
              id: 1,
              fecha: "2026-10-29",
              estado: "ABIERTO",
              horarios_sorteo: {
                hora_oficial: "09:00:00",
                etiqueta: "09:00 AM",
              },
            },
          ],
          error: null,
        }),
      }),
    }),
  };
});

describe("Tier 2 - Boundary 11: Resultados Cron Edge Cases & Malformed Feeds", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, CRON_SECRET: "boundary_res_secret_555" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("B11.1 should handle external feed returning empty array of resultados without error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ resultados: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/resultados?key=boundary_res_secret_555"
    );
    const res = await resultadosCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sorteos_liquidados).toBe(0);
  });

  it("B11.2 should ignore feed results whose schedule labels do not match any pending draw", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resultados: [{ hora: "11:55 PM", numero: "10" }], // Non-existent draw hour
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/resultados?key=boundary_res_secret_555"
    );
    const res = await resultadosCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.sorteos_liquidados).toBe(0);
  });

  it("B11.3 should safely skip unknown animal numbers in feed (e.g. '99' or 'XX')", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resultados: [{ hora: "09:00 AM", numero: "99" }], // Unrecognized figure
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/resultados?key=boundary_res_secret_555"
    );
    const res = await resultadosCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.sorteos_liquidados).toBe(0);
  });

  it("B11.4 should handle external feed returning null or empty object without crashing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/resultados?key=boundary_res_secret_555"
    );
    const res = await resultadosCronGet(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("B11.5 should reject request when authorization header has wrong bearer format", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/resultados", {
      headers: { authorization: "Basic some_basic_auth" },
    });
    const res = await resultadosCronGet(req);
    expect(res.status).toBe(401);
  });
});
