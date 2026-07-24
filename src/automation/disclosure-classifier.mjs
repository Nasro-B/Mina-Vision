// Classificateur de divulgation : la dépendance `disclosure_classifier` attendue par la
// simulation. Réponse à UNE question : « si cette automatisation part, quelles données de Nasro
// sortent, et à quel niveau ? ». Classification DÉTERMINISTE par inspection du payload des
// actions — motifs de clés + motifs de valeurs — jamais un jugement de modèle.

const SENSITIVE_KEY_PATTERNS = [
  /password|motdepasse|secret|token|cle|key|credential/iu,
  /iban|rib|carte|card|cvv|paiement|payment/iu,
  /sante|medical|ordonnance|diagnostic/iu,
];

const PERSONAL_KEY_PATTERNS = [
  /email|mail|courriel/iu,
  /phone|tel|numero/iu,
  /adresse|address|domicile/iu,
  /nom|name|prenom|contact/iu,
  /position|gps|localisation|location/iu,
];

const PERSONAL_VALUE_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/iu, // email
  /(?:\+?\d[\s.-]?){9,15}/u, // téléphone
];

function classifyValue(key, value) {
  const keyText = String(key ?? '');
  if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(keyText))) return 'sensitive';
  if (PERSONAL_KEY_PATTERNS.some((pattern) => pattern.test(keyText))) return 'personal';
  if (typeof value === 'string' && PERSONAL_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return 'personal';
  return 'none';
}

function walk(payload, found, depth = 0) {
  if (depth > 6 || payload == null || typeof payload !== 'object') return;
  for (const [key, value] of Object.entries(payload)) {
    const level = classifyValue(key, value);
    if (level !== 'none') found.push({ field: key, level });
    if (value && typeof value === 'object') walk(value, found, depth + 1);
  }
}

const LEVEL_ORDER = { none: 0, personal: 1, sensitive: 2 };

export function createDisclosureClassifier() {
  return async function classify(actions = []) {
    return Object.freeze(actions.map((action) => {
      const found = [];
      walk(action?.payload ?? {}, found);
      const level = found.reduce((max, item) => (LEVEL_ORDER[item.level] > LEVEL_ORDER[max] ? item.level : max), 'none');
      return Object.freeze({
        capability: String(action?.capability ?? ''),
        level,
        fields: Object.freeze(found.map((item) => item.field)),
      });
    }));
  };
}
