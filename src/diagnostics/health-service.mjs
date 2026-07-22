const OPTIONAL_PROBES = new Set(['firebase']);
const SECRET_LIKE = /api[_-]?key|token|secret|password/iu;

function redact(value) {
  if (typeof value === 'string' && SECRET_LIKE.test(value)) return '[redacted]';
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_LIKE.test(key) ? '[redacted]' : redact(item)]));
  }
  return value;
}

export function createHealthService({ probes = {} } = {}) {
  const entries = Object.entries(probes);

  async function runOnce() {
    const report = {};
    for (const [name, probe] of entries) {
      try {
        report[name] = redact(await probe());
      } catch (error) {
        report[name] = { ready: false, reason: String(error?.message ?? 'probe_failed').slice(0, 200) };
      }
    }
    const notReady = entries
      .map(([name]) => name)
      .filter((name) => !OPTIONAL_PROBES.has(name) && report[name]?.ready !== true);
    report.summary = Object.freeze({ allRequiredReady: notReady.length === 0, notReady: Object.freeze(notReady) });
    return Object.freeze(report);
  }

  return Object.freeze({ runOnce });
}
