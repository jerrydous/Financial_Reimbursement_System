CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ranks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    CONSTRAINT "ranks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "budget_subjects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    CONSTRAINT "budget_subjects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_types" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "expense_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "employees" ADD COLUMN "department_id" TEXT;
ALTER TABLE "employees" ADD COLUMN "rank_id" TEXT;

ALTER TABLE "employees"
ADD CONSTRAINT "employees_department_id_fkey"
FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employees"
ADD CONSTRAINT "employees_rank_id_fkey"
FOREIGN KEY ("rank_id") REFERENCES "ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_reports" ADD COLUMN "approval_mode" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "expense_reports" ADD COLUMN "subsidy_fen" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "invoices" ADD COLUMN "buyer_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN "buyer_tax_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN "invoice_type" TEXT NOT NULL DEFAULT '';

CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "employee_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "consumed_fen" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "applications_employee_id_created_at_idx" ON "applications"("employee_id", "created_at");

ALTER TABLE "applications"
ADD CONSTRAINT "applications_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_reports" ADD COLUMN "application_id" TEXT;

ALTER TABLE "expense_reports"
ADD CONSTRAINT "expense_reports_application_id_fkey"
FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "policy_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "rules_json" JSONB NOT NULL,
    "skip_manager_below_fen" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "policy_versions_tenant_id_name_version_key" ON "policy_versions"("tenant_id", "name", "version");

CREATE TABLE "subsidy_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "city" TEXT NOT NULL,
    "rank_id" TEXT NOT NULL,
    "daily_fen" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "subsidy_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subsidy_rates_tenant_id_city_rank_id_key" ON "subsidy_rates"("tenant_id", "city", "rank_id");

ALTER TABLE "subsidy_rates"
ADD CONSTRAINT "subsidy_rates_rank_id_fkey"
FOREIGN KEY ("rank_id") REFERENCES "ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "employee_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "balance_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "due_on" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loans_employee_id_created_at_idx" ON "loans"("employee_id", "created_at");

ALTER TABLE "loans"
ADD CONSTRAINT "loans_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "repayments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "loan_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repayments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repayments_tenant_id_idempotency_key_key" ON "repayments"("tenant_id", "idempotency_key");

ALTER TABLE "repayments"
ADD CONSTRAINT "repayments_loan_id_fkey"
FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "department_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "reserved_fen" BIGINT NOT NULL DEFAULT 0,
    "consumed_fen" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "budget_lines_tenant_id_department_id_project_id_subject_id_period_key"
ON "budget_lines"("tenant_id", "department_id", "project_id", "subject_id", "period");

ALTER TABLE "budget_lines"
ADD CONSTRAINT "budget_lines_department_id_fkey"
FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budget_lines"
ADD CONSTRAINT "budget_lines_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budget_lines"
ADD CONSTRAINT "budget_lines_subject_id_fkey"
FOREIGN KEY ("subject_id") REFERENCES "budget_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_reports" ADD COLUMN "budget_line_id" TEXT;

ALTER TABLE "expense_reports"
ADD CONSTRAINT "expense_reports_budget_line_id_fkey"
FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "approval_assignments" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    CONSTRAINT "approval_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_assignments_report_id_actor_id_key" ON "approval_assignments"("report_id", "actor_id");

ALTER TABLE "approval_assignments"
ADD CONSTRAINT "approval_assignments_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "approval_votes" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3),
    CONSTRAINT "approval_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_votes_report_id_actor_id_key" ON "approval_votes"("report_id", "actor_id");

ALTER TABLE "approval_votes"
ADD CONSTRAINT "approval_votes_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "approval_proxies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "principal_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "starts_on" TEXT NOT NULL,
    "ends_on" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "approval_proxies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "approval_proxies"
