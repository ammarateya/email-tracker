document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('serverUrl');
  const codeInput = document.getElementById('pairCode');
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  serverInput.value = config.server;
  document.getElementById('openDashboard').addEventListener('click', event => { event.preventDefault(); chrome.tabs.create({ url: serverInput.value }); });
  document.getElementById('pairButton').onclick = async () => {
    const result = await chrome.runtime.sendMessage({ type: 'PAIR', serverUrl: serverInput.value.trim(), code: codeInput.value.trim() });
    if (!result.ok) { status.textContent = result.error; return; }
    location.reload();
  };
  document.getElementById('disconnectButton').onclick = async () => { const result = await chrome.runtime.sendMessage({ type: 'DISCONNECT' }); if (result.ok) location.reload(); else status.textContent = result.error; };
  if (!config.connected) { status.textContent = 'Not connected'; list.textContent = 'Sign in to the dashboard, open Settings, and generate a pairing code.'; return; }
  const recent = await chrome.runtime.sendMessage({ type: 'GET_RECENT' });
  if (!recent.ok) { status.textContent = recent.error || 'Cannot reach server'; list.textContent = 'Check your account connection.'; return; }
  status.textContent = 'Connected';
  if (!recent.emails.length) { list.textContent = 'No tracked emails yet'; return; }
  for (const email of recent.emails) {
    const row = document.createElement('div'); row.className = 'email-row';
    const subject = document.createElement('div'); subject.className = 'subject'; subject.textContent = email.subject || '(no subject)';
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${email.recipient} · ${email.open_count} opens`;
    row.append(subject, meta); list.append(row);
  }
});
