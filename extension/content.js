// Reserve a tracker while composing. Sending itself never waits for the network.
(() => {
  'use strict';
  if (globalThis.__emailTrackerContentLoaded) return;
  globalThis.__emailTrackerContentLoaded = true;

  const records = new WeakMap();
  const registering = new WeakSet();
  const finalizing = new WeakSet();
  let failed = new WeakSet();
  let connected = null;
  const bodyOf = compose => compose.querySelector('div[g_editable="true"][role="textbox"], div.Am.Al.editable, div[role="textbox"][aria-label*="Body"]');
  const composeOf = element => element.closest('div[role="dialog"], .M9, .AD, .ip.iq');
  const sendButton = compose => compose.querySelector('.T-I.aoO, [role="button"][aria-label^="Send"], button[aria-label^="Send"]');
  const detailsOf = compose => ({
    subject: compose.querySelector('input[name="subjectbox"]')?.value || '',
    recipient: [...compose.querySelectorAll('span[email]')].map(el => el.getAttribute('email')).filter(Boolean).join(', ')
  });

  function updateBadge(compose) {
    const badge = compose.querySelector('.email-tracker-ready');
    if (!badge) return;
    const ready = records.has(compose);
    const off = connected === false || failed.has(compose);
    const label = ready ? 'Tracking ready' : off ? 'Tracking off' : 'Preparing tracker';
    if (badge.textContent !== label) badge.textContent = label;
    badge.classList.toggle('off', off);
    badge.classList.toggle('preparing', !ready && !off);
    badge.title = ready ? 'The tracker is ready; Send will not wait for the server'
      : off ? 'This message will send without open tracking'
      : 'Preparing open tracking in the background';
  }

  async function reserve(compose) {
    if (!connected || records.has(compose) || registering.has(compose) || failed.has(compose)) return;
    registering.add(compose);
    updateBadge(compose);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_TRACKING', data: { ...detailsOf(compose), links: [], pending: true }
      });
      if (!response?.ok) throw new Error(response?.error || 'Registration failed');
      records.set(compose, { id: response.email_id, pixelUrl: response.pixel_url });
    } catch (error) {
      console.warn('Email Tracker could not prepare tracking:', error);
      failed.add(compose);
    } finally {
      registering.delete(compose);
      updateBadge(compose);
    }
  }

  function markComposes() {
    document.querySelectorAll('div[role="dialog"], .M9, .AD, .ip.iq').forEach(compose => {
      if (!bodyOf(compose)) return;
      const send = sendButton(compose);
      if (!send || composeOf(send) !== compose) return;
      if (!compose.querySelector('.email-tracker-ready')) {
        const badge = document.createElement('span');
        badge.className = 'email-tracker-ready';
        send.insertAdjacentElement('afterend', badge);
      }
      updateBadge(compose);
      if (connected) void reserve(compose);
    });
  }

  function finalize(record, data, attempt = 0) {
    chrome.runtime.sendMessage({ type: 'FINALIZE_TRACKING', emailId: record.id, data })
      .then(result => {
        if (result?.ok) return;
        throw new Error(result?.error || 'Could not finalize tracking');
      }).catch(error => {
        if (attempt < 2) setTimeout(() => finalize(record, data, attempt + 1), 2000 * (attempt + 1));
        else console.warn('Email Tracker could not save sent-message details:', error);
      });
  }

  function prepareSend(compose) {
    const record = records.get(compose);
    const body = bodyOf(compose);
    if (!record || !body) return;
    if (!body.querySelector('img[data-email-tracker-pixel]')) {
      const pixel = document.createElement('img');
      pixel.setAttribute('data-email-tracker-pixel', record.id);
      pixel.src = record.pixelUrl;
      pixel.width = 1;
      pixel.height = 1;
      pixel.alt = '';
      pixel.style.cssText = 'width:1px;height:1px;opacity:0;pointer-events:none';
      body.appendChild(pixel);
    }
    if (!finalizing.has(compose)) {
      finalizing.add(compose);
      finalize(record, detailsOf(compose));
    }
  }

  new MutationObserver(markComposes).observe(document.documentElement, { childList: true, subtree: true });
  markComposes();
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }).then(config => {
    connected = !!config?.connected;
    markComposes();
  }).catch(() => { connected = false; markComposes(); });
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.extensionToken) return;
    connected = !!changes.extensionToken.newValue;
    failed = new WeakSet();
    markComposes();
  });

  window.addEventListener('click', event => {
    const button = event.target instanceof Element && event.target.closest('.T-I.aoO, [role="button"][aria-label^="Send"], button[aria-label^="Send"]');
    const compose = button && composeOf(button);
    if (compose) prepareSend(compose);
  }, true);
  window.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    const compose = composeOf(event.target);
    if (compose) prepareSend(compose);
  }, true);
})();
