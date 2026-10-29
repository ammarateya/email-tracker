import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/status.js', import.meta.url), 'utf8');

async function viewSentMessage(emails, connected = true) {
  const reports = [];
  const badges = [];
  const parent = { querySelector() { return badges[0] || null; }, appendChild(badge) { badges.push(badge); } };
  const heading = { textContent: 'Test subject', parentElement: parent };
  const document = {
    documentElement: {}, hidden: false,
    querySelector(selector) { return selector === 'h2.hP' ? heading : null; },
    querySelectorAll() { return []; },
    createElement() {
      return { className: '', textContent: '', title: '', classList: { toggle() {} }, addEventListener() {} };
    },
    addEventListener() {}
  };
  const chrome = { runtime: { async sendMessage(message) {
    if (message.type === 'GET_CONFIG') return { connected, server: 'https://example.com' };
    if (message.type === 'GET_TRACKED_STATUS') return { ok: true, emails };
    if (message.type === 'SELF_VIEW') { reports.push(message.emailId); return { ok: true }; }
    throw new Error('Unexpected message');
  } }, storage: { onChanged: { addListener() {} } } };
  const context = {
    document, chrome, location: { hash: '#sent/message' },
    window: { addEventListener() {} }, MutationObserver: class { observe() {} },
    requestAnimationFrame(callback) { callback(); }, setInterval() {}, console
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { reports, labels: badges.map(badge => badge.textContent) };
}

test('reports a unique opened sent message even without a visible pixel', async () => {
  assert.deepEqual(await viewSentMessage([{ id: 'abc123456789', subject: 'Test subject', recipient: 'someone@example.com', open_count: 0 }]), {
    reports: ['abc123456789'], labels: ['Not opened']
  });
});

test('does not guess when two tracked messages have the same subject', async () => {
  assert.deepEqual(await viewSentMessage([
    { id: 'abc123456789', subject: 'Test subject', recipient: 'someone@example.com', open_count: 0 },
    { id: 'def123456789', subject: 'Test subject', recipient: 'other@example.com', open_count: 0 }
  ]), { reports: [], labels: [] });
});

test('does not request status or sender views when unpaired', async () => {
  assert.deepEqual(await viewSentMessage([{ id: 'abc123456789', subject: 'Test subject', open_count: 0 }], false), {
    reports: [], labels: []
  });
});
