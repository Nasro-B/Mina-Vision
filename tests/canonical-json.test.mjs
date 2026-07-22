import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/crypto/canonical-json.mjs';
import { sha256 } from '../src/crypto/digest.mjs';

describe('canonicalJson: deterministic, order-independent object serialization', () => {
  it('produces the same output regardless of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested object keys recursively', () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 1 })).toBe('{"a":1,"z":{"c":2,"d":1}}');
  });

  it('preserves array element order, never sorting array contents', () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it('rejects a value containing undefined', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow('canonical_json_value_invalid');
  });

  it('rejects a value containing a function', () => {
    expect(() => canonicalJson({ a: () => {} })).toThrow('canonical_json_value_invalid');
  });

  it('rejects a value containing a symbol', () => {
    expect(() => canonicalJson({ a: Symbol('x') })).toThrow('canonical_json_value_invalid');
  });

  it('rejects a non-finite number', () => {
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow('canonical_json_value_invalid');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow('canonical_json_value_invalid');
  });

  it('rejects a cyclic reference instead of hanging or throwing a generic stack overflow', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('canonical_json_cyclic_reference');
  });
});

describe('sha256: stable hex digest', () => {
  it('matches the well-known digest of an empty string', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces a 64-character lowercase hex digest for arbitrary text', () => {
    expect(sha256('mina-vision')).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('is stable across repeated calls with the same input', () => {
    expect(sha256('same-input')).toBe(sha256('same-input'));
  });
});
