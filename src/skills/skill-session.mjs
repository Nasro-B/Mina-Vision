import { randomUUID } from 'node:crypto';

function snapshot(value) {
  return Object.freeze({
    ...value,
    capabilities: Object.freeze([...value.capabilities]),
    referencesLoaded: Object.freeze([...value.referencesLoaded]),
  });
}

export function createSkillSessionManager({ clock = Date.now, ids = randomUUID } = {}) {
  const sessions = new Map();
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const nextId = () => String(typeof ids === 'function' ? ids() : ids.next());

  function start({ workSessionId, skill } = {}) {
    if (typeof workSessionId !== 'string' || !workSessionId || !skill?.name || !skill?.version || !skill?.digest) {
      throw new TypeError('skill_session_invalid');
    }
    const id = nextId();
    if (sessions.has(id)) throw new Error('skill_session_duplicate');
    const session = {
      id,
      workSessionId,
      skillName: skill.name,
      version: skill.version,
      digest: skill.digest,
      capabilities: [...skill.capabilities],
      referencesLoaded: Object.keys(skill.references ?? {}).sort(),
      startedAt: now(),
      endedAt: null,
      status: 'active',
      reason: null,
    };
    sessions.set(id, session);
    return snapshot(session);
  }

  function close(id, reason = 'completed') {
    const session = sessions.get(id);
    if (!session || session.status !== 'active') throw new Error('skill_session_not_active');
    session.status = 'closed';
    session.reason = reason;
    session.endedAt = now();
    sessions.delete(id);
    return snapshot(session);
  }

  function closeForWorkSession(workSessionId, reason = 'work_session_end') {
    const active = [...sessions.values()].filter((session) => session.workSessionId === workSessionId);
    return Object.freeze(active.map((session) => close(session.id, reason)));
  }

  function list(workSessionId = null) {
    return Object.freeze([...sessions.values()]
      .filter((session) => workSessionId === null || session.workSessionId === workSessionId)
      .map(snapshot));
  }

  return Object.freeze({ start, close, closeForWorkSession, list });
}
