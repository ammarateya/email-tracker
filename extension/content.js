// Content script for Gmail — injects tracking on send and shows status in inbox

(function () {
    'use strict';

    let trackingEnabled = true;

    // ── Compose: Intercept Send ──
    // Gmail's send button triggers a click. We observe the compose windows,
    // add a listener to the send button, and inject the tracking pixel + wrap links.

    function observeCompose() {
        const observer = new MutationObserver(() => {
            // Find compose windows (div with role="dialog" containing a send button)
            const composeWindows = document.querySelectorAll('div[role="dialog"]');
            composeWindows.forEach(setupCompose);

            // Also handle inline compose (reply)
            const inlineCompose = document.querySelectorAll('.ip.iq');
            inlineCompose.forEach(setupCompose);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    const processedComposes = new WeakSet();

    function setupCompose(composeEl) {
        if (processedComposes.has(composeEl)) return;
        processedComposes.add(composeEl);

        // Find the send button - Gmail uses div[role="button"] with specific data attributes
        // The send button typically has aria-label containing "Send" or data-tooltip="Send"
        const sendBtns = composeEl.querySelectorAll('div[role="button"][aria-label*="Send"], div[role="button"][data-tooltip*="Send"]');

        sendBtns.forEach(btn => {
            if (btn.dataset.trackerBound) return;
            btn.dataset.trackerBound = 'true';

            btn.addEventListener('click', async (e) => {
                if (!trackingEnabled) return;

                // Extract email details from compose window
                const recipientEls = composeEl.querySelectorAll('span[email], div[data-hovercard-id]');
                const recipients = [];
                recipientEls.forEach(el => {
                    const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || el.textContent;
                    if (email && email.includes('@')) recipients.push(email);
                });
                const recipient = recipients[0] || '';

                // Subject
                const subjectInput = composeEl.querySelector('input[name="subjectbox"]');
                const subject = subjectInput ? subjectInput.value : document.title.replace(' - Gmail', '').replace('Re: ', '').replace('Fwd: ', '');

                // Body - the contenteditable div
                const bodyEl = composeEl.querySelector('div[role="textbox"][aria-label*="Body"], div[role="textbox"][g_editable="true"], div.Am.Al.editable');
                if (!bodyEl) return;

                // Collect links in the body
                const linkEls = bodyEl.querySelectorAll('a[href]');
                const linkUrls = [];
                linkEls.forEach(a => {
                    const href = a.getAttribute('href');
                    if (href && href.startsWith('http') && !href.includes('mail.google.com')) {
                        linkUrls.push(href);
                    }
                });

                // Register tracking with server
                const result = await chrome.runtime.sendMessage({
                    type: 'CREATE_TRACKING',
                    data: { subject, recipient, links: linkUrls }
                });

                if (!result || !result.ok) {
                    console.warn('[Email Tracker] Failed to create tracking:', result?.error);
                    return;
                }

                const server = result.server;

                // Inject tracking pixel at end of body
                const pixelImg = document.createElement('img');
                pixelImg.src = `${server}${result.pixel_url}`;
                pixelImg.width = 1;
                pixelImg.height = 1;
                pixelImg.style.cssText = 'display:block;width:1px;height:1px;opacity:0;';
                pixelImg.alt = '';
                bodyEl.appendChild(pixelImg);

                // Wrap links with tracked URLs
                if (result.links && result.links.length > 0) {
                    const urlMap = {};
                    result.links.forEach(l => {
                        urlMap[l.original_url] = `${server}${l.tracked_url}`;
                    });

                    linkEls.forEach(a => {
                        const href = a.getAttribute('href');
                        if (urlMap[href]) {
                            a.setAttribute('href', urlMap[href]);
                        }
                    });
                }

                console.log('[Email Tracker] Tracking injected for:', subject, '->', recipient);
            }, true); // capture phase to run before Gmail's handler
        });
    }

    // ── Inbox: Show tracking status ──

    async function updateInboxStatus() {
        // Find email rows in inbox
        const rows = document.querySelectorAll('tr.zA');
        if (rows.length === 0) return;

        // Collect subject + sender info from rows
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

                // Remove existing badge if any
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

                    // Insert badge in the subject cell
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

    // ── Init ──
    observeCompose();

    // Check inbox status periodically
    setInterval(updateInboxStatus, 5000);
    setTimeout(updateInboxStatus, 2000);

    // Also check when URL changes (navigation within Gmail)
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // Reset checked state on navigation
            document.querySelectorAll('[data-tracker-checked]').forEach(el => {
                delete el.dataset.trackerChecked;
            });
            setTimeout(updateInboxStatus, 1000);
        }
    }).observe(document.body, { childList: true, subtree: true });
})();
