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
  const optIn = options => {
    if (options.retry === false) return false;
    if (typeof options.retries !== 'number' || options.retries < 1) return false;
    if (options.retry === true) return true;
    return safeToRetry(options);
  };

  const handle = async (request, ctx, next) => {
    const options = ctx.options;
    if (!optIn(options) || isReadableStream(request.body)) return null;
    const max = options.retries;
    const method = (options.method || 'GET').toUpperCase();
    let delay = options.initDelay != null ? options.initDelay : io.retry.initDelay;
    let attempt = 0;
    for (;;) {
      let response = null;
      let error = null;
      try {
        response = await next();
      } catch (e) {
        error = e;
      }
      if (response && method === 'DELETE' && attempt > 0 && response.status === 404) {
        return new Response(null, {status: 204, statusText: 'No Content'});
      }
      const failed = error != null || (response != null && retryableStatus(response.status));
      if (!failed || attempt >= max) {
        if (response != null) return response;
        throw error;
      }
      const after = response != null ? retryAfterMs(response) : null;
      await sleep(after != null ? after : delay);
      delay = io.retry.nextDelay(delay, attempt, options);
      ++attempt;
    }
  };

  const service = {name: 'retry', priority: 30, handle};

  io.retry = {
    initDelay: 100,
    nextDelay: delay => Math.min(delay * 2, 5000),
    optIn,
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
