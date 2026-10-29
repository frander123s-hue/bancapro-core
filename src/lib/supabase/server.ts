import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./client";

export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Invocado desde un Server Component de solo lectura
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Invocado desde un Server Component de solo lectura
        }
      },
    },
  });
}

export interface TenantSessionContext {
  userId: string;
  email: string;
  nombreUsuario: string;
  rol: "superadmin" | "admin_comercio" | "cajero";
  tenantId: string;
  tenantNombre: string;
  tenantRif: string;
  perdidaMaximaSorteoUsd: number;
  cupoMaximoPorAnimalUsd: number;
}

/**
 * Obtiene y valida el contexto de sesión y aislamiento Multi-Tenant del usuario actual.
 * Garantiza que ningún operador opere fuera de su `tenant_id` asignado en RLS.
 */
export async function getAuthenticatedTenantContext(): Promise<TenantSessionContext | null> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: perfil, error: perfilError } = await supabase
    .from("usuarios")
    .select(
      `
      id,
      nombre,
      email,
      rol,
      tenant_id,
      tenants (
        id,
        nombre,
        rif,
        perdida_maxima_sorteo_usd,
        activo
      )
    `
    )
    .eq("id", user.id)
    .single();

  if (perfilError || !perfil || !perfil.tenant_id) {
    return null;
  }

  const tenantData = Array.isArray(perfil.tenants)
    ? perfil.tenants[0]
    : perfil.tenants;

  if (!tenantData || !tenantData.activo) {
    return null;
  }

  const perdidaMax = Number(tenantData.perdida_maxima_sorteo_usd ?? 300);

  return {
    userId: user.id,
    email: user.email ?? perfil.email ?? "",
    nombreUsuario: perfil.nombre,
    rol: perfil.rol as TenantSessionContext["rol"],
    tenantId: perfil.tenant_id,
    tenantNombre: tenantData.nombre,
    tenantRif: tenantData.rif,
    perdidaMaximaSorteoUsd: perdidaMax,
    cupoMaximoPorAnimalUsd: Number((perdidaMax / 30).toFixed(2)),
  };
}
