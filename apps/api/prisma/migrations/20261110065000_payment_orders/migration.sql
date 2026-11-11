CREATE TABLE payout_orders (
 id TEXT PRIMARY KEY,
 report_id TEXT NOT NULL UNIQUE REFERENCES expense_reports(id),
 actor_id TEXT NOT NULL REFERENCES employees(id),
 amount_fen BIGINT NOT NULL CHECK(amount_fen > 0),
 currency TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','unknown','succeeded','failed')),
 provider_reference TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
