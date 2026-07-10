import type {IO, SW} from './types.js';

/** The message-carrying end of a Service Worker (structural: `ServiceWorker` or a test fake). */
export interface SWEndpoint {
  postMessage(message: unknown, transfer?: unknown[]): void;
}

export interface SWRegistrationLike {
  active?: SWEndpoint | null;
}

/** Structural subset of `ServiceWorkerContainer` — injectable for tests and non-DOM builds. */
export interface SWContainerLike {
  controller?: SWEndpoint | null;
  ready: Promise<SWRegistrationLike>;
  getRegistration(): Promise<SWRegistrationLike | undefined>;
  addEventListener?(type: 'controllerchange', listener: () => void): void;
}

export interface SWInstallOptions {
  /** Announced in `io:hello`; the SW keys client-wins bundling on it. Default: `'double-meh'`. */
  library?: string;
  /** Injectable for tests. Default: `navigator.serviceWorker`; pass `null` to force "no support". */
  serviceWorker?: SWContainerLike | null;
  /** How long to wait for a hello reply before giving up, ms. Default: 500. */
  helloTimeout?: number;
}

/** The shared-tier cache name — lockstep with the double-meh-sw cache-tier default. */
export declare const SHARED_CACHE: 'io-shared';

/**
 * Installs the page half of the Service-Worker contract: registers the `sw` message transport
 * (`transport: 'sw'` — the prefetch/adopt class: engages uncontrolled pages and survives
 * navigations by landing results in the SW's shared Cache API tier), announces `io:hello` when a
 * controlling SW is present (and re-announces on `controllerchange`), and maintains `io.sw`.
 * Emits the `sw` event on connect and disconnect. Request bodies do not cross the channel;
 * interactive traffic stays on the default fetch transport.
 */
export declare function installSW(io: IO, options?: SWInstallOptions): IO;
