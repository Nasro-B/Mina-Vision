import { classifyAdbEndpoint } from './android-transport.mjs';

export function parseAuthorizedAdbTransports(stdout) {
  const transports = new Set();
  for (const rawLine of String(stdout).split(/\r?\n/u).slice(1)) {
    const [serial, status] = rawLine.trim().split(/\s+/u);
    if (status === 'device') transports.add(classifyAdbEndpoint(serial));
  }
  return Object.freeze([...transports]);
}
