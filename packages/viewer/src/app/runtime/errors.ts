/**
 * Tagged errors for the runtime client boundary (src/app/runtime/). Plain
 * classes, not `Effect`-based errors: this file is consumed by React hooks
 * that expose Promises, and Effect itself stays confined to this directory
 * (never imported by components).
 */

export class RuntimeFetchError extends Error {
  readonly _tag = "RuntimeFetchError";
  readonly path: string;
  readonly status: number | undefined;

  constructor(path: string, message: string, status?: number) {
    super(message);
    this.name = "RuntimeFetchError";
    this.path = path;
    this.status = status;
  }
}

export class RuntimeDecodeError extends Error {
  readonly _tag = "RuntimeDecodeError";
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "RuntimeDecodeError";
    this.path = path;
  }
}

export type RuntimeError = RuntimeFetchError | RuntimeDecodeError;
