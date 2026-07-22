import { createHash } from 'node:crypto';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function response(status, evidence, reason) {
  return Object.freeze({ status, evidence, reason });
}

function inferredEffect(action) {
  if (action?.name === 'print') return { type: 'print_job_accepted' };
  if (action?.name === 'download') return { type: 'file_appeared' };
  if (action?.name === 'send_message') return { type: 'message_accepted' };
  return { type: 'ui_state_change' };
}

export function verifyAction({ action, before, result, after, expectedEffect }) {
  if (!result?.executed) {
    return response('failed', null, result?.error || 'executor_did_not_execute');
  }

  const effect = expectedEffect ?? inferredEffect(action);
  if (effect.type === 'ui_state_change') {
    const beforeDigest = digest(before);
    const afterDigest = digest(after);
    if (beforeDigest === afterDigest) return response('unknown', null, 'ui_state_unchanged');
    return response('verified', Object.freeze({
      type: 'ui_state_change',
      beforeDigest,
      afterDigest,
    }), null);
  }

  if (effect.type === 'file_appeared') {
    const beforeFiles = new Map((before?.files ?? []).map((file) => [file.path, file.digest]));
    const file = (after?.files ?? []).find((candidate) => (
      (!effect.path || candidate.path === effect.path)
      && candidate.digest
      && candidate.digest !== beforeFiles.get(candidate.path)
      && (!effect.digest || candidate.digest === effect.digest)
    ));
    if (!file) return response('unknown', null, 'file_digest_not_observed');
    return response('verified', Object.freeze({
      type: 'file_appeared',
      path: file.path,
      digest: file.digest,
    }), null);
  }

  if (effect.type === 'print_job_accepted') {
    if (!result.jobId) return response('unknown', null, 'print_job_id_missing');
    return response('verified', Object.freeze({
      type: 'print_job_accepted',
      jobId: result.jobId,
    }), null);
  }

  if (effect.type === 'message_accepted') {
    const remoteMessageId = result.remoteMessageId ?? result.messageId;
    if (!remoteMessageId) return response('unknown', null, 'remote_message_id_missing');
    return response('verified', Object.freeze({
      type: 'message_accepted',
      remoteMessageId,
    }), null);
  }

  return response('unknown', null, 'unsupported_expected_effect');
}
