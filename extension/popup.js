document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('serverUrl');
  const keyInput = document.getElementById('apiKey');
  const saveMsg = document.getElementById('saveMsg');
  const status = document.getElementById('status');
  const list = document.getElementById('list');
  const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  serverInput.value = config.server;
  keyInput.value = config.apiKey;
  document.getElementById('openDashboard').addEventListener('click', event => {
    event.preventDefault(); chrome.tabs.create({ url: serverInput.value });
  });
  let timer;
  for (const input of [serverInput, keyInput]) input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await chrome.runtime.sendMessage({ type: 'SET_CONFIG', serverUrl: serverInput.value.replace(/\/$/, ''), apiKey: keyInput.value });
      saveMsg.classList.add('show'); setTimeout(() => saveMsg.classList.remove('show'), 1500);
    }, 400);
  });
  const recent = await chrome.runtime.sendMessage({ type: 'GET_RECENT' });
  if (!recent.ok) {
    status.textContent = recent.error || 'Cannot reach server';
    list.textContent = 'Check the server URL and API key.';
    return;
  }
  status.textContent = 'Connected';
  if (!recent.emails.length) { list.textContent = 'No tracked emails yet'; return; }
  for (const email of recent.emails) {
    const row = document.createElement('div'); row.className = 'email-row';
    const subject = document.createElement('div'); subject.className = 'subject'; subject.textContent = email.subject || '(no subject)';
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${email.recipient} · ${email.open_count} opens · ${email.click_count} clicks`;
    row.append(subject, meta); list.append(row);
  }
});
