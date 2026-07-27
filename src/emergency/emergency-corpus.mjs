import { randomUUID, createHash } from 'node:crypto';
import { sealRecord, openRecord } from '../memory/record-codec.mjs';

function sha256(value) {
  return `sha256:${createHash('sha256').update(Buffer.from(JSON.stringify(value))).digest('hex')}`;
}

// The AAD id only needs to separate this record TYPE from others sharing the same key; it does not
// need to be unique per bundle (the envelope itself carries no id field to recover at verify time,
// so a per-bundle id would be unrecoverable without decrypting first). The real bundleId travels
// inside the encrypted payload instead.
const AAD_ID = 'emergency-corpus-bundle';

export function createEmergencyCorpus({ keyring, exporters, filesystem, clock } = {}) {
  if (!keyring?.open) throw new TypeError('emergency_corpus_keyring_required');
  if (!Array.isArray(exporters) || exporters.length === 0) throw new TypeError('emergency_corpus_exporters_required');
  if (!filesystem?.writeFile || !filesystem?.readFile) throw new TypeError('emergency_corpus_filesystem_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('emergency_corpus_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async build(selection, { destination = `emergency/corpus-${randomUUID()}.bin` } = {}) {
      const manifest = [];
      const items = {};
      for (const { sourceId, itemIds } of selection) {
        const exporter = exporters.find((candidate) => candidate.sourceId === sourceId);
        if (!exporter) throw new Error(`emergency_corpus_exporter_not_found:${sourceId}`);
        // eslint-disable-next-line no-await-in-loop
        const exported = await exporter.export(itemIds);
        for (const entry of exported) {
          manifest.push(Object.freeze({
            itemId: entry.itemId, sourceId, digest: sha256(entry.payload), version: 1,
            classification: entry.classification ?? 'personal', observedAt: new Date(now()).toISOString(),
          }));
          items[entry.itemId] = entry.payload;
        }
      }

      const bundleId = randomUUID();
      const key = await keyring.open();
      const sealed = sealRecord({ key, type: 'emergency-corpus', id: AAD_ID, value: { bundleId, manifest, items, builtAt: new Date(now()).toISOString() } });
      await filesystem.writeFile(destination, sealed);
      return Object.freeze({ path: destination, bundleId, itemCount: manifest.length });
    },

    async verify(pathOrBytes) {
      const bytes = Buffer.isBuffer(pathOrBytes) ? pathOrBytes : await filesystem.readFile(pathOrBytes);
      const key = await keyring.open();
      let bundle;
      try {
        bundle = openRecord({ key, type: 'emergency-corpus', id: AAD_ID, ciphertext: bytes });
      } catch {
        throw new Error('emergency_manifest_invalid');
      }
      if (!Array.isArray(bundle?.manifest) || typeof bundle?.items !== 'object') throw new Error('emergency_manifest_invalid');
      return bundle;
    },
  });
}
