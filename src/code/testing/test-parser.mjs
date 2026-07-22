// Parseur de sorties de tests : comprend les résumés texte de vitest et jest, extrait compteurs,
// durée et fichiers en échec. Sortie inconnue → résultat nominé, jamais d'exception.

const VITEST_TESTS = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/u;
const VITEST_FILES = /Test Files\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:[^(]*)\((\d+)\)/u;
const VITEST_DURATION = /Duration\s+([\d.]+)(m?s)/u;
const JEST_TESTS = /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s+(\d+)\s+total/u;
const MOCHA_TESTS = /(\d+)\s+passing(?:[\s\S]*?(\d+)\s+failing)?/u;

export function parseTestOutput(output, { framework = 'vitest' } = {}) {
  const text = String(output ?? '');
  const failures = [];
  for (const match of text.matchAll(/(?:FAIL|✕|×)\s+([^\s].*)/gu)) {
    failures.push(match[1].trim().slice(0, 300));
  }

  if (framework === 'vitest') {
    const tests = text.match(VITEST_TESTS);
    if (tests) {
      const files = text.match(VITEST_FILES);
      const duration = text.match(VITEST_DURATION);
      return Object.freeze({
        framework,
        parsed: true,
        failed: Number(tests[1] ?? 0),
        passed: Number(tests[2]),
        skipped: Number(tests[3] ?? 0),
        total: Number(tests[4]),
        files: files ? Object.freeze({ failed: Number(files[1] ?? 0), passed: Number(files[2]), total: Number(files[3]) }) : null,
        duration: duration ? (duration[2] === 'ms' ? Number(duration[1]) : Number(duration[1]) * 1_000) : null,
        failures: Object.freeze(failures),
      });
    }
  }
  if (framework === 'jest') {
    const tests = text.match(JEST_TESTS);
    if (tests) {
      return Object.freeze({
        framework,
        parsed: true,
        failed: Number(tests[1] ?? 0),
        skipped: Number(tests[2] ?? 0),
        passed: Number(tests[3]),
        total: Number(tests[4]),
        files: null,
        duration: null,
        failures: Object.freeze(failures),
      });
    }
  }
  if (framework === 'mocha') {
    const tests = text.match(MOCHA_TESTS);
    if (tests) {
      const passed = Number(tests[1]);
      const failed = Number(tests[2] ?? 0);
      return Object.freeze({
        framework, parsed: true, passed, failed, skipped: 0, total: passed + failed, files: null, duration: null, failures: Object.freeze(failures),
      });
    }
  }
  return Object.freeze({
    framework,
    parsed: false,
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    files: null,
    duration: null,
    failures: Object.freeze(failures),
    reason: 'test_output_unrecognized',
  });
}
