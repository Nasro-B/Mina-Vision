function budgetError(scope, limit, projected) {
  const error = new Error(`budget_exceeded:${scope}`);
  error.code = 'budget_exceeded';
  error.scope = scope;
  error.limit = limit;
  error.projected = projected;
  return error;
}

function validAmount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function dayOf(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function createInMemoryBudgetStore() {
  const state = { reservations: new Map(), settlements: new Map() };
  let tail = Promise.resolve();

  async function transaction(callback) {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback(state);
    } finally {
      release();
    }
  }

  return Object.freeze({ transaction });
}

function sums(state, predicate) {
  let reservedCostMicros = 0;
  let reservedDurationMs = 0;
  let settledCostMicros = 0;
  let settledDurationMs = 0;
  for (const value of state.reservations.values()) {
    if (!predicate(value)) continue;
    reservedCostMicros += value.costMicros;
    reservedDurationMs += value.durationMs;
  }
  for (const value of state.settlements.values()) {
    if (!predicate(value)) continue;
    settledCostMicros += value.costMicros;
    settledDurationMs += value.durationMs;
  }
  return { reservedCostMicros, reservedDurationMs, settledCostMicros, settledDurationMs };
}

export function createBudgetGuard({
  store = createInMemoryBudgetStore(),
  clock = Date.now,
  limits = {},
} = {}) {
  if (!store?.transaction) throw new TypeError('budget_store_required');
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function reserve(estimate = {}) {
    if (!estimate.id || !estimate.sessionId || !estimate.providerId
      || !validAmount(estimate.costMicros) || !validAmount(estimate.durationMs)) {
      throw new TypeError('budget_estimate_invalid');
    }
    if (limits.perCallMicros !== undefined && estimate.costMicros > limits.perCallMicros) {
      throw budgetError('per_call_cost', limits.perCallMicros, estimate.costMicros);
    }
    if (limits.perCallDurationMs !== undefined && estimate.durationMs > limits.perCallDurationMs) {
      throw budgetError('per_call_time', limits.perCallDurationMs, estimate.durationMs);
    }
    return store.transaction((state) => {
      if (state.reservations.has(estimate.id) || state.settlements.has(estimate.id)) {
        throw new Error('budget_reservation_duplicate');
      }
      const createdAt = now();
      const day = dayOf(createdAt);
      const session = sums(state, (value) => value.sessionId === estimate.sessionId);
      const daily = sums(state, (value) => value.day === day);
      const providerDaily = sums(state, (value) => value.day === day && value.providerId === estimate.providerId);
      const sessionCost = session.reservedCostMicros + session.settledCostMicros + estimate.costMicros;
      const dailyCost = daily.reservedCostMicros + daily.settledCostMicros + estimate.costMicros;
      const providerCost = providerDaily.reservedCostMicros + providerDaily.settledCostMicros + estimate.costMicros;
      const sessionTime = session.reservedDurationMs + session.settledDurationMs + estimate.durationMs;
      if (limits.sessionMicros !== undefined && sessionCost > limits.sessionMicros) {
        throw budgetError('session_cost', limits.sessionMicros, sessionCost);
      }
      if (limits.dailyMicros !== undefined && dailyCost > limits.dailyMicros) {
        throw budgetError('daily_cost', limits.dailyMicros, dailyCost);
      }
      const providerLimit = limits.providerDailyMicros?.[estimate.providerId];
      if (providerLimit !== undefined && providerCost > providerLimit) {
        throw budgetError('provider_daily_cost', providerLimit, providerCost);
      }
      if (limits.sessionDurationMs !== undefined && sessionTime > limits.sessionDurationMs) {
        throw budgetError('session_time', limits.sessionDurationMs, sessionTime);
      }
      const reservation = Object.freeze({ ...estimate, createdAt, day });
      state.reservations.set(estimate.id, reservation);
      return Object.freeze({ id: estimate.id, reserved: true, day });
    });
  }

  async function settle(id, actual = {}) {
    if (!id || !validAmount(actual.costMicros) || !validAmount(actual.durationMs)) {
      throw new TypeError('budget_actual_invalid');
    }
    return store.transaction((state) => {
      if (state.settlements.has(id)) return state.settlements.get(id);
      const reservation = state.reservations.get(id);
      if (!reservation) throw new Error('budget_reservation_unknown');
      state.reservations.delete(id);
      const settlement = Object.freeze({
        ...reservation,
        costMicros: actual.costMicros,
        durationMs: actual.durationMs,
        settledAt: now(),
      });
      state.settlements.set(id, settlement);
      return settlement;
    });
  }

  async function release(id) {
    if (!id) throw new TypeError('budget_reservation_id_required');
    return store.transaction((state) => state.reservations.delete(id));
  }

  async function snapshot(scope = { type: 'daily' }) {
    return store.transaction((state) => {
      const day = dayOf(now());
      let predicate;
      let limit = null;
      if (scope.type === 'daily') {
        predicate = (value) => value.day === day;
        limit = limits.dailyMicros ?? null;
      } else if (scope.type === 'session' && scope.id) {
        predicate = (value) => value.sessionId === scope.id;
        limit = limits.sessionMicros ?? null;
      } else if (scope.type === 'provider' && scope.id) {
        predicate = (value) => value.day === day && value.providerId === scope.id;
        limit = limits.providerDailyMicros?.[scope.id] ?? null;
      } else {
        throw new TypeError('budget_scope_invalid');
      }
      const totals = sums(state, predicate);
      const projected = totals.reservedCostMicros + totals.settledCostMicros;
      return Object.freeze({
        ...totals,
        scope: scope.type,
        id: scope.id ?? day,
        limitMicros: limit,
        remainingMicros: limit === null ? null : Math.max(0, limit - projected),
        overBudget: limit !== null && projected > limit,
      });
    });
  }

  return Object.freeze({ reserve, settle, release, snapshot });
}
