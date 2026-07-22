// Analyseur de couverture : lit le coverage-summary.json (format istanbul/v8 produit par
// `vitest run --coverage`) et rapporte totaux, fichiers sous le seuil et non couverts.

export function createCoverageAnalyzer({ fs, projectRoot } = {}) {
  if (!fs || typeof fs.readFile !== 'function') throw new TypeError('coverage_analyzer_fs_required');
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) throw new TypeError('coverage_analyzer_root_required');

  const summaryPath = `${projectRoot.replace(/[\\/]+$/u, '')}/coverage/coverage-summary.json`;

  async function load() {
    let raw;
    try {
      raw = String(await fs.readFile(summaryPath, 'utf8'));
    } catch {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const pct = (metrics, key) => Number(metrics?.[key]?.pct ?? 0);

  async function report({ threshold = 80 } = {}) {
    const summary = await load();
    if (!summary) {
      return Object.freeze({
        available: false,
        reason: 'coverage_report_missing: lancer les tests avec --coverage d\'abord',
      });
    }
    const files = [];
    for (const [file, metrics] of Object.entries(summary)) {
      if (file === 'total') continue;
      files.push(Object.freeze({
        file: file.replace(/\\/gu, '/').replace(`${projectRoot.replace(/\\/gu, '/')}/`, ''),
        lines: pct(metrics, 'lines'),
        branches: pct(metrics, 'branches'),
        functions: pct(metrics, 'functions'),
        statements: pct(metrics, 'statements'),
      }));
    }
    const total = summary.total ?? {};
    const belowThreshold = files.filter((entry) => entry.lines < threshold);
    return Object.freeze({
      available: true,
      total: Object.freeze({
        lines: pct(total, 'lines'),
        branches: pct(total, 'branches'),
        functions: pct(total, 'functions'),
        statements: pct(total, 'statements'),
      }),
      threshold,
      files: Object.freeze(files),
      belowThreshold: Object.freeze(belowThreshold),
      meetsThreshold: pct(total, 'lines') >= threshold,
    });
  }

  async function findUncovered() {
    const result = await report({ threshold: 100 });
    if (!result.available) return result;
    return Object.freeze(result.files.filter((entry) => entry.lines === 0));
  }

  return Object.freeze({ report, findUncovered });
}
