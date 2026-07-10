/**
 * The shape every command resolves to. `main.ts` is the only place that
 * touches stdout/stderr/process.exit — commands stay pure Effect values.
 */
export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export const ok = (stdout: string): CliResult => ({ stdout, stderr: "", exitCode: 0 });

export const expectedFailure = (stderr: string): CliResult => ({
  stdout: "",
  stderr,
  exitCode: 1,
});

export const usageError = (stderr: string): CliResult => ({
  stdout: "",
  stderr,
  exitCode: 2,
});
