// Gemini Live streams inputTranscription as partial fragments (often word-by-word). Routing each
// fragment straight into the wake router / dialogue layer made every multi-word phrase unmatchable —
// "active la caméra" arrived as "active" then " la caméra" and neither chunk matched anything. This
// aggregator rebuilds one utterance per silence window: fragments are concatenated raw (Gemini's
// fragments carry their own spacing) and flushed as a single string once no new fragment arrives
// within holdMs. Pure and timer-injected so the silence behavior is testable without real delays.
export function createUtteranceAggregator({
  holdMs = 900,
  maxChars = 2_000,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  onUtterance = () => {},
} = {}) {
  let buffer = '';
  let timer = null;

  const emit = () => {
    timer = null;
    const utterance = buffer.replace(/\s+/gu, ' ').trim().slice(0, maxChars);
    buffer = '';
    if (utterance) onUtterance(utterance);
  };

  return Object.freeze({
    push(fragment) {
      const text = String(fragment ?? '');
      if (!text.trim()) return;
      buffer = (buffer + text).slice(0, maxChars * 2);
      if (timer) cancel(timer);
      timer = schedule(emit, holdMs);
    },
    flush() {
      if (timer) cancel(timer);
      emit();
    },
  });
}
