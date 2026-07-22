import { describe, expect, it, vi } from 'vitest';
import { createRoutedComputerUse } from '../src/providers/routed-computer-use.mjs';

const localRoute = Object.freeze({ providerId: 'local-cu', capability: 'computer.use', locality: 'local', network: 'none' });
const cloudRoute = Object.freeze({ providerId: 'cloud-cu', capability: 'computer.use', locality: 'cloud', network: 'internet' });

describe('routed Computer Use', () => {
  it('pins an interaction to the provider selected at start', async () => {
    const capabilityRouter = { resolve: vi.fn(() => [localRoute, cloudRoute]) };
    const providerRegistry = {
      invoke: vi.fn(async (route, input) => ({
        interactionId: 'i-local', completed: input.operation === 'continue', calls: input.operation === 'start' ? [{}] : [],
      })),
    };
    const routed = createRoutedComputerUse({ capabilityRouter, providerRegistry });

    const first = await routed.start({ goal: 'test', environment: 'browser', observation: {} });
    capabilityRouter.resolve.mockReturnValue([cloudRoute, localRoute]);
    await routed.continue({
      interactionId: first.interactionId, call: {}, actionResult: {}, observation: {}, environment: 'browser',
    });

    expect(capabilityRouter.resolve).toHaveBeenCalledTimes(1);
    expect(providerRegistry.invoke.mock.calls[0][0]).toBe(localRoute);
    expect(providerRegistry.invoke.mock.calls[1][0]).toBe(localRoute);
    expect(providerRegistry.invoke.mock.calls[1][1]).toMatchObject({ operation: 'continue', interactionId: 'i-local' });
  });

  it('honours local-only routing and rejects unavailable or unknown interactions', async () => {
    const capabilityRouter = { resolve: vi.fn(() => []) };
    const providerRegistry = { invoke: vi.fn() };
    const routed = createRoutedComputerUse({ capabilityRouter, providerRegistry });

    await expect(routed.start({ goal: 'test', environment: 'browser', observation: {}, mode: 'local-only' }))
      .rejects.toThrow('computer_use_route_unavailable');
    expect(capabilityRouter.resolve).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'computer.use', mode: 'local-only', offline: false,
    }));
    await expect(routed.continue({ interactionId: 'missing' })).rejects.toThrow('computer_use_interaction_unknown');
  });

  it('starts a new interaction on another route only when the failure policy explicitly allows it', async () => {
    const capabilityRouter = { resolve: vi.fn(() => [localRoute, cloudRoute]) };
    const providerRegistry = {
      invoke: vi.fn()
        .mockRejectedValueOnce(new Error('local_failed'))
        .mockResolvedValueOnce({ interactionId: 'i-cloud', completed: false, calls: [{}] }),
    };
    const failurePolicy = {
      recover: vi.fn(() => ({ action: 'new_interaction', providerId: 'cloud-cu' })),
    };
    const routed = createRoutedComputerUse({ capabilityRouter, providerRegistry, failurePolicy });

    await expect(routed.start({ goal: 'test', environment: 'browser', observation: {} }))
      .resolves.toMatchObject({ interactionId: 'i-cloud' });
    expect(providerRegistry.invoke.mock.calls.map(([route]) => route.providerId)).toEqual(['local-cu', 'cloud-cu']);
  });

  it('can traverse more than one failed provider before a fallback succeeds', async () => {
    const thirdRoute = Object.freeze({ providerId: 'third-cu', capability: 'computer.use', locality: 'cloud', network: 'internet' });
    const capabilityRouter = { resolve: vi.fn(() => [localRoute, cloudRoute, thirdRoute]) };
    const providerRegistry = {
      invoke: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('quota 429'), { status: 429 }))
        .mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }))
        .mockResolvedValueOnce({ interactionId: 'i-third', completed: false, calls: [{}] }),
    };
    const failurePolicy = {
      recover: vi.fn(({ remainingRoutes }) => remainingRoutes[0]
        ? { action: 'new_interaction', providerId: remainingRoutes[0].providerId }
        : null),
    };
    const routed = createRoutedComputerUse({ capabilityRouter, providerRegistry, failurePolicy });

    await expect(routed.start({ goal: 'test', environment: 'browser', observation: {} }))
      .resolves.toMatchObject({ interactionId: 'i-third' });
    expect(providerRegistry.invoke.mock.calls.map(([route]) => route.providerId))
      .toEqual(['local-cu', 'cloud-cu', 'third-cu']);
  });
});
