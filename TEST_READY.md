# TEST_READY: BancaPro Core Venezuela E2E Test Suite

## Executive Summary
The comprehensive, 4-tier opaque-box E2E test harness and verification suites for **BancaPro Core Venezuela** have been successfully implemented and verified. All 126 test cases execute with zero unhandled errors and a 100% pass rate via the standard Vitest test runner.

- **Test Runner Command**: `npm test` (or `npx vitest run --config vitest.config.mts`)
- **Watch Mode**: `npm run test:watch`
- **Execution Result**: **24 Test Files Passed | 126 Tests Passed | 0 Failed** (Exit Code: 0)
- **Execution Duration**: ~25 seconds

---

## Test Suite Architecture & Breakdown

Derived strictly from user requirements in `ORIGINAL_REQUEST.md` (R1–R6) and `PROJECT.md` § Feature Inventory:

| Tier | Category | Description | Files | Tests | Pass |
|:---|:---|:---|:---:|:---:|:---:|
| **Tier 1** | **Feature Coverage** | Core happy paths and functional specifications for each of the 11 key features | 11 | 55 | 55 |
| **Tier 2** | **Boundary & Corner Cases** | Strict boundary conditions (T-3m, quota limits, 60s cancellation, HMAC tampering, zero/negative bets) | 11 | 55 | 55 |
| **Tier 3** | **Cross-Feature Combinations** | Pairwise interactions between major subsystems (bet + WhatsApp + cancel, lockdown precedence, settlement + payout idempotency, multi-tenant isolation) | 1 | 11 | 11 |
| **Tier 4** | **Real-World Scenarios** | Complex end-to-end operational workflows (full betting lifecycle, cashier rush hour, cancellation race, cross-tenant security breach stress, automated daily cron cycle) | 1 | 5 | 5 |
| **Total** | | **Comprehensive 4-Tier Verification Suite** | **24** | **126** | **126** |

---

## Detailed Test Inventory by Tier

### Tier 1: Feature Coverage (55 tests)
1. `tests/e2e/tier1_features/01_rls_auth.test.ts` (5 tests)
   - 1.1 Tenant admin authentication & context loading (Magaly Rodríguez)
   - 1.2 Anonymous / unauthenticated session rejection
   - 1.3 Inactive tenant rejection
   - 1.4 RLS ticket isolation (Tenant 1 operator cannot cancel Tenant 2 ticket)
   - 1.5 RLS payout isolation (Tenant 1 cashier cannot redeem Tenant 2 ticket)
2. `tests/e2e/tier1_features/02_persistence.test.ts` (5 tests)
   - 2.1 Atomic persistence across `tickets`, `ticket_detalles`, and `caja_movimientos`
   - 2.2 Sequential and unique `serial_corto` generation
   - 2.3 Official BCV exchange rate freezing at emission timestamp
   - 2.4 State transition from `EMITIDO` to `GANADOR` or `PERDEDOR` on settlement
   - 2.5 State transition from `GANADOR` to `PAGADO` with cash drawer disbursement
3. `tests/e2e/tier1_features/03_lockdown.test.ts` (5 tests)
   - 3.1 Bet allowed prior to 3-minute lockdown window
   - 3.2 Bet rejected during 3-minute lockdown window (`LOCKDOWN_ACTIVO`)
   - 3.3 Bet rejected at or after draw time
   - 3.4 Multi-draw ticket rejected if any included draw is in lockdown
   - 3.5 Bet rejected if draw state is explicitly closed or liquidated
4. `tests/e2e/tier1_features/04_quota_rollback.test.ts` (5 tests)
   - 4.1 Max Quota calculation: Acceptable Max Loss / 30 ($10.00 for $300 limit)
   - 4.2 Cumulative quota tracking and sequential bets within limit
   - 4.3 Bet exceeding quota rejected with `CUPO_AGOTADO` and atomic transaction rollback
   - 4.4 Independent quota tracking per animal within the same draw
   - 4.5 Multi-tenant quota isolation ($300 limit vs $600 limit)
5. `tests/e2e/tier1_features/05_hmac_pin.test.ts` (5 tests)
   - 5.1 64-character hex HMAC-SHA256 digital signature generation
   - 5.2 Deterministic match between Server Actions and DB HMAC signatures
   - 5.3 QR payload format: `BANCAPRO|tenant|ticket|monto|epoch|hash`
   - 5.4 Customer PIN format: `${serialCorto}-${HASH8UPPER}`
   - 5.5 Tampered QR payload detection via cryptographic mismatch
6. `tests/e2e/tier1_features/06_payout_idempotency.test.ts` (5 tests)
   - 6.1 Winning ticket payout via 64-character security hash
   - 6.2 Idempotent payout rejection on already-paid tickets (`TICKET_YA_PAGADO`)
   - 6.3 Customer PIN lookup and redemption
   - 6.4 Payout rejection for losing tickets (`TICKET_NO_PREMIADO`)
   - 6.5 Payout rejection for cancelled tickets (`TICKET_ANULADO`)
