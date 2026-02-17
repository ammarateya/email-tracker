document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('status');
    const listEl = document.getElementById('list');
    const serverInput = document.getElementById('serverUrl');
    const saveMsg = document.getElementById('saveMsg');
    const dashLink = document.getElementById('openDashboard');

    // Load server URL
    const { url } = await chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' });
    serverInput.value = url;
    dashLink.href = url;
    dashLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: serverInput.value || url });
    });

    // Save server URL on change
    let saveTimeout;
    serverInput.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            await chrome.runtime.sendMessage({ type: 'SET_SERVER_URL', url: serverInput.value });
            saveMsg.classList.add('show');
            setTimeout(() => saveMsg.classList.remove('show'), 1500);
        }, 500);
    });

    // Load recent emails
    const result = await chrome.runtime.sendMessage({ type: 'GET_RECENT' });

    if (result && result.ok) {
        statusEl.innerHTML = '<span class="status-dot connected"></span><span>Connected</span>';

        if (result.emails.length === 0) {
            listEl.innerHTML = '<div class="empty">No tracked emails yet</div>';
        } else {
            listEl.innerHTML = result.emails.map(e => `
                <div class="email-row">
                    <div class="subject">${esc(e.subject || '(no subject)')}</div>
                    <div class="meta">
                        <span>${esc(e.recipient)}</span>
                        <span class="opens">${e.open_count} open${e.open_count !== 1 ? 's' : ''}</span>
                        <span class="clicks">${e.click_count} click${e.click_count !== 1 ? 's' : ''}</span>
                    </div>
                </div>
            `).join('');
        }
    } else {
        statusEl.innerHTML = '<span class="status-dot error"></span><span>Cannot reach server</span>';
        listEl.innerHTML = '<div class="empty">Check your server URL below</div>';
    }
});

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}
