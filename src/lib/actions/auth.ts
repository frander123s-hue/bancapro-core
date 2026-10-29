"use server";

import { cookies } from "next/headers";
import crypto from "crypto";
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

const SUPERADMIN_COOKIE_NAME = "bancapro_superadmin_portal_token";
const SUPERADMIN_USER = process.env.SUPERADMIN_PORTAL_USER || "admin";
const SUPERADMIN_PASS = process.env.SUPERADMIN_PORTAL_PASS || "rootadmin1234";
const SUPERADMIN_SECRET =
  process.env.TICKET_HMAC_SECRET ||
  "bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210";

function generarTokenSuperAdmin(): string {
  return crypto
    .createHmac("sha256", SUPERADMIN_SECRET)
    .update(`${SUPERADMIN_USER}|${SUPERADMIN_PASS}|PORTAL_SUPERADMIN_V1`)
    .digest("hex");
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
        rol:
          contexto?.rol ??
          (data.user.app_metadata?.rol as string) ??
          "cajero",
        tenantId:
          contexto?.tenantId ??
          (data.user.app_metadata?.tenant_id as string),
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

/**
 * AUTENTICACIÓN EXCLUSIVA DEL PORTAL SUPERADMIN INDEPENDIENTE
 * Credenciales requeridas: usuario `admin`, contraseña `rootadmin1234`.
 */
export async function autenticarPortalSuperAdmin(
  usuario: string,
  contrasena: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const userClean = (usuario || "").trim().toLowerCase();
    const passClean = (contrasena || "").trim();

    if (userClean !== SUPERADMIN_USER.toLowerCase() || passClean !== SUPERADMIN_PASS) {
      return {
        ok: false,
        error: "Credenciales de SuperAdmin inválidas. Verifique usuario y contraseña.",
      };
    }

    const token = generarTokenSuperAdmin();
    try {
      const cookieStore = cookies();
      cookieStore.set(SUPERADMIN_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12, // 12 horas
      });
    } catch {
      // Entorno de test sin contexto HTTP de cookies
    }

    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Error al autenticar en el Portal SuperAdmin",
    };
  }
}

/**
 * Verifica si existe una sesión activa en el Portal SuperAdmin Independiente.
 */
export async function verificarSesionPortalSuperAdmin(): Promise<boolean> {
  try {
    const cookieStore = cookies();
    const valor = cookieStore.get(SUPERADMIN_COOKIE_NAME)?.value;
    return Boolean(valor && valor === generarTokenSuperAdmin());
  } catch {
    return false;
  }
}

/**
 * Cierra la sesión del Portal SuperAdmin Independiente.
 */
export async function cerrarSesionPortalSuperAdmin(): Promise<{ ok: boolean }> {
  try {
    const cookieStore = cookies();
    cookieStore.delete(SUPERADMIN_COOKIE_NAME);
  } catch {
    // Ignorar en entorno sin cookies
  }
  return { ok: true };
}
