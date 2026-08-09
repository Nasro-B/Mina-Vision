import { z } from 'zod';
import { redactSensitiveText } from '../research/network-evidence.mjs';

export const GROUNDED_RESPONSE_SAFE_TEXT = 'Je ne peux pas fournir une réponse factuelle vérifiée avec les preuves disponibles.';

const MAX_MODEL_OUTPUT = 16_384;
const MAX_SEGMENTS = 16;
const MAX_CITATIONS = 32;
const MAX_SEGMENT_TEXT = 4_096;
const MAX_EVIDENCE_FOR_MODEL = 10;
const MAX_EVIDENCE_EXTRACT = 1_000;

const modelSegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('creative'),
    text: z.string().min(1).max(MAX_SEGMENT_TEXT),
  }),
  z.strictObject({
    kind: z.literal('factual'),
    text: z.string().min(1).max(MAX_SEGMENT_TEXT),
    claimType: z.string().min(1).max(80),
    sourceRefs: z.array(z.string().min(1).max(128)).max(MAX_CITATIONS),
  }),
]);

const modelEnvelopeSchema = z.strictObject({
  segments: z.array(modelSegmentSchema).min(1).max(MAX_SEGMENTS),
  citations: z.array(z.strictObject({
    segmentIndex: z.number().int().min(0).max(MAX_SEGMENTS - 1),
    evidenceId: z.string().min(1).max(128),
  })).max(MAX_CITATIONS),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function safeResult(reason, details = {}) {
  return deepFreeze({ decision: 'block', text: GROUNDED_RESPONSE_SAFE_TEXT, reason, ...details });
}

function evidencePrompt(evidence, redactText) {
  const rendered = evidence
    .filter((item) => typeof item?.sourceId === 'string' && typeof item?.extract === 'string')
    .slice(0, MAX_EVIDENCE_FOR_MODEL)
    .map((item) => `[${item.sourceId}] ${redactText(item.extract).slice(0, MAX_EVIDENCE_EXTRACT)}`);
  return rendered.length > 0
    ? `Preuves réellement consultées, utilisables uniquement par leur identifiant :\n${rendered.join('\n')}`
    : 'Aucune preuve consultée n’est disponible pour une affirmation factuelle.';
}

const RESPONSE_INSTRUCTION = [
  'Réponds exclusivement par un objet JSON valide, sans balise Markdown ni texte autour.',
  'La forme exacte est {"segments":[...],"citations":[...]}.',
  'Un segment creative est réservé à une conversation sociale, une opinion explicitement annoncée ou un soutien sans fait vérifiable.',
  'Toute information factuelle, actuelle, action, recherche ou conclusion vérifiable doit être un segment factual avec claimType et sourceRefs.',
  'Chaque citation contient le segmentIndex factual et un evidenceId présent dans sourceRefs.',
  'N’invente ni preuve, ni identifiant de preuve, ni statut, ni claimId.',
].join(' ');

function parseOutput(output) {
  if (typeof output !== 'string' || output.length < 1 || output.length > MAX_MODEL_OUTPUT) {
    throw new Error('grounded_response_output_invalid');
  }
  return modelEnvelopeSchema.parse(JSON.parse(output));
}

function createClaimsInput(segments) {
  const claimIndexBySegment = new Map();
  const claims = [];
  segments.forEach((segment, segmentIndex) => {
    if (segment.kind !== 'factual') return;
    claimIndexBySegment.set(segmentIndex, claims.length);
    claims.push({ text: segment.text, kind: segment.claimType, sourceRefs: segment.sourceRefs });
  });
  return { claims, claimIndexBySegment };
}

function asDraft(segments, claims, claimIndexBySegment) {
  return {
    segments: segments.map((segment, segmentIndex) => (segment.kind === 'factual'
      ? { kind: 'factual', text: segment.text, claimId: claims[claimIndexBySegment.get(segmentIndex)].claimId }
      : { kind: 'creative', text: segment.text })),
  };
}

function asCitations(citations, claims, claimIndexBySegment) {
  const result = [];
  for (const citation of citations) {
    const claimIndex = claimIndexBySegment.get(citation.segmentIndex);
    if (claimIndex === undefined) throw new Error('grounded_response_citation_segment_invalid');
    result.push({ claimId: claims[claimIndex].claimId, evidenceId: citation.evidenceId });
  }
  return result;
}

export function createGroundedResponseService({ pipeline, redactText = redactSensitiveText } = {}) {
  if (!pipeline?.recordAndValidate || !pipeline?.gate || typeof redactText !== 'function') {
    throw new TypeError('grounded_response_dependencies_required');
  }

  return Object.freeze({
    async reply({ generate, messages, evidence = [], workSessionId, channel, maxOutput = MAX_SEGMENT_TEXT } = {}) {
      if (typeof generate !== 'function' || !Array.isArray(messages) || !Array.isArray(evidence)
        || typeof workSessionId !== 'string' || workSessionId.length < 1 || workSessionId.length > 128
        || typeof channel !== 'string' || channel.length < 1 || channel.length > 80
        || !Number.isInteger(maxOutput) || maxOutput < GROUNDED_RESPONSE_SAFE_TEXT.length || maxOutput > MAX_SEGMENT_TEXT) {
        throw new TypeError('grounded_response_request_invalid');
      }

      let envelope;
      const response = await generate({
        messages: [
          { role: 'system', content: RESPONSE_INSTRUCTION },
          { role: 'system', content: evidencePrompt(evidence, redactText) },
          ...messages,
        ],
        temperature: 0.3,
      });
      try {
        envelope = parseOutput(response?.output);
      } catch {
        return safeResult('grounded_response_invalid');
      }

      const renderedText = envelope.segments.map((segment) => segment.text).join('\n');
      if (renderedText.length > maxOutput) return safeResult('grounded_response_too_long');

      try {
        const { claims: claimInputs, claimIndexBySegment } = createClaimsInput(envelope.segments);
        const claims = pipeline.recordAndValidate({ workSessionId, claims: claimInputs, evidence });
        const citations = asCitations(envelope.citations, claims, claimIndexBySegment);
        const gated = pipeline.gate({
          draft: asDraft(envelope.segments, claims, claimIndexBySegment),
          claims,
          citations,
          channel,
        });
        if (gated.decision !== 'allow') {
          return deepFreeze({ decision: gated.decision, text: GROUNDED_RESPONSE_SAFE_TEXT, claims, citations, reason: 'grounded_response_gate_denied' });
        }
        if (gated.response.text.length > maxOutput) return safeResult('grounded_response_too_long');
        return deepFreeze({ decision: 'allow', text: gated.response.text, claims, citations });
      } catch {
        return safeResult('grounded_response_invalid');
      }
    },
  });
}
