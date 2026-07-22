const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function dayWindow(asOfMs) {
  const start = new Date(asOfMs);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function bucket(item, asOfMs, items, staleItems) {
  const age = asOfMs - Date.parse(item.observedAt);
  if (Number.isFinite(age) && age > STALE_AFTER_MS) {
    staleItems.push(Object.freeze({ ...item, label: `Dernière donnée : ${item.observedAt}` }));
  } else {
    items.push(Object.freeze(item));
  }
}

export function createDailyBriefingService({
  calendarService = null,
  taskRepository = null,
  healthMonitor = null,
  routineRegistry = null,
  budgetGuard = null,
  clock,
} = {}) {
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('daily_briefing_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async build({ identityId, asOf, channel }) {
      if (typeof identityId !== 'string' || identityId.length === 0) throw new TypeError('daily_briefing_identity_id_required');
      const asOfMs = asOf !== undefined ? Number(asOf) : now();
      const items = [];
      const staleItems = [];

      if (calendarService) {
        const { from, to } = dayWindow(asOfMs);
        const events = await calendarService.list({ from, to });
        for (const event of events) {
          bucket({
            sourceRef: `calendar:${event.eventId}`, observedAt: new Date(event.syncedAt ?? asOfMs).toISOString(),
            section: 'confirmed_facts', text: `${event.title} (${event.startAt})`,
          }, asOfMs, items, staleItems);
        }
      }

      if (taskRepository) {
        const tasks = await taskRepository.list();
        for (const task of tasks.filter((entry) => entry.status === 'active')) {
          bucket({
            sourceRef: `task:${task.taskId}`, observedAt: new Date(asOfMs).toISOString(),
            section: 'confirmed_facts', text: task.title,
          }, asOfMs, items, staleItems);
        }
      }

      if (healthMonitor) {
        for (const entry of healthMonitor.snapshot().filter((probe) => probe.status === 'failed')) {
          bucket({
            sourceRef: `health:${entry.probeId}`, observedAt: new Date(entry.observedAt).toISOString(),
            section: 'blocked_ambiguous', text: `Sonde "${entry.probeId}" en échec : ${entry.suggestion}`,
          }, asOfMs, items, staleItems);
        }
      }

      if (routineRegistry) {
        const routines = await routineRegistry.listRoutines();
        const today = new Date(asOfMs).toISOString().slice(0, 10);
        for (const routine of routines.filter((entry) => entry.status === 'active' && entry.trigger.type === 'schedule')) {
          bucket({
            sourceRef: `routine:${routine.routineId}`, observedAt: new Date(asOfMs).toISOString(),
            section: 'planned_automations', text: `Routine "${routine.name}" prévue le ${today}`,
          }, asOfMs, items, staleItems);
        }
      }

      if (budgetGuard) {
        const snapshot = await budgetGuard.snapshot({ type: 'daily' });
        bucket({
          sourceRef: 'budget:daily', observedAt: new Date(asOfMs).toISOString(),
          section: 'remaining_budget', text: snapshot.remainingMicros === null ? 'Aucune limite configurée' : `${snapshot.remainingMicros} µ$ restants aujourd'hui`,
        }, asOfMs, items, staleItems);
      }

      return Object.freeze({
        identityId, asOf: asOfMs, channel,
        items: Object.freeze(items),
        staleItems: Object.freeze(staleItems),
      });
    },
  });
}
