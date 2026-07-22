import { describe, expect, it, vi } from 'vitest';
import { createMqttConnector } from '../src/home/adapters/mqtt.mjs';

function fakeClient() {
  const listeners = {};
  return {
    on: vi.fn((event, handler) => { (listeners[event] ??= []).push(handler); }),
    subscribe: vi.fn(),
    publish: vi.fn((topic, payload, options, callback) => callback(null)),
    end: vi.fn(),
    emitMessage(topic, payload, packet) { (listeners.message ?? []).forEach((handler) => handler(topic, Buffer.from(payload), packet)); },
  };
}

const PRISE_SCHEMA = Object.freeze({
  deviceId: 'prise-salon', publishTopic: 'mina/prise-salon/set', stateTopic: 'mina/prise-salon/state',
  actions: ['turn_on', 'turn_off'],
  buildPayload: (action) => ({ power: action === 'turn_on' }),
  parseState: (buffer) => ({ on: JSON.parse(buffer.toString()).power === true }),
});

describe('MQTT connector: TLS and credentials required except for a localhost test broker', () => {
  it('rejects a non-TLS broker that is not localhost', () => {
    expect(() => createMqttConnector({ brokerUrl: 'mqtt://broker.example.test:1883', clientFactory: vi.fn(), schemas: [PRISE_SCHEMA] }))
      .toThrow('mqtt_tls_required');
  });

  it('accepts an explicit localhost broker without TLS for local testing only', () => {
    expect(() => createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: vi.fn(), schemas: [PRISE_SCHEMA] })).not.toThrow();
  });

  it('requires dedicated restricted credentials for a real TLS broker', () => {
    expect(() => createMqttConnector({ brokerUrl: 'mqtts://broker.example.test:8883', clientFactory: vi.fn(), schemas: [PRISE_SCHEMA] }))
      .toThrow('mqtt_credentials_required');
  });
});

describe('MQTT connector: schema-allowlisted topics only', () => {
  it('rejects a device schema containing a wildcard topic', () => {
    expect(() => createMqttConnector({
      brokerUrl: 'mqtt://localhost:1883', clientFactory: vi.fn(),
      schemas: [{ ...PRISE_SCHEMA, stateTopic: 'mina/+/state' }],
    })).toThrow('mqtt_device_schema_invalid');
  });

  it('subscribes only to the exact state topics declared by device schemas, never a wildcard', () => {
    const client = fakeClient();
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA] });
    connector.execute({ deviceId: 'prise-salon' }, { action: 'turn_on', desiredState: { on: true } });
    expect(client.subscribe).toHaveBeenCalledWith('mina/prise-salon/state');
  });
});

describe('MQTT connector: publish, ack timeout, and mapped actions', () => {
  it('publishes the exact schema-built payload and resolves once the broker acks', async () => {
    const client = fakeClient();
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA] });
    await expect(connector.execute({ deviceId: 'prise-salon' }, { action: 'turn_on', desiredState: { on: true } }))
      .resolves.toEqual({ accepted: true });
    expect(client.publish).toHaveBeenCalledWith('mina/prise-salon/set', JSON.stringify({ power: true }), { qos: 1 }, expect.any(Function));
  });

  it('rejects with a timeout error when the broker never acknowledges the publish', async () => {
    const client = fakeClient();
    client.publish = vi.fn(); // never invokes the callback
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA], ackTimeoutMs: 20 });
    await expect(connector.execute({ deviceId: 'prise-salon' }, { action: 'turn_on', desiredState: { on: true } }))
      .rejects.toThrow('mqtt_publish_ack_timeout');
  });

  it('rejects an action with no mapping in the device schema', async () => {
    const client = fakeClient();
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA] });
    await expect(connector.execute({ deviceId: 'prise-salon' }, { action: 'set_brightness', desiredState: { brightness: 10 } }))
      .rejects.toThrow('mqtt_action_unmapped');
  });
});

describe('MQTT connector: retained state, staleness, and duplicate QoS redelivery', () => {
  it('parses a retained state message and reports it fresh', async () => {
    let now = 1_000;
    const client = fakeClient();
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA], now: () => now });
    connector.health();
    client.emitMessage('mina/prise-salon/state', JSON.stringify({ power: true }), { dup: false });
    await expect(connector.readState({ deviceId: 'prise-salon' })).resolves.toEqual({ on: true, stale: false });
  });

  it('marks a retained state as stale once it exceeds the freshness window', async () => {
    let now = 1_000;
    const client = fakeClient();
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA], now: () => now });
    connector.health();
    client.emitMessage('mina/prise-salon/state', JSON.stringify({ power: true }), { dup: false });
    now += 40_000;
    await expect(connector.readState({ deviceId: 'prise-salon' })).resolves.toMatchObject({ stale: true });
  });

  it('ignores a duplicate QoS redelivery instead of double-processing it', async () => {
    const client = fakeClient();
    const connector = createMqttConnector({ brokerUrl: 'mqtt://localhost:1883', clientFactory: () => client, schemas: [PRISE_SCHEMA] });
    connector.health();
    client.emitMessage('mina/prise-salon/state', JSON.stringify({ power: true }), { dup: false });
    client.emitMessage('mina/prise-salon/state', JSON.stringify({ power: false }), { dup: true });
    await expect(connector.readState({ deviceId: 'prise-salon' })).resolves.toMatchObject({ on: true });
  });
});
