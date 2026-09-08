// Fallback for environments without collaborative preview automation. Start a
// fresh loopback-only Chromium debugging instance on port 9222 before use.
// For desktop pointer coverage, launch headless with
// --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4
// (the same defaults used by Playwright's Chromium launcher). Otherwise headless
// may advertise no hover and exercise Pantry's mobile handle UI at desktop width.
import assert from 'node:assert/strict';
import { origin } from './verify-staging-recipe-import.mjs';

export async function stagingBrowser(browserOrigin = origin, options = {}) {
  const debugPort = process.env.PANTRY_BROWSER_DEBUG_PORT ?? '9222';
  const tab = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?` + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const requests = new Map();
  const responses = [];
  const errors = [];
  const blockedRequests = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback?.reject(new Error(message.error.message));
      else callback?.resolve(message.result);
    }
    if (message.method === 'Network.requestWillBeSent') {
      const request = message.params.request;
      const url = new URL(request.url);
      // Record transport metadata only. Never capture headers, bodies or tokens.
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/functions/')) {
        requests.set(message.params.requestId, { path: url.pathname, method: request.method,
          contentType: Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] });
      }
    }
    if (message.method === 'Network.responseReceived') {
      const request = requests.get(message.params.requestId);
      if (request) responses.push({ ...request, status: message.params.response.status });
    }
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params.request;
      const url = new URL(request.url);
      let blocked = true;
      try {
        blocked = options.requestGuard({ method: request.method, path: url.pathname, origin: url.origin }) === false;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Request guard failed');
      }
      if (blocked) {
        blockedRequests.push({ method: request.method, path: url.pathname, origin: url.origin });
        void call('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' })
          .catch(error => errors.push(error.message));
      } else {
        void call('Fetch.continueRequest', { requestId: message.params.requestId })
          .catch(error => errors.push(error.message));
      }
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  };
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, 'Browser evaluation failed');
    return result.result.value;
  }
  async function until(expression, attempts = 100) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Browser condition timed out: ' + expression);
  }
  async function fill(selector, value) {
    await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Input missing'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  }
  async function click(label) {
    await evaluate(`(() => { const el=[...document.querySelectorAll('[tabindex="0"]')].find(e=>e.innerText.trim()===${JSON.stringify(label)}); if(!el) throw new Error('Control missing'); el.click(); })()`);
  }
  await call('Network.enable');
  await call('Runtime.enable');
  if (options.requestGuard) await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await call('Page.navigate', { url: browserOrigin + '/login' });
  return { call, evaluate, until, fill, click, responses, errors, blockedRequests,
    async login(user) {
      await until("!!document.querySelector('input[type=email]')");
      await fill('input[type=email]', user.email);
      await fill('input[type=password]', user.password);
      await click('Sign In');
      await until("location.pathname==='/household'");
    },
    async navigate(path) {
      assert(path.startsWith('/') && !path.startsWith('//'));
      await call('Page.navigate', { url: browserOrigin + path });
    },
    async close() {
      await Promise.race([call('Browser.close'), new Promise(resolve => setTimeout(resolve, 1000))]).catch(() => {});
      socket.close();
    },
  };
}
