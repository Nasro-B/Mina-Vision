import { execFileSync } from 'node:child_process';
import 'dotenv/config';

let matches = '';
try {
  matches = execFileSync(
    'git',
    ['grep', '-I', '-h', '-o', '-E', 'AIza[0-9A-Za-z_-]{35}'],
    { encoding: 'utf8' },
  );
} catch (error) {
  if (error.status !== 1) throw error;
}
const candidates = [...new Set(matches.split(/\r?\n/u).filter(Boolean))];
const probes = [];
for (const candidate of candidates) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(candidate)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  let reason = null;
  try {
    const body = await response.json();
    reason = body?.error?.details?.find((detail) => typeof detail?.reason === 'string')?.reason
      ?? body?.error?.status
      ?? null;
  } catch {
    reason = null;
  }
  probes.push({ status: response.status, reason });
}

process.stdout.write(`${JSON.stringify({
  trackedUniqueGoogleKeyCandidates: candidates.length,
  anyCandidateEqualsConfiguredGeminiKey: candidates.some(
    (candidate) => candidate === process.env.GEMINI_API_KEY,
  ),
  probes,
}, null, 2)}\n`);
