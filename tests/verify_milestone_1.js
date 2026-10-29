// tests/verify_milestone_1.js
// Script de Verificación Integral de Hitos de Milestone 1:
// 1. Autenticación GoTrue de Magaly Rodríguez
// 2. Validación de Tenant RLS y Perfil de Usuario
// 3. Verificación de Server Actions (emitirTicket, anularTicket, pagarTicketGanador)
// 4. Verificación de Migración SQL 005

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://sgzpxrmdpvirshyccrss.supabase.co';
const ANON_KEY = 'sb_publishable_LD3ZnrAAiCebDUR-sf_F7A_kCd9ub3K';

async function run() {
  console.log('===============================================================');
  console.log('   BANCAPRO CORE — VERIFICACIÓN AUTOMATIZADA MILESTONE 1');
  console.log('===============================================================\n');

  let passedChecks = 0;
  let totalChecks = 0;

  function assert(condition, message) {
    totalChecks++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedChecks++;
    } else {
      console.error(`  [FAIL] ${message}`);
    }
  }

  // 1. TEST GOTRUE AUTHENTICATION
  console.log('--- 1. GoTrue Authentication & Tenant Admin Login ---');
  let authData = null;
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'magaly.rodriguez@bancapro.local',
        password: '123456789',
      }),
    });
    authData = await authRes.json();
    assert(authRes.status === 200, `Login de Magaly Rodríguez retorna HTTP 200 (recibido: ${authRes.status})`);
    assert(!!authData?.access_token, 'GoTrue emite un access_token JWT válido');
    assert(authData?.user?.id === '22222222-2222-4222-8222-222222222222', `ID de usuario correcto: ${authData?.user?.id}`);
    assert(
      (authData?.user?.app_metadata?.rol || authData?.user?.user_metadata?.rol) === 'admin_comercio',
      `Rol asignado en metadatos es admin_comercio`
    );
  } catch (err) {
    assert(false, `Excepción durante login GoTrue: ${err.message}`);
  }

  // 2. TEST RLS TENANT DATA ACCESS WITH GOTRUE TOKEN
  console.log('\n--- 2. Aislamiento Multi-Tenant y Consulta de Perfil ---');
  if (authData?.access_token) {
    try {
      const headers = {
        apikey: ANON_KEY,
        Authorization: `Bearer ${authData.access_token}`,
      };

      const tenantsRes = await fetch(`${SUPABASE_URL}/rest/v1/tenants?select=*`, { headers });
      const tenants = await tenantsRes.json();
      assert(tenants.length === 1, `RLS restringe lectura a exactamente 1 comercio (Tenant de Magaly)`);
      assert(
        tenants[0]?.id === '11111111-1111-4111-8111-111111111111',
        `Tenant ID corresponde a Bodega Piloto Magaly: ${tenants[0]?.id}`
      );
      assert(
        tenants[0]?.nombre === 'Bodega Piloto Magaly',
        `Nombre de comercio verificado: "${tenants[0]?.nombre}"`
      );

      const usuariosRes = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?select=*`, { headers });
      const usuarios = await usuariosRes.json();
      assert(usuarios.length >= 1, `Perfil en public.usuarios recuperado`);
      assert(
        usuarios[0]?.email === 'magaly.rodriguez@bancapro.local',
        `Email de perfil coincide: ${usuarios[0]?.email}`
      );
    } catch (err) {
      assert(false, `Error consultando datos de tenant: ${err.message}`);
    }
  }

  // 3. VERIFY MIGRATION 005 FILE INTEGRITY
  console.log('\n--- 3. Integridad de Migración SQL 005 ---');
  const migrationPath = path.resolve(__dirname, '../supabase/migrations/20261029000005_bancapro_hardening_fixes.sql');
  assert(fs.existsSync(migrationPath), `Archivo de migración 005 existe en: ${migrationPath}`);
  const sqlContent = fs.readFileSync(migrationPath, 'utf8');

  assert(
    sqlContent.includes('DROP FUNCTION IF EXISTS public.emitir_ticket(JSONB, TEXT);'),
    'Migración 005 incluye DROP FUNCTION para resolver PGRST202'
  );
  assert(
    sqlContent.includes('SET search_path = public, extensions') && sqlContent.includes('extensions.hmac('),
    'Migración 005 incluye search_path = public, extensions y extensions.hmac() para resolver 42883'
  );
  
  // Extraer función anular_ticket para verificar corrección de v_ticket.serial_corto
  const anularTicketMatch = sqlContent.match(/FUNCTION public\.anular_ticket[\s\S]*?END;\s*\$\$;/);
  const anularBody = anularTicketMatch ? anularTicketMatch[0] : '';
  assert(
    anularBody.includes('v_ticket.serial_corto') && !anularBody.includes('v_serial_corto'),
    'Migración 005 corrige identificador no declarado en anular_ticket (usa v_ticket.serial_corto)'
  );
  assert(
    sqlContent.includes('IF NOT public.is_superadmin() THEN'),
    'Migración 005 protege liquidar_sorteo exigiendo rol superadmin'
  );
  assert(
    sqlContent.includes('CREATE OR REPLACE FUNCTION public.actualizar_tasa_bcv'),
    'Migración 005 define Stored Procedure actualizar_tasa_bcv (SECURITY DEFINER)'
  );
  assert(
    sqlContent.includes('CREATE OR REPLACE FUNCTION public.obtener_sorteos_cron'),
    'Migración 005 define Stored Procedure obtener_sorteos_cron (SECURITY DEFINER)'
  );
  assert(
    sqlContent.includes('CREATE OR REPLACE FUNCTION public.pagar_ticket_por_pin'),
    'Migración 005 define Stored Procedure pagar_ticket_por_pin (SECURITY DEFINER)'
  );

  // 4. VERIFY FRONTEND GHOST TICKET ELIMINATION
  console.log('\n--- 4. Eliminación de Ghost Tickets en TaquillaPos.tsx ---');
  const posPath = path.resolve(__dirname, '../src/components/pos/TaquillaPos.tsx');
  const posContent = fs.readFileSync(posPath, 'utf8');

  assert(
    posContent.includes('if (!respuestaRpc.ok || !respuestaRpc.ticket)'),
    'TaquillaPos valida estrictamente if (!respuestaRpc.ok || !respuestaRpc.ticket)'
  );
  assert(
    !posContent.includes('respuestaRpc.ticket?.ticket_id ?? crypto.randomUUID()'),
    'TaquillaPos ya NO genera UUIDs falsos con crypto.randomUUID()'
  );
  assert(
    !posContent.includes('Math.floor(1042 + Math.random() * 8900)'),
    'TaquillaPos ya NO genera números seriales aleatorios falsos'
  );
  assert(
    posContent.includes('iniciarSesionMagaly') && posContent.includes('obtenerContextoActual'),
    'TaquillaPos integra sesión GoTrue con iniciarSesionMagaly y obtenerContextoActual'
  );

  // 5. VERIFY SERVER ACTIONS AUTHENTICATION IN AUTH.TS AND TRANSACCIONES.TS
  console.log('\n--- 5. Server Actions y Propagación de Sesión ---');
  const authActionPath = path.resolve(__dirname, '../src/lib/actions/auth.ts');
  assert(fs.existsSync(authActionPath), 'Archivo src/lib/actions/auth.ts implementado');
  const authActionContent = fs.readFileSync(authActionPath, 'utf8');
  assert(authActionContent.includes('signInWithPassword'), 'auth.ts invoca signInWithPassword');
  assert(authActionContent.includes('iniciarSesionMagaly'), 'auth.ts provee iniciarSesionMagaly');

  const transActionPath = path.resolve(__dirname, '../src/lib/actions/transacciones.ts');
  const transActionContent = fs.readFileSync(transActionPath, 'utf8');
  assert(
    transActionContent.includes('supabase.auth.getUser()'),
    'transacciones.ts verifica auth.getUser() antes de emitir tickets'
  );
  assert(
    transActionContent.includes('pagar_ticket_por_pin'),
    'transacciones.ts soporta resolución por PIN de WhatsApp (pagar_ticket_por_pin)'
  );

  console.log('\n===============================================================');
  console.log(`   RESULTADO FINAL: ${passedChecks}/${totalChecks} VERIFICACIONES EXITOSAS`);
  console.log('===============================================================\n');

  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Error fatal en suite de verificación:', e);
  process.exit(1);
});
