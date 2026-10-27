// Gmail compose integration. Register and rewrite the message before Gmail sends it.
(() => {
  'use strict';
  const prepared = new WeakSet();
  const sending = new WeakSet();
  const bodyOf = compose => compose.querySelector('div[g_editable="true"][role="textbox"], div.Am.Al.editable, div[role="textbox"][aria-label*="Body"]');
  const composeOf = element => element.closest('div[role="dialog"], .ip.iq');
  const sendButton = compose => compose.querySelector('.T-I.aoO, div[role="button"][aria-label^="Send"]');
  async function prepare(compose) {
    if (prepared.has(compose) || sending.has(compose)) return true;
    const body = bodyOf(compose);
    if (!body) return false;
    sending.add(compose);
    try {
      const subject = compose.querySelector('input[name="subjectbox"]')?.value || '';
      const recipient = [...compose.querySelectorAll('span[email]')].map(el => el.getAttribute('email')).filter(Boolean).join(', ');
      const anchors = [...body.querySelectorAll('a[href]')].filter(a => /^https?:\/\//i.test(a.href));
      const links = anchors.map(a => a.href);
      const response = await chrome.runtime.sendMessage({ type: 'CREATE_TRACKING', data: { subject, recipient, links } });
      if (!response?.ok) throw new Error(response?.error || 'Registration failed');
      anchors.forEach((anchor, i) => anchor.href = response.links[i].tracked_url);
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
      alert(`Email Tracker could not prepare this message: ${error.message}. The email was not sent. Check your server URL and API key.`);
      return false;
    } finally { sending.delete(compose); }
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('.T-I.aoO, div[role="button"][aria-label^="Send"]');
    const compose = button && composeOf(button);
    if (!compose || prepared.has(compose)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (await prepare(compose)) button.click();
  }, true);
  document.addEventListener('keydown', async event => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return;
    const compose = composeOf(event.target);
    if (!compose || prepared.has(compose)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (await prepare(compose)) sendButton(compose)?.click();
  }, true);
})();
