// Content script for Gmail — injects tracking on compose and shows status in inbox

(function () {
    'use strict';

    // ── Compose: Inject pixel immediately, register on send ──

    function generateId() {
        const arr = new Uint8Array(6);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    const processedComposes = new WeakSet();

    function observeCompose() {
        const observer = new MutationObserver(() => {
            document.querySelectorAll('div[role="dialog"]').forEach(setupCompose);
            // Inline reply
            document.querySelectorAll('.ip.iq').forEach(setupCompose);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function getBodyEl(composeEl) {
        return composeEl.querySelector(
            'div[g_editable="true"][role="textbox"], div.Am.Al.editable, div[role="textbox"][aria-label*="Body"]'
        );
    }

    function setupCompose(composeEl) {
        if (processedComposes.has(composeEl)) return;

        const bodyEl = getBodyEl(composeEl);
        if (!bodyEl) return;

        processedComposes.add(composeEl);

        // Generate tracking ID and inject pixel immediately
        const trackingId = generateId();
        composeEl.dataset.trackingId = trackingId;

        // Get server URL and inject pixel
        chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' }, (res) => {
            if (!res || !res.url) {
                console.error('[Email Tracker] Failed to get server URL');
                return;
            }
            const server = res.url;
            composeEl.dataset.serverUrl = server;

            const pixelImg = document.createElement('img');
            pixelImg.src = `${server}/t/${trackingId}.png`;
            pixelImg.width = 1;
            pixelImg.height = 1;
            pixelImg.style.cssText = 'display:block !important;width:1px !important;height:1px !important;opacity:0 !important;position:absolute !important;pointer-events:none !important;';
            pixelImg.alt = '';
            pixelImg.dataset.tracker = 'true';
            bodyEl.appendChild(pixelImg);

            console.log('[Email Tracker] Pixel injected:', trackingId, 'Server:', server);
        });

        // Find ALL send buttons (Gmail's original + MailSuite's replacement)
        // Gmail send: class T-I with aoO, aria-label contains "Send"
        // MailSuite send: same but with mt-send class
        const sendBtns = composeEl.querySelectorAll('.T-I.aoO, div[role="button"][aria-label*="Send"]');

        sendBtns.forEach(btn => {
            if (btn.dataset.etBound) return;
            btn.dataset.etBound = 'true';

            btn.addEventListener('click', () => {
                onSend(composeEl);
            }, true); // capture phase
        });

        // Also catch Cmd+Enter / Ctrl+Enter
        composeEl.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                onSend(composeEl);
            }
        }, true);
    }

    function onSend(composeEl) {
        const trackingId = composeEl.dataset.trackingId;
        const server = composeEl.dataset.serverUrl;
        if (!trackingId || !server) return;

        // Prevent double-registration
        if (composeEl.dataset.trackingSent) return;
        composeEl.dataset.trackingSent = 'true';

        // Extract recipient
        const recipientEls = composeEl.querySelectorAll('span[email]');
        const recipients = [];
        recipientEls.forEach(el => {
            const email = el.getAttribute('email');
            if (email && email.includes('@')) recipients.push(email);
        });
        const recipient = recipients[0] || '';

        // Subject
        const subjectInput = composeEl.querySelector('input[name="subjectbox"]');
        const subject = subjectInput ? subjectInput.value : '';

        // Collect links in body (exclude tracker pixel and mailsuite stuff)
        const bodyEl = getBodyEl(composeEl);
        const linkUrls = [];
        if (bodyEl) {
            bodyEl.querySelectorAll('a[href]').forEach(a => {
                const href = a.getAttribute('href');
                if (href && href.startsWith('http') && !href.includes('mail.google.com') && !href.includes(server)) {
                    linkUrls.push(href);
                }
            });

            // Wrap links with tracked redirects synchronously using beacon
            // We'll do link wrapping in the registration call's response
            // For now, fire-and-forget the registration
        }

        // Register with server (fire and forget — pixel is already in the email)
        chrome.runtime.sendMessage({
            type: 'CREATE_TRACKING',
            data: { subject, recipient, links: linkUrls, emailId: trackingId }
        });

        console.log('[Email Tracker] Registered:', trackingId, subject, '->', recipient);
    }

    // ── Inbox: Show tracking status ──

    async function updateInboxStatus() {
        const rows = document.querySelectorAll('tr.zA');
        if (rows.length === 0) return;

        const emailsToCheck = [];
        const rowMap = new Map();

        rows.forEach(row => {
            if (row.dataset.trackerChecked) return;

            const subjectEl = row.querySelector('.bog span, .y6 span');
            const recipientEl = row.querySelector('.yW span[email], .yW [data-hovercard-id]');

            const subject = subjectEl ? subjectEl.textContent.trim() : '';
            const recipient = recipientEl
                ? (recipientEl.getAttribute('email') || recipientEl.getAttribute('data-hovercard-id') || '')
                : '';

            if (subject) {
                const key = `track_${normalizeKey(subject, recipient)}`;
                emailsToCheck.push({ subject, recipient });
                if (!rowMap.has(key)) rowMap.set(key, []);
                rowMap.get(key).push(row);
            }
        });

        if (emailsToCheck.length === 0) return;

        const statuses = await chrome.runtime.sendMessage({
            type: 'GET_STATUSES',
            data: { emails: emailsToCheck }
        });

        if (!statuses) return;

        for (const [key, rows] of rowMap) {
            const status = statuses[key];
            rows.forEach(row => {
                row.dataset.trackerChecked = 'true';

                const existing = row.querySelector('.email-tracker-badge');
                if (existing) existing.remove();

                if (status && status.tracked) {
                    const badge = document.createElement('span');
                    badge.className = 'email-tracker-badge';

                    if (status.opens > 0) {
                        badge.classList.add('opened');
                        badge.title = `Opened ${status.opens} time${status.opens !== 1 ? 's' : ''}` +
                            (status.clicks > 0 ? `, ${status.clicks} click${status.clicks !== 1 ? 's' : ''}` : '');
                        badge.textContent = status.opens > 1 ? status.opens : '';
                    } else {
                        badge.classList.add('pending');
                        badge.title = 'Tracked — not yet opened';
                    }

                    const subjectCell = row.querySelector('.xT, .a4W');
                    if (subjectCell) {
                        subjectCell.style.position = 'relative';
                        subjectCell.insertBefore(badge, subjectCell.firstChild);
                    }
                }
            });
        }
    }

    function normalizeKey(subject, recipient) {
        return (subject + '||' + recipient).toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // ── Auto-ignore sender's IP ──
    async function registerMyIp() {
        try {
            const server = await new Promise(resolve => {
                chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' }, res => resolve(res.url));
            });
            await fetch(`${server}/api/ignored-ips`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: 'Auto (Gmail extension)' }),
            });
        } catch {}
    }

    // ── Init ──
    registerMyIp();
    observeCompose();

    setInterval(updateInboxStatus, 5000);
    setTimeout(updateInboxStatus, 2000);

    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            document.querySelectorAll('[data-tracker-checked]').forEach(el => {
                delete el.dataset.trackerChecked;
            });
            setTimeout(updateInboxStatus, 1000);
        }
    }).observe(document.body, { childList: true, subtree: true });
})();
