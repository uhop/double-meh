const isReadableStream = body =>
  body != null && typeof body === 'object' && typeof body.getReader === 'function';

export const fetchTransport = request => {
  const init = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal
  };
  if (isReadableStream(request.body)) init.duplex = 'half';
  return fetch(request.url, init);
};
