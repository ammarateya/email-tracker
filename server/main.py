import base64
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

from database import get_db, init_db

# 1x1 transparent PNG (68 bytes)
PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYPgPAAEDAQAIicLsAAAABJRU5ErkJggg=="
)


async def geolocate_ip(ip: str) -> str:
    """Best-effort IP geolocation using free ip-api.com."""
    if not ip or ip in ("127.0.0.1", "::1", "testclient"):
        return ""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"http://ip-api.com/json/{ip}?fields=country,city")
            if resp.status_code == 200:
                data = resp.json()
                city = data.get("city", "")
                country = data.get("country", "")
                if city and country:
                    return f"{city}, {country}"
                return country or ""
    except Exception:
        pass
    return ""


def client_ip(request: Request) -> str:
    """Extract client IP, respecting CF and proxy headers."""
    return (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "")
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Tracking routes
# ---------------------------------------------------------------------------


@app.get("/t/{tracking_id}.png")
async def track_open(tracking_id: str, request: Request):
    """Serve tracking pixel and log open event."""
    db = await get_db()
    try:
        ip = client_ip(request)

        # Skip ignored IPs (your own devices)
        ignored = await db.execute_fetchall(
            "SELECT ip FROM ignored_ips WHERE ip = ?", (ip,)
        )
        if ignored:
            return Response(
                content=PIXEL_PNG,
                media_type="image/png",
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        # Create email record if it doesn't exist yet (pixel may load before registration)
        await db.execute(
            "INSERT OR IGNORE INTO emails (id, subject, recipient) VALUES (?, '', '')",
            (tracking_id,),
        )
        country = await geolocate_ip(ip)
        await db.execute(
            "INSERT INTO events (email_id, event_type, ip, user_agent, country) VALUES (?, 'open', ?, ?, ?)",
            (tracking_id, ip, request.headers.get("user-agent", ""), country),
        )
        await db.commit()
    finally:
        await db.close()

    return Response(
        content=PIXEL_PNG,
        media_type="image/png",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/c/{link_id}")
async def track_click(link_id: str, request: Request):
    """Log click event and redirect to original URL."""
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT email_id, original_url FROM links WHERE id = ?", (link_id,)
        )
        if not rows:
            return JSONResponse({"error": "Link not found"}, status_code=404)

        link = rows[0]
        ip = client_ip(request)

        # Skip ignored IPs (your own devices)
        ignored = await db.execute_fetchall(
            "SELECT ip FROM ignored_ips WHERE ip = ?", (ip,)
        )
        if not ignored:
            country = await geolocate_ip(ip)
            await db.execute(
                "INSERT INTO events (email_id, link_id, event_type, ip, user_agent, country) VALUES (?, ?, 'click', ?, ?, ?)",
                (link["email_id"], link_id, ip, request.headers.get("user-agent", ""), country),
            )
            await db.commit()
        redirect_url = link["original_url"]
    finally:
        await db.close()

    return RedirectResponse(url=redirect_url, status_code=302)


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------


@app.post("/api/emails")
async def create_email(request: Request):
    """Register a new tracked email. Body: {subject, recipient, links: [url, ...]}"""
    body = await request.json()
    email_id = body.get("emailId") or uuid.uuid4().hex[:12]
    subject = body.get("subject", "")
    recipient = body.get("recipient", "")
    link_urls = body.get("links", [])

    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO emails (id, subject, recipient) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, recipient=excluded.recipient "
            "WHERE subject = '' OR recipient = ''",
            (email_id, subject, recipient),
        )

        link_mappings = []
        for url in link_urls:
            link_id = uuid.uuid4().hex[:10]
            await db.execute(
                "INSERT INTO links (id, email_id, original_url) VALUES (?, ?, ?)",
                (link_id, email_id, url),
            )
            link_mappings.append({"original_url": url, "tracked_url": f"/c/{link_id}"})

        await db.commit()
    finally:
        await db.close()

    return {
        "email_id": email_id,
        "pixel_url": f"/t/{email_id}.png",
        "links": link_mappings,
    }


