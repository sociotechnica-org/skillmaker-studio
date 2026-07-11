#!/usr/bin/env node
/**
 * A fake ACP adapter that simulates the pre-handshake infra-error path
 * (test/e2e/phase8.e2e.test.ts): exits nonzero immediately, before ever
 * responding to `initialize`. `AcpClient.spawn()` detects this via its
 * 800ms early-exit race and classifies it as `AcpSpawnError` ->
 * `infra-error`, never `failed` -- auth/sandbox/connection faults must
 * never pollute pass rates (data-model.md §2.8).
 */
process.stderr.write("fake-acp-infra-fail: simulated connection refused (ECONNREFUSED)\n");
process.exit(1);
