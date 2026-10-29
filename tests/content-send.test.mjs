import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

async function runSend({ connected, trackingResponse, shortcut = false, waitForTracker = true }) {
  const listeners = {};
  let pixels = 0;
  let registrations = 0;
  let finalizations = 0;
  let badge = null;
  class Element {}
  const body = { querySelector() { return pixels ? {} : null; }, appendChild() { pixels++; } };
  const compose = {
    querySelector(selector) {
      if (selector.includes('g_editable')) return body;
      if (selector.includes('subjectbox')) return { value: 'Test subject' };
      if (selector.includes('aoO')) return button;
      if (selector.includes('email-tracker-ready')) return badge;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const button = new Element();
  button.closest = selector => selector.includes('aoO') ? button : compose;
  button.insertAdjacentElement = (_where, element) => { badge = element; };
  const document = {
    documentElement: {},
    querySelectorAll(selector) { return selector.includes('role="dialog"') ? [compose] : []; },
    createElement() { return { className: '', textContent: '', style: {}, classList: { toggle() {} }, setAttribute() {} }; }
  };
  const chrome = {
    runtime: { async sendMessage(message) {
      if (message.type === 'GET_CONFIG') return { connected };
      if (message.type === 'CREATE_TRACKING') { registrations++; return trackingResponse; }
      if (message.type === 'FINALIZE_TRACKING') { finalizations++; return { ok: true }; }
      throw new Error('Unexpected message');
    } },
    storage: { onChanged: { addListener() {} } }
  };
  const window = { addEventListener(type, handler) { listeners[type] = handler; } };
  vm.runInNewContext(source, { Element, document, chrome, window, MutationObserver: class { observe() {} }, console, setTimeout });
  if (waitForTracker) await new Promise(resolve => setImmediate(resolve));
  const event = { target: button, metaKey: shortcut, key: shortcut ? 'Enter' : '', prevented: false, preventDefault() { this.prevented = true; } };
  if (shortcut) listeners.keydown(event);
  else listeners.click(event);
  await new Promise(resolve => setImmediate(resolve));
  return { pixels, registrations, finalizations, prevented: event.prevented };
}

test('sends normally while disconnected', async () => {
  assert.deepEqual(await runSend({ connected: false }), { pixels: 0, registrations: 0, finalizations: 0, prevented: false });
});

test('reserves a tracker during compose and uses it without waiting at Send', async () => {
  assert.deepEqual(await runSend({ connected: true, trackingResponse: { ok: true, email_id: 'abc123456789', pixel_url: 'https://example.com/t/abc123456789.png' } }), {
    pixels: 1, registrations: 1, finalizations: 1, prevented: false
  });
});

test('sends untracked when pre-registration fails', async () => {
  assert.deepEqual(await runSend({ connected: true, trackingResponse: { ok: false, error: 'Unavailable' } }), {
    pixels: 0, registrations: 1, finalizations: 0, prevented: false
  });
});

test('Send never waits for a tracker that is still registering', async () => {
  assert.deepEqual(await runSend({ connected: true, trackingResponse: new Promise(() => {}) }), {
    pixels: 0, registrations: 1, finalizations: 0, prevented: false
  });
});

test('keyboard Send uses a tracker already reserved', async () => {
  assert.deepEqual(await runSend({ connected: true, shortcut: true, trackingResponse: { ok: true, email_id: 'abc123456789', pixel_url: 'https://example.com/t/abc123456789.png' } }), {
    pixels: 1, registrations: 1, finalizations: 1, prevented: false
  });
});
