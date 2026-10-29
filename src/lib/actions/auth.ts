"use server";

import {
  createServerSupabaseClient,
  getAuthenticatedTenantContext,
  type TenantSessionContext,
} from "@/lib/supabase/server";

export interface AuthResultado {
  ok: boolean;
  error?: string;
  contexto?: TenantSessionContext | null;
  user?: {
    id: string;
    email: string;
    rol?: string;
    tenantId?: string;
    nombre?: string;
  };
}

/**
 * Autentica un operador o administrador de comercio ante Supabase GoTrue.
 * Establece cookies de sesión HTTP-only seguras mediante `@supabase/ssr`.
 */
export async function iniciarSesion(
  email: string,
  contrasena: string
): Promise<AuthResultado> {
  try {
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: contrasena,
    });

    if (error || !data.user) {
      return {
        ok: false,
        error: error?.message || "Credenciales de acceso inválidas",
      };
    }

    // Cargar perfil multi-tenant vinculado
    const contexto = await getAuthenticatedTenantContext();

    return {
      ok: true,
      contexto,
      user: {
        id: data.user.id,
        email: data.user.email ?? email,
        rol: contexto?.rol ?? (data.user.app_metadata?.rol as string) ?? "cajero",
        tenantId: contexto?.tenantId ?? (data.user.app_metadata?.tenant_id as string),
        nombre: contexto?.nombreUsuario ?? "Operador",
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error inesperado al iniciar sesión",
    };
  }
}

/**
 * Inicia sesión rápidamente con el usuario semilla por defecto (Magaly Rodríguez - Tenant #1)
 */
export async function iniciarSesionMagaly(): Promise<AuthResultado> {
  return iniciarSesion("magaly.rodriguez@bancapro.local", "123456789");
}

/**
 * Cierra la sesión activa en Supabase GoTrue y remueve las cookies del navegador.
 */
export async function cerrarSesion(): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al cerrar sesión",
    };
  }
}

/**
 * Obtiene el contexto de sesión y tenant del operador autenticado.
 */
export async function obtenerContextoActual(): Promise<TenantSessionContext | null> {
  try {
    return await getAuthenticatedTenantContext();
  } catch {
    return null;
  }
}
