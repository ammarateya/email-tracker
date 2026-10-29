ALTER TABLE emails ADD COLUMN state TEXT NOT NULL DEFAULT 'sent' CHECK(state IN ('pending','sent'));
CREATE INDEX idx_emails_owner_state ON emails(owner_id, state, created_at);
