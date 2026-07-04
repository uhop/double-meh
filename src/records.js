// @ts-self-types="./records.d.ts"
import {BadStatus, FailedIO} from './envelope.js';

const abortError = signal =>
  signal.reason != null
    ? signal.reason
    : new DOMException('This operation was aborted', 'AbortError');

// byte chunks with abort support: transports may ignore the signal mid-body, so race it here
async function* chunks(stream, signal) {
  const reader = stream.getReader();
  let onAbort = null;
  let abortPromise = null;
  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      throw abortError(signal);
    }
    abortPromise = new Promise((_, reject) => {
      onAbort = () => reject(abortError(signal));
      signal.addEventListener('abort', onAbort, {once: true});
    });
    abortPromise.catch(() => {});
  }
  try {
    for (;;) {
      const result = abortPromise
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read();
      if (result.done) break;
      yield result.value;
    }
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => {});
  }
}

export async function* lines(stream, signal) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunks(stream, signal)) {
    buffer += decoder.decode(chunk, {stream: true});
    let start = 0;
    for (let i = 0; i < buffer.length; ++i) {
      const code = buffer.charCodeAt(i);
      if (code === 13) {
        if (i + 1 === buffer.length) break; // a \r\n pair may be split across chunks
        yield buffer.slice(start, i);
        if (buffer.charCodeAt(i + 1) === 10) ++i;
        start = i + 1;
      } else if (code === 10) {
        yield buffer.slice(start, i);
        start = i + 1;
      }
    }
    buffer = buffer.slice(start);
  }
  buffer += decoder.decode();
  if (buffer) yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
}

// reads the streamed error body so the thrown BadStatus carries parsed data, not an unread stream
export const parsedBadStatus = async (envelope, baseUrl, options) => {
  let data;
  const body = envelope.data;
  if (body && typeof body.getReader === 'function') {
    const text = await new Response(body).text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
  }
  return new BadStatus(envelope.response, data, baseUrl, options);
};

const makeParser = (options, response) => text => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FailedIO('io.records: malformed record', response, options, {cause: error});
  }
};

async function* jsonlRecords(body, options, response) {
  const parse = makeParser(options, response);
  for await (const line of lines(body, options.signal)) {
    const text = line.trim();
    if (text) yield parse(text);
  }
}

// RFC 7464: each record is RS (0x1e) + JSON text + LF; a record completes at the next RS or EOF
async function* seqRecords(body, options, response) {
  const parse = makeParser(options, response);
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunks(body, options.signal)) {
    buffer += decoder.decode(chunk, {stream: true});
    const parts = buffer.split('\x1e');
    buffer = parts.pop();
    for (const part of parts) {
      const text = part.trim();
      if (text) yield parse(text);
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) yield parse(tail);
}

const iterate = (fullVerb, url, data, opts) => {
  const base = {...opts};
  const framing = base.framing;
  delete base.framing;
  if (framing !== undefined && framing !== 'jsonl' && framing !== 'json-seq') {
    throw new TypeError('io.records: unknown framing: ' + framing);
  }
  const lenient = base.ignoreBadStatus === true;
  return (async function* () {
    const options = {...base, stream: true, ignoreBadStatus: true};
    if (!options.accept) options.accept = 'application/x-ndjson, application/json-seq';
    const envelope = await fullVerb(url, data, options);
    if (!envelope.ok && !lenient) {
      throw await parsedBadStatus(envelope, envelope.response.url || undefined, base);
    }
    const body = envelope.data;
    if (!body || typeof body.getReader !== 'function') return;
    const contentType = envelope.contentType || '';
    const mode = framing || (contentType.includes('json-seq') ? 'json-seq' : 'jsonl');
    yield* (mode === 'json-seq' ? seqRecords : jsonlRecords)(body, base, envelope.response);
  })();
};

export const installRecords = io => {
  io.records = {
    get: (url, data, opts) => iterate(io.full.get, url, data, opts),
    post: (url, data, opts) => iterate(io.full.post, url, data, opts)
  };
  return io;
};
