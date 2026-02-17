// Background service worker — handles API communication

const DEFAULT_SERVER = 'http://localhost:8000';

async function getServerUrl() {
    const result = await chrome.storage.sync.get(['serverUrl']);
    return result.serverUrl || DEFAULT_SERVER;
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CREATE_TRACKING') {
        handleCreateTracking(msg.data).then(sendResponse);
        return true; // async response
    }
    if (msg.type === 'GET_STATUSES') {
        handleGetStatuses(msg.data).then(sendResponse);
        return true;
    }
    if (msg.type === 'GET_RECENT') {
        handleGetRecent().then(sendResponse);
        return true;
    }
    if (msg.type === 'GET_SERVER_URL') {
        getServerUrl().then(url => sendResponse({ url }));
        return true;
    }
    if (msg.type === 'SET_SERVER_URL') {
        chrome.storage.sync.set({ serverUrl: msg.url }).then(() => sendResponse({ ok: true }));
        return true;
    }
});

async function handleCreateTracking({ subject, recipient, links }) {
    try {
        const server = await getServerUrl();
        const res = await fetch(`${server}/api/emails`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, recipient, links }),
        });
        const data = await res.json();
        // Store the mapping locally for inbox status lookup
        const key = `track_${normalizeKey(subject, recipient)}`;
        await chrome.storage.local.set({ [key]: { emailId: data.email_id, createdAt: Date.now() } });
        return { ok: true, ...data, server };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function handleGetStatuses({ emails }) {
    // emails: [{subject, recipient}, ...]
    // Look up local storage for tracked email IDs, then batch-check server
    try {
        const server = await getServerUrl();
        const results = {};

        for (const { subject, recipient } of emails) {
            const key = `track_${normalizeKey(subject, recipient)}`;
            const stored = await chrome.storage.local.get(key);
            if (stored[key]) {
                const emailId = stored[key].emailId;
                try {
                    const res = await fetch(`${server}/api/emails/${emailId}`);
                    const data = await res.json();
                    results[key] = {
                        tracked: true,
                        opens: data.total_opens || 0,
                        clicks: data.total_clicks || 0,
                        emailId,
                    };
                } catch {
                    results[key] = { tracked: true, opens: 0, clicks: 0, emailId };
                }
            }
        }
        return results;
    } catch (err) {
        return {};
    }
}

async function handleGetRecent() {
    try {
        const server = await getServerUrl();
        const res = await fetch(`${server}/api/emails?per_page=10`);
        const data = await res.json();
        return { ok: true, emails: data.emails, server };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function normalizeKey(subject, recipient) {
    return (subject + '||' + recipient).toLowerCase().replace(/\s+/g, ' ').trim();
}
