import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createMediaAssembler } from '../src/chat/media-assembler.mjs';

function metaFor(bytes, { chunkBytes = 4, mime = 'image/jpeg', mediaId = 'M1' } = {}) {
  const chunkCount = Math.ceil(bytes.length / chunkBytes);
  return {
    mediaId, mime, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    chunkCount, chunkBytes,
  };
}
function chunksOf(bytes, chunkBytes = 4) {
  const out = [];
  for (let i = 0; i * chunkBytes < bytes.length; i += 1) out.push(bytes.subarray(i * chunkBytes, (i + 1) * chunkBytes));
  return out;
}

describe('media assembler (réception pièces jointes — sécurité critique)', () => {
  it('réassemble dans le désordre puis vérifie digest + taille', () => {
    const bytes = Buffer.from('bonjour Mina, voici une photo', 'utf8');
    const asm = createMediaAssembler();
    asm.begin(metaFor(bytes));
    const chunks = chunksOf(bytes);
    // Envoi volontairement dans le désordre.
    for (const i of [3, 0, 5, 1, 4, 2, 6, 7].filter((i) => i < chunks.length)) {
      asm.addChunk({ mediaId: 'M1', index: i, binary: chunks[i] });
    }
    expect(asm.isComplete('M1')).toBe(true);
    const result = asm.finalize('M1');
    expect(result.mime).toBe('image/jpeg');
    expect(result.bytes.equals(bytes)).toBe(true);
  });

  it('REFUSE avant toute allocation : mime hors liste, trop gros, digest/tailles invalides', () => {
    const asm = createMediaAssembler({ maxTotalBytes: 100 });
    expect(() => asm.begin({ mediaId: 'M1', mime: 'application/x-msdownload', sizeBytes: 4, sha256: 'a'.repeat(64), chunkCount: 1, chunkBytes: 4 })).toThrow(/mime_refuse/u);
    expect(() => asm.begin({ mediaId: 'M1', mime: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64), chunkCount: 100, chunkBytes: 128 })).toThrow(/trop_gros/u);
    expect(() => asm.begin({ mediaId: 'M1', mime: 'image/png', sizeBytes: 4, sha256: 'xyz', chunkCount: 1, chunkBytes: 4 })).toThrow(/digest_invalide/u);
  });

  it('rejet TOTAL si le digest ne correspond pas (média corrompu jamais rendu)', () => {
    const bytes = Buffer.from('12345678', 'utf8');
    const meta = metaFor(bytes);
    meta.sha256 = 'f'.repeat(64); // digest annoncé faux
    const asm = createMediaAssembler();
    asm.begin(meta);
    chunksOf(bytes).forEach((c, i) => asm.addChunk({ mediaId: 'M1', index: i, binary: c }));
    expect(() => asm.finalize('M1')).toThrow(/digest_mismatch/u);
  });

  it('index hors bornes, doublon, chunk sans meta', () => {
    const bytes = Buffer.from('abcd', 'utf8');
    const asm = createMediaAssembler();
    expect(() => asm.addChunk({ mediaId: 'X', index: 0, binary: Buffer.from('a') })).toThrow(/media_inconnu/u);
    asm.begin(metaFor(bytes)); // 1 chunk
    expect(() => asm.addChunk({ mediaId: 'M1', index: 5, binary: Buffer.from('a') })).toThrow(/index_invalide/u);
    asm.addChunk({ mediaId: 'M1', index: 0, binary: bytes });
    expect(asm.addChunk({ mediaId: 'M1', index: 0, binary: bytes }).duplicate).toBe(true);
  });

  it('purge les médias incomplets après le TTL', () => {
    let t = 1_000;
    const asm = createMediaAssembler({ incompleteTtlMs: 1_000, now: () => t });
    asm.begin(metaFor(Buffer.from('abcdefgh'), { chunkBytes: 4 })); // 2 chunks, on n'en envoie qu'un
    asm.addChunk({ mediaId: 'M1', index: 0, binary: Buffer.from('abcd') });
    expect(asm.pendingCount()).toBe(1);
    t += 2_000;
    expect(asm.pendingCount()).toBe(0);
  });
});
