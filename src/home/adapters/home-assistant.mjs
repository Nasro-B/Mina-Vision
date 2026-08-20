const LOCAL_HTTPS = /^https:\/\/[a-z0-9.-]+(:\d+)?$/iu;
const DEFAULT_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 1_000;

const SERVICE_MAP = Object.freeze({
  light: {
    turn_on: () => ({ service: 'turn_on', data: {} }),
    turn_off: () => ({ service: 'turn_off', data: {} }),
    set_brightness: (desired) => ({ service: 'turn_on', data: { brightness_pct: desired.brightness } }),
    set_color: (desired) => ({ service: 'turn_on', data: { rgb_color: desired.color } }),
  },
  switch: {
    turn_on: () => ({ service: 'turn_on', data: {} }),
    turn_off: () => ({ service: 'turn_off', data: {} }),
  },
  cover: {
    set_position: (desired) => ({ service: 'set_cover_position', data: { position: desired.position } }),
  },
  climate: {
    set_temperature: (desired) => ({ service: 'set_temperature', data: { temperature: desired.temperature } }),
  },
  scene: {
    run_scene: () => ({ service: 'turn_on', data: {} }),
  },
});

function mapServiceCall(domain, action, desiredState) {
  const builder = SERVICE_MAP[domain]?.[action];
  if (!builder) return null;
  return { domain, ...builder(desiredState) };
}

function normalizeObservedState(haState) {
  const state = {};
  if (haState.state === 'on') state.on = true;
  if (haState.state === 'off') state.on = false;
  if (Number.isFinite(haState.attributes?.brightness)) {
    state.brightness = Math.round((haState.attributes.brightness / 255) * 100);
  }
  if (Number.isFinite(haState.attributes?.current_position)) state.position = haState.attributes.current_position;
  if (Number.isFinite(haState.attributes?.temperature)) state.temperature = haState.attributes.temperature;
  return state;
}

export function createHomeAssistantConnector({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  webSocketFactory,
  reconnectDelayMs = RECONNECT_DELAY_MS,
} = {}) {
  if (!LOCAL_HTTPS.test(baseUrl ?? '')) throw new TypeError('home_assistant_base_url_invalid');
  if (typeof token !== 'string' || token.length < 1) throw new TypeError('home_assistant_token_invalid');

  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('home_assistant_request_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    id: 'home-assistant',
    network: 'lan',

    async health() {
      try {
        const response = await request('/api/');
        return Object.freeze({ available: Boolean(response.ok) });
      } catch {
        return Object.freeze({ available: false });
      }
    },

    async discoverEntities() {
      const response = await request('/api/states');
      const states = await response.json();
      return Object.freeze(states
        .map((entry) => Object.freeze({
          entityId: entry.entity_id, domain: entry.entity_id.split('.')[0],
          friendlyName: entry.attributes?.friendly_name ?? entry.entity_id, state: entry.state,
        }))
        .filter((entity) => Object.hasOwn(SERVICE_MAP, entity.domain)));
    },

    supports(binding, action) {
      if (action === 'read_state') return Object.hasOwn(SERVICE_MAP, binding?.domain);
      return Boolean(mapServiceCall(binding?.domain, action, {}));
    },

    async execute(binding, command) {
      const call = mapServiceCall(binding?.domain, command?.action, command?.desiredState ?? {});
      if (!call) throw new Error('home_assistant_action_unmapped');
      const response = await request(`/api/services/${call.domain}/${call.service}`, {
        method: 'POST',
        body: { entity_id: binding.entityId, ...call.data },
      });
      return Object.freeze({ accepted: Boolean(response.ok) });
    },

    async readState(binding) {
      const response = await request(`/api/states/${binding.entityId}`);
      const haState = await response.json();
      return Object.freeze(normalizeObservedState(haState));
    },

    subscribeState({ entityId, onUpdate } = {}) {
      if (typeof webSocketFactory !== 'function' || typeof onUpdate !== 'function') {
        throw new TypeError('home_assistant_subscription_dependencies_required');
      }
      let messageId = 1;
      let closedIntentionally = false;

      function connect() {
        const wsUrl = `${baseUrl.replace(/^https:/u, 'wss:')}/api/websocket`;
        const socket = webSocketFactory(wsUrl);
        socket.on('message', (raw) => {
          const message = JSON.parse(String(raw));
          if (message.type === 'auth_required') {
            socket.send(JSON.stringify({ type: 'auth', access_token: token }));
          } else if (message.type === 'auth_ok') {
            socket.send(JSON.stringify({ id: messageId++, type: 'subscribe_events', event_type: 'state_changed' }));
          } else if (message.type === 'event' && message.event?.event_type === 'state_changed'
            && message.event.data?.entity_id === entityId) {
            onUpdate(normalizeObservedState(message.event.data.new_state));
          }
        });
        socket.on('close', () => {
          if (!closedIntentionally) setTimeout(connect, reconnectDelayMs);
        });
        return socket;
      }

      let current = connect();
      return Object.freeze({
        stop: () => {
          closedIntentionally = true;
          current.close();
        },
      });
    },
  });
}
