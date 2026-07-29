export function toAutomationHomeResult(result) {
  const verified = result?.state === 'state_confirmed' && result?.verified === true;
  return Object.freeze({
    effect: Object.freeze({ executed: verified, verified }),
    detail: result == null ? null : structuredClone(result),
  });
}
