import { describe, expect, it, vi } from 'vitest';
import { createPrinterRegistry } from '../src/printing/printer-registry.mjs';
import { createPrintService } from '../src/printing/print-service.mjs';

function fakeRepository() {
  const rows = new Map();
  return { put: vi.fn(async (id, r) => rows.set(id, r)), get: vi.fn(async (id) => rows.get(id) ?? null), list: vi.fn(async () => [...rows.values()]) };
}

function fakeSpooler(overrides = {}) {
  let counter = 0;
  return {
    listPrinters: vi.fn(async () => [{ printerId: 'hp-1', name: 'HP LaserJet' }]),
    submit: vi.fn(async () => { counter += 1; return { jobId: `job-${counter}` }; }),
    getStatus: vi.fn(async () => ({ status: 'completed' })),
    ...overrides,
  };
}

async function buildWorld(spoolerOverrides = {}) {
  const spooler = fakeSpooler(spoolerOverrides);
  const printerRegistry = createPrinterRegistry({ spooler, repository: fakeRepository() });
  await printerRegistry.approvePrinter('hp-1');
  const actionVerifier = { verify: vi.fn(async () => ({ confirmed: true })) };
  const print = createPrintService({ printerRegistry, spooler, actionVerifier, clock: () => 1_700_000_000_000 });
  return { print, printerRegistry, spooler, actionVerifier };
}

describe('createPrinterRegistry: discover / approvePrinter / isApproved', () => {
  it('requires explicit approval before a printer may be used', async () => {
    const spooler = fakeSpooler();
    const registry = createPrinterRegistry({ spooler, repository: fakeRepository() });
    expect(await registry.isApproved('hp-1')).toBe(false);
    await registry.approvePrinter('hp-1');
    expect(await registry.isApproved('hp-1')).toBe(true);
  });

  it('rejects approving an undiscovered printer', async () => {
    const spooler = fakeSpooler();
    const registry = createPrinterRegistry({ spooler, repository: fakeRepository() });
    await expect(registry.approvePrinter('missing')).rejects.toThrow('printer_not_found');
  });

  it('discover lists raw printers without approving them', async () => {
    const spooler = fakeSpooler();
    const registry = createPrinterRegistry({ spooler, repository: fakeRepository() });
    const discovered = await registry.discover();
    expect(discovered).toEqual([{ printerId: 'hp-1', name: 'HP LaserJet' }]);
    expect(await registry.isApproved('hp-1')).toBe(false);
  });
});

describe('createPrintService.proposePrint: fixes digest/printer/pages/copies/duplex/color/media/estimatedSheets', () => {
  it('rejects proposing a print on an unapproved printer', async () => {
    const { print } = await buildWorld();
    await expect(print.proposePrint({ digest: 'sha256:abc', printerId: 'unapproved', pages: [1, 2] })).rejects.toThrow('printer_not_approved');
  });

  it('fixes every documented field on the proposal', async () => {
    const { print } = await buildWorld();
    const proposal = await print.proposePrint({ digest: 'sha256:abc', printerId: 'hp-1', pages: [1, 2, 3], copies: 2, duplex: true, color: false, media: 'A4' });
    expect(proposal).toMatchObject({ digest: 'sha256:abc', printerId: 'hp-1', pages: [1, 2, 3], copies: 2, duplex: true, color: false, media: 'A4', estimatedSheets: 6 });
  });
});

describe('createPrintService.submit: idempotent by proposal', () => {
  it('a second submit of the same proposal never calls the spooler again and returns the same jobId', async () => {
    const { print, spooler } = await buildWorld();
    const proposal = await print.proposePrint({ digest: 'sha256:abc', printerId: 'hp-1', pages: [1] });

    const first = await print.submit(proposal);
    const second = await print.submit(proposal);

    expect(spooler.submit).toHaveBeenCalledTimes(1);
    expect(second.jobId).toBe(first.jobId);
  });

  it('submit returns status accepted_by_spooler immediately after a fresh submission', async () => {
    const { print } = await buildWorld();
    const proposal = await print.proposePrint({ digest: 'sha256:abc', printerId: 'hp-1', pages: [1] });
    const job = await print.submit(proposal);
    expect(job.status).toBe('accepted_by_spooler');
  });

  it('two different proposals for the same printer produce two distinct jobs', async () => {
    const { print, spooler } = await buildWorld();
    const a = await print.proposePrint({ digest: 'sha256:aaa', printerId: 'hp-1', pages: [1] });
    const b = await print.proposePrint({ digest: 'sha256:bbb', printerId: 'hp-1', pages: [1] });
    const jobA = await print.submit(a);
    const jobB = await print.submit(b);
    expect(jobA.jobId).not.toBe(jobB.jobId);
    expect(spooler.submit).toHaveBeenCalledTimes(2);
  });
});

describe('createPrintService.reconcile: exact five-state vocabulary, never a false completed', () => {
  it('reports completed only once the action verifier confirms it', async () => {
    const { print } = await buildWorld();
    const proposal = await print.proposePrint({ digest: 'sha256:abc', printerId: 'hp-1', pages: [1] });
    const job = await print.submit(proposal);
    const status = await print.reconcile(job.jobId);
    expect(status.status).toBe('completed');
  });

  it('reports state_unknown when the action verifier cannot confirm a claimed completion', async () => {
    const actionVerifier = { verify: vi.fn(async () => ({ confirmed: false })) };
    const { printerRegistry, spooler } = await buildWorld();
    const print = createPrintService({ printerRegistry, spooler, actionVerifier, clock: () => 0 });
    const proposal = await print.proposePrint({ digest: 'sha256:abc', printerId: 'hp-1', pages: [1] });
    const job = await print.submit(proposal);
    const status = await print.reconcile(job.jobId);
    expect(status.status).toBe('state_unknown');
  });

  it('reports state_unknown when the spooler status query itself fails, never assuming success', async () => {
    const { print, spooler } = await buildWorld();
    spooler.getStatus = vi.fn(async () => { throw new Error('spooler_unreachable'); });
    const status = await print.reconcile('job-1');
    expect(status.status).toBe('state_unknown');
  });

  it('reports state_unknown for a status outside the five documented states', async () => {
    const { print, spooler } = await buildWorld();
    spooler.getStatus = vi.fn(async () => ({ status: 'queued_somewhere_else' }));
    const status = await print.reconcile('job-1');
    expect(status.status).toBe('state_unknown');
  });

  it('passes through printing/failed states directly', async () => {
    const { print, spooler } = await buildWorld();
    spooler.getStatus = vi.fn(async () => ({ status: 'printing' }));
    expect((await print.reconcile('job-1')).status).toBe('printing');
    spooler.getStatus = vi.fn(async () => ({ status: 'failed' }));
    expect((await print.reconcile('job-1')).status).toBe('failed');
  });
});
