import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installModelManifest } from '../src/models/model-installer.mjs';

const manifestFlag = process.argv.indexOf('--manifest');
if (manifestFlag < 0 || !process.argv[manifestFlag + 1]) {
  process.stderr.write('Usage: npm run models:install -- --manifest C:\\path\\model-manifest.json\n');
  process.exitCode = 2;
} else {
  const manifestPath = resolve(process.argv[manifestFlag + 1]);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const result = await installModelManifest({ manifest, authorized: true, networkEnabled: true });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
