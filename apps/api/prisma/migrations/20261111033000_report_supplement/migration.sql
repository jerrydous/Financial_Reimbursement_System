ALTER TABLE "expense_reports" ADD COLUMN "supplement_history" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "resume_status" TEXT, ADD COLUMN "resume_actor_id" TEXT;
