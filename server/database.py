import aiosqlite
import os

DB_PATH = os.environ.get("DB_PATH", "/home/ammarateya/email-tracker/data/tracker.db")


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await get_db()
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS emails (
            id TEXT PRIMARY KEY,
            subject TEXT NOT NULL,
            recipient TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS links (
            id TEXT PRIMARY KEY,
            email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
            original_url TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
            link_id TEXT REFERENCES links(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL CHECK(event_type IN ('open', 'click')),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip TEXT,
            user_agent TEXT,
            country TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_email_id ON events(email_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_links_email_id ON links(email_id);
    """)
    await db.commit()
    await db.close()
