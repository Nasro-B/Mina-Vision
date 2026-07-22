const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const TOPIC = /^[A-Za-z0-9/_-]{1,200}$/u;

export function validateMqttDeviceSchema(schema) {
  if (!ID.test(schema?.deviceId ?? '') || !TOPIC.test(schema?.publishTopic ?? '') || !TOPIC.test(schema?.stateTopic ?? '')
    || typeof schema.buildPayload !== 'function' || typeof schema.parseState !== 'function'
    || !Array.isArray(schema.actions) || schema.actions.length < 1) {
    throw new TypeError('mqtt_device_schema_invalid');
  }
  return Object.freeze({ ...schema, actions: Object.freeze([...schema.actions]) });
}
