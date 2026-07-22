function isWithinScope(path, allowedPaths) {
  const normalized = String(path ?? '').replaceAll('\\', '/');
  return allowedPaths.some((allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`));
}

export function createConnectorWorkerBroker({ manifest, limits, keyring = null } = {}) {
  if (!manifest) throw new TypeError('connector_worker_manifest_required');
  if (!Number.isSafeInteger(limits?.maxOutputBytes) || limits.maxOutputBytes < 1) {
    throw new TypeError('connector_worker_output_limit_required');
  }
  const allowedPaths = Object.freeze([...(manifest.allowedPaths ?? [])]);
  const allowedEndpoints = new Set(manifest.networkAllowlist ?? []);
  let outputBytes = 0;

  return Object.freeze({
    readFile(path) {
      if (!isWithinScope(path, allowedPaths)) throw new Error('connector_scope_violation');
      // Real file access happens host-side only after this scope check; never a raw fs handle
      // reaches the sandboxed code itself.
      return Object.freeze({ path, scoped: true });
    },

    callEndpoint(host) {
      if (!allowedEndpoints.has(host)) throw new Error('connector_scope_violation');
      return Object.freeze({ host, scoped: true });
    },

    getSecret(name) {
      if (!keyring) throw new Error('connector_scope_violation');
      // Deliberately never exposes keyring.get directly to the sandboxed side; only a named,
      // pre-declared secret handle can be resolved, and only host-side.
      return keyring.resolveConnectorSecret?.(name) ?? null;
    },

    writeOutput(chunk) {
      const size = Buffer.byteLength(String(chunk ?? ''), 'utf8');
      outputBytes += size;
      if (outputBytes > limits.maxOutputBytes) throw new Error('connector_output_limit');
      return Object.freeze({ accepted: true, totalBytes: outputBytes });
    },
  });
}
