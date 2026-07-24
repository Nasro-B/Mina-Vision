// Routeur de modèles pour l'évaluation : la dépendance `model_router.route` attendue par
// l'evaluation-engine. Route chaque fixture vers la VRAIE chaîne de génération de Mina (injectée —
// même chaîne que Telegram/chat), impose une réponse JSON structurée et MESURE l'usage réel
// (latence). Pas de générateur → l'appel LÈVE et l'engine marque le candidat `suspended` : jamais
// un verdict inventé localement pour faire joli.

function extractJson(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('evaluation_reponse_sans_json');
  return JSON.parse(raw.slice(start, end + 1));
}

export function createEvaluationModelRouter({ generate, clock = () => Date.now() } = {}) {
  if (typeof generate !== 'function') throw new TypeError('evaluation_model_router_generate_required');

  return Object.freeze({
    async route({ candidate, fixture, signal } = {}) {
      const prompt = [
        `Tu évalues une affirmation pour le candidat « ${String(candidate ?? 'defaut')} ».`,
        `Question : ${String(fixture?.prompt ?? fixture?.question ?? '')}`,
        `Contexte : ${JSON.stringify(fixture?.context ?? {})}`,
        'Réponds UNIQUEMENT en JSON strict :',
        '{"claimSupported": true|false, "citations": ["id", ...], "action": "nom_action_ou_none"}',
      ].join('\n');

      const startedAt = Number(clock());
      const rawAnswer = await generate({ text: prompt, signal });
      const latencyMs = Math.max(0, Number(clock()) - startedAt);
      const text = typeof rawAnswer === 'string' ? rawAnswer : String(rawAnswer?.text ?? rawAnswer?.answer ?? '');
      const parsed = extractJson(text);

      if (typeof parsed.claimSupported !== 'boolean') throw new Error('evaluation_verdict_invalide');
      return Object.freeze({
        claimSupported: parsed.claimSupported,
        citations: Object.freeze(Array.isArray(parsed.citations) ? parsed.citations.map(String) : []),
        action: String(parsed.action ?? 'none'),
        usage: Object.freeze({
          latencyMs,
          // Estimation de tokens honnête : ~4 caractères par token, arrondi supérieur — mesuré sur
          // le texte réellement échangé, pas un chiffre au hasard.
          tokens: Math.ceil((prompt.length + text.length) / 4),
          costMicros: 0,
        }),
      });
    },
  });
}
