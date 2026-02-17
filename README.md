# Email Tracker

A self-hosted email tracking system. Tracks email opens and link clicks using a tracking pixel and link redirects. Includes a clean analytics dashboard and a Chrome extension that integrates directly into Gmail.

<!-- TODO: Add dashboard screenshot -->

## How it works

1. When you send an email, the Chrome extension injects an invisible 1x1 tracking pixel and wraps any links with redirect URLs
2. When the recipient opens the email, their mail client loads the pixel -- the server logs the open with timestamp, IP, and approximate location
3. When the recipient clicks a link, the server logs the click and redirects them to the original URL
4. The dashboard shows all tracked emails with open counts, click counts, and a full activity timeline

## Architecture

- **Backend**: Python (FastAPI) + SQLite
- **Dashboard**: Single-page app served by the backend (vanilla HTML/CSS/JS)
- **Chrome Extension**: Manifest V3, integrates into Gmail compose and inbox

## Setup

### Server

The server runs as a Docker container. Only the server operator has access to the tracking data.

```bash
git clone https://github.com/ammarateya/email-tracker.git
cd email-tracker
docker-compose up -d
```

The dashboard will be available at `http://localhost:8000`.

### Chrome Extension

1. Clone or download this repo to your local machine
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `extension/` folder from this repo
5. Click the extension icon in the Chrome toolbar
6. Set the **Server URL** to your server's address (e.g. `http://your-server:8000`)

Once configured, the extension will automatically:
- Inject tracking into emails you send from Gmail
- Show open/unread status indicators next to tracked emails in your inbox

## API

All endpoints are served from the same origin as the dashboard.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/emails` | Register a new tracked email |
| `GET` | `/api/emails` | List all tracked emails with counts |
| `GET` | `/api/emails/:id` | Get email detail with event timeline |
| `DELETE` | `/api/emails/:id` | Delete a tracked email |
| `GET` | `/api/stats` | Aggregate stats for the overview page |
| `GET` | `/t/:id.png` | Tracking pixel (logs open event) |
| `GET` | `/c/:id` | Click redirect (logs click event) |

## Roadmap

- Multi-tenant support
- Notifications on open/click
- Apple Mail plugin
- Email scheduling and templates

## License

MIT
