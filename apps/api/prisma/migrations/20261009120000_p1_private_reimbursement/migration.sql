ALTER TABLE "employees" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'employee';
ALTER TABLE "employees" ADD COLUMN "manager_id" TEXT;

ALTER TABLE "employees"
ADD CONSTRAINT "employees_manager_id_fkey"
FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_reports" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CNY';
ALTER TABLE "expense_reports" ADD COLUMN "submitted_amount_fen" BIGINT;
ALTER TABLE "expense_reports" ADD COLUMN "approved_amount_fen" BIGINT;
ALTER TABLE "expense_reports" ADD COLUMN "current_step" TEXT;
ALTER TABLE "expense_reports" ADD COLUMN "current_actor_id" TEXT;
ALTER TABLE "expense_reports" ADD COLUMN "workflow_id" TEXT;

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "owner_employee_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "invoice_code" TEXT NOT NULL DEFAULT '',
    "invoice_number" TEXT NOT NULL DEFAULT '',
    "amount_fen" BIGINT,
    "recognition_status" TEXT NOT NULL DEFAULT 'pending_confirmation',
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "binding" TEXT NOT NULL DEFAULT 'released',
    "expense_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoices_owner_employee_id_created_at_idx" ON "invoices"("owner_employee_id", "created_at");

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_owner_employee_id_fkey"
FOREIGN KEY ("owner_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_expense_report_id_fkey"
FOREIGN KEY ("expense_report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 有效发票只占用一次：只约束 binding = active 的行。数电票的发票代码为空，号码仍参与唯一键。
CREATE UNIQUE INDEX "invoices_active_number_key"
ON "invoices" ("tenant_id", "invoice_code", "invoice_number")
WHERE "binding" = 'active' AND "invoice_number" <> '';

CREATE UNIQUE INDEX "invoices_active_sha_key"
ON "invoices" ("tenant_id", "file_sha256")
WHERE "binding" = 'active';

CREATE TABLE "expense_lines" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_lines_report_id_idx" ON "expense_lines"("report_id");

ALTER TABLE "expense_lines"
ADD CONSTRAINT "expense_lines_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_lines"
ADD CONSTRAINT "expense_lines_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "report_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_report_id_idx" ON "payments"("report_id");

ALTER TABLE "payments"
ADD CONSTRAINT "payments_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "amount_adjustments" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "before_amount_fen" BIGINT NOT NULL,
    "after_amount_fen" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "amount_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "amount_adjustments_report_id_idx" ON "amount_adjustments"("report_id");

ALTER TABLE "amount_adjustments"
ADD CONSTRAINT "amount_adjustments_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "workflow_id" TEXT,
    "before_amount_fen" BIGINT,
    "after_amount_fen" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_document_id_created_at_idx" ON "audit_events"("document_id", "created_at");

ALTER TABLE "audit_events"
ADD CONSTRAINT "audit_events_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_tenant_id_operation_key_key"
ON "idempotency_keys" ("tenant_id", "operation", "key");

CREATE TABLE "document_access" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_access_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_access_actor_id_action_revoked_at_idx"
ON "document_access" ("actor_id", "action", "revoked_at");

CREATE INDEX "document_access_document_id_idx" ON "document_access"("document_id");

ALTER TABLE "document_access"
ADD CONSTRAINT "document_access_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_financial_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DOCUMENT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_reports_no_delete
BEFORE DELETE ON "expense_reports"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

CREATE TRIGGER invoices_no_delete
BEFORE DELETE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

CREATE TRIGGER expense_lines_no_delete
BEFORE DELETE ON "expense_lines"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

CREATE TRIGGER payments_no_delete
BEFORE DELETE ON "payments"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

CREATE TRIGGER amount_adjustments_no_delete
BEFORE DELETE ON "amount_adjustments"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();

REVOKE UPDATE, DELETE ON "audit_events" FROM PUBLIC;
