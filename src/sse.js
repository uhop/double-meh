// @ts-self-types="./sse.d.ts"
import {isAbort, FailedIO} from './envelope.js';
import {lines, parsedBadStatus} from './records.js';

const MAX_RETRY = 2 ** 31 - 1; // setTimeout's ceiling

const sleep = (ms, signal) => {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(
        signal.reason != null
          ? signal.reason
          : new DOMException('This operation was aborted', 'AbortError')
      );
    if (signal.aborted) return void fail();
    const onAbort = () => {
      clearTimeout(timer);
      fail();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(undefined);
    }, ms);
    signal.addEventListener('abort', onAbort, {once: true});
  });
};

const withHeader = (headers, name, value) => {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const copy = new Headers(headers);
    copy.set(name, value);
    return copy;
  }
  return {...headers, [name]: value};
};

export const installSse = io => {
  io.sse = (url, data, opts) => {
    const base = {...opts};
    const reconnect = base.reconnect;
    let lastEventId = base.lastEventId != null ? String(base.lastEventId) : undefined;
    delete base.reconnect;
    delete base.lastEventId;
    const lenient = base.ignoreBadStatus === true;
    return (async function* () {
      let delay = typeof reconnect === 'number' ? reconnect : io.sse.reconnectDelay;
      for (;;) {
        const options = {...base, stream: true, ignoreBadStatus: true};
        if (!options.accept) options.accept = 'text/event-stream';
        if (lastEventId !== undefined) {
          options.headers = withHeader(options.headers, 'Last-Event-ID', lastEventId);
        }
        let envelope;
        try {
          envelope = await io.full(url, data, options);
        } catch (error) {
          if (isAbort(error) || (base.signal && base.signal.aborted) || reconnect === false) {
            throw error;
          }
          await sleep(delay, base.signal); // a network failure reconnects, EventSource-style
          continue;
        }
        if (!envelope.ok && !lenient) {
          throw await parsedBadStatus(envelope, envelope.response.url || undefined, base);
        }
        if (envelope.status === 204) return; // the server ends the subscription
        const body = envelope.data;
        const contentType = envelope.contentType || '';
        if (contentType && !contentType.includes('text/event-stream') && !lenient) {
          if (body && typeof body.cancel === 'function') await body.cancel().catch(() => {});
          throw new FailedIO(
            'io.sse: unexpected content type: ' + contentType,
            envelope.response,
            base
          );
        }
        if (body && typeof body.getReader === 'function') {
          let dataLines = [];
          let eventType = '';
          try {
            for await (const line of lines(body, base.signal)) {
              if (line === '') {
                if (dataLines.length) {
                  yield {
                    data: dataLines.join('\n'),
                    event: eventType || 'message',
                    id: lastEventId
                  };
                }
                dataLines = [];
                eventType = '';
                continue;
              }
              if (line.charCodeAt(0) === 58) continue; // ':' comment / keep-alive
              const colon = line.indexOf(':');
              const field = colon < 0 ? line : line.slice(0, colon);
              let value = colon < 0 ? '' : line.slice(colon + 1);
              if (value.charCodeAt(0) === 32) value = value.slice(1);
              if (field === 'data') dataLines.push(value);
              else if (field === 'event') eventType = value;
              else if (field === 'id') {
                if (!value.includes('\0')) lastEventId = value;
              } else if (field === 'retry') {
                // only ASCII digits, per the spec: Number('') is 0, which would zero the
                // reconnect delay. Clamped because a larger value overflows setTimeout's
                // 32-bit range and fires immediately — the same storm by another route
                if (/^\d+$/.test(value)) delay = Math.min(Number(value), MAX_RETRY);
              }
            }
          } catch (error) {
            if (isAbort(error) || (base.signal && base.signal.aborted) || reconnect === false) {
              throw error;
            }
            // a dropped stream falls through to the reconnect path
          }
        }
        if (reconnect === false) return;
        await sleep(delay, base.signal);
      }
    })();
  };
  io.sse.reconnectDelay = 3000;
  return io;
};
