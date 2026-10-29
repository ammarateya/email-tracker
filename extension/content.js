// Gmail compose integration. Add an open-tracking pixel before Gmail sends the message.
(() => {
  'use strict';
  if (globalThis.__emailTrackerContentLoaded) return;
  globalThis.__emailTrackerContentLoaded = true;
  const prepared = new WeakSet();
  const sending = new WeakSet();
  const bypass = new WeakSet();
  let connected = null;
  let trackingHealthy = true;
  const bodyOf = compose => compose.querySelector('div[g_editable="true"][role="textbox"], div.Am.Al.editable, div[role="textbox"][aria-label*="Body"]');
  const composeOf = element => element.closest('div[role="dialog"], .M9, .AD, .ip.iq');
  const sendButton = compose => compose.querySelector('.T-I.aoO, [role="button"][aria-label^="Send"], button[aria-label^="Send"]');
  async function prepare(compose) {
    if (prepared.has(compose)) return true;
    const body = bodyOf(compose);
    if (!body) return false;
    try {
      if (connected === null) {
        const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
        connected = !!config?.connected;
      }
      if (!connected) return false;
      const subject = compose.querySelector('input[name="subjectbox"]')?.value || '';
      const recipient = [...compose.querySelectorAll('span[email]')].map(el => el.getAttribute('email')).filter(Boolean).join(', ');
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type: 'CREATE_TRACKING', data: { subject, recipient, links: [] } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tracking timed out')), 3000))
      ]);
      if (!response?.ok) throw new Error(response?.error || 'Registration failed');
      const pixel = document.createElement('img');
      pixel.src = response.pixel_url;
      pixel.width = 1;
      pixel.height = 1;
      pixel.alt = '';
      pixel.style.cssText = 'width:1px;height:1px;opacity:0;pointer-events:none';
      body.appendChild(pixel);
      prepared.add(compose);
      trackingHealthy = true;
      updateBadges();
      return true;
    } catch (error) {
      console.warn('Email Tracker sent this message without tracking:', error);
      trackingHealthy = false;
      updateBadges();
      return false;
    }
  }
  function updateBadges() {
    document.querySelectorAll('.email-tracker-ready').forEach(badge => {
      const enabled = connected !== false && trackingHealthy;
      const label = enabled ? 'Tracking enabled' : 'Tracking off';
      if (badge.textContent !== label) badge.textContent = label;
      badge.classList.toggle('off', !enabled);
      badge.title = enabled ? 'Email Tracker will register this message before sending' : 'This message will send without open tracking';
    });
  }
  function markComposes() {
    document.querySelectorAll('div[role="dialog"], .M9, .ip.iq').forEach(compose => {
      if (!bodyOf(compose) || compose.querySelector('.email-tracker-ready')) return;
      const send = sendButton(compose);
      if (!send) return;
      const badge = document.createElement('span');
      badge.className = 'email-tracker-ready';
      badge.textContent = 'Tracking enabled';
      badge.title = 'Email Tracker will register this message before sending';
      send.insertAdjacentElement('afterend', badge);
    });
    updateBadges();
  }
  new MutationObserver(markComposes).observe(document.documentElement, { childList: true, subtree: true });
  markComposes();
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }).then(config => {
    connected = !!config?.connected;
    updateBadges();
  }).catch(() => { connected = false; updateBadges(); });

  window.addEventListener('click', async event => {
    const button = event.target instanceof Element && event.target.closest('.T-I.aoO, [role="button"][aria-label^="Send"], button[aria-label^="Send"]');
    const compose = button && composeOf(button);
    if (!compose) return;
    if (bypass.has(compose)) { bypass.delete(compose); return; }
    if (prepared.has(compose)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (sending.has(compose)) return;
    sending.add(compose);
    try {
      if (!await prepare(compose)) bypass.add(compose);
      button.click();
    } finally { sending.delete(compose); }
  }, true);
  window.addEventListener('keydown', async event => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    const compose = composeOf(event.target);
    if (!compose || prepared.has(compose)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (sending.has(compose)) return;
    sending.add(compose);
    try {
      if (!await prepare(compose)) bypass.add(compose);
      sendButton(compose)?.click();
    } finally { sending.delete(compose); }
  }, true);
})();
