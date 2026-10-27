# Email Tracker

A personal Gmail open and link tracker with a dashboard. The Chrome extension adds a tracking pixel and rewrites links before Gmail sends the message. A Cloudflare Worker records events in D1. No paid MailSuite plan or subscription is required.

## What it tracks

- Email opens and link clicks with timestamps
- Per-message activity and link breakdown
- Dashboard totals, search, and CSV export
- Ignored IPs for your own devices

Open counts are estimates: Gmail and Apple Mail may proxy or preload images, and blocked images produce no event. A click only registers when a recipient follows a rewritten link. Tracking does not identify which person opened a message sent to multiple recipients.

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
npm run db:remote
npm run deploy
```

Generate an API key with `openssl rand -hex 32`. For `EXTENSION_ID`, use the ID shown at `chrome://extensions` after loading the unpacked `extension/` directory. If it changes, update the secret. The dashboard asks for the API key and stores it only in that browser tab's session storage. Enter the same key in the extension popup. You can also add a custom domain to the Worker in Cloudflare after deployment.

### Extension

1. Go to `chrome://extensions`, enable Developer mode, and load the `extension/` folder unpacked.
2. Open the popup and enter the deployed Worker URL and API key.
3. Refresh Gmail. Compose and send a new message. Check the dashboard to see its activity.

The extension pauses sending while registration completes. If registration fails, it keeps the message in the compose window and shows an error. Gmail changes its interface regularly, so refresh and test with a message to yourself after updating Gmail or the extension.

### Local development

Create `.dev.vars` with `API_KEY=<your-key>` and `EXTENSION_ID=<your-local-extension-id>`. Do not commit it. Then run:

```bash
npm run db:local
npm run dev
```

The local Worker serves at `http://localhost:8787` and the extension popup defaults to that URL.

## API

All `/api/*` routes require `Authorization: Bearer <API_KEY>`. Only the configured extension origin is allowed for cross-origin API requests. The pixel (`/t/:id.png`) and click redirect (`/c/:id`) are public so mail clients can reach them. Events store timestamps, country (from Cloudflare), and user agent. Raw IP addresses are used only to check the ignore list and are not saved with events.

## Legacy server

The old FastAPI/SQLite prototype remains in `server/` for reference. The supported deployment is the Cloudflare Worker and D1 setup above. Existing SQLite data is not migrated automatically.
