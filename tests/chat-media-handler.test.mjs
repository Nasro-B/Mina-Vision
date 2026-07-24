import { describe, expect, it, vi } from 'vitest';
import { createChatMediaHandler } from '../src/chat/chat-media-handler.mjs';
import { createMediaAssembler } from '../src/chat/media-assembler.mjs';
import { chunkMedia } from '../src/chat/media-chunker.mjs';

describe('chat media handler (réception → assemblage → stockage chiffré)', () => {
  it('reçoit meta + chunks (via le vrai chunker/assembleur), stocke le média complet et notifie', async () => {
    const original = Buffer.from('contenu image de test assez long pour au moins deux chunks distincts.', 'utf8');
    const { eventType, meta, chunks } = chunkMedia(original, { mime: 'image/jpeg', chunkBytes: 16 });

    const store = { save: vi.fn(async () => ({ stored: true })) };
    const onComplete = vi.fn(async () => {});
    const handle = createChatMediaHandler({ assembler: createMediaAssembler(), store, onComplete });

    await handle({ deviceId: 'd1', type: eventType, meta });
    let last;
    for (const chunk of chunks) {
      last = await handle({ deviceId: 'd1', type: 'media.chunk', meta: { mediaId: meta.mediaId, index: chunk.index }, binary: chunk.binary });
    }
    expect(last).toMatchObject({ complete: true, mime: 'image/jpeg' });
    // Le store a reçu les OCTETS EXACTS réassemblés (après vérif sha256 + taille par l'assembleur).
    expect(store.save).toHaveBeenCalledOnce();
    const [mediaId, mime, bytes] = store.save.mock.calls[0];
    expect(mediaId).toBe(meta.mediaId);
    expect(mime).toBe('image/jpeg');
    expect(bytes.equals(original)).toBe(true);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ mediaId: meta.mediaId, mime: 'image/jpeg' }));
  });

  it('un chunk corrompu (digest faux) fait échouer la finalisation, le store n\'est jamais appelé', async () => {
    const original = Buffer.from('12345678', 'utf8');
    const { meta, chunks } = chunkMedia(original, { mime: 'image/png', chunkBytes: 4 });
    const corruptedMeta = { ...meta, sha256: 'f'.repeat(64) };
    const store = { save: vi.fn() };
    const handle = createChatMediaHandler({ assembler: createMediaAssembler(), store });
    await handle({ deviceId: 'd1', type: 'message.attachment.created', meta: corruptedMeta });
    await handle({ deviceId: 'd1', type: 'media.chunk', meta: { mediaId: meta.mediaId, index: 0 }, binary: chunks[0].binary });
    await expect(handle({ deviceId: 'd1', type: 'media.chunk', meta: { mediaId: meta.mediaId, index: 1 }, binary: chunks[1].binary }))
      .rejects.toThrow(/digest_mismatch/u);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('rejette un type de payload média inconnu', async () => {
    const handle = createChatMediaHandler({ assembler: createMediaAssembler(), store: { save: vi.fn() } });
    await expect(handle({ type: 'message.text.created', meta: {} })).rejects.toThrow(/media_type_inconnu/u);
  });
});
