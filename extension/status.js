// Show the tracked open status in Gmail's Sent list and expanded sent messages.
(() => {
  'use strict';
  if (globalThis.__emailTrackerStatusLoaded === 106) return;
  globalThis.__emailTrackerStatusLoaded = 106;

  let emails = [];
  let fetchedAt = 0;
  let fetching = null;
  let renderQueued = false;
  const normalized = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const pixelId = image => {
    for (const raw of [image.getAttribute('src'), image.getAttribute('data-src'), image.currentSrc]) {
      let value = raw || '';
      for (let i = 0; i < 3; i++) {
        const match = value.match(/\/t\/([a-f0-9]{12,32})\.png(?:[?#]|$)/i);
        if (match) return match[1].toLowerCase();
        try { value = decodeURIComponent(value); } catch { break; }
      }
    }
    return null;
  };
  const statusText = email => email.open_count > 0
    ? `Opened${email.open_count > 1 ? ` ${email.open_count}×` : ''}`
    : 'Not opened';

  function showBadge(target, email, placement) {
    if (!target) return;
    let badge = target.querySelector(`:scope > .email-tracker-status.${placement}`);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = `email-tracker-status ${placement}`;
      target.appendChild(badge);
    }
    badge.classList.toggle('opened', Number(email.open_count) > 0);
    badge.classList.toggle('pending', Number(email.open_count) === 0);
    const label = statusText(email);
    if (badge.textContent !== label) badge.textContent = label;
    badge.title = email.last_opened ? `Last opened: ${email.last_opened}` : 'No recipient opens recorded';
  }

  function matchingEmail(subject, recipient = '') {
    const matches = emails.filter(email => normalized(email.subject) === normalized(subject));
    if (matches.length === 1) return matches[0];
    if (!recipient) return null;
    const address = normalized(recipient);
    const narrowed = matches.filter(email => normalized(email.recipient).split(/[,;]\s*/).includes(address));
    return narrowed.length === 1 ? narrowed[0] : null;
  }

  function renderSentRows() {
    const sentView = /(?:^|[\/#+])sent(?:$|[\/#+])|in(?:%3a|:)sent/i.test(location.hash);
    if (!sentView) return;
    document.querySelectorAll('tr.zA').forEach(row => {
      const subject = row.querySelector('.bog, .y6')?.textContent;
      const recipient = row.querySelector('.yP [email], .yW [email], [email]')?.getAttribute('email') || '';
      const email = subject && matchingEmail(subject, recipient);
      const target = row.querySelector('.xT, .y6');
      if (email && target) showBadge(target, email, 'list');
      else target?.querySelector(':scope > .email-tracker-status.list')?.remove();
    });
  }

  function renderExpandedMessages() {
    const byId = new Map(emails.map(email => [email.id, email]));
    document.querySelectorAll('.adn').forEach(message => {
      const ids = [...message.querySelectorAll('img')].map(pixelId).filter(Boolean);
      const matches = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean);
      if (matches.length !== 1) return;
      const target = message.querySelector('.gE, .gD')?.parentElement || message;
      showBadge(target, matches[0], 'message');
    });
    // Some Gmail layouts do not expose a per-message wrapper. In those views,
    // show status by the subject only when the match is unambiguous.
    if (!document.querySelector('.email-tracker-status.message') && /sent|in(?:%3a|:)sent/i.test(location.hash)) {
      const heading = document.querySelector('h2.hP');
      const email = heading && matchingEmail(heading.textContent);
      if (email) showBadge(heading.parentElement, email, 'message');
    }
  }

  function render() {
    renderQueued = false;
    if (!emails.length) return;
    renderSentRows();
    renderExpandedMessages();
  }
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }
  async function fetchStatus(force = false) {
    if (fetching) return fetching;
    if (!force && Date.now() - fetchedAt < 15000) return;
    fetching = chrome.runtime.sendMessage({ type: 'GET_TRACKED_STATUS' }).then(result => {
      if (!result?.ok) throw new Error(result?.error || 'Status unavailable');
      emails = result.emails || [];
      fetchedAt = Date.now();
      scheduleRender();
    }).catch(error => console.warn('Email Tracker status:', error)).finally(() => { fetching = null; });
    return fetching;
  }

  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => { scheduleRender(); void fetchStatus(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void fetchStatus(true); });
  void fetchStatus(true);
  setInterval(() => { if (!document.hidden) void fetchStatus(true); }, 30000);
})();
