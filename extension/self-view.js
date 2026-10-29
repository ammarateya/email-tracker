// Watch Gmail message images for this user's own tracked pixels.
(() => {
  'use strict';
  if (globalThis.__emailTrackerSelfViewLoaded === 109) return;
  globalThis.__emailTrackerSelfViewLoaded = 109;
  // Gmail fetches images through GoogleImageProxy, so the pixel request cannot identify
  // the sender. Report a view of our own sent pixel over the authenticated extension API.
  const reportedViews = new Map();
  let connected = false;
  function ownPixelId(img) {
    // Skip only the editable compose body. Gmail can use dialog-like wrappers
    // around opened messages, and those views must still be reported.
    if (img.closest('div[g_editable="true"], div.Am.Al.editable, div[role="textbox"][aria-label*="Body"]')) return null;
    for (const raw of [img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-image-url'), img.currentSrc]) {
      if (!raw) continue;
      let value = raw;
      for (let i = 0; i < 3; i++) {
        const match = value.match(/\/t\/([a-f0-9]{12,32})\.png(?:[?#]|$)/i);
        if (match) return match[1].toLowerCase();
        try { value = decodeURIComponent(value); } catch { break; }
      }
    }
    return null;
  }
  function inspectImage(img) {
    if (!connected) return;
    const emailId = ownPixelId(img);
    if (!emailId || Date.now() - (reportedViews.get(emailId) || 0) < 3000) return;
    reportedViews.set(emailId, Date.now());
    chrome.runtime.sendMessage({ type: 'SELF_VIEW', emailId }).then(result => {
      if (!result?.ok) {
        reportedViews.delete(emailId);
        console.warn('Email Tracker could not mark sender view:', result?.error);
      }
    }).catch(error => {
      reportedViews.delete(emailId);
      console.warn('Email Tracker could not mark sender view:', error);
    });
  }
  function inspectNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('img')) inspectImage(node);
    node.querySelectorAll('img').forEach(inspectImage);
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') inspectImage(record.target);
      else record.addedNodes.forEach(inspectNode);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'data-image-url'] });
  function setConnection(value) {
    connected = !!value;
    if (connected) document.querySelectorAll('img').forEach(inspectImage);
  }
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }).then(config => setConnection(config?.connected)).catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.extensionToken) setConnection(!!changes.extensionToken.newValue);
  });
})();
