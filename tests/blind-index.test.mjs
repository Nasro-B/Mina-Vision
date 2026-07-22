import { describe, expect, it } from 'vitest';
import { tokenizeFrench, TOKENIZER_VERSION } from '../src/rag/tokenizer.mjs';
import { createBlindIndex } from '../src/rag/blind-index.mjs';
import { rankBlindCandidates } from '../src/rag/ranker.mjs';

describe('French tokenizer', () => {
  it('normalizes accents, apostrophes and simple plurals with versioned stopwords', () => {
    expect(TOKENIZER_VERSION).toBe(1);
    expect(tokenizeFrench("L’adresse des gâteaux préférés d’Anaïs")).toEqual([
      'adresse', 'gâteau', 'préféré', 'anaï',
    ]);
  });

  it('retains searchable emails, numbers and OTP values', () => {
    expect(tokenizeFrench('Email Nasro.Test+mina@example.com, dossier 4821, OTP 739201')).toEqual([
      'nasro.test+mina@example.com', 'dossier', '4821', 'otp', '739201',
    ]);
  });
});

describe('blind lexical index', () => {
  const masterKey = Buffer.alloc(32, 83);

  it('derives deterministic 128-bit HMAC tokens without retaining plaintext', () => {
    const index = createBlindIndex({ masterKey });
    const encoded = index.indexText('secret secret +33612345678 otp 739201');
    const serialized = JSON.stringify(encoded.map(({ hash, frequency }) => ({
      hash: hash.toString('hex'), frequency,
    })));

    expect(encoded.every(({ hash }) => hash.length === 16)).toBe(true);
    expect(encoded.find(({ frequency }) => frequency === 2)).toBeDefined();
    for (const marker of ['secret', '+33612345678', 'otp', '739201']) {
      expect(serialized).not.toContain(marker);
    }
    expect(index.hashToken('secret')).toEqual(index.hashToken('secret'));
    expect(createBlindIndex({ masterKey: Buffer.alloc(32, 84) }).hashToken('secret'))
      .not.toEqual(index.hashToken('secret'));
  });

  it('ranks matching documents BM25-like using only blind hashes', () => {
    const index = createBlindIndex({ masterKey });
    const documents = [
      { id: 'cake', tokens: index.indexText('recette gâteau chocolat moelleux') },
      { id: 'dental', tokens: index.indexText('rendez-vous dentiste mardi') },
      { id: 'weak', tokens: index.indexText('gâteau rendez-vous') },
    ].map((document) => ({
      ...document,
      length: document.tokens.reduce((sum, token) => sum + token.frequency, 0),
    }));

    const ranked = rankBlindCandidates({ queryTokens: index.query('recette gâteau chocolat'), documents });

    expect(ranked.map(({ id }) => id)).toEqual(['cake', 'weak']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
