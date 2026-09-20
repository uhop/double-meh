// The measurement core of nano-bench carries no `node:` import as of 2026-09-19, so a browser needs
// neither a shim nor an import map. That change is not released yet, so this points at the sibling
// checkout rather than at node_modules; switch the specifier back to
// '../node_modules/nano-benchmark/src/index.js' once a published version carries it.
import {compare, median} from '../../nano-bench/src/index.js';

import {candidates} from './backends.js';

const entry = bytes => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: new ArrayBuffer(bytes),
  expiresAt: Infinity
});

const el = (tag, text, attrs) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  Object.assign(node, attrs || {});
  return node;
};

const row = (cells, tag = 'td') => {
  const tr = el('tr');
  for (const cell of cells) tr.append(el(tag, cell));
  return tr;
};

const table = (head, rows) => {
  const t = el('table');
  t.append(row(head, 'th'));
  for (const r of rows) t.append(row(r));
  return t;
};

const ms = value => (value >= 1 ? value.toFixed(3) + ' ms' : (value * 1000).toFixed(1) + ' µs');

const operations = {
  set: (storage, keys, bytes) => {
    let i = 0;
    return async n => {
      for (let j = 0; j < n; ++j) await storage.set(keys[i++ % keys.length], entry(bytes));
    };
  },
  get: (storage, keys) => {
    let i = 0;
    return async n => {
      for (let j = 0; j < n; ++j) await storage.get(keys[i++ % keys.length]);
    };
  },
  keys: storage => async n => {
    for (let j = 0; j < n; ++j) await storage.keys();
  }
};

export const run = async ({question, operation, bodyBytes = 2048, keyCount = 20, reps = 50}) => {
  document.title = question;
  const out = document.body;
  out.append(el('h1', question));
  out.append(
    el(
      'p',
      `${operation} · ${bodyBytes} byte bodies · ${keyCount} keys · series sized by nano-bench from ${reps}`
    )
  );
  // a pasted result has to say where it came from: an absent backend on an insecure origin is a
  // property of the URL, not of the engine
  out.append(el('p', `${navigator.userAgent} · secureContext: ${self.isSecureContext}`));
  const status = el('p', 'measuring…');
  out.append(status);

  const keys = Array.from({length: keyCount}, (_, i) => `GET https://bench.invalid/${i}`);
  const inputs = {};
  const open = [];
  const skipped = [];

  for (const candidate of candidates()) {
    if (candidate.skip) {
      skipped.push([candidate.name, candidate.skip]);
      continue;
    }
    try {
      const storage = candidate.create();
      await storage.clear();
      if (operation !== 'set') for (const key of keys) await storage.set(key, entry(bodyBytes));
      open.push(storage);
      inputs[candidate.name] = operations[operation](storage, keys, bodyBytes);
    } catch (error) {
      skipped.push([candidate.name, `setup failed: ${(error && error.name) || error}`]);
    }
  }

  const names = Object.keys(inputs);
  if (names.length < 2) {
    status.textContent = `only ${names.length} backend available — nothing to compare`;
  } else {
    status.textContent = `measuring ${names.length} backends…`;
    // `reps` only seeds the search: nano-bench grows it until a series clears 20 ms, which is
    // what keeps a fast backend from measuring as zero against a coarsened clock
    const result = await compare(inputs, {startFrom: reps, nSeries: 60});
    const medians = result.data.map(series => median(series.slice().sort((a, b) => a - b)));
    const best = Math.min(...medians);
    const rows = names
      .map((name, i) => ({name, m: medians[i]}))
      .sort((a, b) => a.m - b.m)
      .map(({name, m}) => [
        name,
        ms(m),
        Math.round(1000 / m).toLocaleString() + '/s',
        m === best ? '—' : best > 0 ? (m / best).toFixed(1) + '× slower' : 'n/a'
      ]);
    status.remove();
    out.append(table(['backend', 'median per op', 'throughput', 'versus best'], rows));
    const {data, ...verdict} = result;
    out.append(el('h2', 'significance'));
    out.append(el('pre', JSON.stringify(verdict, null, 2)));
    out.append(el('h2', 'raw series (ms per op)'));
    const raw = el('pre', names.map((n, i) => `${n}\n  ${result.data[i].join(' ')}`).join('\n'));
    raw.style.whiteSpace = 'pre-wrap';
    out.append(raw);
  }

  if (skipped.length) {
    out.append(el('h2', 'not measured'));
    out.append(table(['backend', 'why'], skipped));
  }
  for (const storage of open) await storage.clear().catch(() => {});
};
