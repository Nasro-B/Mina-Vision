import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createFilePolicy } from '../research/file-policy.mjs';

function requestDigest({ path, purpose, maxBytes }) {
  const value = JSON.stringify({ path, purpose, maxBytes });
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export async function createFileReadPolicy({
  capabilityBroker,
  approvedRoots = [],
  pathPolicy,
} = {}) {
  if (!capabilityBroker?.authorize) throw new TypeError('capability_broker_required');
  const localPathPolicy = pathPolicy ?? await createFilePolicy({ approvedRoots });

  async function authorize({
    path,
    purpose,
    maxBytes,
    signal,
    sessionId,
    channel = 'local',
    origin = 'user',
  } = {}) {
    signal?.throwIfAborted();
    if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) {
      throw new TypeError('absolute_file_path_required');
    }
    if (path.startsWith('\\\\')) throw new Error('network_path_forbidden');
    if (typeof purpose !== 'string' || !purpose.trim()) throw new TypeError('file_read_purpose_required');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('file_read_max_bytes_required');
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('file_read_session_required');

    // realpath and the sensitive-path policy run before the capability scope is evaluated.
    const canonical = await localPathPolicy.authorize({ path, operation: 'read', confirmed: true });
    signal?.throwIfAborted();
    const request = {
      sessionId,
      channel,
      capability: 'files.read',
      resource: canonical,
      effect: 'read',
      digest: requestDigest({ path: canonical, purpose: purpose.trim(), maxBytes }),
      origin,
    };
    const result = await capabilityBroker.authorize(request);
    signal?.throwIfAborted();
    if (result?.decision === 'confirm') throw new Error('files_read_confirmation_required');
    if (result?.decision !== 'allow') throw new Error(`files_read_denied:${result?.reason ?? 'policy'}`);
    return canonical;
  }

  return Object.freeze({ authorize });
}
