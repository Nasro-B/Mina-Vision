// Logique PURE de la voix locale de secours (Kokoro ff_siwis) — tout ce qui se teste sans modèle :
// découpage en phrases pour le streaming, conversion float→PCM16, sélection du style par longueur.
// Le worker (local-voice-worker.mjs) n'ajoute que le chargement ONNX et la boucle stdio.

// Une phrase à la fois : à RTF ≈ 0,75 sur le CPU cible, la phrase suivante se calcule pendant que
// la précédente se joue — premier son rapide, lecture continue. Les morceaux trop longs sans
// ponctuation sont recoupés pour garder cette propriété.
const MAX_SENTENCE_LENGTH = 220;

export function splitSentences(text) {
  const normalized = String(text ?? '').replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  const raw = normalized.match(/[^.!?…]+[.!?…]*/gu) ?? [normalized];
  const sentences = [];
  for (const part of raw) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length <= MAX_SENTENCE_LENGTH) {
      sentences.push(trimmed);
      continue;
    }
    // Recoupe aux virgules d'abord, puis en dur — jamais de morceau démesuré.
    let remainder = trimmed;
    while (remainder.length > MAX_SENTENCE_LENGTH) {
      const comma = remainder.lastIndexOf(',', MAX_SENTENCE_LENGTH);
      const cut = comma > 40 ? comma + 1 : MAX_SENTENCE_LENGTH;
      sentences.push(remainder.slice(0, cut).trim());
      remainder = remainder.slice(cut).trim();
    }
    if (remainder) sentences.push(remainder);
  }
  return sentences;
}

export function floatToPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = Math.round(value * 32767);
  }
  return pcm;
}

// Réplique exacte du choix de style de kokoro-js : un vecteur de 256 floats par longueur de
// séquence, borné à l'index 509 — mesuré sur le .bin réel (522 240 octets = 510 × 256 × 4).
export function styleVectorOffset(tokenCount) {
  return 256 * Math.min(Math.max(Number(tokenCount) - 2, 0), 509);
}

export function sliceStyleVector(styleData, tokenCount) {
  if (!(styleData instanceof Float32Array)) throw new TypeError('local_voice_style_invalid');
  const offset = styleVectorOffset(tokenCount);
  if (offset + 256 > styleData.length) throw new Error('local_voice_style_out_of_range');
  return styleData.slice(offset, offset + 256);
}
