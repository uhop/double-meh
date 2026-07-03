import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';
import {createIO} from '../src/io.js';

test('io.create() yields an isolated, fully equipped instance', async t => {
  const other = io.create();
  other.mock('https://example.com/iso', () => ({from: 'other'}));
  serve(() => json({from: 'root'}));
  t.deepEqual(
    await other.get('https://example.com/iso'),
    {from: 'other'},
    'the child mock answers on the child'
  );
  t.deepEqual(
    await io.get('https://example.com/iso'),
    {from: 'root'},
    'the root instance is unaffected'
  );
  t.ok(other.track && other.cache && other.retry, 'services installed on the child');
  other.mock.clear();
  reset();
});

test('scoped inspectors fire only for matching URLs', async t => {
  const other = io.create();
  const seen = [];
  other.mock(
    () => true,
    request => {
      seen.push(request.headers.get('authorization'));
      return {ok: true};
    }
  );
  other.inspect.request(request => {
    request.headers.set('Authorization', 'Bearer one');
  }, 'https://api.one.example/');
  await other.get('https://api.one.example/data');
  await other.get('https://api.two.example/data');
  t.equal(seen[0], 'Bearer one', 'inspector applied on its host');
  t.equal(seen[1], null, 'inspector skipped elsewhere');
});

test('createIO() gives a bare pipeline', t => {
  const bare = createIO();
  t.equal(bare.defaultTransport, null, 'no transport configured');
  t.equal(bare.services.length, 0, 'no services attached');
  t.equal(bare.track, undefined, 'no track service');
});
