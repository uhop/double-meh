import test from 'tape-six';

import {io, json} from './helper.mjs';

// a complete envelope plugin exercising every seam — the pluggable-types reference example:
// requests wrap into {v: 1, payload}, responses unwrap, faults surface as BadStatus either way
const ACME_MIME = 'application/vnd.acme+json';

const installAcme = dm => {
  dm.mimeTypes.acme = ACME_MIME;
  dm.registerData({
    match: (_data, options) => options.as === 'acme',
    encode: (data, headers) => {
      headers.set('Content-Type', ACME_MIME);
      return JSON.stringify({v: 1, payload: data});
    }
  });
  dm.registerMime({
    match: contentType => contentType.startsWith(ACME_MIME),
    decode: async (response, options) => {
      const doc = JSON.parse(await response.text());
      // an envelope-level fault rides a 2xx: reject it like a bad status, fault as the data
      if (doc.fault) throw new dm.BadStatus(response, doc.fault, undefined, options);
      return doc.payload;
    }
  });
  return dm;
};

const acmeResponse = (doc, init = {}) =>
  new Response(JSON.stringify(doc), {
    status: init.status || 200,
    headers: {'content-type': ACME_MIME}
  });

test('plugin: the request side wraps and labels the body', async t => {
  const dm = installAcme(io.create());
  let seen;
  dm.mock(
    () => true,
    request => {
      seen = request;
      return acmeResponse({v: 1, payload: {ok: true}});
    }
  );
  await dm.post('https://example.com/acme/echo', {name: 'unit-1'}, {as: 'acme'});
  t.equal(seen.headers.get('content-type'), ACME_MIME, 'the plugin MIME labels the request');
  t.deepEqual(
    JSON.parse(seen.body),
    {v: 1, payload: {name: 'unit-1'}},
    'the body rides inside the envelope'
  );
});

test('plugin: the response side unwraps the envelope', async t => {
  const dm = installAcme(io.create());
  dm.mock(
    () => true,
    () => acmeResponse({v: 1, payload: {units: [1, 2, 3]}})
  );
  const data = await dm.get('https://example.com/acme/units');
  t.deepEqual(data, {units: [1, 2, 3]}, 'callers see the payload, not the envelope');
});

test('plugin: an envelope-level fault inside a 2xx becomes BadStatus', async t => {
  const dm = installAcme(io.create());
  dm.mock(
    () => true,
    () => acmeResponse({v: 1, fault: {code: 'E_NO_UNIT', message: 'unit 9 does not exist'}})
  );
  try {
    await dm.get('https://example.com/acme/units/9');
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof dm.BadStatus, 'BadStatus despite the 200');
    t.equal(error.status, 200, 'the transport status is preserved');
    t.equal(error.data.code, 'E_NO_UNIT', 'the fault is the error data');
    t.equal(error.problem, error.data, 'and the problem envelope');
  }
});

test('plugin: an HTTP-level fault surfaces through problem automatically', async t => {
  const dm = installAcme(io.create());
  dm.mock(
    () => true,
    () => acmeResponse({v: 1, payload: {reason: 'maintenance'}}, {status: 503})
  );
  try {
    await dm.get('https://example.com/acme/down');
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof dm.BadStatus, 'BadStatus');
    t.equal(error.status, 503, 'HTTP status');
    t.deepEqual(error.problem, {reason: 'maintenance'}, 'the decoded payload is the problem');
  }
});

test('plugin: unwrapped responses compose with the cache', async t => {
  const dm = installAcme(io.create());
  let calls = 0;
  dm.mock(
    () => true,
    () => {
      ++calls;
      return acmeResponse({v: 1, payload: {n: calls}});
    }
  );
  const first = await dm.get('https://example.com/acme/cached');
  await dm.cache.idle();
  const second = await dm.get('https://example.com/acme/cached');
  t.deepEqual(first, {n: 1}, 'first response unwrapped');
  t.deepEqual(second, {n: 1}, 'second served from cache');
  t.equal(calls, 1, 'one wire hit');
});

test('plugin: the alias composes with plain JSON services on the same instance', async t => {
  const dm = installAcme(io.create());
  dm.mock(
    () => true,
    request =>
      request.url.includes('/acme/')
        ? acmeResponse({v: 1, payload: {kind: 'acme'}})
        : json({kind: 'plain'})
  );
  t.deepEqual(await dm.get('https://example.com/acme/x'), {kind: 'acme'}, 'plugin route unwraps');
  t.deepEqual(await dm.get('https://example.com/plain/x'), {kind: 'plain'}, 'JSON untouched');
});
