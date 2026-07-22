export function createPrinterRegistry({ spooler, repository } = {}) {
  if (!spooler?.listPrinters) throw new TypeError('printer_registry_spooler_required');
  if (!repository?.put || !repository?.get || !repository?.list) throw new TypeError('printer_registry_repository_required');

  return Object.freeze({
    async discover() {
      const printers = await spooler.listPrinters();
      return Object.freeze(printers.map((printer) => Object.freeze({ ...printer })));
    },

    async approvePrinter(printerId) {
      const discovered = await spooler.listPrinters();
      const printer = discovered.find((entry) => entry.printerId === printerId);
      if (!printer) throw new Error('printer_not_found');
      const record = Object.freeze({ ...printer, approved: true });
      await repository.put(printerId, record);
      return record;
    },

    async isApproved(printerId) {
      const record = await repository.get(printerId);
      return Boolean(record?.approved);
    },

    async listApproved() {
      return Object.freeze(await repository.list());
    },
  });
}
