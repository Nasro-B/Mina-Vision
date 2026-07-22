import { describe, expect, it, vi } from 'vitest';
import { createResearchEvidenceCompactor } from '../src/memory/research-evidence-compactor.mjs';
import { createEvidenceValidator } from '../src/grounding/evidence-validator.mjs';

function evidenceItem(n) {
  return Object.freeze({
    sourceId: `file-${n}`,
    locator: `C:\\Docs\\note-${n}.txt:1`,
    capturedAt: '2026-07-15T11:00:00.000Z',
    contentDigest: `sha256:${String(n).padStart(64, '0')}`,
    freshnessClass: 'current',
    extract: `preuve numero ${n}`,
    method: 'structured_extraction',
  });
}

describe('createResearchEvidenceCompactor: constructor guards', () => {
  it('rejects a maxItems below 2', () => {
    expect(() => createResearchEvidenceCompactor({ maxItems: 1 })).toThrow('invalid_evidence_compactor_max_items');
  });
});

describe('createResearchEvidenceCompactor.add: under the cap', () => {
  it('accumulates items unchanged and never calls summarize', async () => {
    const summarize = vi.fn(async () => 'never called');
    const compactor = createResearchEvidenceCompactor({ maxItems: 5, summarize });
    await compactor.add([evidenceItem(1), evidenceItem(2)]);
    await compactor.add([evidenceItem(3)]);
    expect(compactor.list()).toEqual([evidenceItem(1), evidenceItem(2), evidenceItem(3)]);
    expect(summarize).not.toHaveBeenCalled();
    expect(compactor.count()).toBe(3);
  });
});

describe('createResearchEvidenceCompactor.add: crossing the cap folds the oldest items into one summary', () => {
  it('keeps the list at exactly maxItems, preserving the freshest raw items', async () => {
    const compactor = createResearchEvidenceCompactor({ maxItems: 5, idGenerator: () => 'summary-1', now: () => 1_700_000_000_000 });
    await compactor.add([1, 2, 3, 4, 5, 6, 7].map(evidenceItem));

    const list = compactor.list();
    expect(list).toHaveLength(5);
    expect(list.slice(1)).toEqual([evidenceItem(4), evidenceItem(5), evidenceItem(6), evidenceItem(7)]);

    const summary = list[0];
    expect(summary.sourceId).toBe('evidence-summary-summary-1');
    expect(summary.method).toBe('model_inference');
    expect(summary.freshnessClass).toBe('historical');
    expect(summary.result.compactedSourceIds).toEqual(['file-1', 'file-2', 'file-3']);
    expect(summary.extract).toContain('preuve numero 1');
  });

  it('passes the real evidence-validator schema (strictObject) unmodified', async () => {
    const compactor = createResearchEvidenceCompactor({ maxItems: 3 });
    await compactor.add([1, 2, 3, 4].map(evidenceItem));
    const [summary] = compactor.list();

    const validator = createEvidenceValidator();
    const verdict = validator.validate({ evidenceIds: [summary.sourceId], claimType: 'inference' }, [summary]);
    expect(verdict.reasons).not.toContain(expect.stringContaining('invalid_evidence'));
    expect(verdict.status).toBe('inference');
  });
});

describe('createResearchEvidenceCompactor.add: repeated compaction never grows past maxItems', () => {
  it('folds the prior summary together with new overflow into a single fresh summary, indefinitely', async () => {
    const compactor = createResearchEvidenceCompactor({ maxItems: 5 });
    for (let round = 0; round < 20; round += 1) {
      await compactor.add([evidenceItem(`r${round}a`), evidenceItem(`r${round}b`), evidenceItem(`r${round}c`)]);
      const list = compactor.list();
      expect(list.length).toBeLessThanOrEqual(5);
      expect(list.filter((item) => item.sourceId.startsWith('evidence-summary-')).length).toBeLessThanOrEqual(1);
    }
    const finalList = compactor.list();
    expect(finalList[0].sourceId.startsWith('evidence-summary-')).toBe(true);
    expect(finalList.slice(1)).toEqual([evidenceItem('r18c'), evidenceItem('r19a'), evidenceItem('r19b'), evidenceItem('r19c')]);
  });
});

describe('createResearchEvidenceCompactor.add: summarize is injected and receives the dropped events', () => {
  it('calls the injected summarize with ids and extracts of exactly the folded items', async () => {
    const summarize = vi.fn(async (events) => `resume:${events.map((e) => e.id).join(',')}`);
    const compactor = createResearchEvidenceCompactor({ maxItems: 4, summarize });
    await compactor.add([1, 2, 3, 4, 5, 6].map(evidenceItem));
    expect(summarize).toHaveBeenCalledWith([
      { id: 'file-1', extract: 'preuve numero 1' },
      { id: 'file-2', extract: 'preuve numero 2' },
      { id: 'file-3', extract: 'preuve numero 3' },
    ]);
    expect(compactor.list()[0].extract).toBe('resume:file-1,file-2,file-3');
  });
});

describe('createResearchEvidenceCompactor.add: default summarizer works without any injected dependency', () => {
  it('produces a non-empty bounded string out of the box', async () => {
    const compactor = createResearchEvidenceCompactor({ maxItems: 3 });
    await compactor.add([1, 2, 3, 4].map(evidenceItem));
    const [summary] = compactor.list();
    expect(typeof summary.extract).toBe('string');
    expect(summary.extract.length).toBeGreaterThan(0);
    expect(summary.extract.length).toBeLessThanOrEqual(6_000);
  });
});

describe('createResearchEvidenceCompactor.clear', () => {
  it('empties the list back to zero', async () => {
    const compactor = createResearchEvidenceCompactor({ maxItems: 3 });
    await compactor.add([evidenceItem(1)]);
    compactor.clear();
    expect(compactor.list()).toEqual([]);
    expect(compactor.count()).toBe(0);
  });
});
