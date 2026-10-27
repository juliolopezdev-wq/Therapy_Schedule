-- The normal deployment uses drizzle-kit push against schema.ts.
-- For managed/manual migrations, apply once after a verified backup.
ALTER TABLE patients ADD COLUMN actualDischargeDate TEXT;
CREATE TABLE IF NOT EXISTS aiChangeProposals (
  id TEXT PRIMARY KEY NOT NULL,
  actorUserId INTEGER NOT NULL,
  state TEXT DEFAULT 'pending' NOT NULL,
  payload TEXT NOT NULL,
  result TEXT,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);
