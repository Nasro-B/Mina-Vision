import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import istanbulCoverage from 'istanbul-lib-coverage';

const { createCoverageMap } = istanbulCoverage;

const root = resolve('.');
const normalize = (value) => value.replaceAll('\\', '/');
const tracked = new Set(execFileSync(
  'git',
  ['ls-files', 'src/*.mjs', 'src/*.js', 'src/*.cjs'],
  { encoding: 'utf8' },
).trim().split(/\r?\n/u).filter(Boolean).map(normalize));
const raw = JSON.parse(await readFile('coverage/coverage-final.json', 'utf8'));
const allMap = createCoverageMap(raw);
const trackedMap = createCoverageMap({});
const coveredPaths = new Set();
const extra = [];

for (const absolute of allMap.files()) {
  const path = normalize(relative(root, absolute));
  if (tracked.has(path)) {
    coveredPaths.add(path);
    trackedMap.addFileCoverage(allMap.fileCoverageFor(absolute));
  } else if (path.startsWith('src/')) {
    extra.push(path);
  }
}

const missing = [...tracked].filter((path) => !coveredPaths.has(path)).sort();
const compactSummary = (map) => {
  const summary = map.getCoverageSummary();
  return Object.fromEntries(
    ['statements', 'branches', 'functions', 'lines'].map((kind) => [
      kind,
      {
        covered: summary[kind].covered,
        total: summary[kind].total,
        pct: summary[kind].pct,
      },
    ]),
  );
};

process.stdout.write(`${JSON.stringify({
  trackedSourceModules: tracked.size,
  coverageSourceEntries: allMap.files().filter((path) => normalize(relative(root, path)).startsWith('src/')).length,
  instrumentedTrackedModules: coveredPaths.size,
  missingTrackedModules: missing,
  extraUntrackedOrIgnoredModules: extra.sort(),
  trackedOnlySummary: compactSummary(trackedMap),
  reportSummaryIncludingExtraModules: compactSummary(allMap),
}, null, 2)}\n`);
