// Traite les payloads média reçus sur le canal `mina_app` : relie le réassembleur (chunks →
// média complet vérifié) au stockage chiffré, et notifie quand un média est prêt (pour la mémoire
// et, plus tard, la vision de Mina). Aucune réponse texte n'est produite ici — le serveur a déjà
// acquitté ; un média n'est pas une question à répondre par chunk.

export function createChatMediaHandler({ assembler, store, onComplete = null, logger = null } = {}) {
  if (!assembler?.begin || !assembler?.addChunk || !store?.save) {
    throw new TypeError('chat_media_handler_dependencies_required');
  }

  return async function handleMedia({ deviceId, threadId, eventId, type, meta = {}, binary } = {}) {
    if (type === 'message.attachment.created' || type === 'message.voice.created') {
      // Toutes les gardes (mime, borne de taille, digest) sont dans assembler.begin — fail-loud.
      assembler.begin({ ...meta });
      logger?.append?.({ event: 'chat_media_declare', mediaId: meta.mediaId, type, deviceId });
      return Object.freeze({ started: meta.mediaId });
    }
    if (type === 'media.chunk') {
      const state = assembler.addChunk({ mediaId: meta.mediaId, index: meta.index, binary });
      if (!state.complete) return Object.freeze({ mediaId: meta.mediaId, chunk: meta.index, complete: false });
      // Complet : finalize vérifie sha256 + taille (rejet total si divergence) puis stockage chiffré.
      const media = assembler.finalize(meta.mediaId);
      await store.save(media.mediaId, media.mime, media.bytes);
      logger?.append?.({ event: 'chat_media_complet', mediaId: media.mediaId, mime: media.mime, sizeBytes: media.sizeBytes, deviceId });
      await onComplete?.({ deviceId, threadId, eventId, mediaId: media.mediaId, mime: media.mime, sizeBytes: media.sizeBytes });
      return Object.freeze({ mediaId: media.mediaId, complete: true, mime: media.mime, sizeBytes: media.sizeBytes });
    }
    throw new Error(`media_type_inconnu:${type}`);
  };
}
