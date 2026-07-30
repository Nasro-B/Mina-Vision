import { describe, expect, it, vi } from 'vitest';
import { classifyFailure, withRetry } from '../src/core/error-resilience.mjs';

import { classifyFailure as classifyForConnectionCheck } from '../src/core/error-resilience.mjs';

// « Connection error. » (message nu du SDK @google/genai) tombait en « permanent » → zéro retry,
// mission morte instantanément (journal 2026-07-22). Toute variante de coupure de connexion est
// TRANSITOIRE — et un refus de sécurité ne devient jamais retryable pour autant.
describe('classifyFailure — coupures de connexion transitoires', () => {
  it.each([
    'Connection error.',
    'connection closed unexpectedly',
    'Connection terminated',
  ])('classe « %s » en transient', (message) => {
    expect(classifyForConnectionCheck(new Error(message))).toBe('transient');
  });

  it('un refus de sécurité reste non-retryable', () => {
    expect(classifyForConnectionCheck(new Error('action blocked par policy'))).toBe('safety');
  });
});

describe('classifyFailure', () => {
  it.each([
    'ETIMEDOUT', 'connect ECONNRESET', 'socket hang up', 'fetch failed',
    'Request timed out', '429 Too Many Requests', 'quota exceeded', 'rate limit',
    'RESOURCE_EXHAUSTED', 'service unavailable', '503 Service Unavailable',
    'The model is overloaded', 'device offline', 'screenshot failed',
    'Target page, context or browser has been closed',
  ])('classifies "%s" as transient', (message) => {
    expect(classifyFailure(new Error(message))).toBe('transient');
  });

  it.each([
    'confirmation_refused', 'safety_blocked', 'action forbidden by policy',
    'permission denied', 'unauthorized capability',
  ])('classifies "%s" as safety — never retried', (message) => {
    expect(classifyFailure(new Error(message))).toBe('safety');
  });

  it.each(['Objectif manquant.', 'skill_metadata_fields_invalid', 'TypeError: x is not a function'])(
    'classifies "%s" as permanent', (message) => {
      expect(classifyFailure(new Error(message))).toBe('permanent');
    },
  );

  it('safety wins over transient when a message matches both', () => {
    expect(classifyFailure(new Error('confirmation_refused after timeout'))).toBe('safety');
  });
});

describe('withRetry', () => {
  const instantSleep = () => Promise.resolve();

  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(withRetry(fn, { sleep: instantSleep, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries a transient failure with growing backoff, then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockRejectedValueOnce(new Error('503 unavailable'))
      .mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue();
    const onRetry = vi.fn();
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 100, sleep, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, error: expect.any(Error) }));
  });

  it('rethrows once attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(withRetry(fn, { attempts: 3, sleep: instantSleep })).rejects.toThrow('ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a permanent failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Objectif manquant.'));
    await expect(withRetry(fn, { attempts: 3, sleep: instantSleep })).rejects.toThrow('Objectif manquant.');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never retries a safety refusal, whatever the attempts budget', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('confirmation_refused'));
    const onRetry = vi.fn();
    await expect(withRetry(fn, { attempts: 5, sleep: instantSleep, onRetry })).rejects.toThrow('confirmation_refused');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  // Durcissement 2026-07-29 (réseau vers Google en à-coups) : le défaut encaisse plus de coupures.
  it('par défaut, encaisse jusqu’à 5 tentatives sur une coupure réseau (durci depuis 3)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Connection error.'));
    await expect(withRetry(fn, { sleep: instantSleep })).rejects.toThrow('Connection error.');
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('plafonne le backoff exponentiel à maxDelayMs (jamais d’attente démesurée)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Connection error.'));
    const sleep = vi.fn().mockResolvedValue();
    await expect(withRetry(fn, { attempts: 6, baseDelayMs: 1_000, maxDelayMs: 3_000, sleep })).rejects.toThrow('Connection error.');
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1_000, 2_000, 3_000, 3_000, 3_000]);
    expect(fn).toHaveBeenCalledTimes(6);
  });
});
