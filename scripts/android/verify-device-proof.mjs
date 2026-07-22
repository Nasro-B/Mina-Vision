import { pathToFileURL } from 'node:url';
import { verifyDeviceProof } from '../../src/devices/device-identity-proof.mjs';

export { verifyDeviceProof };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const proof = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!verifyDeviceProof(proof)) process.exitCode = 2;
  else process.stdout.write('verified\n');
}
