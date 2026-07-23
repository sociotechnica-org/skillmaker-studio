/**
 * Shared e2e server harness -- the ONE place "spawn `skillmaker start` and
 * wait until it serves" lives (it was previously copy-pasted as a local
 * `waitForHealth` in 22 e2e files, per-file random ports and all).
 *
 * Built to kill the "server never became healthy at :NNNNN" CI flake class
 * structurally, not by raising a timeout:
 *
 * 1. FAIL FAST ON EXIT. The old loops polled `/api/health` blind: if the
 *    spawned process died on startup (port already bound -> EADDRINUSE,
 *    any crash), the harness spun on a corpse for the full timeout and then
 *    reported a misleading "never became healthy". Here the child's exit
 *    settles the wait immediately, with its exit code and captured
 *    stderr/stdout in the error -- the real failure, seconds not minutes.
 * 2. PORTS OUTSIDE THE EPHEMERAL RANGE, WITH RETRY. The old per-file
 *    `20000 + random(20000)` reached into Linux's ephemeral port range
 *    (32768+), where any outgoing socket on a busy CI runner can already
 *    hold the port (the observed flake was :33736 -- ephemeral territory).
 *    Ports are now drawn strictly below 32768, and a startup that dies
 *    anyway is retried on a fresh port a couple of times before failing.
 * 3. TIMEOUT AS BACKSTOP ONLY. Startup measures ~170ms locally (bun
 *    transpile + reindex + listen); readiness normally lands on the first
 *    or second poll. The default 45s backstop exists purely to absorb a
 *    badly loaded runner -- with fail-fast above, a hung-but-alive server
 *    is the only thing that can ever run it down. 45s, not 60s, because
 *    the server-starting beforeAll hooks budget 60s: the backstop must
 *    fire first so a failure surfaces THIS error (with captured stdio),
 *    not bun's bare hook-timeout message.
 *
 * The error message keeps the established "server never became healthy at
 * <url>" shape from the 22 originals.
 */

const POLL_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;

/** Below Linux's ephemeral range (32768+) so a runner's own outgoing sockets can never squat the chosen port. */
const randomPort = (): number => 20_000 + Math.floor(Math.random() * 12_000);

export interface StartE2eServerOptions {
  /** argv for one attempt at the given port, e.g. `(port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"]`. */
  readonly command: (port: number) => ReadonlyArray<string>;
  readonly cwd: string;
  /** Extra env for the spawned server, merged over the test process's env. Explicit because relying on `process.env` mutations propagating through Bun.spawn's default inheritance has proven flaky. */
  readonly env?: Readonly<Record<string, string>>;
  /** Backstop deadline per attempt (see the header: readiness normally arrives in well under a second). */
  readonly timeoutMs?: number;
}

export interface StartedE2eServer {
  readonly process: ReturnType<typeof Bun.spawn>;
  readonly port: number;
  readonly baseUrl: string;
}

const drain = async (stream: ReadableStream<Uint8Array>, into: { text: string }): Promise<void> => {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    into.text += decoder.decode(chunk);
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type AttemptOutcome =
  | { readonly kind: "ready" }
  | { readonly kind: "exited"; readonly detail: string }
  | { readonly kind: "timed-out"; readonly detail: string };

export const startE2eServer = async (options: StartE2eServerOptions): Promise<StartedE2eServer> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const failures: string[] = [];
  let lastBaseUrl = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const port = randomPort();
    const baseUrl = `http://localhost:${port}`;
    lastBaseUrl = baseUrl;
    const proc = Bun.spawn([...options.command(port)], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      ...(options.env !== undefined ? { env: { ...process.env, ...options.env } } : {}),
    });

    // Drained continuously so a chatty server can never block on a full
    // pipe buffer; kept for diagnostics when startup fails.
    const stdout = { text: "" };
    const stderr = { text: "" };
    void drain(proc.stdout as ReadableStream<Uint8Array>, stdout);
    void drain(proc.stderr as ReadableStream<Uint8Array>, stderr);

    let exited = false;
    void proc.exited.then(() => {
      exited = true;
    });

    const outcome = await (async (): Promise<AttemptOutcome> => {
      const deadline = Date.now() + timeoutMs;
      let lastError: unknown;
      while (Date.now() < deadline) {
        if (exited) {
          // Give the drains a beat to flush the tail of the pipes.
          await sleep(20);
          return {
            kind: "exited",
            detail:
              `attempt ${attempt}: server process exited with code ${String(proc.exitCode)} before becoming healthy at ${baseUrl}\n` +
              `--- stderr ---\n${stderr.text}--- stdout ---\n${stdout.text}`,
          };
        }
        try {
          const response = await fetch(`${baseUrl}/api/health`);
          if (response.ok) {
            return { kind: "ready" };
          }
        } catch (cause) {
          lastError = cause;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      return {
        kind: "timed-out",
        detail: `attempt ${attempt}: ${String(lastError)}\n--- stderr ---\n${stderr.text}--- stdout ---\n${stdout.text}`,
      };
    })();

    if (outcome.kind === "ready") {
      return { process: proc, port, baseUrl };
    }

    failures.push(outcome.detail);
    proc.kill("SIGTERM");
    await proc.exited;

    // A process that died on startup may have hit a one-off (a squatted
    // port, a transient resource blip) -- worth fresh ports. A full
    // backstop timeout means the server is alive but wedged; retrying
    // would triple an already-long wait for the same answer.
    if (outcome.kind === "timed-out") {
      break;
    }
  }

  throw new Error(
    `server never became healthy at ${lastBaseUrl} after ${failures.length} attempt(s):\n${failures.join("\n")}`,
  );
};
