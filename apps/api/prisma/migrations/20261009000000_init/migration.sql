CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "keycloak_subject" TEXT,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employees_keycloak_subject_key" ON "employees"("keycloak_subject");
CREATE UNIQUE INDEX "employees_username_key" ON "employees"("username");

ALTER TABLE "employees"
ADD CONSTRAINT "employees_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expense_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "employee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_reports_employee_id_created_at_idx" ON "expense_reports"("employee_id", "created_at");

ALTER TABLE "expense_reports"
ADD CONSTRAINT "expense_reports_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
