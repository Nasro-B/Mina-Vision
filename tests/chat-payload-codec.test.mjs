import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeChatPayload, encodeChatPayloadV2, MAX_BINARY_BYTES } from '../src/contracts/chat-payload.mjs';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/protocol/mina-chat-payload-v2-vectors.json', import.meta.url), 'utf8')).vectors;

describe('chat payload v2 codec (extras chat — verrou W1)', () => {
  it('round-trip pièce jointe : encode puis décode redonne type + meta + binaire', () => {
    const meta = { mediaId: 'M9', mime: 'audio/mp4', durationMs: 4200, chunkCount: 2, chunkBytes: 128 };
    const encoded = encodeChatPayloadV2({ type: 'message.voice.created', meta });
    const decoded = decodeChatPayload(encoded);
    expect(decoded).toMatchObject({ version: 2, type: 'message.voice.created', meta });
    expect(decoded.binary.length).toBe(0);
  });

  it('round-trip chunk binaire', () => {
    const binary = Buffer.from([9, 8, 7, 6]);
    const decoded = decodeChatPayload(encodeChatPayloadV2({ type: 'media.chunk', meta: { mediaId: 'M9', index: 3 }, binary }));
    expect(decoded.type).toBe('media.chunk');
    expect([...decoded.binary]).toEqual([9, 8, 7, 6]);
  });

  it('RÉTROCOMPAT : un payload texte v1 (1er octet ≠ 0x00) est décodé comme texte brut, jamais v2', () => {
    expect(decodeChatPayload(Buffer.from('salut Mina', 'utf8'))).toEqual({ version: 1, kind: 'text', text: 'salut Mina' });
    expect(decodeChatPayload(Buffer.alloc(0))).toEqual({ version: 1, kind: 'text', text: '' });
  });

  it('correspond EXACTEMENT aux vecteurs partagés (que Kotlin doit rejouer)', () => {
    for (const vector of vectors) {
      if (vector.payloadHex && vector.type) {
        const encoded = encodeChatPayloadV2({
          type: vector.type,
          meta: vector.meta,
          binary: Buffer.from(vector.binaryHex ?? '', 'hex'),
        });
        expect(encoded.toString('hex')).toBe(vector.payloadHex);
      } else if (vector.textUtf8 !== undefined) {
        // Le texte v1 n'est PAS ré-encodé par ce codec (il reste brut à l'émission) ; on vérifie
        // seulement que son hex se décode bien comme texte.
        const decoded = decodeChatPayload(Buffer.from(vector.payloadHex, 'hex'));
        expect(decoded).toEqual({ version: 1, kind: 'text', text: vector.textUtf8 });
      }
    }
  });

  it('rejette les types inconnus, les binaires trop gros, les payloads tronqués', () => {
    expect(() => encodeChatPayloadV2({ type: 'message.text.created' })).toThrow(/type_invalide/u);
    expect(() => encodeChatPayloadV2({ type: 'media.chunk', binary: Buffer.alloc(MAX_BINARY_BYTES + 1) })).toThrow(/binaire_trop_long/u);
    expect(() => decodeChatPayload(Buffer.from([0x00, 0x02, 0x00]))).toThrow(/tronque|invalide/u);
    expect(() => decodeChatPayload(Buffer.from([0x00, 0x09]))).toThrow(/version_inconnue/u);
  });
});
