// minimal surface used by sqlite.js; Bun ships no importable types for its builtins
declare module 'bun:sqlite' {
  export interface Statement {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): Record<string, unknown>[];
  }
  export class Database {
    constructor(filename?: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
