// Isolated world. Relays the page-context interceptor's findings to the
// service worker. Validates the origin and shape before forwarding — this
// listener is reachable by any script on the page.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data;
  if (!data || data.__leettrack !== true || !data.submission) return;

  const s = data.submission;
  if (typeof s.id !== 'string' || typeof s.slug !== 'string') return;
  if (!/^[a-z0-9-]{1,120}$/.test(s.slug)) return;

  try {
    chrome.runtime.sendMessage({ type: 'leettrack:submission', submission: s }, () => {
      // Reading lastError suppresses the "no receiver" console noise that
      // happens if the worker is mid-restart; the GraphQL sync backfills.
      void chrome.runtime.lastError;
    });
  } catch {
    // Extension context invalidated (reload/update) — nothing to do.
  }
});
