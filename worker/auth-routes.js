import { random, hash, passwordHash, safeEqual, cookie, sessionUser } from './auth.js';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const one = async (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const id = () => crypto.randomUUID().replaceAll('-', '').slice(0, 20);
export async function authRoute(request, env, url, path, method) {
  const db = env.DB;
  if (path === '/api/auth/state' && method === 'GET') return json({ user: await sessionUser(db, request), setup: !(await one(db, 'SELECT id FROM users LIMIT 1')) });
  if (path === '/api/auth/register' && method === 'POST') {
    const { email, password, code } = await request.json();
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 256 || typeof code !== 'string') return json({ error: 'Use a valid email, a password of at least 12 characters, and an invite code.' }, 400);
    const first = !(await one(db, 'SELECT id FROM users LIMIT 1'));
    const codeHash = await hash(code.trim());
    if (first) {
      if (!env.BOOTSTRAP_CODE_HASH || !safeEqual(codeHash, env.BOOTSTRAP_CODE_HASH)) return json({ error: 'Invalid setup code' }, 403);
    } else if (!await one(db, 'SELECT code_hash FROM invites WHERE code_hash=? AND used_by IS NULL AND expires_at>?', codeHash, Date.now())) return json({ error: 'Invalid or expired invite code' }, 403);
    if (await one(db, 'SELECT id FROM users WHERE email=?', normalized)) return json({ error: 'Email already registered' }, 409);
    const userId = id(), salt = random(16), passhash = await passwordHash(password, salt), token = random();
    try {
      await db.batch([
        db.prepare('INSERT INTO users (id,email,salt,password_hash,role) VALUES (?,?,?,?,?)').bind(userId, normalized, salt, passhash, first ? 'admin' : 'user'),
        ...(first ? [db.prepare('UPDATE emails SET owner_id=? WHERE owner_id IS NULL').bind(userId)] : [db.prepare('UPDATE invites SET used_by=? WHERE code_hash=? AND used_by IS NULL').bind(userId, codeHash)]),
        db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(token), userId, Date.now() + 604800000)
      ]);
    } catch { return json({ error: 'Registration failed; try again.' }, 409); }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(token) } });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const { email, password } = await request.json();
    const user = await one(db, 'SELECT * FROM users WHERE email=?', String(email || '').trim().toLowerCase());
    if (!user || typeof password !== 'string' || !safeEqual(await passwordHash(password, user.salt), user.password_hash)) return json({ error: 'Invalid email or password' }, 401);
    const token = random();
    await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(token), user.id, Date.now() + 604800000).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(token) } });
  }
  if (path === '/api/auth/extension-claim' && method === 'POST') {
    const { code } = await request.json();
    const codeHash = await hash(String(code || '').trim());
    const pairing = await one(db, 'SELECT user_id FROM pairing_codes WHERE code_hash=? AND expires_at>?', codeHash, Date.now());
    if (!pairing) return json({ error: 'Invalid or expired pairing code' }, 403);
    const token = random();
    await db.batch([db.prepare('DELETE FROM pairing_codes WHERE code_hash=?').bind(codeHash), db.prepare('INSERT INTO extension_tokens (token_hash,user_id) VALUES (?,?)').bind(await hash(token), pairing.user_id)]);
    return json({ token });
  }
  if (path === '/api/auth/extension-token' && method === 'DELETE') {
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return json({ error: 'Unauthorized' }, 401);
    await db.prepare('DELETE FROM extension_tokens WHERE token_hash=?').bind(await hash(token)).run();
    return json({ ok: true });
  }
  if (!path.startsWith('/api/auth/')) return null;
  const user = await sessionUser(db, request);
  if (!user || request.headers.get('Authorization')) return json({ error: 'Sign in on the dashboard' }, 401);
  if (path === '/api/auth/logout' && method === 'POST') {
    const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)tracker_session=([a-f0-9]{64})/)?.[1];
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie('', 0) } });
  }
  if (path === '/api/auth/invite' && method === 'POST') {
    if (user.role !== 'admin') return json({ error: 'Admin only' }, 403);
    const code = random(12);
    await db.prepare('INSERT INTO invites (code_hash,created_by,expires_at) VALUES (?,?,?)').bind(await hash(code), user.id, Date.now() + 7 * 86400000).run();
    return json({ code, register_url: `${url.origin}/login.html?invite=${code}` });
  }
  if (path === '/api/auth/pair' && method === 'POST') {
    const code = random(8);
    await db.prepare('INSERT INTO pairing_codes (code_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(code), user.id, Date.now() + 600000).run();
    return json({ code, expires_in: 600 });
  }
  return json({ error: 'Not found' }, 404);
}
