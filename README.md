# Email Tracker

A multi-user Gmail open tracker with a dashboard. The Chrome extension adds an open-tracking pixel before Gmail sends the message. A Cloudflare Worker records events in D1. No paid MailSuite plan or subscription is required.

## What it tracks

- Email opens with timestamps
- Per-message activity
- Dashboard totals, search, and CSV export
- Ignored IPs for your own devices

Open counts are estimates: Gmail and Apple Mail may proxy or preload images, and blocked images produce no event. Tracking does not identify which person opened a message sent to multiple recipients.

## Deploy on Cloudflare

You need a free Cloudflare account, Node.js, and Chrome. D1 and Workers have free tier limits; check Cloudflare's current limits before relying on them for high volume use.

```bash
npm install
npx wrangler login
npx wrangler d1 create email-tracker
```

Copy the `database_id` from the create command into `wrangler.jsonc`. Set the Chrome extension ID as a Worker variable:

```bash
npx wrangler secret put API_KEY
npx wrangler secret put EXTENSION_ID
npx wrangler secret put BOOTSTRAP_CODE_HASH
npm run db:remote
npm run deploy
```

Generate a random server-only `API_KEY` with `openssl rand -hex 32`; it is used only for sender preview detection. Set `BOOTSTRAP_CODE_HASH` to the SHA-256 hex digest of a separate random setup code. Keep the original setup code privately for the first admin registration. For `EXTENSION_ID`, use the ID shown at `chrome://extensions` after loading the unpacked `extension/` directory. You can also add a custom domain to the Worker in Cloudflare after deployment.

### Extension

1. Go to `chrome://extensions`, enable Developer mode, and load the `extension/` folder unpacked.
2. Sign in to the dashboard with email and password. Generate a pairing code in Settings, then enter the Worker URL and pairing code in the extension popup.
3. Refresh Gmail. Compose and send a new message. Check the dashboard to see its activity.

The extension pauses sending while registration completes. If registration fails, it keeps the message in the compose window and shows an error. Gmail changes its interface regularly, so refresh and test with a message to yourself after updating Gmail or the extension.

### Local development

Create `.dev.vars` with `API_KEY`, `EXTENSION_ID`, and `BOOTSTRAP_CODE_HASH`. Do not commit it. Then run:

```bash
npm run db:local
npm run dev
```

The local Worker serves at `http://localhost:8787`; set that URL in the extension popup when pairing locally.

## API

The dashboard uses a secure HttpOnly session cookie; the extension uses a separate token obtained with a one-time, 10-minute pairing code. Passwords are salted and hashed with PBKDF2. Emails, stats, exports, and ignored IPs are scoped to each account. Admins can create one-use invite links for additional users. Only the configured extension origin is allowed for cross-origin API requests. The pixel (`/t/:id.png`) and legacy click redirect (`/c/:id`) are public so mail clients can reach previously sent emails. Events store timestamps, country (from Cloudflare), and user agent. Raw IP addresses are used only to check the ignore list and are not saved with events.

## Legacy server

The old FastAPI/SQLite prototype remains in `server/` for reference. The supported deployment is the Cloudflare Worker and D1 setup above. Existing SQLite data is not migrated automatically.
