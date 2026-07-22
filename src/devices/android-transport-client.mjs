const QUEUES = Object.freeze(['control', 'message', 'media']);
const TRANSPORT_ORDER = Object.freeze({ usb: 0, lan: 1, firebase: 2 });
const ID = /^[A-Za-z0-9._:-]{1,160}$/u;

export function createAndroidTransportClient({
  verifyPeer,
  mode = 'auto',
  capacities = { control: 100, message: 500, media: 8 },
} = {}) {
  if (typeof verifyPeer !== 'function' || !['auto', 'local-first', 'local-only', 'offline'].includes(mode)
    || QUEUES.some((queue) => !Number.isSafeInteger(capacities[queue]) || capacities[queue] < 1)) {
    throw new TypeError('android_transport_client_dependencies_required');
  }
  const endpoints = new Map();
  const queues = Object.fromEntries(QUEUES.map((queue) => [queue, []]));
  const delivered = new Set();
  let pairedDeviceId = null;
  let pumping = false;

  async function connect({ endpoint, proof } = {}) {
    if (!endpoint || !ID.test(endpoint.endpointId ?? '') || !['usb', 'lan', 'firebase'].includes(endpoint.type)
      || typeof endpoint.send !== 'function') throw new TypeError('android_endpoint_invalid');
    if (mode === 'offline' && endpoint.type !== 'usb') throw new Error(`android_transport_disabled:${endpoint.type}`);
    if (mode === 'local-only' && endpoint.type === 'firebase') throw new Error('android_transport_disabled:firebase');
    if (await verifyPeer(proof, endpoint) !== true || !ID.test(proof?.deviceId ?? '')) throw new Error('android_peer_untrusted');
    if (pairedDeviceId !== null && pairedDeviceId !== proof.deviceId) throw new Error('android_peer_identity_conflict');
    pairedDeviceId = proof.deviceId;
    endpoints.set(endpoint.endpointId, { ...endpoint, healthy: true });
    return Object.freeze({ connected: true, endpointId: endpoint.endpointId, deviceId: pairedDeviceId });
  }

  function availableEndpoints() {
    return [...endpoints.values()]
      .filter((endpoint) => endpoint.healthy && !(mode === 'offline' && endpoint.type !== 'usb')
        && !(mode === 'local-only' && endpoint.type === 'firebase'))
      .sort((left, right) => TRANSPORT_ORDER[left.type] - TRANSPORT_ORDER[right.type]
        || left.endpointId.localeCompare(right.endpointId));
  }

  async function deliver(task) {
    if (task.signal?.aborted) throw new Error('android_transport_canceled');
    const candidates = availableEndpoints();
    if (!candidates.length) throw new Error('android_transport_unavailable');
    let lastError;
    for (const endpoint of candidates) {
      if (task.signal?.aborted) throw new Error('android_transport_canceled');
      try {
        const receipt = await endpoint.send(task.envelope, { queue: task.queue, signal: task.signal });
        if (receipt?.accepted !== true || receipt.envelopeId !== task.envelope.id) {
          throw new Error('android_transport_receipt_invalid');
        }
        delivered.add(task.envelope.id);
        return Object.freeze({ accepted: true, envelopeId: task.envelope.id, transport: endpoint.type, endpointId: endpoint.endpointId });
      } catch (error) {
        endpoint.healthy = false;
        lastError = error;
      }
    }
    throw new Error('android_transport_delivery_failed', { cause: lastError });
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (QUEUES.some((queue) => queues[queue].length)) {
        const queue = QUEUES.find((name) => queues[name].length);
        const task = queues[queue].shift();
        try { task.resolve(await deliver(task)); } catch (error) { task.reject(error); }
      }
    } finally {
      pumping = false;
      if (QUEUES.some((queue) => queues[queue].length)) void pump();
    }
  }

  async function send({ queue, envelope, signal } = {}) {
    if (!QUEUES.includes(queue) || !envelope || !ID.test(envelope.id ?? '')) throw new TypeError('android_transport_request_invalid');
    if (signal?.aborted) throw new Error('android_transport_canceled');
    if (delivered.has(envelope.id)) return Object.freeze({ duplicate: true, envelopeId: envelope.id });
    if (queues[queue].length >= capacities[queue]) throw new Error(`android_transport_backpressure:${queue}`);
    return new Promise((resolve, reject) => {
      queues[queue].push({ queue, envelope: structuredClone(envelope), signal, resolve, reject });
      void pump();
    });
  }

  return Object.freeze({ connect, send });
}
