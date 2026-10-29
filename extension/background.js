const DEFAULT_SERVER = 'https://email-tracker.ammarateya.workers.dev';
async function config() {
  const stored = await chrome.storage.local.get(['serverUrl', 'extensionToken']);
  return { server: (stored.serverUrl || DEFAULT_SERVER).replace(/\/$/, ''), connected: !!stored.extensionToken, token: stored.extensionToken || '' };
}
async function api(path, options = {}) {
  const { server, token } = await config();
  if (!token) throw new Error('Connect the extension from Dashboard → Settings');
  const response = await fetch(server + path, { ...options, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return { ...data, server };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    try {
      if (message.type === 'GET_CONFIG') { const { server, connected } = await config(); return { server, connected }; }
      if (message.type === 'PAIR') {
        const server = String(message.serverUrl || DEFAULT_SERVER).replace(/\/$/, '');
        const response = await fetch(server + '/api/auth/extension-claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: message.code }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Pairing failed');
        await chrome.storage.local.set({ serverUrl: server, extensionToken: data.token });
        await chrome.storage.sync.remove('apiKey');
        return { ok: true };
      }
      if (message.type === 'DISCONNECT') {
        const { server, token } = await config();
        if (token) {
          const response = await fetch(server + '/api/auth/extension-token', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
          if (!response.ok) throw new Error('Could not revoke the extension connection');
        }
        await chrome.storage.local.remove('extensionToken');
        return { ok: true };
      }
      if (message.type === 'CREATE_TRACKING') return { ok: true, ...await api('/api/emails', { method: 'POST', body: JSON.stringify(message.data) }) };
      if (message.type === 'GET_RECENT') return { ok: true, ...await api('/api/emails?per_page=10') };
      return { ok: false, error: 'Unknown message' };
    } catch (error) { return { ok: false, error: error.message }; }
  })().then(reply);
  return true;
});

// Attach to Gmail tabs that were already open when the extension was installed or updated.
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.remove('apiKey');
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  for (const tab of tabs) {
    if (tab.id) {
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); }
      catch (error) { console.warn('Could not attach to Gmail tab', tab.id, error); }
    }
  }
});
