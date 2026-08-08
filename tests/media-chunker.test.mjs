import { describe, expect, it } from 'vitest';
import { chunkMedia, encodeMediaChunkPayload, encodeMediaMetaPayload } from '../src/chat/media-chunker.mjs';
import { createMediaAssembler } from '../src/chat/media-assembler.mjs';
import { decodeChatPayload } from '../src/contracts/chat-payload.mjs';

describe('media chunker (émission) — round-trip complet avec le réassembleur', () => {
  it('chunk puis assemble redonne les octets EXACTS, à travers l\'encodage payload v2', () => {
    const original = Buffer.from('Une vraie photo JPEG ferait plusieurs Kio ; ici un contenu de test suffisant pour plusieurs chunks.'.repeat(50));
    const { eventType, meta, chunks } = chunkMedia(original, { mime: 'image/jpeg', chunkBytes: 128, extraMeta: { width: 640, height: 480 } });
    expect(eventType).toBe('message.attachment.created');
    expect(meta.chunkCount).toBe(chunks.length);
    expect(meta.width).toBe(640);

    // Simule le trajet réseau : chaque chunk est encodé en payload v2 puis re-décodé côté réception.
    const asm = createMediaAssembler();
    const decodedMeta = decodeChatPayload(encodeMediaMetaPayload({ eventType, meta }));
    expect(decodedMeta).toMatchObject({ version: 2, type: eventType });
    asm.begin(decodedMeta.meta);
    for (const chunk of chunks) {
      const decoded = decodeChatPayload(encodeMediaChunkPayload({ mediaId: meta.mediaId, index: chunk.index, binary: chunk.binary }));
      asm.addChunk({ mediaId: decoded.meta.mediaId, index: decoded.meta.index, binary: decoded.binary });
    }
    expect(asm.isComplete(meta.mediaId)).toBe(true);
    const result = asm.finalize(meta.mediaId);
    expect(result.bytes.equals(original)).toBe(true);
    expect(result.mime).toBe('image/jpeg');
  });

  it('audio m4a → type voix', () => {
    const { eventType, meta } = chunkMedia(Buffer.from('audio'), { mime: 'audio/mp4', extraMeta: { durationMs: 3200 } });
    expect(eventType).toBe('message.voice.created');
    expect(meta.durationMs).toBe(3200);
  });

  it('PCM16 canonical → type voix et chunks d’une seconde au plus', () => {
    const { eventType, meta, chunks } = chunkMedia(Buffer.alloc(32_001, 7), {
      mime: 'audio/L16;rate=16000;channels=1',
    });
    expect(eventType).toBe('message.voice.created');
    expect(meta.chunkBytes).toBe(32_000);
    expect(chunks.map((chunk) => chunk.binary.length)).toEqual([32_000, 1]);
  });

  it('refuse mime hors liste, média vide ou trop gros', () => {
    expect(() => chunkMedia(Buffer.from('x'), { mime: 'application/pdf' })).toThrow(/mime_refuse/u);
    expect(() => chunkMedia(Buffer.alloc(0), { mime: 'image/png' })).toThrow(/media_vide/u);
    expect(() => chunkMedia(Buffer.alloc(11), { mime: 'image/png', maxTotalBytes: 10 })).toThrow(/trop_gros/u);
  });

  it('identifiants de média uniques', () => {
    const a = chunkMedia(Buffer.from('a'), { mime: 'image/png' }).meta.mediaId;
    const b = chunkMedia(Buffer.from('a'), { mime: 'image/png' }).meta.mediaId;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/u);
  });
});