7. `tests/e2e/tier1_features/07_cancellation.test.ts` (5 tests)
   - 7.1 Cancellation allowed within 60 seconds post-issuance
   - 7.2 Atomic reversion of risk quota in `cupos_sorteo`
   - 7.3 Cash drawer refund movement registration (`ANULACION`)
   - 7.4 Cancellation rejected past 60 seconds (`TIEMPO_ANULACION_EXPIRADO`)
   - 7.5 Cancellation rejected during 3-minute lockdown window (`SORTEO_EN_LOCKDOWN`)
8. `tests/e2e/tier1_features/08_settlement.test.ts` (5 tests)
   - 8.1 Draw settlement with exact 30x payout calculation
   - 8.2 Ticket marked `PERDEDOR` when all plays lose
   - 8.3 Multi-draw ticket remains `EMITIDO` while subsequent draws remain open
   - 8.4 Re-settlement rejection (`SORTEO_YA_LIQUIDADO`)
   - 8.5 Multi-tenant draw settlement sweep without balance leakage
9. `tests/e2e/tier1_features/09_whatsapp_claim.test.ts` (5 tests)
   - 9.1 Phone normalization to E.164 digits without `+` (e.g. `0414-1234567` -> `584141234567`)
   - 9.2 Claim PIN and HMAC signature presence in WhatsApp receipt
   - 9.3 Plays breakdown and 30x potential payout formatting
   - 9.4 Embedded public claim URL with encoded QR payload
   - 9.5 Valid `https://wa.me/...` URL generation
10. `tests/e2e/tier1_features/10_bcv_sync.test.ts` (5 tests)
    - 10.1 Rejection without authorization header or key with HTTP 401
    - 10.2 Rejection with invalid secret with HTTP 401
    - 10.3 Successful sync with Bearer token
    - 10.4 Successful sync with query param `?key=`
    - 10.5 Graceful fallback when external rate API times out or fails
11. `tests/e2e/tier1_features/11_resultados_sync.test.ts` (5 tests)
    - 11.1 Rejection without authorization with HTTP 401
    - 11.2 Rejection with incorrect secret with HTTP 401
    - 11.3 Figure resolution for special figures 0 (Delfín) and 00 (Ballena, dbNumber 37)
    - 11.4 Authenticated sync processing operational date and draws summary
    - 11.5 External feed DNS/network failure handled gracefully

---

### Tier 2: Boundary & Corner Cases (55 tests)
1. `tests/e2e/tier2_boundaries/01_rls_auth_boundaries.test.ts` (5 tests)
   - B1.1 Empty session userId rejection
   - B1.2 Cashier operation by user without tenant assignment (superadmin)
   - B1.3 Deactivated user account rejection
   - B1.4 Cross-tenant cancellation rejection under RLS
   - B1.5 Cross-tenant payout redemption rejection under RLS
2. `tests/e2e/tier2_boundaries/02_persistence_boundaries.test.ts` (5 tests)
   - B2.1 Empty `jugadas` array rejection
   - B2.2 Zero amount bet ($0.00) rejection
   - B2.3 Negative amount bet (-$5.00) rejection
   - B2.4 NaN or infinite amount rejection
   - B2.5 Animal number out of range (<0 or >37) rejection
3. `tests/e2e/tier2_boundaries/03_lockdown_boundaries.test.ts` (5 tests)
   - B3.1 Bet allowed at exact T - 181s (08:56:59 AM)
   - B3.2 Bet rejected at exact T - 180s boundary (08:57:00 AM)
   - B3.3 Bet rejected at T - 179s (08:57:01 AM)
   - B3.4 Bet rejected at exact draw time (09:00:00 AM)
   - B3.5 Bet rejected post draw time (09:00:01 AM)
4. `tests/e2e/tier2_boundaries/04_quota_boundaries.test.ts` (5 tests)
   - B4.1 Single bet at exact maximum quota limit ($10.00)
   - B4.2 Single bet exceeding quota limit by $0.01 ($10.01) rejected
   - B4.3 Cumulative bets summing to exactly $10.00 ($7.50 + $2.50)
   - B4.4 Additional $0.01 bet rejected once quota is fully exhausted
   - B4.5 Multi-play ticket atomic rollback when second play overflows quota
5. `tests/e2e/tier2_boundaries/05_hmac_pin_boundaries.test.ts` (5 tests)
   - B5.1 QR code payload with <6 pipe segments rejected
   - B5.2 QR code payload with >6 pipe segments rejected
   - B5.3 Tampered HMAC signature in QR payload rejected
   - B5.4 Amount altered by $0.01 in QR payload rejected
   - B5.5 TenantId altered in QR payload rejected
6. `tests/e2e/tier2_boundaries/06_payout_boundaries.test.ts` (5 tests)
   - B6.1 Non-existent security code / PIN rejected
   - B6.2 Payout for ticket in `EMITIDO` state rejected
   - B6.3 Payout for ticket in `PERDEDOR` state rejected
   - B6.4 Payout for ticket in `ANULADO` state rejected
   - B6.5 Payout for ticket in `PAGADO` state rejected (idempotency guard)
