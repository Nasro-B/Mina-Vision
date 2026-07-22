import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { createConnectorRegistry } from '../src/connectors/connector-registry.mjs';
import { createRestRuntime } from '../src/connectors/runtimes/rest-runtime.mjs';
import { createMqttRuntime } from '../src/connectors/runtimes/mqtt-runtime.mjs';
import { createLocalAdapterRuntime } from '../src/connectors/runtimes/local-adapter-runtime.mjs';

const manifest = Object.freeze({ connectorId: 'nas-reader', networkAllowlist: ['nas.local', 'nas2.local'] });

const capabilitySchemas = Object.freeze({
  'nas.read': {
    input: z.strictObject({ path: z.string().min(1).max(300).refine((value) => !value.includes('..'), 'path_traversal_forbidden') }),
    output: z.strictObject({ content: z.string() }),
  },
  'nas.write': {
    input: z.strictObject({ path: z.string().min(1).max(300), content: z.string() }),
    output: z.strictObject({ ok: z.boolean() }),
  },
});

function fakeHttpPort() {
  const calls = [];
  return { calls, request: vi.fn(async (call) => { calls.push(call); return { body: { content: 'ok' } }; }) };
}

describe('createConnectorRegistry: exact plan example (input validation + host allowlist)', () => {
  it('rejects a path-traversal input before ever calling the transport, and only ever calls allowlisted hosts', async () => {
    const http = fakeHttpPort();
    const restRuntime = createRestRuntime({
      manifest, endpoints: { 'nas.read': { urlTemplate: 'https://nas.local/files?path={path}', method: 'GET', effect: 'read' } },
      httpPort: http, capabilitySchemas,
    });
    const registry = createConnectorRegistry({ clock: () => 0 });
    registry.register({ connectorId: 'nas-reader', manifest, runtime: restRuntime });

    await expect(registry.invoke({ connectorId: 'nas-reader', capability: 'nas.read', input: { path: '../secret' } }))
      .rejects.toThrow('connector_input_invalid');
    expect(http.request).not.toHaveBeenCalled();

    await registry.invoke({ connectorId: 'nas-reader', capability: 'nas.read', input: { path: 'report.pdf' } });
    const allowedHosts = new Set(manifest.networkAllowlist);
    expect(http.calls.every((call) => allowedHosts.has(new URL(call.url).host))).toBe(true);
  });
});

describe('createConnectorRegistry: constructor and registration guards', () => {
  it('requires a clock', () => {
    expect(() => createConnectorRegistry({})).toThrow('connector_registry_clock_required');
  });

  it('rejects registering a runtime missing a required method', () => {
    const registry = createConnectorRegistry({ clock: () => 0 });
    expect(() => registry.register({ connectorId: 'x', manifest, runtime: { health: vi.fn() } })).toThrow('connector_runtime_invalid');
  });

  it('rejects invoking an unregistered connector', async () => {
    const registry = createConnectorRegistry({ clock: () => 0 });
    await expect(registry.invoke({ connectorId: 'missing', capability: 'nas.read', input: {} })).rejects.toThrow('connector_not_registered');
  });
});