ADD CONSTRAINT "approval_proxies_principal_id_fkey"
FOREIGN KEY ("principal_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_proxies"
ADD CONSTRAINT "approval_proxies_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loan_write_offs" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loan_write_offs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loan_write_offs_report_id_idx" ON "loan_write_offs"("report_id");

ALTER TABLE "loan_write_offs"
ADD CONSTRAINT "loan_write_offs_loan_id_fkey"
FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_write_offs"
ADD CONSTRAINT "loan_write_offs_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "vendor_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contracts_employee_id_created_at_idx" ON "contracts"("employee_id", "created_at");

ALTER TABLE "contracts"
ADD CONSTRAINT "contracts_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts"
ADD CONSTRAINT "contracts_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "due_on" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "paid_fen" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "installments_contract_id_sequence_key" ON "installments"("contract_id", "sequence");

ALTER TABLE "installments"
ADD CONSTRAINT "installments_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "corporate_bills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "employee_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "invoice_number" TEXT NOT NULL DEFAULT '',
    "amount_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "current_actor_id" TEXT,
    "budget_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "corporate_bills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "corporate_bills_employee_id_created_at_idx" ON "corporate_bills"("employee_id", "created_at");

ALTER TABLE "corporate_bills"
ADD CONSTRAINT "corporate_bills_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corporate_bills"
ADD CONSTRAINT "corporate_bills_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corporate_bills"
ADD CONSTRAINT "corporate_bills_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "budget_holds" (
    "id" TEXT NOT NULL,
    "budget_line_id" TEXT NOT NULL,
    "report_id" TEXT,
    "corporate_bill_id" TEXT,
    "amount_fen" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    CONSTRAINT "budget_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "budget_holds_report_id_idx" ON "budget_holds"("report_id");

ALTER TABLE "budget_holds"
ADD CONSTRAINT "budget_holds_budget_line_id_fkey"
FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budget_holds"
ADD CONSTRAINT "budget_holds_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budget_holds"
ADD CONSTRAINT "budget_holds_corporate_bill_id_fkey"
FOREIGN KEY ("corporate_bill_id") REFERENCES "corporate_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "allocation_lines" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "cost_center_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    CONSTRAINT "allocation_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "allocation_lines_report_id_idx" ON "allocation_lines"("report_id");

ALTER TABLE "allocation_lines"
ADD CONSTRAINT "allocation_lines_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allocation_lines"
ADD CONSTRAINT "allocation_lines_cost_center_id_fkey"
FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "control_warnings" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_warnings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "control_warnings_report_id_idx" ON "control_warnings"("report_id");

ALTER TABLE "control_warnings"
ADD CONSTRAINT "control_warnings_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invoice_verification_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "invoice_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_verification_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_verification_attempts_tenant_id_idempotency_key_key"
ON "invoice_verification_attempts"("tenant_id", "idempotency_key");

CREATE INDEX "invoice_verification_attempts_invoice_id_idx" ON "invoice_verification_attempts"("invoice_id");

ALTER TABLE "invoice_verification_attempts"
ADD CONSTRAINT "invoice_verification_attempts_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "travel_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "employee_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "occurred_on" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expense_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "travel_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "travel_orders_tenant_id_provider_external_id_key"
ON "travel_orders"("tenant_id", "provider", "external_id");

ALTER TABLE "travel_orders"
ADD CONSTRAINT "travel_orders_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "kind" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "params_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_document_id_kind_key" ON "notifications"("document_id", "kind");

CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "actor_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "object_key" TEXT NOT NULL DEFAULT '',
    "idempotency_key" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_jobs_tenant_id_idempotency_key_key" ON "export_jobs"("tenant_id", "idempotency_key");

CREATE TRIGGER applications_no_delete BEFORE DELETE ON "applications" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER loans_no_delete BEFORE DELETE ON "loans" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER loan_write_offs_no_delete BEFORE DELETE ON "loan_write_offs" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER repayments_no_delete BEFORE DELETE ON "repayments" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER budget_holds_no_delete BEFORE DELETE ON "budget_holds" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER control_warnings_no_update BEFORE UPDATE ON "control_warnings" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER control_warnings_no_delete BEFORE DELETE ON "control_warnings" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER notifications_no_update BEFORE UPDATE ON "notifications" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER notifications_no_delete BEFORE DELETE ON "notifications" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER corporate_bills_no_delete BEFORE DELETE ON "corporate_bills" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON "contracts" FOR EACH ROW EXECUTE FUNCTION reject_financial_delete();