7. `tests/e2e/tier2_boundaries/07_cancellation_boundaries.test.ts` (5 tests)
   - B7.1 Cancellation at exactly 59 seconds post-issuance (allowed)
   - B7.2 Cancellation at exactly 60 seconds post-issuance (allowed)
   - B7.3 Cancellation at exactly 61 seconds post-issuance rejected (`TIEMPO_ANULACION_EXPIRADO`)
   - B7.4 Cancellation at 08:57:00 AM lockdown start rejected even if issued 5s ago
   - B7.5 Cancellation of already-cancelled ticket rejected (`ESTADO_NO_ANULABLE`)
8. `tests/e2e/tier2_boundaries/08_settlement_boundaries.test.ts` (5 tests)
   - B8.1 Lower boundary animal 0 (Delfín) settlement
   - B8.2 Upper boundary animal 37 (Ballena 00) settlement
   - B8.3 Negative animal number (-1) rejected
   - B8.4 Animal number > 37 (38, 99) rejected
   - B8.5 Non-existent `sorteo_diario_id` rejected
9. `tests/e2e/tier2_boundaries/09_whatsapp_boundaries.test.ts` (5 tests)
   - B9.1 Normalization of formatted number `(0414) 123-4567`
   - B9.2 Normalization of 10-digit number without 0 `4249998877`
   - B9.3 Empty or non-digit phone string returns `""`
   - B9.4 Preservation of existing E.164 digits without alteration
   - B9.5 URL encoding of special characters and store names
10. `tests/e2e/tier2_boundaries/10_bcv_sync_boundaries.test.ts` (5 tests)
    - B10.1 Empty Bearer token rejected
    - B10.2 Empty query param `?key=` rejected
    - B10.3 External API HTTP 500 fallback handling
    - B10.4 Zero exchange rate from external feed rejected
    - B10.5 Empty JSON object `{}` from external feed handled safely
11. `tests/e2e/tier2_boundaries/11_resultados_sync_boundaries.test.ts` (5 tests)
    - B11.1 Empty `resultados: []` handled safely
    - B11.2 Non-matching draw hours ignored
    - B11.3 Unknown animal numbers (`99`, `XX`) skipped safely
    - B11.4 Null or empty feed payload handled without crash
    - B11.5 Wrong authorization format (Basic auth) rejected

---

### Tier 3: Cross-Feature Combinations (11 tests)
`tests/e2e/tier3_combinations/combinations.test.ts` (11 tests)
- **C1**: Bet + WhatsApp + Cancellation (quota released and ledger refunded)
- **C2**: Bet + Lockdown + Cancellation (lockdown precedence over 60s rule)
- **C3**: Multi-Bet + Quota Exhaustion + Atomic Rollback (all plays rolled back)
- **C4**: Settlement + Payout + Idempotency (duplicate payout blocked)
- **C5**: Multi-Draw Ticket + Partial Settlement (payout blocked until all draws resolve)
- **C6**: Multi-Tenant Bet + Quota Isolation (Tenant 1 quota exhaustion does not block Tenant 2)
- **C7**: BCV Rate Update + Ticket Emission + Payout Rate Alignment
- **C8**: Settlement with Ballena 00 (dbNumber 37) + 30x Multiplier
- **C9**: Cancelled Ticket + Settlement (cancelled ticket remains with 0 prize)
- **C10**: Anti-Fraud QR Verification (tampered amount caught prior to DB query)
- **C11**: Quota Capacity Stress (10 consecutive bets fill capacity; 11th rejected)

---

### Tier 4: Real-World Application Workloads (5 scenarios)
`tests/e2e/tier4_realworld/scenarios.test.ts` (5 tests)
- **Scenario 1 (Full Lifecycle)**: Cashier login -> Multi-item ticket -> WhatsApp dispatch -> Claim inspect -> Draw lockdown -> Settlement -> QR/PIN payout -> Cash drawer reconciliation
- **Scenario 2 (Rush Hour & Quotas)**: Rapid successive bets on popular animal -> Quota exceeded -> Atomic rollback prevents ghost ticket -> Customer places valid residual bet
- **Scenario 3 (Cancellation Race)**: Customer cancels within 20s (succeeds) -> Buys second ticket -> Sorteo enters lockdown -> Cancellation attempt fails due to lockdown precedence
- **Scenario 4 (Multi-Tenant Security)**: Tenant 1 & Tenant 2 concurrent bets -> Malicious cross-tenant cancellation & payout breaches are strictly prevented
- **Scenario 5 (Automation Cycle)**: BCV rate updates -> Day schedules 11 draws -> Tickets issued -> Cron liquidates draws automatically with 30x prizes

---

## Infrastructure Configuration
- **Runner**: Vitest 4.1.12 with `vitest.config.mts`
- **Aliases**: `@/*` -> `./src/*`, `next/headers` -> `tests/e2e/helpers/next-mock.ts`, `next/server` -> `tests/e2e/helpers/next-server-mock.ts`
- **Concurrency**: Node threads pool with sequential execution guarantee on Windows
- **Scripts in package.json**:
  - `"test": "vitest run --config vitest.config.mts"`
  - `"test:watch": "vitest --config vitest.config.mts"`
