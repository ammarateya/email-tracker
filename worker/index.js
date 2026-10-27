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
const authorized = (request, env) => !!env.API_KEY && request.headers.get('Authorization') === `Bearer ${env.API_KEY}`;
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = async (db, sql, ...args) => await db.prepare(sql).bind(...args).first();
const record = async (db, request, emailId, type, linkId = null, secret = '') => {
  const ip = ipOf(request);
  if (ip && await one(db, 'SELECT ip FROM ignored_ips WHERE ip=?', ip)) return;
  if (type === 'open' && ip && secret) {
    const email = await one(db, 'SELECT sender_ip_hash, created_at FROM emails WHERE id=?', emailId);
    const ageSeconds = email ? (Date.now() - Date.parse(email.created_at.replace(' ', 'T') + 'Z')) / 1000 : Infinity;
    if (email?.sender_ip_hash && ageSeconds >= 0 && ageSeconds < 10 && email.sender_ip_hash === await ipHash(ip, secret)) return;
  }
  await db.prepare('INSERT INTO events (email_id,link_id,event_type,user_agent,country) VALUES (?,?,?,?,?)').bind(emailId, linkId, type, request.headers.get('User-Agent') || '', request.cf?.country || '').run();
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
      ctx.waitUntil(record(db, request, link.email_id, 'click', linkId, env.API_KEY));
      return Response.redirect(link.original_url, 302);
    }
    if (path.startsWith('/api/')) {
      if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request, env);
      if (!authorized(request, env)) return cors(json({ error: 'Unauthorized' }, 401), request, env);
      let result;
      if (path === '/api/emails' && method === 'POST') {
        const body = await request.json();
        if (typeof body.subject !== 'string' || typeof body.recipient !== 'string' || !Array.isArray(body.links) || body.links.length > 100 || body.subject.length > 500 || body.recipient.length > 1000) return cors(json({ error: 'Invalid email' }, 400), request, env);
        if (body.links.some(u => typeof u !== 'string' || u.length > 2048 || !allowedUrl(u))) return cors(json({ error: 'Invalid link' }, 400), request, env);
        const emailId = id(), links = body.links.map(original_url => ({ original_url, id: id() }));
        await db.batch([db.prepare('INSERT INTO emails (id,subject,recipient,sender_ip_hash) VALUES (?,?,?,?)').bind(emailId, body.subject, body.recipient, await ipHash(ipOf(request), env.API_KEY)), ...links.map(l => db.prepare('INSERT INTO links (id,email_id,original_url) VALUES (?,?,?)').bind(l.id, emailId, l.original_url))]);
        result = { email_id: emailId, pixel_url: `${url.origin}/t/${emailId}.png`, links: links.map(l => ({ original_url: l.original_url, tracked_url: `${url.origin}/c/${l.id}` })) };
      } else if (path === '/api/export.csv' && method === 'GET') {
        const data = await rows(db, `SELECT e.subject,e.recipient,e.created_at,COUNT(CASE WHEN v.event_type='open' THEN 1 END) opens,COUNT(CASE WHEN v.event_type='click' THEN 1 END) clicks,MIN(CASE WHEN v.event_type='open' THEN v.timestamp END) first_open FROM emails e LEFT JOIN events v ON v.email_id=e.id GROUP BY e.id ORDER BY e.created_at DESC LIMIT 10000`);
        const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
        const columns = ['subject','recipient','created_at','opens','clicks','first_open'];
        const csv = [columns.join(','), ...data.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n');
        return cors(new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="email-tracker.csv"', 'Cache-Control': 'no-store' } }), request, env);
      } else if (path === '/api/emails' && method === 'GET') {
        const q = url.searchParams.get('q') || '', page = Math.max(1, Number(url.searchParams.get('page')) || 1), per = Math.min(200, Math.max(1, Number(url.searchParams.get('per_page')) || 50));
        const match = `%${q}%`;
        const total = (await one(db, 'SELECT COUNT(*) n FROM emails WHERE subject LIKE ? OR recipient LIKE ?', match, match)).n;
        const emails = await rows(db, `SELECT e.id,e.subject,e.recipient,e.created_at, SUM(CASE WHEN v.event_type='open' THEN 1 ELSE 0 END) open_count, SUM(CASE WHEN v.event_type='click' THEN 1 ELSE 0 END) click_count, MAX(CASE WHEN v.event_type='open' THEN v.timestamp END) last_opened FROM emails e LEFT JOIN events v ON v.email_id=e.id WHERE e.subject LIKE ? OR e.recipient LIKE ? GROUP BY e.id ORDER BY e.created_at DESC LIMIT ? OFFSET ?`, match, match, per, (page - 1) * per);
        result = { emails, total, page, per_page: per };
      } else if (/^\/api\/emails\/[^/]+$/.test(path)) {
        const emailId = path.split('/')[3];
        if (method === 'DELETE') { await db.prepare('DELETE FROM emails WHERE id=?').bind(emailId).run(); result = { ok: true }; }
        else if (method === 'GET') {
          const email = await one(db, 'SELECT id,subject,recipient,created_at FROM emails WHERE id=?', emailId);
          if (!email) return cors(json({ error: 'Not found' }, 404), request, env);
          const events = await rows(db, 'SELECT v.*,l.original_url FROM events v LEFT JOIN links l ON l.id=v.link_id WHERE v.email_id=? ORDER BY v.timestamp DESC LIMIT 1000', emailId);
          const counts = await one(db, `SELECT SUM(CASE WHEN event_type='open' THEN 1 ELSE 0 END) total_opens, SUM(CASE WHEN event_type='click' THEN 1 ELSE 0 END) total_clicks, COUNT(DISTINCT CASE WHEN event_type='open' THEN user_agent || country END) unique_opens FROM events WHERE email_id=?`, emailId);
          const link_stats = await rows(db, `SELECT l.id,l.original_url,COUNT(v.id) click_count FROM links l LEFT JOIN events v ON v.link_id=l.id WHERE l.email_id=? GROUP BY l.id`, emailId);
          result = { ...email, events, total_opens: counts.total_opens || 0, total_clicks: counts.total_clicks || 0, unique_opens: counts.unique_opens || 0, ignored_opens: 0, link_stats };
        }
      } else if (path === '/api/stats' && method === 'GET') {
        const totals = await one(db, `SELECT (SELECT COUNT(*) FROM emails) total_emails,(SELECT COUNT(*) FROM events WHERE event_type='open') total_opens,(SELECT COUNT(*) FROM events WHERE event_type='click') total_clicks,(SELECT COUNT(DISTINCT email_id) FROM events WHERE event_type='open') emails_opened`);
        result = { ...totals, open_rate: totals.total_emails ? Math.round(totals.emails_opened / totals.total_emails * 1000) / 10 : 0, activity: await rows(db, `SELECT DATE(timestamp) date,SUM(event_type='open') opens,SUM(event_type='click') clicks FROM events WHERE timestamp >= DATE('now','-30 days') GROUP BY DATE(timestamp) ORDER BY date`) };
      } else if (path === '/api/ignored-ips' && method === 'GET') result = await rows(db, 'SELECT * FROM ignored_ips ORDER BY created_at DESC');
      else if (path === '/api/ignored-ips' && method === 'POST') { const body = await request.json(); const ip = body.ip || ipOf(request); if (!ip || ip.length > 64) return cors(json({ error: 'Invalid IP' }, 400), request, env); await db.prepare('INSERT OR IGNORE INTO ignored_ips (ip,label) VALUES (?,?)').bind(ip, String(body.label || '').slice(0, 100)).run(); result = { ok: true, ip }; }
      else if (path.startsWith('/api/ignored-ips/') && method === 'DELETE') { await db.prepare('DELETE FROM ignored_ips WHERE ip=?').bind(decodeURIComponent(path.slice(17))).run(); result = { ok: true }; }
      else if (path === '/api/my-ip' && method === 'GET') result = { ip: ipOf(request) };
      else return cors(json({ error: 'Not found' }, 404), request, env);
      return cors(json(result), request, env);
    }
    if (path === '/') return env.ASSETS.fetch(new Request(new URL('/index.html', url)));
    return env.ASSETS.fetch(request);
  } catch (error) { console.error(error); return json({ error: 'Server error' }, 500); }
} };
