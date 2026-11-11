# Generic payout gateway integration (not a bank implementation)

Environment variables, supplied by deployment secret management:
- PAYMENT_GATEWAY_URL: trusted HTTPS service base URL
- PAYMENT_GATEWAY_TOKEN: service authentication credential
- PAYMENT_CALLBACK_SECRET: at least 32 characters

The service must implement POST /payouts and GET /payouts/{id}.
POST JSON: {id, reportId, employeeId, amountFen, currency}.
Headers: Authorization and Idempotency-Key (same durable payout id).
GET must return authoritative state for the same payout, including after timeout.
Response JSON: {id, amountFen, currency, status, reference}.
Status: processing | succeeded | failed; reference must be non-empty and stable.
Amounts are integer minor units represented as strings.
The gateway must map employeeId to an independently verified beneficiary account.
It must enforce durable idempotency and immutable terminal results.
This repository does not implement beneficiary onboarding or a bank-specific adapter.

Callback: POST /payments/callback
JSON includes id. X-Payment-Timestamp is epoch seconds.
X-Payment-Signature is lowercase hex HMAC-SHA256(secret, timestamp + "." + exact raw body).
A valid callback triggers GET reconciliation; it never directly marks a payment successful.

Install and migrate: pnpm install --frozen-lockfile; pnpm --filter @frs/api prisma:generate;
DATABASE_URL=<deployment database> pnpm --filter @frs/api exec prisma migrate deploy
Review and back up the database before production migration.

Tests:
pnpm test
pnpm typecheck
PAYMENT_TEST_DATABASE_URL=<isolated test database> pnpm --filter @frs/api exec vitest run --config vitest.integration.ts test/p1-reimbursement.integration.spec.ts test/payment-local.integration.spec.ts
The test URL must refer to a disposable database; tests create records and apply migrations.

Known limits: no bank-specific integration, automatic reconciliation scheduler, failed-order retry workflow,
loan-offset net payout, real OIDC/Temporal/browser end-to-end acceptance, or documents-path payment integration.
Do not enable real-money operation before those acceptance gates and provider sandbox certification.
