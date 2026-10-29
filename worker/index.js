import { authRoute } from './auth-routes.js';
import { sessionUser, originAllowed } from './auth.js';
const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const id = () => crypto.randomUUID().replaceAll('-', '').slice(0, 20);
const ipOf = request => request.headers.get('CF-Connecting-IP') || '';
const ipHash = async (ip, secret) => {
  if (!ip) return null;
  const data = new TextEncoder().encode(`${secret}:${ip}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
};
const allowedUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
const cors = (response, request, env) => { const origin = request.headers.get('Origin'); if (origin === `chrome-extension://${env.EXTENSION_ID}`) { response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type'); response.headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS'); } return response; };
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = async (db, sql, ...args) => await db.prepare(sql).bind(...args).first();
const record = async (db, request, emailId, type, linkId = null, secret = '') => {
  const ip = ipOf(request);
  if (ip && await one(db, 'SELECT 1 FROM ignored_ips WHERE owner_id=(SELECT owner_id FROM emails WHERE id=?) AND ip=?', emailId, ip)) return;
  if (type === 'open' && ip && secret) {
    const email = await one(db, 'SELECT sender_ip_hash, created_at FROM emails WHERE id=?', emailId);
    const ageSeconds = email ? (Date.now() - Date.parse(email.created_at.replace(' ', 'T') + 'Z')) / 1000 : Infinity;
    if (email?.sender_ip_hash && ageSeconds >= 0 && ageSeconds < 10 && email.sender_ip_hash === await ipHash(ip, secret)) return;
  }
  await db.prepare('INSERT INTO events (email_id,link_id,event_type,user_agent,country) SELECT id,?,?,?,? FROM emails WHERE id=? AND sender_view_until_ms<?').bind(linkId, type, request.headers.get('User-Agent') || '', request.cf?.country || '', emailId, Date.now()).run();
};
export default { async fetch(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname, method = request.method, db = env.DB;
  try {
    if (path.startsWith('/t/') && method === 'GET') {
      const emailId = path.slice(3).replace(/\.png$/, '');
      if (/^[a-f0-9]{12,32}$/.test(emailId) && await one(db, 'SELECT id FROM emails WHERE id=?', emailId)) ctx.waitUntil(record(db, request, emailId, 'open', null, env.API_KEY));
      return new Response(pixel, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store, no-cache, max-age=0' } });
    }
    if (path.startsWith('/c/') && method === 'GET') {
      const linkId = path.slice(3), link = await one(db, 'SELECT email_id,original_url FROM links WHERE id=?', linkId);
      if (!link || !allowedUrl(link.original_url)) return json({ error: 'Link not found' }, 404);
      return Response.redirect(link.original_url, 302);
    }
    if (path.startsWith('/api/')) {
      if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request, env);
      if (!['GET','HEAD','OPTIONS'].includes(method) && !request.headers.get('Authorization') && path !== '/api/auth/extension-claim' && !originAllowed(request)) return json({ error: 'Invalid origin' }, 403);
      const auth = await authRoute(request, env, url, path, method);
      if (auth) return cors(auth, request, env);
      const user = await sessionUser(db, request);
      if (!user) return cors(json({ error: 'Unauthorized' }, 401), request, env);
      let result;
      if (path === '/api/emails' && method === 'POST') {
        const body = await request.json();
        const suppliedLinks = body.links == null ? [] : body.links;
        if (typeof body.subject !== 'string' || typeof body.recipient !== 'string' || !Array.isArray(suppliedLinks) || suppliedLinks.length > 100 || body.subject.length > 500 || body.recipient.length > 1000) return cors(json({ error: 'Invalid email' }, 400), request, env);
        if (suppliedLinks.some(u => typeof u !== 'string' || u.length > 2048 || !allowedUrl(u))) return cors(json({ error: 'Invalid link' }, 400), request, env);
        const emailId = id();
        await db.prepare('INSERT INTO emails (id,subject,recipient,sender_ip_hash,owner_id) VALUES (?,?,?,?,?)').bind(emailId, body.subject, body.recipient, await ipHash(ipOf(request), env.API_KEY), user.id).run();
        result = { email_id: emailId, pixel_url: `${url.origin}/t/${emailId}.png`, links: suppliedLinks.map(original_url => ({ original_url, tracked_url: original_url })) };
      } else if (/^\/api\/emails\/[^/]+\/self-view$/.test(path) && method === 'POST') {
        const emailId = path.split('/')[3];
        const owned = await one(db, 'SELECT id FROM emails WHERE id=? AND owner_id=?', emailId, user.id);
        if (!owned) return cors(json({ error: 'Not found' }, 404), request, env);
        await db.batch([
          db.prepare('UPDATE emails SET sender_view_until_ms=? WHERE id=?').bind(Date.now() + 15000, emailId),
          db.prepare("UPDATE events SET ignored_sender=1 WHERE email_id=? AND event_type='open' AND ignored_sender=0 AND timestamp>=datetime('now','-20 seconds') AND user_agent LIKE '%GoogleImageProxy%'").bind(emailId)
        ]);
        result = { ok: true };
      } else if (/^\/api\/events\/\d+\/ignore$/.test(path) && method === 'POST') {
        const eventId = Number(path.split('/')[3]);
        const body = await request.json();
        if (typeof body.ignored !== 'boolean') return cors(json({ error: 'Invalid value' }, 400), request, env);
        await db.prepare("UPDATE events SET ignored_sender=? WHERE id=? AND event_type='open' AND email_id IN (SELECT id FROM emails WHERE owner_id=?)").bind(body.ignored ? 1 : 0, eventId, user.id).run();
        result = { ok: true };
      } else if (path === '/api/export.csv' && method === 'GET') {
        const data = await rows(db, `SELECT e.subject,e.recipient,e.created_at,COUNT(CASE WHEN v.event_type='open' AND v.ignored_sender=0 THEN 1 END) opens,MIN(CASE WHEN v.event_type='open' AND v.ignored_sender=0 THEN v.timestamp END) first_open FROM emails e LEFT JOIN events v ON v.email_id=e.id WHERE e.owner_id=? GROUP BY e.id ORDER BY e.created_at DESC LIMIT 10000`, user.id);
        const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
        const columns = ['subject','recipient','created_at','opens','first_open'];
        const csv = [columns.join(','), ...data.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n');
        return cors(new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="email-tracker.csv"', 'Cache-Control': 'no-store' } }), request, env);
      } else if (path === '/api/emails' && method === 'GET') {
        const q = url.searchParams.get('q') || '', page = Math.max(1, Number(url.searchParams.get('page')) || 1), per = Math.min(200, Math.max(1, Number(url.searchParams.get('per_page')) || 50));
        const match = `%${q}%`;
        const total = (await one(db, 'SELECT COUNT(*) n FROM emails WHERE owner_id=? AND (subject LIKE ? OR recipient LIKE ?)', user.id, match, match)).n;
        const emails = await rows(db, `SELECT e.id,e.subject,e.recipient,e.created_at, SUM(CASE WHEN v.event_type='open' AND v.ignored_sender=0 THEN 1 ELSE 0 END) open_count, MAX(CASE WHEN v.event_type='open' AND v.ignored_sender=0 THEN v.timestamp END) last_opened FROM emails e LEFT JOIN events v ON v.email_id=e.id WHERE e.owner_id=? AND (e.subject LIKE ? OR e.recipient LIKE ?) GROUP BY e.id ORDER BY e.created_at DESC LIMIT ? OFFSET ?`, user.id, match, match, per, (page - 1) * per);
        result = { emails, total, page, per_page: per };
      } else if (/^\/api\/emails\/[^/]+$/.test(path)) {
        const emailId = path.split('/')[3];
        if (method === 'DELETE') { await db.prepare('DELETE FROM emails WHERE id=? AND owner_id=?').bind(emailId, user.id).run(); result = { ok: true }; }
        else if (method === 'GET') {
          const email = await one(db, 'SELECT id,subject,recipient,created_at FROM emails WHERE id=? AND owner_id=?', emailId, user.id);
          if (!email) return cors(json({ error: 'Not found' }, 404), request, env);
          const events = await rows(db, "SELECT id,email_id,event_type,timestamp,user_agent,country,ignored_sender FROM events WHERE email_id=? AND event_type='open' ORDER BY timestamp DESC LIMIT 1000", emailId);
          const counts = await one(db, `SELECT SUM(CASE WHEN ignored_sender=0 THEN 1 ELSE 0 END) total_opens, COUNT(DISTINCT CASE WHEN ignored_sender=0 THEN user_agent || country END) unique_opens FROM events WHERE email_id=? AND event_type='open'`, emailId);
          result = { ...email, events, total_opens: counts.total_opens || 0, unique_opens: counts.unique_opens || 0, ignored_opens: 0 };
        }
      } else if (path === '/api/stats' && method === 'GET') {
        const totals = await one(db, `SELECT (SELECT COUNT(*) FROM emails WHERE owner_id=?) total_emails,(SELECT COUNT(*) FROM events v JOIN emails e ON e.id=v.email_id WHERE e.owner_id=? AND v.event_type='open' AND v.ignored_sender=0) total_opens,(SELECT COUNT(DISTINCT v.email_id) FROM events v JOIN emails e ON e.id=v.email_id WHERE e.owner_id=? AND v.event_type='open' AND v.ignored_sender=0) emails_opened`, user.id, user.id, user.id);
        result = { ...totals, open_rate: totals.total_emails ? Math.round(totals.emails_opened / totals.total_emails * 1000) / 10 : 0, activity: await rows(db, `SELECT DATE(v.timestamp) date,COUNT(*) opens FROM events v JOIN emails e ON e.id=v.email_id WHERE e.owner_id=? AND v.event_type='open' AND v.ignored_sender=0 AND v.timestamp >= DATE('now','-30 days') GROUP BY DATE(v.timestamp) ORDER BY date`, user.id) };
      } else if (path === '/api/ignored-ips' && method === 'GET') result = await rows(db, 'SELECT ip,label,created_at FROM ignored_ips WHERE owner_id=? ORDER BY created_at DESC', user.id);
      else if (path === '/api/ignored-ips' && method === 'POST') { const body = await request.json(); const ip = body.ip || ipOf(request); if (!ip || ip.length > 64) return cors(json({ error: 'Invalid IP' }, 400), request, env); await db.prepare('INSERT OR IGNORE INTO ignored_ips (owner_id,ip,label) VALUES (?,?,?)').bind(user.id, ip, String(body.label || '').slice(0, 100)).run(); result = { ok: true, ip }; }
      else if (path.startsWith('/api/ignored-ips/') && method === 'DELETE') { await db.prepare('DELETE FROM ignored_ips WHERE owner_id=? AND ip=?').bind(user.id, decodeURIComponent(path.slice(17))).run(); result = { ok: true }; }
      else if (path === '/api/my-ip' && method === 'GET') result = { ip: ipOf(request) };
      else return cors(json({ error: 'Not found' }, 404), request, env);
      return cors(json(result), request, env);
    }
    if (path === '/' || path === '/index.html') {
      if (!await sessionUser(db, request)) return Response.redirect(new URL('/login.html', url), 302);
      return env.ASSETS.fetch(new Request(new URL('/index.html', url)));
    }
    return env.ASSETS.fetch(request);
  } catch (error) { console.error(error); return json({ error: 'Server error' }, 500); }
} };
