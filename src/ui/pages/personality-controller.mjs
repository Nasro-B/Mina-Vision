export function createPersonalityController({ personalityService } = {}) {
  if (!personalityService?.get || !personalityService?.proposePatch || !personalityService?.confirmPatch
    || !personalityService?.rollback || !personalityService?.renderStyleContext) {
    throw new TypeError('personality_controller_dependencies_required');
  }

  return Object.freeze({
    get: () => personalityService.get(),
    // Proposing never mutates; only confirmPatch does — personality confirmation stays main-process/local.
    proposePatch: (patch) => personalityService.proposePatch(patch),
    confirmPatch: (patchId) => personalityService.confirmPatch(patchId),
    rollback: () => personalityService.rollback(),
    renderStyleContext: (channel) => personalityService.renderStyleContext(channel),
  });
}
