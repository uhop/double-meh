// Seeded (reproducible) corpus of API responses following the design article's envelope
// conventions. Entropy is deliberately mixed: uuid/date fields stay incompressible, so any
// bundling gain comes from shared structure, not artificially repetitive data.

const mulberry32 = a => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const WORDS = (
  'acoustic amber apex atlas aurora basalt beacon birch bramble cedar cinder cobalt coral ' +
  'crystal delta drift ember fable falcon fern flint garnet glacier harbor hazel indigo iris ' +
  'juniper kestrel lagoon larch lumen maple meadow nectar obsidian onyx opal orchid pebble ' +
  'pine quartz raven reed sable sage summit thistle timber tundra velvet willow zephyr'
).split(' ');

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const hex = (rng, n) => Array.from({length: n}, () => int(rng, 0, 15).toString(16)).join('');
const uuid = rng =>
  `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-${pick(rng, ['8', '9', 'a', 'b'])}${hex(rng, 3)}-${hex(rng, 12)}`;
const isoDate = rng =>
  new Date(
    Date.UTC(
      2026,
      int(rng, 0, 6),
      int(rng, 1, 28),
      int(rng, 0, 23),
      int(rng, 0, 59),
      int(rng, 0, 59)
    )
  )
    .toISOString()
    .replace(/\.\d+Z$/, 'Z');
const title = word => word[0].toUpperCase() + word.slice(1);

const orderRow = rng => ({
  id: uuid(rng),
  number: 'ORD-' + int(rng, 100000, 999999),
  status: pick(rng, ['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
  currency: pick(rng, ['USD', 'EUR', 'GBP']),
  total: int(rng, 100, 999999) / 100,
  customerId: uuid(rng),
  itemCount: int(rng, 1, 12),
  createdAt: isoDate(rng),
  updatedAt: isoDate(rng)
});

const userRow = rng => ({
  id: uuid(rng),
  email: `${pick(rng, WORDS)}.${pick(rng, WORDS)}@example.com`,
  name: `${title(pick(rng, WORDS))} ${title(pick(rng, WORDS))}`,
  role: pick(rng, ['viewer', 'editor', 'admin', 'owner']),
  active: rng() < 0.85,
  lastSeenAt: isoDate(rng),
  createdAt: isoDate(rng)
});

const productRow = rng => ({
  id: uuid(rng),
  sku: 'SKU-' + hex(rng, 8).toUpperCase(),
  name: `${title(pick(rng, WORDS))} ${pick(rng, WORDS)}`,
  price: int(rng, 100, 99999) / 100,
  stock: int(rng, 0, 5000),
  tags: Array.from({length: int(rng, 1, 3)}, () => pick(rng, WORDS)),
  updatedAt: isoDate(rng)
});

const list = (rng, row, count) => {
  const items = Array.from({length: count}, () => row(rng));
  return {items, offset: 0, limit: count, total: int(rng, count, count * 20)};
};

const configResponse = rng => ({
  theme: pick(rng, ['light', 'dark', 'system']),
  locale: pick(rng, ['en-US', 'en-GB', 'de-DE', 'fr-FR']),
  currency: pick(rng, ['USD', 'EUR', 'GBP']),
  features: {records: true, sse: rng() < 0.5, uploads: rng() < 0.5, beta: rng() < 0.2},
  limits: {
    pageSize: pick(rng, [20, 50, 100]),
    uploadMb: int(rng, 10, 500),
    sessions: int(rng, 1, 20)
  }
});

const meResponse = rng => ({
  id: uuid(rng),
  email: `${pick(rng, WORDS)}.${pick(rng, WORDS)}@example.com`,
  name: `${title(pick(rng, WORDS))} ${title(pick(rng, WORDS))}`,
  roles: Array.from({length: int(rng, 1, 3)}, () => pick(rng, ['viewer', 'editor', 'admin'])),
  org: {
    id: uuid(rng),
    name: title(pick(rng, WORDS)) + ' Inc',
    plan: pick(rng, ['free', 'team', 'enterprise'])
  }
});

export const ROWS_PER_SIZE = {small: 3, medium: 18, large: 75};

// cycle mixes list + single-resource endpoints, the shape of one page's request burst
export const makeCorpus = ({count, size = 'medium', seed = 20260704}) => {
  const rng = mulberry32(seed);
  const rows = ROWS_PER_SIZE[size];
  if (!rows) throw new Error(`unknown size: ${size}`);
  const cycle = [
    rng => list(rng, orderRow, rows),
    rng => list(rng, userRow, rows),
    rng => meResponse(rng),
    rng => list(rng, productRow, rows),
    rng => configResponse(rng)
  ];
  return Array.from({length: count}, (_, i) => cycle[i % cycle.length](rng));
};

export const makeBundle = responses =>
  responses.map(body => ({status: 200, headers: {'content-type': 'application/json'}, body}));
