import type {IOError, FailedIO, BadStatus, TimedOut} from './envelope.js';

export type Method =
  'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | (string & {});

export type HeaderValue = string | string[];
export type HeaderDict = Record<string, HeaderValue>;

export type QueryInput = Record<string, unknown> | URLSearchParams | string | number | boolean;

export type DecodeMode = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData';

export interface RetryConfig {
  retries?: number;
  initDelay?: number;
  force?: boolean;
  nextDelay?(delay: number, attempt: number, options: Options): number;
  continueRetries?(response: Response, attempt: number, options: Options): boolean;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

export interface Options {
  url: string | URL;
  method?: Method;
  query?: QueryInput;
  data?: unknown;
  headers?: HeaderDict | Headers;
  signal?: AbortSignal;
  timeout?: number;
  transport?: string;
  fetch?: Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>;
  accept?: string;
  as?:
    | 'merge-patch'
    | 'json-patch'
    | 'json'
    | 'ndjson'
    | 'jsonl'
    | 'text'
    | 'csv'
    | 'html'
    | 'xml'
    | 'form'
    | 'octet'
    | (string & {});
  decode?: DecodeMode | ((response: Response, options: Options) => unknown);
  ifMatch?: string;
  ifNoneMatch?: string;
  fields?: string[];
  sort?: string[];
  expand?: string[];
  stream?: boolean;
  bust?: boolean | string;
  ignoreBadStatus?: boolean;
  cache?: boolean | {ttl?: number};
  track?: boolean | 'wait';
  mock?: boolean;
  retry?: boolean | number | RetryConfig;
  idempotencyKey?: boolean | string;
  force?: boolean;
  onDownloadProgress?(info: DownloadProgress): void;
  meta?: Record<string, unknown>;
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
  userSignal?: AbortSignal;
  timeoutSignal?: AbortSignal | null;
}

export interface ServerTimingMetric {
  name: string;
  dur?: number;
  desc?: string;
}

export interface Envelope<T = unknown> {
  data: T;
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

export type InspectorMatch = string | RegExp | ((url: string) => boolean);

export type RequestInspector = (
  request: PreparedRequest,
  options: Options
) => void | PreparedRequest | Promise<void | PreparedRequest>;

export type ResponseInspector = (
  envelope: Envelope,
  ctx: RequestContext
) => void | Envelope | Promise<void | Envelope>;

export interface RequestInspectorEntry {
  fn: RequestInspector;
  match?: InspectorMatch;
}

export interface ResponseInspectorEntry {
  fn: ResponseInspector;
  match?: InspectorMatch;
}

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

export type ServiceDefault = boolean | ((options: Options) => boolean);

export type Target = string | URL | Options;
export type Overrides = Omit<Options, 'url'> & {url?: never};
export type Verb = <T = unknown>(url: Target, data?: unknown, options?: Overrides) => Promise<T>;
export type MetaVerb = (url: Target, data?: unknown, options?: Overrides) => Promise<Envelope>;
export type FullVerb = <T = unknown>(
  url: Target,
  data?: unknown,
  options?: Overrides
) => Promise<Envelope<T>>;

export interface Verbs {
  get: Verb;
  head: MetaVerb;
  post: Verb;
  put: Verb;
  patch: Verb;
  delete: Verb;
  del: Verb;
  remove: Verb;
  options: MetaVerb;
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
  <T = unknown>(url: Target, data?: unknown, options?: Overrides): Promise<Envelope<T>>;
}

export interface StreamDuplex<T = unknown> {
  readable: ReadableStream;
  writable: WritableStream;
  response: Promise<Envelope<T>>;
}

export type StreamWriteVerb = (url: Target, options?: Overrides) => StreamDuplex;

export interface StreamNamespace {
  get(url: Target, data?: unknown, options?: Overrides): Promise<ReadableStream>;
  put: StreamWriteVerb;
  post: StreamWriteVerb;
  patch: StreamWriteVerb;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
  flying?: boolean;
}

export interface Track {
  active: boolean;
  theDefault: ServiceDefault;
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
  theDefault: ServiceDefault;
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
  retries: number;
  initDelay: number;
  maxDelay: number;
  nextDelay(delay: number, attempt: number, options?: Options): number;
  isActive: boolean;
  attach(): IO;
  detach(): IO;
}

export type MockMatcher =
  string | RegExp | ((request: PreparedRequest, ctx: RequestContext) => boolean);
export type MockCallback = (request: PreparedRequest, ctx: RequestContext) => unknown;

export interface Mock {
  (matcher: MockMatcher, callback?: MockCallback): IO;
  exact: Map<string, MockCallback>;
  isActive: boolean;
  attach(): IO;
  detach(): IO;
  clear(): IO;
}

export type UpdateFn<T> = (data: T) => T | undefined | Promise<T | undefined>;

export interface IO extends Verbs {
  <T = unknown>(url: Target, data?: unknown, options?: Overrides): Promise<T>;
  full: FullNamespace;
  stream: StreamNamespace;
  track: Track;
  cache: Cache;
  retry: Retry;
  mock: Mock;
  create(): IO;
  update<T = unknown>(target: Target, fn: UpdateFn<T>, options?: Overrides): Promise<T>;
  adopt(options: Target, source: Promise<Response> | Response): Promise<Envelope>;
  toEnvelope(response: Response, options: Target): Promise<Envelope>;
  run<T = unknown>(options: Target): Promise<Envelope<T>>;
  makeKey(options: Options): string;
  buildUrl(options: Options): string;
  makeVerb(method: string): Verb;
  inFlight: number;

  IOError: typeof IOError;
  FailedIO: typeof FailedIO;
  BadStatus: typeof BadStatus;
  TimedOut: typeof TimedOut;

  transports: Record<string, Transport>;
  defaultTransport: Transport | null;
  requestInspectors: RequestInspectorEntry[];
  responseInspectors: ResponseInspectorEntry[];
  dataProcessors: DataProcessor[];
  mimeProcessors: MimeProcessor[];
  services: Service[];
  mimeTypes: Record<string, string>;

  registerTransport(name: string, transport: Transport): IO;
  inspect: {
    request(fn: RequestInspector, match?: InspectorMatch): IO;
    response(fn: ResponseInspector, match?: InspectorMatch): IO;
  };
  registerData(processor: DataProcessor): IO;
  registerMime(processor: MimeProcessor): IO;
  attach(service: Service): IO;
  detach(name: string): IO;

  on(event: string, fn: (...args: unknown[]) => void): IO;
  off(event: string, fn: (...args: unknown[]) => void): IO;
  emit(event: string, ...args: unknown[]): IO;
}
