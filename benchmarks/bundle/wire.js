// Shared h2c plumbing for the bundle benchmarks: plaintext HTTP/2 (prior knowledge) keeps TLS
// out of the measurement while socket counters capture real frames + HPACK'd headers.

import http2 from 'node:http2';

// realistic per-request baggage: first request pays full size, HPACK indexes the rest
export const REQUEST_HEADERS = {
  accept: 'application/json',
  'accept-encoding': 'gzip, deflate, br, zstd',
  authorization:
    'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhOWYyLTQ3YjgiLCJvcmciOiJhY21lIiwiaWF0IjoxNzgzNTUyMDAwfQ.' +
    'u3Zx1q9cW0mB4kT7pLnV2rY8dJ6fN0aQ5sE1gH3iC7o',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36'
};

export const startServer = ({parts, bundle}) =>
  new Promise(resolve => {
    const server = http2.createServer();
    server.on('stream', (stream, headers) => {
      const path = headers[':path'];
      const payload =
        path === '/bundle'
          ? bundle
          : path.startsWith('/one/')
            ? parts[Number(path.slice(5))]
            : null;
      if (!payload) {
        stream.respond({':status': 404});
        return void stream.end();
      }
      stream.respond({
        ':status': 200,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'cache-control': 'private, max-age=0, must-revalidate',
        etag: `"${payload.length.toString(16)}-${path.length.toString(16)}"`,
        'x-request-id': `req-${payload.length}-${path.replace(/\W/g, '')}`
      });
      stream.end(payload);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

export const connect = port =>
  new Promise((resolve, reject) => {
    const session = http2.connect(`http://127.0.0.1:${port}`);
    session.once('connect', () => resolve(session));
    session.once('error', reject);
  });

export const drain = stream =>
  new Promise((resolve, reject) => {
    stream.on('data', () => {});
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.on('close', resolve);
  });

export const request = (session, path) =>
  drain(session.request({':path': path, ...REQUEST_HEADERS}, {endStream: true}));