@app.get("/api/emails")
async def list_emails(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: str = Query("", alias="q"),
):
    """List tracked emails with open/click counts."""
    db = await get_db()
    try:
        offset = (page - 1) * per_page

        where = ""
        params: list = []
        if search:
            where = "WHERE e.subject LIKE ? OR e.recipient LIKE ?"
            params = [f"%{search}%", f"%{search}%"]

        count_row = await db.execute_fetchall(
            f"SELECT COUNT(*) as total FROM emails e {where}", params
        )
        total = count_row[0]["total"]

        rows = await db.execute_fetchall(
            f"""
            SELECT
                e.id, e.subject, e.recipient, e.created_at,
                COALESCE(SUM(CASE WHEN ev.event_type = 'open' THEN 1 ELSE 0 END), 0) as open_count,
                COALESCE(SUM(CASE WHEN ev.event_type = 'click' THEN 1 ELSE 0 END), 0) as click_count,
                MAX(CASE WHEN ev.event_type = 'open' THEN ev.timestamp END) as last_opened
            FROM emails e
            LEFT JOIN events ev ON ev.email_id = e.id
            {where}
            GROUP BY e.id
            ORDER BY e.created_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [per_page, offset],
        )

        emails = [dict(r) for r in rows]
    finally:
        await db.close()

    return {"emails": emails, "total": total, "page": page, "per_page": per_page}


@app.get("/api/emails/{email_id}")
async def get_email(email_id: str):
    """Get email detail with events and link breakdown."""
    db = await get_db()
    try:
        rows = await db.execute_fetchall(
            "SELECT * FROM emails WHERE id = ?", (email_id,)
        )
        if not rows:
            return JSONResponse({"error": "Not found"}, status_code=404)

        email = dict(rows[0])

        events = await db.execute_fetchall(
            """
            SELECT ev.*, l.original_url
            FROM events ev
            LEFT JOIN links l ON l.id = ev.link_id
            WHERE ev.email_id = ?
            ORDER BY ev.timestamp DESC
            """,
            (email_id,),
        )
        email["events"] = [dict(e) for e in events]

        # Unique opens by IP
        unique_opens = await db.execute_fetchall(
            "SELECT COUNT(DISTINCT ip) as count FROM events WHERE email_id = ? AND event_type = 'open'",
            (email_id,),
        )
        email["unique_opens"] = unique_opens[0]["count"]

        # Total counts
        counts = await db.execute_fetchall(
            """
            SELECT
                COALESCE(SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END), 0) as total_opens,
                COALESCE(SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END), 0) as total_clicks
            FROM events WHERE email_id = ?
            """,
            (email_id,),
        )
        email["total_opens"] = counts[0]["total_opens"]
        email["total_clicks"] = counts[0]["total_clicks"]

        # Link breakdown
        link_stats = await db.execute_fetchall(
            """
            SELECT l.id, l.original_url, COUNT(ev.id) as click_count
            FROM links l
            LEFT JOIN events ev ON ev.link_id = l.id AND ev.event_type = 'click'
            WHERE l.email_id = ?
            GROUP BY l.id
            """,
            (email_id,),
        )
        email["link_stats"] = [dict(ls) for ls in link_stats]
    finally:
        await db.close()

    return email


@app.delete("/api/emails/{email_id}")
async def delete_email(email_id: str):
    """Delete a tracked email and all its events."""
    db = await get_db()
    try:
        await db.execute("DELETE FROM emails WHERE id = ?", (email_id,))
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.get("/api/stats")
async def get_stats():
    """Aggregate stats for the overview page."""
    db = await get_db()
    try:
        totals = await db.execute_fetchall("""
            SELECT
                (SELECT COUNT(*) FROM emails) as total_emails,
                (SELECT COUNT(*) FROM events WHERE event_type = 'open') as total_opens,
                (SELECT COUNT(*) FROM events WHERE event_type = 'click') as total_clicks
        """)
        t = dict(totals[0])

        # Emails with at least one open
        opened = await db.execute_fetchall("""
            SELECT COUNT(DISTINCT email_id) as count FROM events WHERE event_type = 'open'
        """)
        t["emails_opened"] = opened[0]["count"]
        t["open_rate"] = (
            round(t["emails_opened"] / t["total_emails"] * 100, 1)
            if t["total_emails"] > 0
            else 0
        )

        # Activity over last 30 days
        activity = await db.execute_fetchall("""
            SELECT DATE(timestamp) as date,
                   SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END) as opens,
                   SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as clicks
            FROM events
            WHERE timestamp >= DATE('now', '-30 days')
            GROUP BY DATE(timestamp)
            ORDER BY date
        """)
        t["activity"] = [dict(a) for a in activity]
    finally:
        await db.close()

    return t


# ---------------------------------------------------------------------------
# Ignored IPs management
# ---------------------------------------------------------------------------


@app.get("/api/ignored-ips")
async def list_ignored_ips():
    db = await get_db()
    try:
        rows = await db.execute_fetchall("SELECT * FROM ignored_ips ORDER BY created_at DESC")
        return [dict(r) for r in rows]
    finally:
        await db.close()


@app.post("/api/ignored-ips")
async def add_ignored_ip(request: Request):
    """Add an IP to ignore. Body: {ip, label?} or pass no body to ignore your current IP."""
    body = await request.json()
    ip = body.get("ip") or client_ip(request)
    label = body.get("label", "")
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR IGNORE INTO ignored_ips (ip, label) VALUES (?, ?)", (ip, label)
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "ip": ip}


@app.delete("/api/ignored-ips/{ip}")
async def remove_ignored_ip(ip: str):
    db = await get_db()
    try:
        await db.execute("DELETE FROM ignored_ips WHERE ip = ?", (ip,))
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.get("/api/my-ip")
async def my_ip(request: Request):
    """Returns the caller's IP as seen by the server. Useful for adding yourself to the ignore list."""
    return {"ip": client_ip(request)}


# Serve dashboard — static assets under /static, index.html at root
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    """Serve dashboard and auto-ignore the viewer's IP."""
    ip = client_ip(request)
    if ip and ip not in ("127.0.0.1", "::1"):
        db = await get_db()
        try:
            await db.execute(
                "INSERT OR IGNORE INTO ignored_ips (ip, label) VALUES (?, ?)",
                (ip, "Auto-detected (dashboard visit)"),
            )
            await db.commit()
        finally:
            await db.close()
    with open("static/index.html") as f:
        return f.read()
