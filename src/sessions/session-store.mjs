import { parseSessionEvent } from '../contracts/events.mjs';

export function createSessionStore(initialEvents = []) {
  const events = initialEvents.map((event) => parseSessionEvent(event));

  return Object.freeze({
    append(event) {
      const parsed = parseSessionEvent(event);
      events.push(parsed);
      return parsed;
    },
    list() {
      return Object.freeze([...events]);
    },
  });
}
