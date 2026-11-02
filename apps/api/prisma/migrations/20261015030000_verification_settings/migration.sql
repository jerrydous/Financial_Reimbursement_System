CREATE TABLE "verification_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "company_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'off',
    "base_url" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT 'ap-guangzhou',
    "secret_id" TEXT NOT NULL DEFAULT '',
    "api_key" TEXT NOT NULL DEFAULT '',
    "updated_by" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "verification_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verification_settings_company_id_key" ON "verification_settings"("company_id");

ALTER TABLE "verification_settings"
ADD CONSTRAINT "verification_settings_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
