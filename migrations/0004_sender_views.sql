ALTER TABLE emails ADD COLUMN sender_view_until_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN ignored_sender INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_events_email_open_visible ON events(email_id, event_type, ignored_sender);
