ALTER TABLE "invoices" ADD COLUMN "seller_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN "invoice_date" TEXT NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN "ledger_status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "invoices" ADD COLUMN "transferred_to_employee_id" TEXT;
ALTER TABLE "invoices" ADD COLUMN "ocr_status" TEXT NOT NULL DEFAULT 'skipped';
ALTER TABLE "invoices" ADD COLUMN "ocr_message" TEXT NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN "ocr_request_id" TEXT NOT NULL DEFAULT '';
