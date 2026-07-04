// @ts-self-types="./retry.d.ts"
import {isAbort} from '../envelope.js';

const isReadableStream = body =>
  body != null && typeof body === 'object' && typeof body.getReader === 'function';

const retryableStatus = status => status >= 500 || status === 429;

const retryAfterMs = response => {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const safeToRetry = options => {
  switch ((options.method || 'GET').toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
    case 'PUT':
    case 'DELETE':
      return true;
    case 'PATCH':
      return options.ifMatch != null || options.as === 'merge-patch';
    case 'POST':
      return options.idempotencyKey != null || options.ifNoneMatch === '*';
    default:
      return false;
  }
};

export const installRetry = io => {
  // retries: 0 + continueRetries → polling driven solely by the predicate
  const normalize = options => {
    const r = options.retry;
    if (r === undefined || r === false) return null;
    const defaults = io.retry;
    const cfg =
      r === true ? {} : typeof r === 'number' ? {retries: r} : typeof r === 'object' ? r : null;
    if (!cfg) return null;
    const retries = typeof cfg.retries === 'number' ? cfg.retries : defaults.retries;
    const continueRetries = typeof cfg.continueRetries === 'function' ? cfg.continueRetries : null;
    if (retries < 1 && !continueRetries) return null;
    if (!cfg.force && !safeToRetry(options)) return null;
    return {
      retries,
      continueRetries,
      initDelay: typeof cfg.initDelay === 'number' ? cfg.initDelay : defaults.initDelay,
      nextDelay: typeof cfg.nextDelay === 'function' ? cfg.nextDelay : defaults.nextDelay
    };
  };

  const handle = async (request, ctx, next) => {
    const options = ctx.options;
    const cfg = normalize(options);
    if (!cfg || isReadableStream(request.body)) return null;
    const method = (options.method || 'GET').toUpperCase();
    let delay = cfg.initDelay;
    for (let attempt = 0; ; ++attempt) {
      let response = null;
      let error = null;
      try {
        response = await next();
      } catch (e) {
        if (isAbort(e) || (request.signal && request.signal.aborted)) throw e;
        error = e;
      }
      if (response && method === 'DELETE' && attempt > 0 && response.status === 404) {
        return new Response(null, {status: 204, statusText: 'No Content'});
      }
      const bounded = cfg.retries < 1 || attempt < cfg.retries;
      const wantMore =
        error != null
          ? attempt < cfg.retries
          : cfg.continueRetries
            ? bounded && cfg.continueRetries(response, attempt + 1, options)
            : attempt < cfg.retries && retryableStatus(response.status);
      if (!wantMore) {
        if (response != null) return response;
        throw error;
      }
      io.emit('retry', {attempt: attempt + 1, response, error}, ctx);
      const after = response != null ? retryAfterMs(response) : null;
      await sleep(Math.min(after != null ? after : delay, io.retry.maxDelay));
      if (request.signal && request.signal.aborted) {
        const reason = request.signal.reason;
        throw reason != null
          ? reason
          : new DOMException('This operation was aborted', 'AbortError');
      }
      delay = cfg.nextDelay(delay, attempt + 1, options);
    }
  };

  const service = {name: 'retry', priority: 30, handle};

  io.retry = {
    retries: 2,
    initDelay: 100,
    maxDelay: 30000,
    nextDelay: delay => Math.min(delay * 2, 5000),
    isActive: false,
    attach: () => {
      io.attach(service);
      io.retry.isActive = true;
      return io;
    },
    detach: () => {
      io.detach('retry');
      io.retry.isActive = false;
      return io;
    }
  };

  return io.retry;
};
