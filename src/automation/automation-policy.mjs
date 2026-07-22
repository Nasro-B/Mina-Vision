const EFFECT_BY_ACTION_TYPE = Object.freeze({
  notify: 'send',
  send_message: 'send',
  read_status: 'read',
  observe: 'read',
  set_state: 'write',
  execute_script: 'execute',
});

function inferEffect(actionType) {
  return EFFECT_BY_ACTION_TYPE[actionType] ?? 'execute';
}

function decision(value, reasons) {
  return Object.freeze({ decision: value, reasons: Object.freeze([...reasons]) });
}

function occurredAtParts(isoString) {
  const date = new Date(isoString);
  return { day: date.getUTCDay(), hour: date.getUTCHours() };
}

function withinSchedule(schedule, occurredAt) {
  if (!schedule) return true;
  const { day, hour } = occurredAtParts(occurredAt);
  if (!schedule.allowedDays.includes(day)) return false;
  return hour >= schedule.startHour && hour < schedule.endHour;
}

export function createAutomationPolicy({ capabilityBroker, budgetGuard, clock } = {}) {
  if (!capabilityBroker?.authorize) throw new TypeError('automation_policy_capability_broker_required');
  if (!budgetGuard?.snapshot) throw new TypeError('automation_policy_budget_guard_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('automation_policy_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async evaluate({ definition, grant, trigger, simulation, context }) {
      if (definition.status === 'shadow') return decision('simulate', ['shadow_mode']);
      if (definition.status === 'draft') return decision('deny', ['automation_draft']);
      if (definition.status === 'suspended') return decision('deny', ['automation_suspended']);
      if (definition.status === 'revoked') return decision('deny', ['automation_revoked']);

      if (!grant || now() >= Date.parse(grant.expiresAt)) {
        return decision('deny', ['grant_expired']);
      }
      if (grant.digest !== simulation.digest) {
        return decision('deny', ['digest_mismatch']);
      }
      const resourceAllowed = simulation.proposedActions.every(
        (action) => grant.resourceScope.includes(action.capability),
      );
      if (!resourceAllowed) {
        return decision('deny', ['resource_not_permitted']);
      }
      if (!grant.channelScope.includes(context.channel)) {
        return decision('deny', ['channel_not_permitted']);
      }
      if (!withinSchedule(grant.schedule, trigger.occurredAt)) {
        return decision('deny', ['outside_schedule']);
      }
      if ((context.riskLevel ?? 0) > grant.maxRiskLevel) {
        return decision('deny', ['risk_exceeded']);
      }
      if ((context.recentRunCount ?? 0) >= grant.maxFrequencyPerWindow) {
        return decision('deny', ['frequency_exceeded']);
      }
      const estimatedCostMicros = simulation.estimatedUsage?.estimatedCostMicros ?? 0;
      if (estimatedCostMicros > grant.maxCostMicros) {
        return decision('deny', ['cost_exceeded']);
      }
      const budgetSnapshot = await budgetGuard.snapshot({ type: 'session', id: definition.automationId });
      if (budgetSnapshot.remainingMicros !== null && estimatedCostMicros > budgetSnapshot.remainingMicros) {
        return decision('deny', ['cost_exceeded']);
      }
      const estimatedDurationMs = simulation.estimatedUsage?.estimatedDurationMs ?? 0;
      if (estimatedDurationMs > grant.maxDurationMs) {
        return decision('deny', ['duration_exceeded']);
      }

      for (const action of simulation.proposedActions) {
        // eslint-disable-next-line no-await-in-loop
        const capabilityDecision = await capabilityBroker.authorize({
          sessionId: definition.automationId,
          capability: action.capability,
          resource: action.capability,
          effect: inferEffect(action.actionType),
          channel: context.channel,
          digest: simulation.digest,
        });
        if (capabilityDecision.decision === 'deny') {
          return decision('deny', [capabilityDecision.reason]);
        }
        if (capabilityDecision.decision === 'confirm') {
          return decision('confirm', [capabilityDecision.reason]);
        }
      }

      if (definition.status === 'supervised') return decision('confirm', ['supervised_mode']);
      return decision('allow', []);
    },
  });
}
