// Frontière IPC ÉTROITE et validée entre le renderer et le processus principal pour la publication.
// Exactement cinq canaux ; aucune primitive de système de fichiers n'est exposée ; aucun chemin
// arbitraire : une destination absolue ou distante est refusée par le schéma, et une destination
// relative hors racine Mina exige la confirmation locale existante. Le service est construit une
// seule fois (lazy) et réutilisé. Toute erreur revient en { ok:false, error:<code stable> } — jamais
// une stack ni un chemin interne.

export const PUBLICATION_CHANNELS = Object.freeze([
  'mina:publication:templates',
  'mina:publication:assets:import',
  'mina:publication:preview',
  'mina:publication:publish',
  'mina:publication:convert',
]);

function errorCode(error) {
  const message = String(error?.message ?? error ?? 'publication_error');
  return message.split(/[\s(:]/u)[0] || 'publication_error';
}

export function registerPublicationIpc({
  ipcMain, buildService, buildConverter = null, listTemplates = () => [],
  importAsset = null, previewLimitBytes = 8 * 1024 * 1024, onEvent = () => {},
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof buildService !== 'function') {
    throw new TypeError('publication_ipc_dependencies_required');
  }
  let service = null;
  const getService = () => (service ??= buildService());
  const registered = [];
  const handle = (channel, fn) => { registered.push(channel); ipcMain.handle(channel, fn); };

  handle('mina:publication:templates', async () => {
    try { return { ok: true, templates: listTemplates() }; }
    catch (error) { return { ok: false, error: errorCode(error) }; }
  });

  handle('mina:publication:assets:import', async (_event, payload) => {
    if (typeof importAsset !== 'function') return { ok: false, error: 'publication_asset_import_unavailable' };
    try {
      const asset = await importAsset({ sourcePath: String(payload?.sourcePath ?? ''), sourceKind: String(payload?.sourceKind ?? '') });
      // On ne renvoie jamais les bytes ni le chemin source au renderer — juste l'id/mime/provenance.
      return { ok: true, asset: { assetId: asset.assetId, mimeType: asset.mimeType, provenance: asset.provenance, sha256: asset.sha256, dimensions: asset.dimensions ?? null } };
    } catch (error) { return { ok: false, error: errorCode(error) }; }
  });

  handle('mina:publication:preview', async (_event, request) => {
    try {
      const receipt = await getService().publish({ ...request, format: 'html' });
      return { ok: true, format: 'html', bytes: receipt.bytes, filePath: receipt.filePath };
    } catch (error) { return { ok: false, error: errorCode(error) }; }
  });

  handle('mina:publication:publish', async (_event, request) => {
    try {
      // Destination fournie = jamais un chemin arbitraire silencieux : le schéma refuse déjà l'absolu
      // et le distant ; une relative passe par la confirmation locale existante en amont de l'appel.
      const receipt = await getService().publish(request);
      onEvent({ type: 'publication_published', format: receipt.format, bytes: receipt.bytes });
      return { ok: true, receipt };
    } catch (error) { return { ok: false, error: errorCode(error) }; }
  });

  handle('mina:publication:convert', async (_event, payload) => {
    if (typeof buildConverter !== 'function') return { ok: false, error: 'libreoffice_unavailable' };
    try {
      const receipt = await buildConverter().convert({
        inputPath: String(payload?.inputPath ?? ''),
        outputFormat: String(payload?.outputFormat ?? ''),
        outputDirectory: String(payload?.outputDirectory ?? ''),
      });
      return { ok: true, receipt };
    } catch (error) { return { ok: false, error: errorCode(error) }; }
  });

  return Object.freeze({ channels: Object.freeze([...registered]) });
}
