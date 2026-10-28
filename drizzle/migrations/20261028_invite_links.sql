-- Invite links last 7 days and work only while the invite is still pending.
ALTER TABLE magicLinks ADD COLUMN forInvite INTEGER DEFAULT 0 NOT NULL;
