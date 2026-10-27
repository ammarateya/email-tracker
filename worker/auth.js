const enc = new TextEncoder();
export const random = (bytes = 32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), x => x.toString(16).padStart(2, '0')).join('');
export const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
export const passwordHash = async (password, salt) => {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('');
};
export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
export const cookie = (token, maxAge = 604800) => `tracker_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
export const sessionUser = async (db, request) => {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const session = request.headers.get('Cookie')?.match(/(?:^|;\s*)tracker_session=([a-f0-9]{64})/)?.[1];
  const token = bearer || session;
  if (!token) return null;
  const table = bearer ? 'extension_tokens' : 'sessions';
  const sql = bearer ? `SELECT u.id,u.email,u.role FROM ${table} s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?` : `SELECT u.id,u.email,u.role FROM ${table} s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`;
  return await db.prepare(sql).bind(...(bearer ? [await hash(token)] : [await hash(token), Date.now()])).first();
};
export const originAllowed = request => !request.headers.get('Origin') || request.headers.get('Origin') === new URL(request.url).origin;
