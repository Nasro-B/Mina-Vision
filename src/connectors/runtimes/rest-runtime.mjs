function allowedHost(url, networkAllowlist) {
  try {
    return networkAllowlist.includes(new URL(url).host);
  } catch {
    return false;
  }
}

function fillTemplate(template, input) {
  return template.replace(/\{(\w+)\}/gu, (_match, key) => {
    const value = input[key];
    if (value === undefined) throw new Error(`connector_input_invalid:missing:${key}`);
    return encodeURIComponent(String(value));
  });
}

export function createRestRuntime({ manifest, endpoints, httpPort, capabilitySchemas } = {}) {
  if (!manifest?.networkAllowlist) throw new TypeError('rest_runtime_manifest_required');
  if (!endpoints) throw new TypeError('rest_runtime_endpoints_required');
  if (!httpPort?.request) throw new TypeError('rest_runtime_http_port_required');
  if (!capabilitySchemas) throw new TypeError('rest_runtime_capability_schemas_required');

  function endpointFor(capability) {
    const endpoint = endpoints[capability];
    if (!endpoint) throw new Error(`connector_capability_unknown:${capability}`);
    return endpoint;
  }

  function validateInput(capability, input) {
    const schema = capabilitySchemas[capability]?.input;
    if (!schema) return input;
    const result = schema.safeParse(input);
    if (!result.success) throw new Error('connector_input_invalid');
    return result.data;
  }

  function buildRequest(capability, input) {
    const endpoint = endpointFor(capability);
    const validated = validateInput(capability, input);
    const url = fillTemplate(endpoint.urlTemplate, validated);
    if (!allowedHost(url, manifest.networkAllowlist)) throw new Error('connector_host_not_allowlisted');
    return { endpoint, url, method: endpoint.method ?? 'GET' };
  }

  return Object.freeze({
    async health() {
      return Object.freeze({ available: true });
    },

    async simulate({ capability, input }) {
      const { endpoint, url, method } = buildRequest(capability, input);
      return Object.freeze({ wouldCall: { url, method }, effect: endpoint.effect, simulated: true });
    },

    async invoke({ capability, input, signal }) {
      const { url, method } = buildRequest(capability, input);
      const response = await httpPort.request({ url, method, signal });
      return Object.freeze({ output: response?.body, trusted: false, untrustedReason: 'external_connector_output' });
    },

    async verify({ capability, output }) {
      const schema = capabilitySchemas[capability]?.output;
      if (!schema) return Object.freeze({ verified: false, reason: 'no_output_schema' });
      const result = schema.safeParse(output);
      return Object.freeze({ verified: result.success, reason: result.success ? null : 'connector_output_invalid' });
    },
  });
}
