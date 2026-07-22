// Store JSON versionné (amélioration C) : chaque fichier d'état porte un schemaVersion explicite.
// Lecture fail-closed — une version INCONNUE n'est jamais interprétée ni écrasée en silence : le
// fichier est sauvegardé en .perdu-<date> et l'état repart des défauts, avec l'incident signalé
// au retour. Un fichier legacy SANS version passe par le migrateur déclaré (jamais deviné).

export function createVersionedJsonStore({
  filename,
  schemaVersion,
  readFile,
  writeFile,
  rename,
  now = Date.now,
  // migrate(rawValue) -> data au schéma courant, pour les fichiers legacy sans enveloppe.
  migrateLegacy = null,
} = {}) {
  if (!filename || !Number.isInteger(schemaVersion) || schemaVersion < 1
    || typeof readFile !== 'function' || typeof writeFile !== 'function' || typeof rename !== 'function') {
    throw new TypeError('versioned_store_configuration_required');
  }

  async function quarantineCorrupt() {
    const backup = `${filename}.perdu-${new Date(Number(now())).toISOString().slice(0, 10)}`;
    await rename(filename, backup).catch(() => {});
    return backup;
  }

  return Object.freeze({
    async load({ defaults = null } = {}) {
      let raw;
      try {
        raw = await readFile(filename, 'utf8');
      } catch {
        return Object.freeze({ data: defaults, status: 'absent' });
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const backup = await quarantineCorrupt();
        return Object.freeze({ data: defaults, status: 'corrupt_quarantined', backup });
      }
      if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.schemaVersion)) {
        if (parsed.schemaVersion === schemaVersion) {
          return Object.freeze({ data: parsed.data, status: 'loaded' });
        }
        // Version future ou inconnue : ne JAMAIS interpréter ni écraser — quarantaine.
        const backup = await quarantineCorrupt();
        return Object.freeze({
          data: defaults,
          status: 'unknown_version_quarantined',
          backup,
          foundVersion: parsed.schemaVersion,
        });
      }
      if (typeof migrateLegacy === 'function') {
        try {
          const migrated = migrateLegacy(parsed);
          return Object.freeze({ data: migrated, status: 'migrated_legacy' });
        } catch {
          const backup = await quarantineCorrupt();
          return Object.freeze({ data: defaults, status: 'legacy_migration_failed', backup });
        }
      }
      const backup = await quarantineCorrupt();
      return Object.freeze({ data: defaults, status: 'unversioned_quarantined', backup });
    },

    async save(data) {
      const envelope = JSON.stringify({ schemaVersion, savedAt: Number(now()), data });
      await writeFile(filename, envelope, 'utf8');
      return Object.freeze({ saved: true, schemaVersion });
    },
  });
}
