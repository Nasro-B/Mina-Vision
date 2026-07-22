import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('print main runtime contract', () => {
  it('composes a real printer registry and print service — never a stub — with IPC exposed', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('createWindowsPrintSpooler');
    expect(source).toContain('createPrinterRegistry');
    expect(source).toContain('createPrintService');
    expect(source).toContain("ipcMain.handle('mina:printing:discover'");
    expect(source).toContain("ipcMain.handle('mina:printing:print-file'");
  });

  it('requires local confirmation before both approving a printer and submitting a print job', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    const approveHandler = source.slice(source.indexOf("ipcMain.handle('mina:printing:approve'"), source.indexOf("ipcMain.handle('mina:printing:print-file'"));
    const printHandler = source.slice(source.indexOf("ipcMain.handle('mina:printing:print-file'"), source.indexOf('registerSkillsSandboxIpc({'));
    expect(approveHandler).toContain('confirmSensitiveAction');
    expect(printHandler).toContain('confirmSensitiveAction');
    expect(printHandler).toContain('isApproved');
  });

  it('the printer repository is closed on shutdown, like every other persisted store', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('printerRepository?.close()');
  });
});
