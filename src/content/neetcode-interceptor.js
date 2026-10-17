// Runs in the PAGE's JavaScript context (manifest "world": "MAIN") on neetcode.io.
//
// NeetCode uses Firebase callable functions for code submission. The submit
// endpoint is "executeCodeFunctionHttp" (runs against all test cases), while
// "runCodeFunctionHttp" is for testing against sample cases only. We only
// watch the submit endpoint.
//
// Same transparency rule as the LeetCode interceptor: never alter arguments,
// never consume the caller's response body, swallow our own errors.

(() => {
  if (window.__leettrackInstalled) return;
  window.__leettrackInstalled = true;

  const SUBMIT_URL = /\/api\/executeCodeFunctionHttp\b/;
  const SUBMIT_SQL_URL = /\/api\/runSqlFunctionHttp\b/;

  const slugFromLocation = () => {
    const m = /\/problems\/([^/?#]+)/.exec(window.location.pathname);
    return m ? m[1] : null;
  };

  function report(requestBody, responseBody) {
    let req, res;
    try { req = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody; } catch { return; }
    try { res = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody; } catch { return; }

    // Firebase callable wraps the payload: request in .data, response in .result
    const params = req?.data || req || {};
    const result = res?.result || res || {};

    const slug = params.problemId || slugFromLocation();
    if (!slug) return;

    // runSqlFunctionHttp doubles as run and submit; skip run-only calls.
    if (params.runOnly) return;

    const verdict = detectVerdict(result);

    window.postMessage(
      {
        __leettrack: true,
        submission: {
          id: `nc-${slug}-${Date.now()}`,
          slug,
          title: null,
          verdict,
          lang: params.lang || null,
          runtimeMs: null,
          memoryKb: null,
          totalCorrect: null,
          totalTestcases: null,
          at: Date.now(),
          source: 'neetcode-interceptor',
        },
      },
      window.location.origin,
    );
  }

  // Best-effort verdict from the response. NeetCode's backend returns test
  // results from its judge; we check for the most common shapes.
  function detectVerdict(result) {
    if (!result || typeof result !== 'object') return 'Unknown';

    // Firebase callable error (the function itself threw)
    if (result.error) return categoriseError(result.error);

    // If the result has a status_description or status_msg field (Judge0 style)
    if (result.status_description) return result.status_description;
    if (result.status_msg) return result.status_msg;

    // If the result has a statusCode (Judge0: 3 = Accepted)
    if (typeof result.statusCode === 'number') {
      if (result.statusCode === 3) return 'Accepted';
      if (result.statusCode === 4) return 'Wrong Answer';
      if (result.statusCode === 5) return 'Time Limit Exceeded';
      if (result.statusCode === 6) return 'Compilation Error';
      if (result.statusCode >= 7 && result.statusCode <= 12) return 'Runtime Error';
      if (result.statusCode === 13) return 'Internal Error';
      if (result.statusCode === 14) return 'Exec Format Error';
    }

    // Array of per-test-case results
    if (Array.isArray(result)) {
      if (result.length === 0) return 'Unknown';
      const allPassed = result.every((tc) =>
        !tc.error && (tc.passed === true || tc.correct === true ||
          (tc.expected !== undefined && tc.actual !== undefined && tc.expected === tc.actual)));
      if (allPassed && result.length > 0) return 'Accepted';
      const hasError = result.some((tc) => tc.error);
      if (hasError) return categoriseError(result.find((tc) => tc.error).error);
      return 'Wrong Answer';
    }

    // Result wrapped in a results/test_cases array
    const cases = result.results || result.test_cases || result.testCases;
    if (Array.isArray(cases)) {
      if (cases.length === 0) return 'Unknown';
      const allPassed = cases.every((tc) =>
        !tc.error && (tc.passed === true || tc.correct === true ||
          (tc.expected !== undefined && tc.actual !== undefined && tc.expected === tc.actual)));
      if (allPassed && cases.length > 0) return 'Accepted';
      const hasError = cases.some((tc) => tc.error);
      if (hasError) return categoriseError(cases.find((tc) => tc.error).error);
      return 'Wrong Answer';
    }

    // Flat result with compile_error / compile_output
    if (result.compile_error || result.compile_output) return 'Compilation Error';

    // If we got a result with no error indicators, it might be accepted
    // (some backends only return results on success; failures throw)
    if (result.passed === true || result.correct === true || result.success === true) return 'Accepted';
    if (result.passed === false || result.correct === false) return 'Wrong Answer';

    return 'Unknown';
  }

  function categoriseError(err) {
    const msg = typeof err === 'string' ? err : (err?.message || err?.status || String(err));
    const lower = msg.toLowerCase();
    if (lower.includes('compile') || lower.includes('syntax')) return 'Compilation Error';
    if (lower.includes('time') && lower.includes('limit')) return 'Time Limit Exceeded';
    if (lower.includes('memory') && lower.includes('limit')) return 'Memory Limit Exceeded';
    if (lower.includes('runtime')) return 'Runtime Error';
    return 'Runtime Error';
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function leettrackFetch(...args) {
      const promise = originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const isSubmit = SUBMIT_URL.test(url);
        const isSqlSubmit = SUBMIT_SQL_URL.test(url);

        if (isSubmit || isSqlSubmit) {
          // Capture the request body before it's consumed
          let body = null;
          const opts = args[1];
          if (opts && opts.body) {
            try { body = typeof opts.body === 'string' ? opts.body : null; } catch {}
          } else if (typeof input === 'object' && input.body) {
            // Request object — can't reliably read body here without cloning,
            // but Firebase SDK always passes {method, headers, body} as second arg.
          }

          promise
            .then((res) => {
              try {
                res.clone().text().then((t) => report(body, t)).catch(() => {});
              } catch {}
              return res;
            })
            .catch(() => {});
        }
      } catch {}
      return promise; // untouched
    };
  }
})();