describe('createRestRuntime: never calls a host outside the manifest allowlist', () => {
  it('rejects a URL template that would resolve to a non-allowlisted host', async () => {
    const http = fakeHttpPort();
    const runtime = createRestRuntime({
      manifest, endpoints: { 'nas.read': { urlTemplate: 'https://evil.example/{path}', method: 'GET', effect: 'read' } },
      httpPort: http, capabilitySchemas,
    });
    await expect(runtime.invoke({ capability: 'nas.read', input: { path: 'x' } })).rejects.toThrow('connector_host_not_allowlisted');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('marks invoke output as untrusted', async () => {
    const http = fakeHttpPort();
    const runtime = createRestRuntime({
      manifest, endpoints: { 'nas.read': { urlTemplate: 'https://nas.local/{path}', method: 'GET', effect: 'read' } },
      httpPort: http, capabilitySchemas,
    });
    const result = await runtime.invoke({ capability: 'nas.read', input: { path: 'x' } });
    expect(result.trusted).toBe(false);
  });
});

describe('createRestRuntime.simulate: never invokes a write endpoint', () => {
  it('never calls the http port during simulate, even for a write-effect endpoint', async () => {
    const http = fakeHttpPort();
    const runtime = createRestRuntime({
      manifest, endpoints: { 'nas.write': { urlTemplate: 'https://nas.local/{path}', method: 'POST', effect: 'write' } },
      httpPort: http, capabilitySchemas,
    });
    const result = await runtime.simulate({ capability: 'nas.write', input: { path: 'x', content: 'y' } });
    expect(http.request).not.toHaveBeenCalled();
    expect(result.simulated).toBe(true);
    expect(result.effect).toBe('write');
  });
});

describe('createRestRuntime.verify: validates output schema, does not silently trust it', () => {
  it('reports verified false for output that does not match the declared schema', async () => {
    const runtime = createRestRuntime({
      manifest, endpoints: { 'nas.read': { urlTemplate: 'https://nas.local/{path}', method: 'GET', effect: 'read' } },
      httpPort: fakeHttpPort(), capabilitySchemas,
    });
    const verdict = await runtime.verify({ capability: 'nas.read', output: { wrongField: 1 } });
    expect(verdict).toEqual({ verified: false, reason: 'connector_output_invalid' });
  });

  it('reports verified true for output matching the declared schema', async () => {
    const runtime = createRestRuntime({
      manifest, endpoints: { 'nas.read': { urlTemplate: 'https://nas.local/{path}', method: 'GET', effect: 'read' } },
      httpPort: fakeHttpPort(), capabilitySchemas,
    });
    const verdict = await runtime.verify({ capability: 'nas.read', output: { content: 'ok' } });
    expect(verdict.verified).toBe(true);
  });
});

describe('createMqttRuntime: broker allowlist and read/write dispatch', () => {
  const mqttManifest = Object.freeze({ connectorId: 'sensor', networkAllowlist: ['mqtt.local'] });
  const mqttSchemas = Object.freeze({ 'sensor.read': { input: z.strictObject({}) } });

  it('rejects a topic whose broker is not allowlisted', async () => {
    const mqttPort = { publish: vi.fn(), subscribe: vi.fn() };
    const runtime = createMqttRuntime({
      manifest: mqttManifest, topics: { 'sensor.read': { broker: 'evil.example', topicTemplate: 'sensors/temp', effect: 'read' } },
      mqttPort, capabilitySchemas: mqttSchemas,
    });
    await expect(runtime.invoke({ capability: 'sensor.read', input: {} })).rejects.toThrow('connector_host_not_allowlisted');
  });

  it('dispatches a read-effect capability to subscribe, not publish', async () => {
    const mqttPort = { publish: vi.fn(), subscribe: vi.fn(async () => ({ temp: 21 })) };
    const runtime = createMqttRuntime({
      manifest: mqttManifest, topics: { 'sensor.read': { broker: 'mqtt.local', topicTemplate: 'sensors/temp', effect: 'read' } },
      mqttPort, capabilitySchemas: mqttSchemas,
    });
    await runtime.invoke({ capability: 'sensor.read', input: {} });
    expect(mqttPort.subscribe).toHaveBeenCalledTimes(1);
    expect(mqttPort.publish).not.toHaveBeenCalled();
  });
});

describe('createLocalAdapterRuntime: filtered handles only, never raw keyring/fs/electron/ipc', () => {
  const localManifest = Object.freeze({ connectorId: 'local-1' });
  const localSchemas = Object.freeze({ 'local.read': { input: z.strictObject({}) } });

  it('passes only the filtered bundle to the adapter function', async () => {
    const secretHandleFactory = vi.fn(() => ({ get: vi.fn() }));
    const tempDirHandleFactory = vi.fn(() => ({ path: '/tmp/x' }));
    const transport = { fetch: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const adapterFunction = vi.fn(async (bundle) => {
      expect(Object.keys(bundle).sort()).toEqual(['capability', 'effectOnly', 'input', 'limits', 'logger', 'secretHandle', 'signal', 'tempDirHandle', 'transport']);
      expect(bundle).not.toHaveProperty('keyring');
      expect(bundle).not.toHaveProperty('fs');
      expect(bundle).not.toHaveProperty('ipcMain');
      return { ok: true };
    });
    const runtime = createLocalAdapterRuntime({
      manifest: localManifest, adapterFunction, secretHandleFactory, tempDirHandleFactory, transport, logger, capabilitySchemas: localSchemas,
    });
    await runtime.invoke({ capability: 'local.read', input: {} });
    expect(adapterFunction).toHaveBeenCalledTimes(1);
    expect(secretHandleFactory).toHaveBeenCalledWith('local-1');
  });

  it('marks simulate calls with effectOnly:false so the adapter can distinguish a dry run', async () => {
    const adapterFunction = vi.fn(async (bundle) => { expect(bundle.effectOnly).toBe(false); return {}; });
    const runtime = createLocalAdapterRuntime({
      manifest: localManifest, adapterFunction, secretHandleFactory: vi.fn(() => ({})), tempDirHandleFactory: vi.fn(() => ({})),
      transport: {}, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, capabilitySchemas: localSchemas,
    });
    await runtime.simulate({ capability: 'local.read', input: {} });
    expect(adapterFunction).toHaveBeenCalledTimes(1);
  });
});
