const DEFAULT_LIMITS = Object.freeze({ timeoutMs: 10_000, maxOutputBytes: 1_000_000 });

function boundedLogger(logger) {
  return Object.freeze({
    info: (message) => logger.info(String(message).slice(0, 2000)),
    warn: (message) => logger.warn(String(message).slice(0, 2000)),
    error: (message) => logger.error(String(message).slice(0, 2000)),
  });
}

export function createLocalAdapterRuntime({
  manifest, adapterFunction, secretHandleFactory, tempDirHandleFactory, transport, logger, capabilitySchemas,
} = {}) {
  if (!manifest) throw new TypeError('local_adapter_runtime_manifest_required');
  if (typeof adapterFunction !== 'function') throw new TypeError('local_adapter_runtime_adapter_function_required');
  if (!secretHandleFactory || !tempDirHandleFactory) throw new TypeError('local_adapter_runtime_handle_factories_required');
  if (!transport || !logger || !capabilitySchemas) throw new TypeError('local_adapter_runtime_ports_required');

  function validateInput(capability, input) {
    const schema = capabilitySchemas[capability]?.input;
    if (!schema) return input;
    const result = schema.safeParse(input);
    if (!result.success) throw new Error('connector_input_invalid');
    return result.data;
  }

  async function call({ capability, input, signal, effectOnly }) {
    const validated = validateInput(capability, input);
    const bundle = Object.freeze({
      input: validated,
      secretHandle: secretHandleFactory(manifest.connectorId),
      transport,
      tempDirHandle: tempDirHandleFactory(manifest.connectorId),
      signal,
      limits: DEFAULT_LIMITS,
      logger: boundedLogger(logger),
    });
    return adapterFunction({ capability, effectOnly, ...bundle });
  }

  return Object.freeze({
    async health() {
      return Object.freeze({ available: true });
    },

    async simulate({ capability, input, signal }) {
      const output = await call({ capability, input, signal, effectOnly: false });
      return Object.freeze({ wouldReturn: output, simulated: true });
    },

    async invoke({ capability, input, signal }) {
      const output = await call({ capability, input, signal, effectOnly: true });
      return Object.freeze({ output, trusted: false, untrustedReason: 'external_connector_output' });
    },

    async verify({ capability, output }) {
      const schema = capabilitySchemas[capability]?.output;
      if (!schema) return Object.freeze({ verified: false, reason: 'no_output_schema' });
      const result = schema.safeParse(output);
      return Object.freeze({ verified: result.success, reason: result.success ? null : 'connector_output_invalid' });
    },
  });
}
