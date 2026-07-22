const ALLOWED_CHANNELS = new Set(['local', 'voice', 'telegram']);

function normalized(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(value) {
  return new Set(normalized(value).split(' ').filter(Boolean));
}

function triggerScore(query, trigger) {
  const queryText = normalized(query);
  const triggerText = normalized(trigger);
  if (!queryText || !triggerText) return 0;
  if (queryText.includes(triggerText)) return 1;
  const queryTokens = tokens(queryText);
  const triggerTokens = tokens(triggerText);
  const intersection = [...triggerTokens].filter((token) => queryTokens.has(token)).length;
  const union = new Set([...queryTokens, ...triggerTokens]).size;
  return union ? intersection / union : 0;
}

function score(entry, query) {
  return Math.max(0, ...entry.triggers.map((trigger) => triggerScore(query, trigger)));
}

function requireBudget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('skill_requested_budget_invalid');
  const keys = ['maxDurationMs', 'maxCostMicros', 'maxTokens'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())
    || keys.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)) {
    throw new TypeError('skill_requested_budget_invalid');
  }
  return value;
}

export function createSkillRouter({
  registry,
  loader,
  budgetGuard,
  sessions,
  threshold = 0.75,
} = {}) {
  if (!registry?.list || !registry?.get || !loader?.load || !budgetGuard?.snapshot || !sessions?.start
    || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new TypeError('skill_router_dependencies_required');
  }

  function resolveEntry({ name, query, channel }) {
    if (name !== undefined) {
      if (typeof name !== 'string' || !name) throw new TypeError('skill_name_invalid');
      const entry = registry.get(name);
      if (!entry) throw new Error(`skill_unavailable:${name}`);
      return { entry, decision: 'resolved' };
    }
    if (typeof query !== 'string' || !query.trim()) throw new TypeError('skill_query_required');
    const candidates = registry.list()
      .map((entry) => ({ entry, score: score(entry, query) }))
      .filter((candidate) => candidate.score >= threshold)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
    if (!candidates.length) throw new Error('skill_unavailable:auto');
    const tied = candidates.filter((candidate) => Math.abs(candidate.score - candidates[0].score) < Number.EPSILON);
    if (tied.length > 1) {
      if (!['local', 'voice'].includes(channel)) throw new Error('skill_route_ambiguous_remote');
      return {
        decision: 'clarify',
        reason: 'skill_route_ambiguous',
        candidates: tied.map(({ entry }) => entry.name).sort(),
      };
    }
    return { entry: candidates[0].entry, decision: 'resolved' };
  }

  async function activate(request = {}) {
    if (!ALLOWED_CHANNELS.has(request.channel)) throw new Error(`skill_channel_forbidden:${request.channel}`);
    if (typeof request.workSessionId !== 'string' || !request.workSessionId
      || typeof request.sessionId !== 'string' || !request.sessionId
      || !Array.isArray(request.availableCapabilities)) {
      throw new TypeError('skill_activation_invalid');
    }
    const resolved = resolveEntry(request);
    if (resolved.decision === 'clarify') return Object.freeze(resolved);
    const entry = resolved.entry;
    if (!entry.channels.includes(request.channel)) throw new Error(`skill_channel_incompatible:${entry.name}:${request.channel}`);
    for (const capability of entry.capabilities) {
      if (!request.availableCapabilities.includes(capability)) throw new Error(`skill_capability_unavailable:${capability}`);
    }
    const requested = requireBudget(request.requestedBudget);
    for (const key of ['maxDurationMs', 'maxCostMicros', 'maxTokens']) {
      if (requested[key] > entry.budgets[key]) throw new Error(`skill_budget_exceeded:${key}`);
    }
    const snapshot = await budgetGuard.snapshot({ type: 'session', id: request.sessionId });
    if (snapshot.remainingMicros !== null && snapshot.remainingMicros < requested.maxCostMicros) {
      throw new Error('skill_budget_exceeded:global_cost');
    }
    const loaded = await loader.load(entry.slug);
    if (loaded.name !== entry.name || loaded.version !== entry.version || loaded.digest !== entry.digest) {
      throw new Error('skill_changed_before_activation');
    }
    const session = sessions.start({ workSessionId: request.workSessionId, skill: loaded });
    return Object.freeze({ decision: 'activated', skill: entry, loaded, session });
  }

  return Object.freeze({ activate });
}
