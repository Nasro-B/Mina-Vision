function localParts(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(epochMs).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function isDueDaily(now, trigger) {
  const local = localParts(now, trigger.timezone);
  const dueMinutesOfDay = trigger.hour * 60 + trigger.minute;
  const nowMinutesOfDay = local.hour * 60 + local.minute;
  return Object.freeze({ due: nowMinutesOfDay >= dueMinutesOfDay, slot: local.date });
}

function fillValues(valueSchema, eventData) {
  const filled = {};
  for (const [key, type] of Object.entries(valueSchema)) {
    const value = eventData?.[key];
    if (value === undefined) continue;
    // eslint-disable-next-line valid-typeof
    if (typeof value !== type) continue;
    filled[key] = value;
  }
  return filled;
}

export function compileToAutomation(routine, { eventData } = {}) {
  return Object.freeze(routine.steps.map((step) => Object.freeze({
    domain: step.domain,
    operation: step.operation,
    capability: step.capability,
    ...step.fixedValues,
    ...fillValues(step.valueSchema, eventData),
  })));
}

export function createRoutineScheduler({ registry, automationStore, clock } = {}) {
  if (!registry?.listRoutines) throw new TypeError('routine_scheduler_registry_required');
  if (!automationStore?.create) throw new TypeError('routine_scheduler_automation_store_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('routine_scheduler_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const firedSlots = new Set();

  async function fire(routine, slot, eventData) {
    const idempotencyKey = `${routine.routineId}:${slot}:${routine.version}`;
    if (firedSlots.has(idempotencyKey)) return null;
    firedSlots.add(idempotencyKey);
    const actions = compileToAutomation(routine, { eventData });
    return automationStore.create(actions, { idempotencyKey });
  }

  return Object.freeze({
    async tick(atMs = now()) {
      const routines = await registry.listRoutines();
      const results = [];
      for (const routine of routines) {
        if (routine.status !== 'active' || routine.trigger.type !== 'schedule') continue;
        const { due, slot } = isDueDaily(atMs, routine.trigger);
        if (!due) continue;
        // eslint-disable-next-line no-await-in-loop
        const result = await fire(routine, slot);
        if (result) results.push(result);
      }
      return Object.freeze(results);
    },

    async handleEvent(event) {
      const routines = await registry.listRoutines();
      const results = [];
      for (const routine of routines) {
        if (routine.status !== 'active' || routine.trigger.type !== 'event') continue;
        if (routine.trigger.eventType !== event.type) continue;
        const slot = event.eventId ?? `evt:${now()}`;
        // eslint-disable-next-line no-await-in-loop
        const result = await fire(routine, slot, event.data);
        if (result) results.push(result);
      }
      return Object.freeze(results);
    },
  });
}
