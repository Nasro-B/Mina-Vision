// Personnalité développeur de Mina Code : construit le prompt système du domaine « code »,
// l'enrichit avec les résultats d'action, et le compacte sans jamais perdre les règles absolues.

const RULES = Object.freeze([
  'GIT — Ne JAMAIS git push, git push --force, ni modifier les branches protégées. Format de commit : type(scope): message.',
  'ÉDITION — Modifier UNIQUEMENT les lignes nécessaires. Ne jamais reformater ou réécrire du code qui n\'est pas l\'objet du correctif.',
  'TESTS — Écrire d\'abord un test qui échoue, puis le code minimal qui le fait passer. Ne jamais déclarer « fait » sans suite verte.',
  'DIFFS MINIMAUX — Pas de reformatage massif. Pas de réécriture de fichier entier si 3 lignes suffisent.',
  'VÉRIFICATION — Après chaque édition : lancer les tests. Rouge → corriger. Vert → suite.',
  'SÉCURITÉ — Pas de secrets en dur. Pas d\'eval(). Pas d\'injection non sanitisée.',
  'PROJET — Lire MINA.md, AGENTS.md et CLAUDE.md du projet (ceux qui existent) avant toute modification.',
  'INCERTITUDE — Dire « je ne sais pas » plutôt qu\'inventer.',
  'PLAN — Décomposer en étapes vérifiables. Mettre à jour le statut à chaque étape.',
  'ARRÊT — Arrêt immédiat sur demande. Nettoyer les fichiers temporaires.',
]);

const MODES = new Set(['auto', 'local-first', 'local-only', 'best-quality', 'cheapest']);
const MAX_OBSERVATION_CHARS = 2_000;

const defaultEstimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

function describeProjectContext(projectContext) {
  if (!projectContext || typeof projectContext !== 'object') return null;
  const lines = [];
  if (projectContext.framework) lines.push(`Framework principal : ${projectContext.framework}`);
  if (Array.isArray(projectContext.frameworks) && projectContext.frameworks.length > 1) {
    lines.push(`Frameworks détectés : ${projectContext.frameworks.join(', ')}`);
  }
  if (projectContext.scripts && typeof projectContext.scripts === 'object') {
    const names = Object.keys(projectContext.scripts);
    if (names.length > 0) lines.push(`Scripts npm : ${names.join(', ')}`);
  }
  for (const [key, label] of [['minaMd', 'MINA.md'], ['agentsMd', 'AGENTS.md'], ['claudeMd', 'CLAUDE.md']]) {
    if (typeof projectContext[key] === 'string' && projectContext[key].length > 0) {
      lines.push(`--- ${label} (règles du projet, à respecter) ---`);
      lines.push(projectContext[key]);
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

function describePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return null;
  const marks = { completed: '[x]', in_progress: '[>]', failed: '[!]', skipped: '[~]' };
  const steps = plan.steps
    .map((step, index) => `${marks[step.status] ?? '[ ]'} ${index + 1}. ${step.description}`)
    .join('\n');
  return `Plan actif : ${plan.title ?? plan.id ?? 'sans titre'}\n${steps}`;
}

export function createCodePersonality({
  baseInstructions = '',
  estimateTokens = defaultEstimateTokens,
} = {}) {
  const rulesBlock = [
    'Tu es Mina Code, agent de développement local de Mina Vision. Règles absolues :',
    ...RULES.map((rule, index) => `${index + 1}. ${rule}`),
  ].join('\n');

  return Object.freeze({
    rules: RULES,

    buildSystemPrompt({ projectContext, plan, mode = 'auto', preferences } = {}) {
      if (!MODES.has(mode)) throw new Error(`code_personality_mode_invalid: ${mode}`);
      const sections = [rulesBlock];
      if (baseInstructions) sections.push(String(baseInstructions));
      const contextBlock = describeProjectContext(projectContext);
      if (contextBlock) sections.push(contextBlock);
      const planBlock = describePlan(plan);
      if (planBlock) sections.push(planBlock);
      sections.push(`Mode fournisseur : ${mode}.`);
      if (preferences && typeof preferences === 'object' && Object.keys(preferences).length > 0) {
        sections.push(`Préférences : ${Object.entries(preferences).map(([key, value]) => `${key}=${value}`).join(', ')}`);
      }
      return sections.join('\n\n');
    },

    updateWithResult({ currentPrompt, actionResult, observation } = {}) {
      if (typeof currentPrompt !== 'string' || currentPrompt.length === 0) {
        throw new Error('code_personality_prompt_required');
      }
      const parts = [currentPrompt];
      if (actionResult && typeof actionResult === 'object') {
        const status = actionResult.success === true ? 'succès' : 'échec';
        const detail = actionResult.error ? ` — ${actionResult.error}` : '';
        parts.push(`Dernière action (${actionResult.action ?? 'inconnue'}) : ${status}${detail}`);
      }
      if (observation !== undefined && observation !== null) {
        const text = String(observation);
        parts.push(`Observation : ${text.length > MAX_OBSERVATION_CHARS ? `${text.slice(0, MAX_OBSERVATION_CHARS)}…[tronqué]` : text}`);
      }
      return parts.join('\n\n');
    },

    compact({ prompt, maxTokens, priorityRules = true } = {}) {
      if (typeof prompt !== 'string') throw new Error('code_personality_prompt_required');
      if (!Number.isFinite(maxTokens) || maxTokens <= 0) throw new Error('code_personality_max_tokens_invalid');
      if (estimateTokens(prompt) <= maxTokens) return prompt;
      // Les règles absolues survivent toujours à la compaction ; le reste est tronqué par la fin
      // (l'historique récent, placé en queue, est plus utile que le milieu — on garde tête + queue).
      const head = priorityRules ? rulesBlock : '';
      const budgetChars = Math.max(0, maxTokens * 4 - head.length - 40);
      const rest = prompt.startsWith(head) ? prompt.slice(head.length) : prompt;
      const keptTail = rest.slice(Math.max(0, rest.length - budgetChars));
      return `${head}\n\n…[contexte compacté]…\n${keptTail}`;
    },
  });
}
