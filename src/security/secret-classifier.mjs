const PATTERNS = Object.freeze([
  { type: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu },
  { type: 'api_key', regex: /\b(?:sk|pk|ghp|gho|ghu|ghs|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gu },
  { type: 'telegram_token', regex: /\b\d{6,10}:[A-Za-z0-9_-]{30,40}\b/gu },
  { type: 'password', regex: /\b(?:password|mot ?de ?passe|motdepasse|pwd)\s*[:=]\s*\S+/giu },
  { type: 'env_secret', regex: /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/gu },
]);

function detectOtp(text) {
  const matches = [];
  const re = /\b\d{4,8}\b/gu;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(text))) {
    const windowStart = Math.max(0, match.index - 30);
    const context = text.slice(windowStart, match.index).toLocaleLowerCase('fr-FR');
    if (/code|otp|v[ée]rification|confirmation/u.test(context)) {
      matches.push({ type: 'otp', value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  return matches;
}

// Standard ISO 7064 mod-97-10 IBAN checksum, chunked to stay within safe-integer range. Only ever
// called by detectIban() below with a candidate its own regex already shape-validated — no need to
// re-check the shape here.
function ibanChecksumValid(candidate) {
  const rearranged = candidate.slice(4) + candidate.slice(0, 4);
  const numeric = [...rearranged].map((ch) => (/[0-9]/u.test(ch) ? ch : String(ch.charCodeAt(0) - 55))).join('');
  let remainder = 0;
  for (const chunk of numeric.match(/.{1,7}/gu)) {
    remainder = Number(String(remainder) + chunk) % 97;
  }
  return remainder === 1;
}

function detectIban(text) {
  const matches = [];
  const re = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gu;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(text))) {
    if (ibanChecksumValid(match[0])) matches.push({ type: 'iban', value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return matches;
}

// Only ever called by detectCard() below, whose own regex already bounds the match to 12-19 digits.
function luhnValid(candidate) {
  const digits = candidate.replace(/\D/gu, '');
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (alternate) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function detectCard(text) {
  const matches = [];
  const re = /\b(?:\d[ -]?){12,19}\b/gu;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(text))) {
    if (luhnValid(match[0])) matches.push({ type: 'card', value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return matches;
}

// Later matches never override an earlier, longer match covering the same span — a whole
// `KEY=value` env line always wins over a narrower api_key match inside its value, for example.
function dedupeOverlaps(matches) {
  const sorted = [...matches].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const candidate of sorted) {
    if (!kept.some((entry) => candidate.start < entry.end && candidate.end > entry.start)) kept.push(candidate);
  }
  return kept;
}

export function classifySecrets(text) {
  const value = String(text ?? '');
  const matches = [];
  for (const { type, regex } of PATTERNS) {
    regex.lastIndex = 0;
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = regex.exec(value))) {
      matches.push({ type, value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  matches.push(...detectOtp(value), ...detectIban(value), ...detectCard(value));
  return dedupeOverlaps(matches);
}
