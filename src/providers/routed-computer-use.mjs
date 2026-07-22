function responseValid(response) {
  return response && typeof response === 'object' && typeof response.interactionId === 'string'
    && typeof response.completed === 'boolean' && Array.isArray(response.calls);
}

export function createRoutedComputerUse({
  capabilityRouter,
  providerRegistry,
  failurePolicy,
  defaultMode = 'auto',
  defaultOffline = false,
} = {}) {
  if (!capabilityRouter?.resolve || !providerRegistry?.invoke) {
    throw new TypeError('routed_computer_use_dependencies_required');
  }
  const interactions = new Map();

  function recover({ phase, error, failedRoute, remainingRoutes }) {
    const recovery = failurePolicy?.recover?.({ phase, error, failedRoute, remainingRoutes });
    if (recovery?.action !== 'new_interaction') return null;
    return remainingRoutes.find((route) => route.providerId === recovery.providerId) ?? null;
  }

  async function invokeStart(route, startInput) {
    const response = await providerRegistry.invoke(route, { operation: 'start', ...startInput });
    if (!responseValid(response)) throw new Error(`computer_use_response_invalid:${route.providerId}`);
    return response;
  }

  function pin(response, value) {
    if (!response.completed) interactions.set(response.interactionId, value);
    return response;
  }

  async function fallbackStart({ phase, error, failedRoute, routes, startInput }) {
    let currentError = error;
    let currentFailedRoute = failedRoute;
    const remainingRoutes = routes.filter((route) => route.providerId !== failedRoute.providerId);
    while (remainingRoutes.length) {
      const route = recover({
        phase, error: currentError, failedRoute: currentFailedRoute, remainingRoutes,
      });
      if (!route) throw currentError;
      remainingRoutes.splice(remainingRoutes.findIndex((candidate) => candidate.providerId === route.providerId), 1);
      try {
        return { response: await invokeStart(route, startInput), route };
      } catch (nextError) {
        currentError = nextError;
        currentFailedRoute = route;
      }
    }
    throw currentError;
  }

  async function start(input = {}) {
    const routes = capabilityRouter.resolve({
      capability: 'computer.use',
      mode: input.mode ?? defaultMode,
      offline: input.offline ?? defaultOffline,
      preferredProvider: input.preferredProvider,
    });
    if (!routes.length) throw new Error('computer_use_route_unavailable');
    const startInput = {
      goal: input.goal,
      evidence: input.evidence ?? [],
      environment: input.environment,
      observation: input.observation,
    };
    let route = routes[0];
    try {
      return pin(await invokeStart(route, startInput), { route, routes, startInput });
    } catch (error) {
      const recovered = await fallbackStart({ phase: 'start', error, failedRoute: route, routes, startInput });
      return pin(recovered.response, { route: recovered.route, routes, startInput });
    }
  }

  async function continueInteraction(input = {}) {
    const pinned = interactions.get(input.interactionId);
    if (!pinned) throw new Error('computer_use_interaction_unknown');
    try {
      const response = await providerRegistry.invoke(pinned.route, { operation: 'continue', ...input });
      if (!responseValid(response)) throw new Error(`computer_use_response_invalid:${pinned.route.providerId}`);
      interactions.delete(input.interactionId);
      return pin(response, pinned);
    } catch (error) {
      interactions.delete(input.interactionId);
      const startInput = { ...pinned.startInput, observation: input.observation };
      const recovered = await fallbackStart({
        phase: 'continue', error, failedRoute: pinned.route, routes: pinned.routes, startInput,
      });
      return pin(recovered.response, { ...pinned, route: recovered.route, startInput });
    }
  }

  return Object.freeze({ start, continue: continueInteraction });
}
