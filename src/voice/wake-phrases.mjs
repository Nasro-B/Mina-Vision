const WAKE_PATTERNS = [
  /^\s*salut\s+mina\b[\s,;:!?-]*(.*)$/iu,
  /^\s*bonjour\s+mina\b[\s,;:!?-]*(.*)$/iu,
  /^\s*mina[\s,;:!?-]+comment\s+[cç]a\s+va\b[\s,;:!?-]*(.*)$/iu,
  // Generic "Mina <commande>" — LAST so the specific greetings above keep their empty-remainder
  // behavior. Requires a non-empty remainder: a bare "Mina" stays a rejected false positive.
  /^\s*(?:eh\s+|hey\s+|ok\s+)?mina\b[\s,;:!?-]+(.+)$/iu,
];

export function detectWakePhrase(transcript) {
  const source = String(transcript ?? '');
  for (const pattern of WAKE_PATTERNS) {
    const match = source.match(pattern);
    if (match) {
      return Object.freeze({
        activated: true,
        phrase: match[0].slice(0, match[0].length - match[1].length).trim(),
        remainder: match[1].trim(),
      });
    }
  }
  return Object.freeze({ activated: false, phrase: null, remainder: '' });
}

export function detectStopPhrase(transcript) {
  return /^\s*mina[\s,;:!?-]+arr[eê]te\b/iu.test(String(transcript ?? ''));
}
