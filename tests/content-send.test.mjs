import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

async function runSend({ connected, trackingResponse, shortcut = false }) {
  const listeners = {};
  let delivered = 0;
  let pixels = 0;
  let registrations = 0;
  class Element {}
  const compose = {
    querySelector(selector) {
      if (selector.includes('g_editable')) return body;
      if (selector.includes('subjectbox')) return { value: 'Test subject' };
      if (selector.includes('aoO')) return button;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const body = { appendChild() { pixels++; } };
  const button = new Element();
  button.closest = selector => selector.includes('aoO') ? button : compose;
  button.click = () => {
    const event = { target: button, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
    void listeners.click(event);
    if (!event.prevented) delivered++;
  };
  const document = {
    documentElement: {},
    querySelectorAll() { return []; },
    createElement() { return { style: {} }; }
  };
  const chrome = { runtime: { async sendMessage(message) {
    if (message.type === 'GET_CONFIG') return { connected };
    if (message.type === 'CREATE_TRACKING') { registrations++; return trackingResponse; }
    throw new Error('Unexpected message');
  } } };
  const window = { addEventListener(type, handler) { listeners[type] = handler; } };
  const context = { Element, document, chrome, window, MutationObserver: class { observe() {} }, console, setTimeout };
  vm.runInNewContext(source, context);
  const event = { target: button, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  if (shortcut) { event.metaKey = true; event.key = 'Enter'; await listeners.keydown(event); }
  else await listeners.click(event);
  return { delivered, pixels, registrations, prevented: event.prevented };
}

test('sends normally when extension is disconnected', async () => {
  assert.deepEqual(await runSend({ connected: false }), { delivered: 1, pixels: 0, registrations: 0, prevented: true });
});

test('sends normally when tracking registration fails', async () => {
  assert.deepEqual(await runSend({ connected: true, trackingResponse: { ok: false, error: 'Unavailable' } }), { delivered: 1, pixels: 0, registrations: 1, prevented: true });
});

test('adds a pixel before sending when tracking succeeds', async () => {
  assert.deepEqual(await runSend({ connected: true, trackingResponse: { ok: true, pixel_url: 'https://example.com/t/abc.png' } }), { delivered: 1, pixels: 1, registrations: 1, prevented: true });
});

test('keyboard Send still works without tracking', async () => {
  assert.deepEqual(await runSend({ connected: false, shortcut: true }), { delivered: 1, pixels: 0, registrations: 0, prevented: true });
});
