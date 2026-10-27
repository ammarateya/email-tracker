const DEFAULT_SERVER = 'http://localhost:8787';
async function config() {
  const stored = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
  return { server: (stored.serverUrl || DEFAULT_SERVER).replace(/\/$/, ''), apiKey: stored.apiKey || '' };
}
async function api(path, options = {}) {
  const { server, apiKey } = await config();
  const response = await fetch(server + path, { ...options, headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return { ...data, server };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    try {
      if (message.type === 'GET_CONFIG') return { ...await config(), apiKey: (await config()).apiKey };
      if (message.type === 'SET_CONFIG') {
        await chrome.storage.sync.set({ serverUrl: message.serverUrl, apiKey: message.apiKey });
        return { ok: true };
      }
      if (message.type === 'CREATE_TRACKING') return { ok: true, ...await api('/api/emails', { method: 'POST', body: JSON.stringify(message.data) }) };
      if (message.type === 'GET_RECENT') return { ok: true, ...await api('/api/emails?per_page=10') };
      return { ok: false, error: 'Unknown message' };
    } catch (error) { return { ok: false, error: error.message }; }
  })().then(reply);
  return true;
});
