// Runs in the PAGE's JavaScript context (manifest "world": "MAIN").
//
// A content script in the isolated world cannot observe the page's own fetch
// calls, and MV3 cannot read response bodies via webRequest. So we wrap fetch
// and XHR here purely to *observe* LeetCode's submission-check polling, then
// hand the result to the isolated-world bridge via postMessage.
//
// Hard rule: this must be perfectly transparent. It never alters arguments,
// never consumes the caller's response body (always a clone), and swallows its
// own errors so a change on LeetCode's side can never break the page.

(() => {
  if (window.__leettrackInstalled) return;
  window.__leettrackInstalled = true;

  const CHECK_URL = /\/submissions\/detail\/(\d+)\/check\/?/;

  const slugFromLocation = () => {
    const m = /\/problems\/([^/?#]+)/.exec(window.location.pathname);
    return m ? m[1] : null;
  };

  // "52 ms" -> 52, "N/A" -> null
  const parseMs = (v) => {
    const m = /([\d.]+)\s*ms/i.exec(String(v || ''));
    return m ? Math.round(parseFloat(m[1])) : null;
  };

  // "16.5 MB" -> 16896 (KB)
  const parseKb = (v) => {
    const m = /([\d.]+)\s*(K|M|G)B/i.exec(String(v || ''));
    if (!m) return null;
    const mult = { K: 1, M: 1024, G: 1024 * 1024 }[m[2].toUpperCase()];
    return Math.round(parseFloat(m[1]) * mult);
  };

  function report(url, body) {
    const match = CHECK_URL.exec(url || '');
    if (!match) return;

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return; // still pending, or not JSON
    }
    // LeetCode polls this endpoint; only the terminal response is interesting.
    if (!data || data.state !== 'SUCCESS') return;

    const slug = data.title_slug || data.question_slug || slugFromLocation();
    if (!slug) return;

    window.postMessage(
      {
        __leettrack: true,
        submission: {
          id: String(data.submission_id ?? match[1]),
          slug,
          title: data.question_title || null,
          verdict: data.status_msg || 'Unknown',
          lang: data.pretty_lang || data.lang || null,
          runtimeMs: parseMs(data.status_runtime),
          memoryKb: parseKb(data.status_memory),
          totalCorrect: data.total_correct ?? null,
          totalTestcases: data.total_testcases ?? null,
          at: Date.now(),
          source: 'interceptor',
        },
      },
      window.location.origin,
    );
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function leettrackFetch(...args) {
      const promise = originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (CHECK_URL.test(url)) {
          promise
            .then((res) => {
              try {
                res.clone().text().then((t) => report(url, t)).catch(() => {});
              } catch {}
              return res;
            })
            .catch(() => {});
        }
      } catch {}
      return promise; // untouched
    };
  }

  const { open: originalOpen, send: originalSend } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function leettrackOpen(method, url, ...rest) {
    try {
      this.__leettrackUrl = url;
    } catch {}
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function leettrackSend(...args) {
    try {
      if (CHECK_URL.test(this.__leettrackUrl || '')) {
        this.addEventListener('load', () => {
          try {
            report(this.__leettrackUrl, this.responseText);
          } catch {}
        });
      }
    } catch {}
    return originalSend.apply(this, args);
  };
})();
