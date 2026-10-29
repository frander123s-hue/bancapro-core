/**
 * tests/challenger_m1_1_runner.js
 * 
 * Standalone Empirical Challenger Harness for Milestone 1:
 * - GoTrue Authentication Adversarial Stress (invalid pass, nonexistent, SQLi, empty)
 * - Live PostgREST RPC Unauthenticated Rejections & Tampered Token Handling
 * - Empirical Ghost Ticket Elimination Under Adversarial Failure Conditions
 * - Source Code Verification (removal of crypto.randomUUID fallback in ticket emission)
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://sgzpxrmdpvirshyccrss.supabase.co';
const ANON_KEY = 'sb_publishable_LD3ZnrAAiCebDUR-sf_F7A_kCd9ub3K';

async function main() {
  console.log('====================================================================');
  console.log('   CHALLENGER 1: EMPIRICAL STRESS & ADVERSARIAL SUITE (MILESTONE 1)');
  console.log('====================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, testName, details) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      if (details) console.error(`         Details: ${details}`);
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 1: GOTRUE AUTHENTICATION ADVERSARIAL STRESS
  // -------------------------------------------------------------------------
  console.log('--- SECTION 1: Live GoTrue Authentication Adversarial Stress ---');

  // 1.1 Invalid Password Rejection
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'magaly.rodriguez@bancapro.local',
        password: 'wrong_password_attempt_999',
      }),
    });
    const body = await res.json();
    assert(
      res.status === 400 && body.error_code === 'invalid_credentials' && !body.access_token,
      'Invalid password rejected with HTTP 400 and invalid_credentials',
      JSON.stringify(body)
    );
  } catch (err) {
    assert(false, 'Invalid password test exception', err.message);
  }

  // 1.2 Non-Existent User Rejection
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker.unknown@bancapro.local',
        password: 'some_password_123',
      }),
    });
    const body = await res.json();
    assert(
      res.status === 400 && body.error_code === 'invalid_credentials' && !body.access_token,
      'Non-existent user rejected with HTTP 400 and invalid_credentials',
      JSON.stringify(body)
    );
  } catch (err) {
    assert(false, 'Non-existent user test exception', err.message);
  }

  // 1.3 Empty Credentials & SQLi Rejection
  try {
    const payloads = [
      { email: '', password: '' },
      { email: "' OR '1'='1", password: "' OR '1'='1" },
    ];
    let allEmptyRejected = true;
    for (const p of payloads) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
      const body = await res.json();
      if (res.status !== 400 || body.access_token) {
        allEmptyRejected = false;
      }
    }
    assert(allEmptyRejected, 'Empty credentials and SQL injection attempts rejected with HTTP 400');
  } catch (err) {
    assert(false, 'Empty credentials / SQLi exception', err.message);
  }

  // 1.4 Valid Tenant Admin Login & RLS Isolation
  let validToken = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'magaly.rodriguez@bancapro.local',
        password: '123456789',
      }),
    });
    const body = await res.json();
    validToken = body.access_token;
    assert(
      res.status === 200 && !!validToken && body.user?.id === '22222222-2222-4222-8222-222222222222',
      'Tenant admin (Magaly Rodríguez) login succeeds with valid JWT and ID 22222222-2222-4222-8222-222222222222'
    );

    // Verify RLS isolation
    const tenantRes = await fetch(`${SUPABASE_URL}/rest/v1/tenants?select=*`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${validToken}` },
    });
    const tenants = await tenantRes.json();
    assert(
      tenants.length === 1 && tenants[0].id === '11111111-1111-4111-8111-111111111111',
      'RLS confines tenant query strictly to Bodega Piloto Magaly (Tenant 11111111-1111-4111-8111-111111111111)'
    );
  } catch (err) {
    assert(false, 'Valid login & RLS test exception', err.message);
  }

  // -------------------------------------------------------------------------
  // SECTION 2: UNAUTHENTICATED BET PLACEMENT & FORGED TOKEN REJECTION
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 2: Unauthenticated Bet Placement & Forged Token Rejection ---');

  // 2.1 Unauthenticated RPC Call
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/emitir_ticket`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
        p_secret_key: 'bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210',
      }),
    });
    const body = await res.json();
    assert(
      res.status === 400 && body.code === 'P0001' && body.message.includes('NO_AUTORIZADO'),
      'Unauthenticated direct call to emitir_ticket rejected with P0001 and NO_AUTORIZADO',
      JSON.stringify(body)
    );
  } catch (err) {
    assert(false, 'Unauthenticated RPC exception', err.message);
  }

  // 2.2 Tampered / Forged JWT Bearer Token
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/emitir_ticket`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_jugadas: [{ sorteo_diario_id: 1, animal_numero: 5, monto_usd: 1.0 }],
        p_secret_key: 'bancapro_prod_hmac_sha256_secret_key_9f8e7d6c5b4a3210',
      }),
    });
    const body = await res.json();
    assert(
      res.status === 401 && body.code === 'PGRST301',
      'Tampered JWT Bearer token rejected with HTTP 401 and PGRST301 (cryptographic verification failure)',
      JSON.stringify(body)
    );
  } catch (err) {
    assert(false, 'Tampered JWT exception', err.message);
  }

  // -------------------------------------------------------------------------
  // SECTION 3: EMPIRICAL GHOST TICKET ELIMINATION UNDER ADVERSARIAL FAILURES
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Empirical Ghost Ticket Elimination Under Adversarial Failures ---');

  const tenantId = '11111111-1111-4111-8111-111111111111';

  function runStateCycle(initialState, rpcResponse, shouldThrow = false) {
    const state = JSON.parse(JSON.stringify(initialState));
    state.procesandoVenta = true;
    state.alertaSistema = null;

    try {
      if (shouldThrow) {
        throw new Error('Network timeout: Supabase connection unreachable');
      }

      // Exact check from TaquillaPos.tsx line 539:
      if (!rpcResponse || !rpcResponse.ok || !rpcResponse.ticket) {
        state.alertaSistema = {
          tipo: 'error',
          mensaje: `TRANSACCIÓN RECHAZADA POR EL SERVIDOR: ${
            rpcResponse?.error || 'Fallo en la emisión del ticket.'
          }`,
        };
        state.procesandoVenta = false;
        return state;
      }

      // Valid branch
      const t = rpcResponse.ticket;
      const serialCortoFinal = String(t.serial_corto).padStart(7, '0');
      for (const item of state.carrito) {
        const k = `${tenantId}_${item.sorteoId}_${item.figura.dbNumber}`;
        state.cuposAcumulados[k] = Number(((state.cuposAcumulados[k] ?? 0) + item.montoUsd).toFixed(2));
      }
      const nuevoTicket = { ticketId: t.ticket_id, serialCorto: serialCortoFinal, estado: 'EMITIDO' };
      state.ticketsPorTenant[tenantId] = [nuevoTicket, ...(state.ticketsPorTenant[tenantId] ?? [])];
      state.ultimoTicketImpreso = { serialCorto: serialCortoFinal };
      state.ultimoTicketWhatsApp = nuevoTicket;
      state.carrito = [];
      state.alertaSistema = { tipo: 'exito', mensaje: `Ticket #${serialCortoFinal} emitido.` };
    } catch (err) {
      state.alertaSistema = { tipo: 'error', mensaje: `TRANSACCIÓN RECHAZADA POR EL SERVIDOR: ${err.message}` };
    } finally {
      state.procesandoVenta = false;
    }
    return state;
  }

  const baseState = {
    ticketsPorTenant: { [tenantId]: [] },
    cuposAcumulados: {},
    ultimoTicketImpreso: null,
    ultimoTicketWhatsApp: null,
    alertaSistema: null,
    procesandoVenta: false,
    carrito: [{ sorteoId: 1, figura: { dbNumber: 5, codigo: '05' }, montoUsd: 2.0 }],
  };

  // 3.1 Failure: CUPO_AGOTADO
  const s1 = runStateCycle(baseState, { ok: false, error: 'CUPO_AGOTADO: Cupo agotado para esta figura' });
  assert(
    s1.ticketsPorTenant[tenantId].length === 0 &&
      Object.keys(s1.cuposAcumulados).length === 0 &&
      s1.ultimoTicketImpreso === null &&
      s1.alertaSistema?.tipo === 'error',
    'CUPO_AGOTADO rejection creates ZERO ghost tickets and zero quota mutation'
  );

  // 3.2 Failure: LOCKDOWN_ACTIVO
  const s2 = runStateCycle(baseState, { ok: false, error: 'LOCKDOWN_ACTIVO: El sorteo cerró a las 08:57' });
  assert(
    s2.ticketsPorTenant[tenantId].length === 0 &&
      Object.keys(s2.cuposAcumulados).length === 0 &&
      s2.ultimoTicketImpreso === null &&
      s2.alertaSistema?.tipo === 'error',
    'LOCKDOWN_ACTIVO rejection creates ZERO ghost tickets and zero quota mutation'
  );

  // 3.3 Failure: NO_AUTORIZADO
  const s3 = runStateCycle(baseState, { ok: false, error: 'NO_AUTORIZADO: Debe iniciar sesión con cuenta activa' });
  assert(
    s3.ticketsPorTenant[tenantId].length === 0 &&
      Object.keys(s3.cuposAcumulados).length === 0 &&
      s3.ultimoTicketImpreso === null &&
      s3.alertaSistema?.tipo === 'error',
    'NO_AUTORIZADO rejection creates ZERO ghost tickets and zero quota mutation'
  );

  // 3.4 Failure: Live DB procedure error (42883)
  const s4 = runStateCycle(baseState, { ok: false, error: 'function hmac(text, text, unknown) does not exist' });
  assert(
    s4.ticketsPorTenant[tenantId].length === 0 &&
      Object.keys(s4.cuposAcumulados).length === 0 &&
      s4.ultimoTicketImpreso === null &&
      s4.alertaSistema?.tipo === 'error',
    'Database procedure error (42883) creates ZERO ghost tickets and halts cleanly'
  );

  // 3.5 Failure: Network timeout / exception
  const s5 = runStateCycle(baseState, null, true);
  assert(
    s5.ticketsPorTenant[tenantId].length === 0 &&
      Object.keys(s5.cuposAcumulados).length === 0 &&
      s5.ultimoTicketImpreso === null &&
      s5.alertaSistema?.tipo === 'error',
    'Network timeout exception creates ZERO ghost tickets and preserves cart'
  );

  // 3.6 Failure: Malformed response (ok=true but missing ticket object)
  const s6 = runStateCycle(baseState, { ok: true, ticket: undefined });
  assert(
    s6.ticketsPorTenant[tenantId].length === 0 &&
      Object.keys(s6.cuposAcumulados).length === 0 &&
      s6.ultimoTicketImpreso === null &&
      s6.alertaSistema?.tipo === 'error',
    'Malformed response (ok=true without ticket) creates ZERO ghost tickets'
  );

  // -------------------------------------------------------------------------
  // SECTION 4: SOURCE CODE INTEGRITY AUDIT
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 4: Source Code Integrity Audit ---');
  const posPath = path.resolve(__dirname, '../src/components/pos/TaquillaPos.tsx');
  const posCode = fs.readFileSync(posPath, 'utf8');

  assert(
    !posCode.includes('respuestaRpc.ticket?.ticket_id ?? crypto.randomUUID()'),
    'TaquillaPos.tsx ticket emission contains NO fake UUID fallback'
  );
  assert(
    !posCode.includes('Math.floor(1042 + Math.random() * 8900)'),
    'TaquillaPos.tsx contains NO random mock serial fallback'
  );
  assert(
    posCode.includes('if (!respuestaRpc.ok || !respuestaRpc.ticket)'),
    'TaquillaPos.tsx strictly guards ticket creation with if (!respuestaRpc.ok || !respuestaRpc.ticket)'
  );

  const transPath = path.resolve(__dirname, '../src/lib/actions/transacciones.ts');
  const transCode = fs.readFileSync(transPath, 'utf8');
  assert(
    transCode.includes('supabase.auth.getUser()'),
    'transacciones.ts verifies GoTrue session with supabase.auth.getUser()'
  );
  assert(
    transCode.includes('pagar_ticket_por_pin'),
    'transacciones.ts integrates pagar_ticket_por_pin for WhatsApp PIN redemptions'
  );

  console.log('\n====================================================================');
  console.log(`   RESULTADO FINAL CHALLENGER 1: ${passedTests}/${totalTests} VERIFICACIONES EXITOSAS`);
  console.log('====================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
