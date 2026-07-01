const isReadableStream = body =>
  body != null && typeof body === 'object' && typeof body.getReader === 'function';

export const fetchTransport = (request, ctx) => {
  const init = {
    ...(ctx && ctx.options.fetch),
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal
  };
  if (isReadableStream(request.body)) init.duplex = 'half';
  return fetch(request.url, init);
};
