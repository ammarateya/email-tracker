// Gmail compose integration. Add an open-tracking pixel before Gmail sends the message.
(() => {
  'use strict';
  if (globalThis.__emailTrackerContentLoaded) return;
  globalThis.__emailTrackerContentLoaded = true;
  const prepared = new WeakSet();
  const sending = new WeakSet();
  const bodyOf = compose => compose.querySelector('div[g_editable="true"][role="textbox"], div.Am.Al.editable, div[role="textbox"][aria-label*="Body"]');
  const composeOf = element => element.closest('div[role="dialog"], .M9, .AD, .ip.iq');
  const sendButton = compose => compose.querySelector('.T-I.aoO, [role="button"][aria-label^="Send"], button[aria-label^="Send"]');
  async function prepare(compose) {
    if (prepared.has(compose)) return true;
    if (sending.has(compose)) return false;
    const body = bodyOf(compose);
    if (!body) return false;
    sending.add(compose);
    try {
      const subject = compose.querySelector('input[name="subjectbox"]')?.value || '';
      const recipient = [...compose.querySelectorAll('span[email]')].map(el => el.getAttribute('email')).filter(Boolean).join(', ');
      const response = await chrome.runtime.sendMessage({ type: 'CREATE_TRACKING', data: { subject, recipient, links: [] } });
      if (!response?.ok) throw new Error(response?.error || 'Registration failed');
      const pixel = document.createElement('img');
      pixel.src = response.pixel_url;
      pixel.width = 1;
      pixel.height = 1;
      pixel.alt = '';
      pixel.style.cssText = 'width:1px;height:1px;opacity:0;pointer-events:none';
      body.appendChild(pixel);
      prepared.add(compose);
      return true;
    } catch (error) {
      alert(`Email Tracker could not prepare this message: ${error.message}. The email was not sent. Check your extension account connection.`);
      return false;
    } finally { sending.delete(compose); }
  }
  function markComposes() {
    document.querySelectorAll('div[role="dialog"], .M9, .ip.iq').forEach(compose => {
      if (!bodyOf(compose) || compose.querySelector('.email-tracker-ready')) return;
      const send = sendButton(compose);
      if (!send) return;
      const badge = document.createElement('span');
      badge.className = 'email-tracker-ready';
      badge.textContent = 'Tracker ready';
      badge.title = 'Email Tracker will register this message before sending';
      send.insertAdjacentElement('afterend', badge);
    });
  }
  new MutationObserver(markComposes).observe(document.documentElement, { childList: true, subtree: true });
  markComposes();
  window.addEventListener('click', async event => {
    const button = event.target instanceof Element && event.target.closest('.T-I.aoO, [role="button"][aria-label^="Send"], button[aria-label^="Send"]');
    const compose = button && composeOf(button);
    if (!compose || prepared.has(compose)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (await prepare(compose)) button.click();
  }, true);
  window.addEventListener('keydown', async event => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    const compose = composeOf(event.target);
    if (!compose || prepared.has(compose)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (await prepare(compose)) sendButton(compose)?.click();
  }, true);
})();
