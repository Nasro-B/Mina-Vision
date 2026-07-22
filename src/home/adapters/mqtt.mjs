import { validateMqttDeviceSchema } from '../mqtt-device-schema.mjs';

const LOCALHOST = new Set(['localhost', '127.0.0.1']);
const DEFAULT_ACK_TIMEOUT_MS = 3_000;
const STALE_AFTER_MS = 30_000;

export function createMqttConnector({
  brokerUrl,
  username,
  password,
  clientFactory,
  schemas = [],
  ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  let url;
  try {
    url = new URL(brokerUrl ?? '');
  } catch {
    throw new TypeError('mqtt_broker_url_invalid');
  }
  const isLocalTestBroker = LOCALHOST.has(url.hostname);
  if (url.protocol !== 'mqtts:' && !isLocalTestBroker) throw new TypeError('mqtt_tls_required');
  if (!isLocalTestBroker && (typeof username !== 'string' || !username || typeof password !== 'string' || !password)) {
    throw new TypeError('mqtt_credentials_required');
  }
  if (typeof clientFactory !== 'function') throw new TypeError('mqtt_client_factory_required');

  const bySchema = new Map(schemas.map((schema) => {
    const validated = validateMqttDeviceSchema(schema);
    return [validated.deviceId, validated];
  }));
  const latestState = new Map();

  let client = null;
  function ensureClient() {
    if (client) return client;
    client = clientFactory({ url: brokerUrl, username, password, rejectUnauthorized: true });
    client.on('message', (topic, payload, packet) => {
      if (packet?.dup) return;
      for (const schema of bySchema.values()) {
        if (schema.stateTopic === topic) {
          latestState.set(schema.deviceId, { state: schema.parseState(payload), receivedAt: now() });
        }
      }
    });
    for (const schema of bySchema.values()) client.subscribe(schema.stateTopic);
    return client;
  }

  return Object.freeze({
    id: 'mqtt',
    network: 'lan',

    health: () => Object.freeze({ available: Boolean(ensureClient()) }),

    supports(binding, action) {
      return Boolean(bySchema.get(binding?.deviceId)?.actions.includes(action));
    },

    async execute(binding, command) {
      const schema = bySchema.get(binding?.deviceId);
      if (!schema || !schema.actions.includes(command?.action)) throw new Error('mqtt_action_unmapped');
      const activeClient = ensureClient();
      const payload = JSON.stringify(schema.buildPayload(command.action, command.desiredState ?? {}));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('mqtt_publish_ack_timeout')), ackTimeoutMs);
        activeClient.publish(schema.publishTopic, payload, { qos: 1 }, (error) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve();
        });
      });
      return Object.freeze({ accepted: true });
    },

    async readState(binding) {
      const schema = bySchema.get(binding?.deviceId);
      if (!schema) throw new Error('mqtt_device_unknown');
      ensureClient();
      const entry = latestState.get(schema.deviceId);
      if (!entry) return Object.freeze({ stale: true });
      return Object.freeze({ ...entry.state, stale: now() - entry.receivedAt > STALE_AFTER_MS });
    },
  });
}
