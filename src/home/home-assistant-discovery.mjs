const HOME_ASSISTANT_CAPABILITIES = Object.freeze({
  light: Object.freeze(['read_state', 'turn_on', 'turn_off', 'set_brightness', 'set_color']),
  switch: Object.freeze(['read_state', 'turn_on', 'turn_off']),
  cover: Object.freeze(['read_state', 'set_position']),
  climate: Object.freeze(['read_state', 'set_temperature']),
  scene: Object.freeze(['run_scene']),
});

const HOME_ASSISTANT_RISK = Object.freeze({
  light: 'low',
  switch: 'medium',
  cover: 'medium',
  climate: 'medium',
  scene: 'low',
});

const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/u;

function normalizeDomain(entity) {
  return String(entity?.domain ?? entity?.entityId?.split('.')[0] ?? '').trim().toLocaleLowerCase('fr-FR');
}

export function devicesFromHomeAssistantEntities(entities = []) {
  return Object.freeze(entities.flatMap((entity) => {
    const entityId = String(entity?.entityId ?? '').trim();
    const domain = normalizeDomain(entity);
    const capabilities = HOME_ASSISTANT_CAPABILITIES[domain];
    if (!ENTITY_ID.test(entityId) || !capabilities) return [];
    const displayName = String(entity?.friendlyName ?? entityId).trim() || entityId;
    return Object.freeze({
      deviceId: `ha:${entityId}`,
      displayName,
      aliases: Object.freeze([entityId]),
      roomId: null,
      roomName: null,
      deviceClass: domain,
      capabilities: Object.freeze([...capabilities]),
      bindings: Object.freeze([Object.freeze({
        connectorId: 'home-assistant',
        bindingId: entityId,
        entityId,
        domain,
        capabilities: Object.freeze([...capabilities]),
      })]),
      riskTier: HOME_ASSISTANT_RISK[domain],
      confirmationPolicy: 'risk_based',
      enabled: true,
    });
  }));
}
