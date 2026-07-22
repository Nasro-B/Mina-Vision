import { describe, expect, it } from 'vitest';
import { verifyAction } from '../src/grounding/action-verifier.mjs';

describe('action verifier', () => {
  it('does not trust executed=true when the observed UI is unchanged', () => {
    const observation = { url: 'https://example.test', imageBase64: 'same' };

    expect(verifyAction({
      action: { name: 'click', x: 10, y: 20 },
      before: observation,
      result: { executed: true },
      after: observation,
      expectedEffect: { type: 'ui_state_change' },
    })).toMatchObject({ status: 'unknown', reason: 'ui_state_unchanged' });
  });

  it('verifies a UI action from an independently changed observation', () => {
    expect(verifyAction({
      action: { name: 'click', x: 10, y: 20 },
      before: { url: 'https://example.test', imageBase64: 'before' },
      result: { executed: true },
      after: { url: 'https://example.test', imageBase64: 'after' },
      expectedEffect: { type: 'ui_state_change' },
    })).toMatchObject({
      status: 'verified',
      evidence: { type: 'ui_state_change' },
    });
  });

  it('verifies a downloaded file only when a new digest is observed', () => {
    expect(verifyAction({
      action: { name: 'download' },
      before: { files: [] },
      result: { executed: true },
      after: { files: [{ path: 'C:\\Temp\\report.pdf', digest: 'sha256:new' }] },
      expectedEffect: { type: 'file_appeared', path: 'C:\\Temp\\report.pdf' },
    })).toMatchObject({
      status: 'verified',
      evidence: { type: 'file_appeared', digest: 'sha256:new' },
    });
  });

  it('requires a structured print job identifier', () => {
    const input = {
      action: { name: 'print' },
      before: null,
      after: null,
      expectedEffect: { type: 'print_job_accepted' },
    };

    expect(verifyAction({ ...input, result: { executed: true, jobId: 'print-42' } })).toMatchObject({
      status: 'verified',
      evidence: { type: 'print_job_accepted', jobId: 'print-42' },
    });
    expect(verifyAction({ ...input, result: { executed: true } })).toMatchObject({
      status: 'unknown',
      reason: 'print_job_id_missing',
    });
  });

  it('requires a remote message identifier for an outbound message', () => {
    expect(verifyAction({
      action: { name: 'send_message' },
      before: null,
      result: { executed: true, remoteMessageId: 'message-42' },
      after: null,
      expectedEffect: { type: 'message_accepted' },
    })).toMatchObject({
      status: 'verified',
      evidence: { type: 'message_accepted', remoteMessageId: 'message-42' },
    });
  });

  it('marks an executor error as failed', () => {
    expect(verifyAction({
      action: { name: 'click' },
      before: {},
      result: { executed: false, error: 'target_missing' },
      after: {},
      expectedEffect: { type: 'ui_state_change' },
    })).toEqual({
      status: 'failed',
      evidence: null,
      reason: 'target_missing',
    });
  });
});
