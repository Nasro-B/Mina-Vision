// Exécuteur de commandes unique du domaine code : execFile (jamais de shell → zéro injection),
// timeout borné, sortie bornée. Toutes les intégrations externes (git, tests, lint, format)
// passent par cette interface — injectable dans les tests.

import { execFile } from 'node:child_process';

const MAX_OUTPUT_BYTES = 4_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;

export function createCommandRunner({ execFileImpl = execFile } = {}) {
  return Object.freeze({
    run(command, args = [], { cwd, timeout = DEFAULT_TIMEOUT_MS, env } = {}) {
      if (typeof command !== 'string' || command.length === 0) {
        return Promise.reject(new Error('command_runner_command_required'));
      }
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        return Promise.reject(new Error('command_runner_args_invalid'));
      }
      const boundedTimeout = Math.min(Math.max(1_000, Number(timeout) || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);
      return new Promise((resolve) => {
        execFileImpl(command, args, {
          cwd,
          timeout: boundedTimeout,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          ...(env ? { env } : {}),
        }, (error, stdout, stderr) => {
          resolve(Object.freeze({
            code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            timedOut: error?.killed === true,
            ...(error && !Number.isInteger(error.code) ? { error: String(error.message ?? error) } : {}),
          }));
        });
      });
    },
  });
}
