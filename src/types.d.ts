export type Method =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | (string & {});

export type HeaderValue = string | string[];
export type HeaderDict = Record<string, HeaderValue>;

export interface Options {
  url: string;
  method?: Method;
  query?: Record<string, unknown>;
  data?: unknown;
  headers?: HeaderDict;
  signal?: AbortSignal;
  transport?: string;
  accept?: string;
  as?: 'merge-patch' | 'json-patch' | (string & {});
  ifMatch?: string;
  ifNoneMatch?: string;
  fields?: string[];
  sort?: string[];
  expand?: string[];
  stream?: boolean;
  withEtag?: boolean;
  ignoreBadStatus?: boolean;
  cache?: boolean | {ttl?: number};
  track?: boolean;
  wait?: boolean;
  retries?: number;
  retry?: boolean;
  initDelay?: number;
  idempotencyKey?: boolean | string;
  [key: string]: unknown;
}

export interface PreparedRequest {
  url: string;
  method: Method;
  headers: Headers;
  body?: BodyInit | null;
  signal?: AbortSignal;
  duplex?: 'half';
}

export interface RequestContext {
  options: Options;
  key: string;
}

export interface ServerTimingMetric {
  name: string;
  dur?: number;
  desc?: string;
}

export interface Envelope {
  data: unknown;
  status: number;
  ok: boolean;
  response: Response;
  headers: HeaderDict;
  readonly etag: string | undefined;
  readonly weak: boolean;
  readonly lastModified: Date | undefined;
  readonly location: string | undefined;
  readonly links: Record<string, string>;
  readonly contentType: string | undefined;
  readonly retryAfter: number | Date | undefined;
  readonly serverTiming: ServerTimingMetric[];
}

export type Transport = (request: PreparedRequest, ctx: RequestContext) => Promise<Response>;

export type RequestInspector = (
  request: PreparedRequest,
  options: Options
) => void | PreparedRequest | Promise<void | PreparedRequest>;

export type ResponseInspector = (
  envelope: Envelope,
  ctx: RequestContext
) => void | Envelope | Promise<void | Envelope>;

export interface DataProcessor {
  match(data: unknown, options: Options): boolean;
  encode(data: unknown, headers: Headers, options: Options): BodyInit | null;
}

export interface MimeProcessor {
  match(contentType: string, response: Response): boolean;
  decode(response: Response): unknown | Promise<unknown>;
}

export interface Service {
  name: string;
  priority: number;
  handle(
    request: PreparedRequest,
    ctx: RequestContext,
    next: () => Promise<Response>
  ): Response | null | Promise<Response | null>;
}

export type Target = string | URL | Options;
export type Overrides = Omit<Options, 'url'> & {url?: never};
export type Verb = (url: Target, data?: unknown, options?: Overrides) => Promise<unknown>;
export type FullVerb = (url: Target, data?: unknown, options?: Overrides) => Promise<Envelope>;

export interface Verbs {
  get: Verb;
  head: Verb;
  post: Verb;
  put: Verb;
  patch: Verb;
  delete: Verb;
  del: Verb;
  remove: Verb;
  options: Verb;
}

export interface FullVerbs {
  get: FullVerb;
  head: FullVerb;
  post: FullVerb;
  put: FullVerb;
  patch: FullVerb;
  delete: FullVerb;
  del: FullVerb;
  remove: FullVerb;
  options: FullVerb;
}

export interface FullNamespace extends FullVerbs {
  (url: Target, data?: unknown, options?: Overrides): Promise<Envelope>;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

export interface Track {
  active: boolean;
  deferred: Record<string, Deferred<Envelope>>;
  flyByKey(key: string): Deferred<Envelope>;
  fly(options: Target): Deferred<Envelope>;
  isFlying(options: Target): Deferred<Envelope> | undefined;
  optIn(options: Options): boolean;
  attach(): IO;
  detach(): IO;
}

export interface CacheEntry {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
  etag?: string;
  lastModified?: string;
  expiresAt: number;
}

export interface CacheStorage {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  clear(): void | Promise<void>;
  keys(): string[] | Promise<string[]>;
}

export type CachePattern = string | RegExp | ((key: string) => boolean);

export interface Cache {
  storage: CacheStorage;
  defaultTtl: number;
  isActive: boolean;
  optIn(options: Options): boolean;
  attach(): IO;
  detach(): IO;
  remove(pattern: CachePattern): Promise<IO>;
  clear(): Promise<IO>;
  sweep(): Promise<IO>;
  save(target: Target, response: Response, ttl?: number): Promise<IO>;
}

export interface Retry {
  initDelay: number;
  nextDelay(delay: number, attempt: number, options: Options): number;
  isActive: boolean;
  optIn(options: Options): boolean;
  attach(): IO;
  detach(): IO;
}

export type MockMatcher =
  | string
  | RegExp
  | ((request: PreparedRequest, ctx: RequestContext) => boolean);
export type MockCallback = (request: PreparedRequest, ctx: RequestContext) => unknown;

export interface Mock {
  (matcher: MockMatcher, callback?: MockCallback): IO;
  exact: Map<string, MockCallback>;
  isActive: boolean;
  attach(): IO;
  detach(): IO;
  clear(): IO;
}

export interface IO extends Verbs {
  (url: Target, data?: unknown, options?: Overrides): Promise<unknown>;
  full: FullNamespace;
  track: Track;
  cache: Cache;
  retry: Retry;
  mock: Mock;
  update(target: Target, fn: (data: unknown) => unknown, options?: Overrides): Promise<unknown>;
  adopt(options: Target, source: Promise<Response> | Response): Promise<Envelope>;
  toEnvelope(response: Response, options: Target): Promise<Envelope>;
  run(options: Target): Promise<Envelope>;
  request(options: Target): Promise<Envelope>;
  makeKey(options: Options): string;
  buildUrl(options: Options): string;
  makeVerb(method: string): Verb;

  transports: Record<string, Transport>;
  defaultTransport: Transport | null;
  requestInspectors: RequestInspector[];
  responseInspectors: ResponseInspector[];
  dataProcessors: DataProcessor[];
  mimeProcessors: MimeProcessor[];
  services: Service[];

  registerTransport(name: string, transport: Transport): IO;
  inspect: {
    request(fn: RequestInspector): IO;
    response(fn: ResponseInspector): IO;
  };
  registerData(processor: DataProcessor): IO;
  registerMime(processor: MimeProcessor): IO;
  attach(service: Service): IO;
  detach(name: string): IO;

  on(event: string, fn: (...args: unknown[]) => void): IO;
  off(event: string, fn: (...args: unknown[]) => void): IO;
  emit(event: string, ...args: unknown[]): IO;
}
