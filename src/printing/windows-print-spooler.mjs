import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const JOB_STATUS_MAP = Object.freeze({
  Error: 'failed', Paused: 'printing', Printing: 'printing', Spooling: 'accepted_by_spooler',
  Offline: 'failed', 'Paper Out': 'failed',
});

// Win32 spooler PRINTER_STATUS_* bit flags (public Microsoft API constants) — Get-Printer's
// PrinterStatus is serialized as this raw integer, never a readable name (confirmed against the
// real local spooler: 0 = ready, 128 = PRINTER_STATUS_OFFLINE). Only the flags relevant to "can
// Mina trust this printer right now" are mapped; anything else stays honestly 'unknown'.
const PRINTER_STATUS_OFFLINE = 0x80;
const PRINTER_STATUS_ERROR = 0x2;
const PRINTER_STATUS_PAPER_OUT = 0x10;
const PRINTER_STATUS_PAUSED = 0x1;
function readablePrinterStatus(code) {
  if (typeof code === 'string') return code.toLocaleLowerCase('en-US');
  if (!Number.isInteger(code)) return 'unknown';
  if (code === 0) return 'ready';
  if (code & PRINTER_STATUS_OFFLINE) return 'offline';
  if (code & PRINTER_STATUS_ERROR) return 'error';
  if (code & PRINTER_STATUS_PAPER_OUT) return 'paper_out';
  if (code & PRINTER_STATUS_PAUSED) return 'paused';
  return 'unknown';
}

function defaultRun(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`print_spooler_command_failed:${code}:${stderr.slice(0, 300)}`))));
  });
}

function parseJsonArray(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// A real Windows print spooler adapter over PowerShell's built-in printing cmdlets — no third
// party dependency. Discovery (Get-Printer) and status polling (Get-PrintJob) are read-only;
// submission (Start-Process -Verb Print) hands the job to the OS spooler, which owns it from then
// on. printerId is the print queue NAME, which is the OS's own stable identity for a printer.
export function createWindowsPrintSpooler({ run = defaultRun, powershellPath = 'powershell.exe', spoolerJobId = () => null } = {}) {
  const jobsByProposalId = new Map();

  return Object.freeze({
    async listPrinters() {
      const output = await run(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | ConvertTo-Json -Compress']);
      return parseJsonArray(output).map((entry) => Object.freeze({
        printerId: entry.Name, name: entry.Name, driver: entry.DriverName, port: entry.PortName,
        shared: Boolean(entry.Shared), status: readablePrinterStatus(entry.PrinterStatus), statusCode: entry.PrinterStatus,
      }));
    },

    // print-service.mjs's contract calls this with `digest`, not `filePath` — it is designed for
    // a future content-addressed document store. Until that pipeline is wired, the caller (Mina's
    // main process) passes a real, existing file path AS the digest — an honest interim contract,
    // not a real content hash yet.
    async submit({ printerId, digest: filePath, copies = 1 } = {}) {
      if (typeof filePath !== 'string' || !filePath) throw new TypeError('print_submit_file_path_required');
      if (typeof printerId !== 'string' || !printerId) throw new TypeError('print_submit_printer_id_required');
      const escapedFile = filePath.replaceAll("'", "''");
      const escapedPrinter = printerId.replaceAll("'", "''");
      for (let copy = 0; copy < Math.max(1, copies); copy += 1) {
        await run(powershellPath, [
          '-NoProfile', '-NonInteractive', '-Command',
          `Start-Process -FilePath '${escapedFile}' -Verb Print -ArgumentList '/pt \"${escapedFile}\" \"${escapedPrinter}\"' -WindowStyle Hidden`,
        ]);
      }
      const jobId = randomUUID();
      jobsByProposalId.set(jobId, { printerId, spoolerJobId: spoolerJobId() });
      return Object.freeze({ jobId });
    },

    async getStatus(jobId) {
      const context = jobsByProposalId.get(jobId);
      if (!context || context.spoolerJobId === null) return Object.freeze({ jobId, status: 'state_unknown' });
      const output = await run(powershellPath, [
        '-NoProfile', '-NonInteractive', '-Command', `Get-PrintJob -PrinterName '${context.printerId.replaceAll("'", "''")}' | ConvertTo-Json -Compress`,
      ]);
      const jobs = parseJsonArray(output);
      const live = jobs.find((entry) => entry.Id === context.spoolerJobId);
      if (!live) return Object.freeze({ jobId, status: 'completed' }); // no longer in the live queue = done
      return Object.freeze({ jobId, status: JOB_STATUS_MAP[live.JobStatus] ?? 'printing' });
    },
  });
}
