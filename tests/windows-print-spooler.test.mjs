import { describe, expect, it, vi } from 'vitest';
import { createWindowsPrintSpooler } from '../src/printing/windows-print-spooler.mjs';

// Real Get-Printer output on Windows serializes PrinterStatus as the underlying .NET enum's
// INTEGER value, not its name (confirmed against the real local spooler: "Normal" is never sent
// over the wire) — the spooler must handle both a numeric code and, defensively, a string.
const GET_PRINTER_JSON = JSON.stringify([
  { Name: 'Brother HL-L2350DW', DriverName: 'Brother HL-L2350DW series', PortName: 'USB001', Shared: false, PrinterStatus: 0 },
  { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', Shared: false, PrinterStatus: 128 },
]);

function fakeRun(mapping) {
  return vi.fn(async (executable, args) => {
    const key = args.join(' ');
    for (const [pattern, result] of mapping) {
      if (key.includes(pattern)) return result;
    }
    throw new Error(`unexpected command: ${executable} ${key}`);
  });
}

describe('createWindowsPrintSpooler', () => {
  it('lists real printers from Get-Printer, mapping the queue name to a stable printerId', async () => {
    const run = fakeRun([['Get-Printer', GET_PRINTER_JSON]]);
    const spooler = createWindowsPrintSpooler({ run });

    const printers = await spooler.listPrinters();

    expect(printers).toEqual([
      { printerId: 'Brother HL-L2350DW', name: 'Brother HL-L2350DW', driver: 'Brother HL-L2350DW series', port: 'USB001', shared: false, status: 'ready', statusCode: 0 },
      { printerId: 'Microsoft Print to PDF', name: 'Microsoft Print to PDF', driver: 'Microsoft Print To PDF', port: 'PORTPROMPT:', shared: false, status: 'offline', statusCode: 128 },
    ]);
  });

  it('returns an empty list rather than throwing when no printer is installed', async () => {
    const run = fakeRun([['Get-Printer', '[]']]);
    const spooler = createWindowsPrintSpooler({ run });
    await expect(spooler.listPrinters()).resolves.toEqual([]);
  });

  it('submit() requires a resolved file path — never accepts an unresolved digest', async () => {
    const spooler = createWindowsPrintSpooler({ run: vi.fn() });
    await expect(spooler.submit({ printerId: 'Brother HL-L2350DW', digest: null }))
      .rejects.toThrow('print_submit_file_path_required');
  });

  it('submit() invokes Start-Process with -Verb Print against the resolved file and target printer', async () => {
    const run = fakeRun([['Start-Process', ''], ['Get-PrintJob', '[]']]);
    const spooler = createWindowsPrintSpooler({ run });

    const receipt = await spooler.submit({ printerId: 'Brother HL-L2350DW', digest: 'C:\\Mina\\rapport.pdf', copies: 1 });

    expect(receipt.jobId).toMatch(/^[a-f0-9-]{36}$/u);
    const call = run.mock.calls.find(([, args]) => args.join(' ').includes('Start-Process'));
    expect(call[1].join(' ')).toContain('rapport.pdf');
    expect(call[1].join(' ')).toContain('Brother HL-L2350DW');
  });

  it('getStatus(jobId) reports completed once the job no longer appears in the live print queue', async () => {
    let queueCalls = 0;
    const run = vi.fn(async (executable, args) => {
      const key = args.join(' ');
      if (key.includes('Start-Process')) return '';
      if (key.includes('Get-PrintJob')) {
        queueCalls += 1;
        return queueCalls === 1 ? JSON.stringify([{ Id: 7, JobStatus: 'Printing' }]) : '[]';
      }
      throw new Error(`unexpected: ${key}`);
    });
    const spooler = createWindowsPrintSpooler({ run, spoolerJobId: () => 7 });

    const receipt = await spooler.submit({ printerId: 'Brother HL-L2350DW', digest: 'C:\\Mina\\rapport.pdf' });

    await expect(spooler.getStatus(receipt.jobId)).resolves.toMatchObject({ status: 'printing' });
    await expect(spooler.getStatus(receipt.jobId)).resolves.toMatchObject({ status: 'completed' });
  });

  it('getStatus(jobId) surfaces an explicit error state without throwing', async () => {
    const run = vi.fn(async (executable, args) => {
      const key = args.join(' ');
      if (key.includes('Start-Process')) return '';
      if (key.includes('Get-PrintJob')) return JSON.stringify([{ Id: 7, JobStatus: 'Error' }]);
      throw new Error(`unexpected: ${key}`);
    });
    const spooler = createWindowsPrintSpooler({ run, spoolerJobId: () => 7 });
    const receipt = await spooler.submit({ printerId: 'x', digest: 'C:\\Mina\\a.pdf' });
    await expect(spooler.getStatus(receipt.jobId)).resolves.toMatchObject({ status: 'failed' });
  });

  it('getStatus() on an unknown jobId reports state_unknown rather than throwing', async () => {
    const spooler = createWindowsPrintSpooler({ run: vi.fn() });
    await expect(spooler.getStatus('never-submitted')).resolves.toEqual({ jobId: 'never-submitted', status: 'state_unknown' });
  });
});
