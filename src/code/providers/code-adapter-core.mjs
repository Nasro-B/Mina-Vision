// Socle commun des adaptateurs code : enveloppe un provider texte EXISTANT de Mina Vision
// (contrat réel : { id, locality, network, capabilities, modelId, health(), invoke() }) en
// provider « code.generate » — prompt outillé pour produire un patch au format Mina, extraction
// du patch depuis la sortie, contrat registry conservé à l'identique.

const PATCH_START = '*** Begin Patch';
const PATCH_END = '*** End Patch';

export function extractMinaPatch(output) {
  const text = String(output ?? '');
  const start = text.indexOf(PATCH_START);
  if (start === -1) return null;
  const end = text.indexOf(PATCH_END, start);
  if (end === -1) return null;
  return text.slice(start, end + PATCH_END.length);
}

export function buildCodeMessages({ task, systemPrompt, context = null, files = [] }) {
  if (typeof task !== 'string' || task.trim().length === 0) throw new Error('code_adapter_task_required');
  const userParts = [task.trim()];
  if (context) userParts.push(`Contexte :\n${String(context).slice(0, 30_000)}`);
  for (const file of files) {
    if (file?.path && typeof file.content === 'string') {
      userParts.push(`Fichier ${file.path} :\n\`\`\`\n${file.content.slice(0, 30_000)}\n\`\`\``);
    }
  }
  return [
    {
      role: 'system',
      content: [
        systemPrompt ?? 'Tu es Mina Code, agent de développement.',
        `Réponds avec un patch au format Mina quand une modification de code est demandée :`,
        `${PATCH_START} / *** Update File: chemin / lignes contexte, -suppressions, +ajouts / ${PATCH_END}.`,
        'Diffs minimaux uniquement. Jamais de git push. Dire « je ne sais pas » plutôt qu\'inventer.',
      ].join('\n'),
    },
    { role: 'user', content: userParts.join('\n\n') },
  ];
}

export function createCodeProviderAdapter({ baseProvider, idSuffix = 'code', extraInstructions = null } = {}) {
  if (!baseProvider || typeof baseProvider.invoke !== 'function' || typeof baseProvider.health !== 'function') {
    throw new TypeError('code_adapter_base_provider_required');
  }

  async function generateCode({ task, systemPrompt, context, files, signal, onDelta } = {}) {
    const messages = buildCodeMessages({
      task,
      systemPrompt: extraInstructions ? `${systemPrompt ?? ''}\n${extraInstructions}`.trim() : systemPrompt,
      context,
      files,
    });
    const result = await baseProvider.invoke({ messages, stream: Boolean(onDelta), signal, onDelta });
    return Object.freeze({
      output: result.output ?? '',
      patch: extractMinaPatch(result.output),
      providerId: result.providerId ?? baseProvider.id,
      modelId: result.modelId ?? baseProvider.modelId ?? null,
      usage: result.usage ?? null,
      finishReason: result.finishReason ?? null,
    });
  }

  return Object.freeze({
    id: `${baseProvider.id}-${idSuffix}`,
    locality: baseProvider.locality,
    network: baseProvider.network,
    capabilities: Object.freeze(['code.generate']),
    modelId: baseProvider.modelId ?? null,
    health: () => baseProvider.health(),
    generateCode,
    invoke: generateCode,
  });
}
