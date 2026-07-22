function fillTopic(template, input) {
  return template.replace(/\{(\w+)\}/gu, (_match, key) => {
    const value = input[key];
    if (value === undefined) throw new Error(`connector_input_invalid:missing:${key}`);
    return String(value);
  });
}

export function createMqttRuntime({ manifest, topics, mqttPort, capabilitySchemas } = {}) {
  if (!manifest?.networkAllowlist) throw new TypeError('mqtt_runtime_manifest_required');
  if (!topics) throw new TypeError('mqtt_runtime_topics_required');
  if (!mqttPort?.publish || !mqttPort?.subscribe) throw new TypeError('mqtt_runtime_mqtt_port_required');
  if (!capabilitySchemas) throw new TypeError('mqtt_runtime_capability_schemas_required');

  function topicFor(capability) {
    const topic = topics[capability];
    if (!topic) throw new Error(`connector_capability_unknown:${capability}`);
    return topic;
  }

  function validateInput(capability, input) {
    const schema = capabilitySchemas[capability]?.input;
    if (!schema) return input;
    const result = schema.safeParse(input);
    if (!result.success) throw new Error('connector_input_invalid');
    return result.data;
  }

  function buildMessage(capability, input) {
    const topic = topicFor(capability);
    const validated = validateInput(capability, input);
    if (!manifest.networkAllowlist.includes(topic.broker)) throw new Error('connector_host_not_allowlisted');
    return { topic, resolvedTopic: fillTemplate(topic.topicTemplate, validated), payload: validated };
  }

  function fillTemplate(template, input) {
    return fillTopic(template, input);
  }

  return Object.freeze({
    async health() {
      return Object.freeze({ available: true });
    },

    async simulate({ capability, input }) {
      const { topic, resolvedTopic, payload } = buildMessage(capability, input);
      return Object.freeze({ wouldPublish: { topic: resolvedTopic, payload }, effect: topic.effect, simulated: true });
    },

    async invoke({ capability, input, signal }) {
      const { topic, resolvedTopic, payload } = buildMessage(capability, input);
      if (topic.effect === 'read') {
        const message = await mqttPort.subscribe({ topic: resolvedTopic, signal });
        return Object.freeze({ output: message, trusted: false, untrustedReason: 'external_connector_output' });
      }
      const receipt = await mqttPort.publish({ topic: resolvedTopic, payload, signal });
      return Object.freeze({ output: receipt, trusted: false, untrustedReason: 'external_connector_output' });
    },

    async verify({ capability, output }) {
      const schema = capabilitySchemas[capability]?.output;
      if (!schema) return Object.freeze({ verified: false, reason: 'no_output_schema' });
      const result = schema.safeParse(output);
      return Object.freeze({ verified: result.success, reason: result.success ? null : 'connector_output_invalid' });
    },
  });
}
