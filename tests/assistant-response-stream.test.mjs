import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  decodeAssistantResponseFrame,
  encodeAssistantResponseFrame,
} from '../src/contracts/assistant-response-stream.mjs';

const RESPONSE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SOURCE_EVENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const vectors = JSON.parse(readFileSync(new URL('./fixtures/protocol/mina-chat-payload-v2-vectors.json', import.meta.url), 'utf8')).vectors;

describe('contrat des réponses streamées Mina', () => {
  it('conserve le même lien source et des séquences strictes du début à la fin', () => {
    const started = decodeAssistantResponseFrame(encodeAssistantResponseFrame({
      type: 'assistant.response.started',
      responseId: RESPONSE_ID,
      sourceEventId: SOURCE_EVENT_ID,
      sequence: 0,
    }));
    const chunk = decodeAssistantResponseFrame(encodeAssistantResponseFrame({
      type: 'assistant.response.chunk',
      responseId: RESPONSE_ID,
      sourceEventId: SOURCE_EVENT_ID,
      sequence: 1,
      text: 'bon',
    }));
    const completed = decodeAssistantResponseFrame(encodeAssistantResponseFrame({
      type: 'assistant.response.completed',
      responseId: RESPONSE_ID,
      sourceEventId: SOURCE_EVENT_ID,
      sequence: 2,
      text: 'bonjour',
    }));

    expect(started).toEqual({
      type: 'assistant.response.started', responseId: RESPONSE_ID, sourceEventId: SOURCE_EVENT_ID,
      sequence: 0, text: null, code: null,
    });
    expect(chunk).toMatchObject({ type: 'assistant.response.chunk', sequence: 1, text: 'bon' });
    expect(completed).toMatchObject({ type: 'assistant.response.completed', sequence: 2, text: 'bonjour' });
  });

  it('refuse un fragment ambigu, un mauvais ordre initial ou un identifiant non ULID', () => {
    expect(() => encodeAssistantResponseFrame({
      type: 'assistant.response.started', responseId: RESPONSE_ID, sourceEventId: SOURCE_EVENT_ID,
      sequence: 0, text: 'ne doit pas exister',
    })).toThrow('assistant_response_started_body_invalid');
    expect(() => encodeAssistantResponseFrame({
      type: 'assistant.response.chunk', responseId: RESPONSE_ID, sourceEventId: SOURCE_EVENT_ID,
      sequence: 0, text: 'bon',
    })).toThrow('assistant_response_sequence_invalid');
    expect(() => encodeAssistantResponseFrame({
      type: 'assistant.response.completed', responseId: 'not-ulid', sourceEventId: SOURCE_EVENT_ID,
      sequence: 2, text: 'bonjour',
    })).toThrow('assistant_response_id_invalid');
  });

  it('rejoue le vecteur de réponse finale produit par Node et borne les codes d’échec', () => {
    const vector = vectors.find(({ name }) => name === 'assistant_response_completed');
    const payload = encodeAssistantResponseFrame({
      type: vector.type,
      responseId: vector.meta.responseId,
      sourceEventId: vector.meta.sourceEventId,
      sequence: vector.meta.sequence,
      text: Buffer.from(vector.binaryHex, 'hex').toString('utf8'),
    });

    expect(payload.toString('hex')).toBe(vector.payloadHex);
    expect(decodeAssistantResponseFrame(payload)).toMatchObject({
      type: 'assistant.response.completed', sequence: 2, text: 'bonjour', code: null,
    });
    expect(decodeAssistantResponseFrame(encodeAssistantResponseFrame({
      type: 'assistant.response.failed', responseId: RESPONSE_ID, sourceEventId: SOURCE_EVENT_ID,
      sequence: 3, code: 'provider_timeout',
    }))).toMatchObject({ type: 'assistant.response.failed', sequence: 3, text: null, code: 'provider_timeout' });
    expect(() => encodeAssistantResponseFrame({
      type: 'assistant.response.failed', responseId: RESPONSE_ID, sourceEventId: SOURCE_EVENT_ID,
      sequence: 3, code: 'arbitrary_provider_detail',
    })).toThrow('assistant_response_code_invalid');
  });
});
