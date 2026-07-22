import { randomUUID } from 'node:crypto';

const EVENT_MAPPERS = Object.freeze({
  action_error: (event) => ({ severity: 'error', scope: `action:${event.action?.name || 'unknown'}`, message: event.error }),
  // The orchestrator puts the real reason at actionResult.verification.reason — reading only
  // event.reason surfaced « Erreur technique sans détail » for every unverified action.
  action_unverified: (event) => ({ severity: 'warning', scope: `action:${event.action?.name || 'unknown'}`, message: event.reason || event.actionResult?.verification?.reason || event.error }),
  camera_vision_error: (event) => ({ severity: 'error', scope: 'camera:vision', message: event.error }),
  cursor_error: (event) => ({ severity: 'error', scope: 'cursor', message: event.error }),
  domain_degraded: (event) => ({ severity: 'error', scope: `domain:${event.domain || 'unknown'}`, message: event.reason }),
  mission_error: (event) => ({ severity: 'error', scope: 'mission', message: event.error }),
  resilience_retry: (event) => ({ severity: 'warning', scope: `resilience:${event.operation || 'unknown'}`, message: event.error }),
  voice_error: (event) => ({ severity: 'error', scope: 'voice', message: event.error }),
});

const redact = (value) => String(value ?? 'Erreur technique sans détail.')
  .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/giu, '$1[REDACTED]')
  .replace(/\b(api[_-]?key|token|secret|password|passwd)\s*[=:]\s*[^\s,;]+/giu, '$1=[REDACTED]')
  .slice(0, 2_000);

export const createTechnicalLog = ({ limit = 100, clock = Date.now, onEntry = () => {} } = {}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('technical_log_limit_invalid');
  const entries = [];

  const record = ({ severity = 'error', scope = 'runtime', code = 'technical_error', message } = {}) => {
    const entry = Object.freeze({
      id: randomUUID(),
      occurredAt: new Date(clock()).toISOString(),
      severity: severity === 'warning' ? 'warning' : 'error',
      scope: String(scope || 'runtime').slice(0, 120),
      code: String(code || 'technical_error').slice(0, 120),
      message: redact(message),
    });
    entries.unshift(entry);
    if (entries.length > limit) entries.length = limit;
    onEntry(entry);
    return entry;
  };

  return Object.freeze({
    record,
    recordEvent(event = {}) {
      const mapper = EVENT_MAPPERS[event.type];
      if (!mapper) return null;
      return record({ ...mapper(event), code: event.type });
    },
    list: () => entries.map((entry) => ({ ...entry })),
    clear() {
      const cleared = entries.length;
      entries.length = 0;
      return { cleared };
    },
  });
};

export const createTechnicalLogReader = ({ technicalLog } = {}) => {
  if (!technicalLog?.list) throw new TypeError('technical_log_reader_dependency_required');
  return Object.freeze({
    read({ limit = 10 } = {}) {
      const boundedLimit = Math.min(20, Math.max(1, Number.isInteger(Number(limit)) ? Number(limit) : 10));
      return technicalLog.list().slice(0, boundedLimit);
    },
  });
};
