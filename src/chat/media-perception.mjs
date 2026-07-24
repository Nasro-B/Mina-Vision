// Perception des médias reçus sur le canal `mina_app` (W7 des extras chat) : quand une pièce
// jointe (image) ou une note vocale a été réassemblée, vérifiée et stockée CHIFFRÉE, ce module la
// fait « percevoir » à Mina — l'image passe au fournisseur de vision, la note vocale à la
// transcription locale — puis inscrit l'échange en mémoire (la question du téléphone ET la réponse
// de Mina) et notifie l'interface pour l'afficher.
//
// Deux invariants non négociables :
//   1. HONNÊTE : si la vision ou la transcription n'est pas configurée/échoue, Mina l'écrit
//      explicitement (« gardée, analyse indisponible ») — jamais une légende inventée.
//   2. LOCAL/ÉPHÉMÈRE : les octets déchiffrés ne vivent qu'en mémoire vive le temps de l'analyse,
//      puis sont remis à zéro. Seul le texte (légende/transcription) est retenu, jamais le binaire.

const VISION_PROMPT = 'Décris précisément et brièvement cette image, en français.';

function kindOf(mime) {
  const value = String(mime ?? '');
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('audio/')) return 'voice';
  return 'other';
}

async function callText(capability, request) {
  const raw = await capability(request);
  const text = typeof raw === 'string' ? raw : (raw?.text ?? raw?.caption ?? raw?.transcript ?? '');
  return String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, 2_000);
}

export function createMediaPerception({
  loadMedia,
  rememberExchange,
  visionAnalyze = null,
  transcribe = null,
  notify = null,
  logger = null,
} = {}) {
  if (typeof loadMedia !== 'function' || typeof rememberExchange !== 'function') {
    throw new TypeError('media_perception_dependencies_required');
  }

  async function perceive({ deviceId, threadId = null, eventId, mediaId, mime, sizeBytes = 0 } = {}) {
    const kind = kindOf(mime);
    const media = await loadMedia(mediaId).catch(() => null);
    // Média illisible (absent/altéré) : on ne fabrique rien, on note l'incident.
    if (!media?.bytes) {
      logger?.append?.({ event: 'chat_media_perception_illisible', mediaId, kind });
      await tryRemember({ deviceId, eventId, kind, sizeBytes, mime,
        assistant: 'Média reçu mais illisible (déchiffrement impossible) — rien gardé.' });
      notify?.({ type: 'chat_media_received', mediaId, mime, kind, caption: null, readable: false });
      return Object.freeze({ mediaId, kind, perceived: false });
    }

    let caption = null;
    let understood = false;
    try {
      if (kind === 'image' && typeof visionAnalyze === 'function') {
        caption = await callText(visionAnalyze, { image: media.bytes, mimeType: media.mime, prompt: VISION_PROMPT });
        understood = caption.length > 0;
      } else if (kind === 'voice' && typeof transcribe === 'function') {
        caption = await callText(transcribe, { audio: media.bytes, mimeType: media.mime });
        understood = caption.length > 0;
      }
    } catch (error) {
      // L'analyse a le droit d'échouer (identifiants manquants, réseau, modèle non provisionné) :
      // on log la vraie cause et on retombe sur une note honnête, jamais sur une invention.
      logger?.append?.({ event: 'chat_media_perception_echec', mediaId, kind, error: String(error?.message ?? error).slice(0, 200) });
      caption = null;
      understood = false;
    } finally {
      if (Buffer.isBuffer(media.bytes)) media.bytes.fill(0);
    }

    const assistant = buildAssistantNote(kind, understood, caption);
    await tryRemember({ deviceId, eventId, kind, sizeBytes, mime, assistant });
    logger?.append?.({ event: 'chat_media_perception', mediaId, kind, understood });
    notify?.({ type: 'chat_media_received', mediaId, mime, kind, caption: understood ? caption : null, readable: true });
    return Object.freeze({ mediaId, kind, perceived: understood, caption: understood ? caption : null });
  }

  function buildAssistantNote(kind, understood, caption) {
    if (kind === 'image') {
      return understood ? `Je vois : ${caption}` : 'Image reçue et gardée. Analyse visuelle indisponible pour l’instant.';
    }
    if (kind === 'voice') {
      return understood ? `Note vocale : « ${caption} »` : 'Note vocale reçue et gardée. Transcription hors-ligne non activée.';
    }
    return 'Fichier reçu et gardé.';
  }

  function userLabel(kind, mime, sizeBytes) {
    const ko = Math.max(1, Math.round(Number(sizeBytes || 0) / 1024));
    if (kind === 'image') return `[Image envoyée — ${mime}, ${ko} Ko]`;
    if (kind === 'voice') return `[Note vocale envoyée — ${mime}, ${ko} Ko]`;
    return `[Fichier envoyé — ${mime}, ${ko} Ko]`;
  }

  // La mémoire peut être verrouillée : la perception reste utile (notification UI) même sans
  // écriture. On n'abandonne donc pas tout le chemin si rememberExchange refuse.
  async function tryRemember({ deviceId, eventId, kind, sizeBytes, mime, assistant }) {
    try {
      await rememberExchange({
        eventId,
        deviceId,
        userMessage: userLabel(kind, mime, sizeBytes),
        assistantMessage: assistant,
      });
    } catch (error) {
      logger?.append?.({ event: 'chat_media_perception_memoire', error: String(error?.message ?? error).slice(0, 160) });
    }
  }

  return Object.freeze({ perceive });
}
