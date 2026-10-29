import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as resultadosCronGet } from "@/app/api/cron/resultados/route";
import { resolverFiguraPorInput } from "@/lib/constants/animalitos";

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

describe("Tier 1 - Feature 11: Scheduled Lotto Activo Results Synchronization", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, CRON_SECRET: "test_resultados_secret_456" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("11.1 should reject cron request without authorization with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/resultados");
    const res = await resultadosCronGet(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("11.2 should reject cron request with incorrect secret token with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/cron/resultados", {
      headers: { authorization: "Bearer wrong_token" },
    });
    const res = await resultadosCronGet(req);

    expect(res.status).toBe(401);
  });

  it("11.3 should resolve external winning figures including special animals 0 (Delfín) and 00 (Ballena = dbNumber 37)", () => {
    const delfin = resolverFiguraPorInput("0");
    expect(delfin?.dbNumber).toBe(0);
    expect(delfin?.nombre).toBe("Delfín");

    const ballena = resolverFiguraPorInput("00");
    expect(ballena?.dbNumber).toBe(37);
    expect(ballena?.nombre).toBe("Ballena");

    const leon = resolverFiguraPorInput("05");
    expect(leon?.dbNumber).toBe(5);
    expect(leon?.nombre).toBe("León");
  });

  it("11.4 should accept authenticated cron request and return operational date and check summary", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resultados: [
          { hora: "09:00 AM", numero: "10" },
          { hora: "10:00 AM", numero: "25" },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest(
      "http://localhost:3000/api/cron/resultados?key=test_resultados_secret_456"
    );
    const res = await resultadosCronGet(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.fecha_operativa).toBeDefined();
  });

  it("11.5 should handle external lottery feed DNS/network failure gracefully and return 200 with 0 liquidados", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.loteriadehoy.com"));
    vi.stubGlobal("fetch", mockFetch);

    const req = new NextRequest("http://localhost:3000/api/cron/resultados", {
      headers: { authorization: "Bearer test_resultados_secret_456" },
    });
    const res = await resultadosCronGet(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sorteos_liquidados).toBe(0);
  });
});
