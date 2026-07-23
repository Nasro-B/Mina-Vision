import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CHAT_AAD_PREFIX, encodeChatHeader, encodeChatSignatureInput } from '../src/contracts/chat-binary-codec.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/protocol/mina-chat-event-v2.json', import.meta.url), 'utf8'),
);
// Les vecteurs vivent dans un fichier LU AUSSI par les tests Kotlin : le contrat
// d'interopérabilité est donc vérifié des deux côtés contre la même source, pas contre deux
// copies qui pourraient diverger.
const vectors = JSON.parse(
  await readFile(new URL('./fixtures/protocol/mina-chat-codec-vectors.json', import.meta.url), 'utf8'),
);

describe('codec binaire canonique du chat', () => {
  it('produit exactement l\'AAD du vecteur partagé avec Kotlin', () => {
    expect(encodeChatHeader(fixture).toString('hex')).toBe(vectors.aadHex);
    expect(encodeChatSignatureInput(fixture).length).toBe(vectors.signatureInputLength);
  });

  it('commence par le préfixe de domaine et la version', () => {
    const header = encodeChatHeader(fixture);
    expect(header.subarray(0, CHAT_AAD_PREFIX.length).toString('ascii')).toBe(CHAT_AAD_PREFIX);
    expect(header.readUInt16BE(CHAT_AAD_PREFIX.length)).toBe(2);
  });

  it('change dès qu\'un SEUL champ du contexte change', () => {
    const base = encodeChatHeader(fixture).toString('hex');
    for (const patch of [
      { threadId: 'thread-autre' },
      { senderDeviceId: 'device-huawei' },
      { deviceSequence: 2 },
      { keyEpoch: 2 },
      { routingClass: 'control' },
      { createdAtMs: fixture.createdAtMs + 1 },
      { expiresAtMs: fixture.expiresAtMs + 1 },
    ]) {
      expect(encodeChatHeader({ ...fixture, ...patch }).toString('hex')).not.toBe(base);
    }
  });

  it('ne confond jamais deux champs voisins (longueurs préfixées)', () => {
    // Sans préfixe de longueur, « ab » + « c » et « a » + « bc » donneraient les mêmes octets.
    const first = encodeChatHeader({ ...fixture, threadId: 'ab', senderDeviceId: 'c' });
    const second = encodeChatHeader({ ...fixture, threadId: 'a', senderDeviceId: 'bc' });
    expect(first.toString('hex')).not.toBe(second.toString('hex'));
  });

  it('l\'entrée de signature couvre l\'en-tête ET le contenu chiffré', () => {
    const base = encodeChatSignatureInput(fixture).toString('hex');
    expect(base.startsWith(Buffer.from('MINA_CHAT_SIGNATURE_V1\0', 'ascii').toString('hex'))).toBe(true);
    // Recoller un autre ciphertext sur le même en-tête doit produire une entrée différente.
    const swapped = encodeChatSignatureInput({ ...fixture, payloadCiphertext: 'YXV0cmU=' });
    expect(swapped.toString('hex')).not.toBe(base);
    const otherNonce = encodeChatSignatureInput({ ...fixture, nonce: 'YWJjZGVmZ2hpams=' });
    expect(otherNonce.toString('hex')).not.toBe(base);
  });

  it('refuse un champ démesuré avant toute allocation', () => {
    expect(() => encodeChatHeader({ ...fixture, threadId: 'x'.repeat(5_000) }))
      .toThrow('chat_codec_champ_trop_long');
  });
});
