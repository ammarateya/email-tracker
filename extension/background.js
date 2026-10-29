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
      if (message.type === 'SELF_VIEW' && /^[a-f0-9]{12,32}$/.test(message.emailId)) return { ok: true, ...await api(`/api/emails/${message.emailId}/self-view`, { method: 'POST' }) };
      if (message.type === 'CREATE_TRACKING') return { ok: true, ...await api('/api/emails', { method: 'POST', body: JSON.stringify(message.data) }) };
      if (message.type === 'GET_RECENT') return { ok: true, ...await api('/api/emails?per_page=10') };
      return { ok: false, error: 'Unknown message' };
    } catch (error) { return { ok: false, error: error.message }; }
  })().then(reply);
  return true;
});

async function attachGmail(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('https://mail.google.com/')) {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['self-view.js'] });
    }
  } catch (error) { console.warn('Could not attach to Gmail tab', tabId, error); }
}

async function attachOpenGmailTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  await Promise.all(tabs.filter(tab => tab.id).map(tab => attachGmail(tab.id)));
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.remove('apiKey');
  await attachOpenGmailTabs();
});

// Gmail navigates between messages without replacing the tab. Attach on every
// URL update and service-worker start so an existing tab is covered too.
chrome.runtime.onStartup.addListener(attachOpenGmailTabs);
chrome.tabs.onActivated.addListener(({ tabId }) => { void attachGmail(tabId); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if ((changeInfo.status === 'complete' || changeInfo.url) && tab.url?.startsWith('https://mail.google.com/')) {
    void attachGmail(tabId);
  }
});
