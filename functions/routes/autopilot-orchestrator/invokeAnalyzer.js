// Synthetic Express invocation — Fase 6.1 internal helper.
//
// The orchestrator needs to call the specialist analyze handlers
// (`autopilot-{finance,procurement,hr}/analyze`) without going over HTTP.
// Each handler follows the `(req, res)` shape and calls `res.json(...)`
// exactly once. This helper wraps that contract in a Promise so the
// orchestrator can await the result.
//
// The helper NEVER throws: any error inside the handler is captured and
// returned as `{ statusCode: 500, body: { error } }`. This is important
// because one broken analyzer must not take down the whole orchestrator
// run — the caller records the failure and moves on.

function invokeAnalyzer(analyzeFn, reqContext, body = {}, query = {}) {
  return new Promise(resolve => {
    let statusCode = 200;
    let captured = null;
    let resolved = false;

    const settle = (payload) => {
      if (resolved) return;
      resolved = true;
      resolve({ statusCode, body: payload ?? captured });
    };

    const fakeReq = {
      fincaId: reqContext.fincaId,
      uid: reqContext.uid,
      userEmail: reqContext.userEmail,
      userRole: reqContext.userRole,
      method: 'POST',
      body: body || {},
      query: query || {},
      params: {},
    };

    const fakeRes = {
      status(code) { statusCode = code; return this; },
      json(payload) { captured = payload; settle(payload); return this; },
      send(payload) { captured = payload; settle(payload); return this; },
      set() { return this; },
      setHeader() { return this; },
      get() { return undefined; },
      end() { settle(captured); return this; },
    };

    Promise.resolve()
      .then(() => analyzeFn(fakeReq, fakeRes))
      .then(() => settle(captured))
      .catch(err => {
        if (resolved) return;
        resolved = true;
        resolve({
          statusCode: 500,
          body: { error: err?.message || String(err) },
        });
      });
  });
}

module.exports = { invokeAnalyzer };
