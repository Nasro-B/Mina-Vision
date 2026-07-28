const STATES = Object.freeze({
  idle: Object.freeze({ mode: 'idle', label: 'Dites « Salut Mina »', detail: 'Mina Vision est prête' }),
  listening: Object.freeze({ mode: 'listening', label: 'Je vous écoute', detail: 'Microphone actif · voix analysée en direct' }),
  thinking: Object.freeze({ mode: 'thinking', label: 'Je réfléchis', detail: 'Demande reçue · préparation de la réponse' }),
  speaking: Object.freeze({ mode: 'speaking', label: 'Mina répond', detail: 'Voix naturelle · interruption possible à tout moment' }),
  error: Object.freeze({ mode: 'error', label: 'Voix indisponible', detail: 'Consultez les erreurs techniques' }),
});

const EVENT_STATE = Object.freeze({
  capture_started: 'listening',
  transcript_final: 'thinking',
  audio_chunk: 'speaking',
  playback_finished: 'listening',
  capture_stopped: 'idle',
  failure: 'error',
});

const COLORS = Object.freeze({
  idle: ['#2fc7b9', '#0f998e'],
  listening: ['#5debdc', '#2fc7b9'],
  thinking: ['#b58cff', '#7558d9'],
  speaking: ['#ff9d82', '#ef7266'],
  error: ['#ff786d', '#b83f38'],
});

const ANIMATIONS = new Set(['mina', 'cloudzir']);
const ANIMATION_STORAGE_KEY = 'mina.voice.animation';
const CLOUDZIR_PALETTE_STORAGE_KEY = 'mina.voice.cloudzirPalette';

// Colour ONLY. The CloudZIR shape lives entirely in the @keyframes transforms (scaleX/scaleY/
// translateY) and the bar geometry in styles.css — nothing here touches those, so switching
// palette can never alter the animation's form, only its gradient. "emeraude" is first so the
// existing look stays the default.
export const CLOUDZIR_PALETTES = Object.freeze([
  Object.freeze({ id: 'emeraude', label: 'Émeraude', from: '#10b981', to: '#059669' }),
  Object.freeze({ id: 'azur', label: 'Azur', from: '#38bdf8', to: '#0369a1' }),
  Object.freeze({ id: 'violet', label: 'Violet', from: '#c084fc', to: '#7c3aed' }),
  Object.freeze({ id: 'corail', label: 'Corail', from: '#fb7185', to: '#be123c' }),
  Object.freeze({ id: 'ambre', label: 'Ambre', from: '#fbbf24', to: '#d97706' }),
  Object.freeze({ id: 'glace', label: 'Glace', from: '#e0f2fe', to: '#7dd3fc' }),
]);

export function normalizeCloudzirPalette(value) {
  return CLOUDZIR_PALETTES.some((palette) => palette.id === value) ? value : CLOUDZIR_PALETTES[0].id;
}

export function nextCloudzirPalette(current) {
  // Normalize first: an unknown id is treated as the default palette, so one click still advances
  // to the SECOND one rather than appearing to do nothing by landing back on the default.
  const index = CLOUDZIR_PALETTES.findIndex((palette) => palette.id === normalizeCloudzirPalette(current));
  return CLOUDZIR_PALETTES[(index + 1) % CLOUDZIR_PALETTES.length].id;
}

export function cloudzirPaletteColors(id) {
  const palette = CLOUDZIR_PALETTES.find((entry) => entry.id === id) ?? CLOUDZIR_PALETTES[0];
  return Object.freeze({ from: palette.from, to: palette.to });
}

export function createCloudzirPalettePreference({ storage, key = CLOUDZIR_PALETTE_STORAGE_KEY } = {}) {
  if (!storage?.getItem || !storage?.setItem || typeof key !== 'string' || !key) {
    throw new TypeError('cloudzir_palette_preference_dependencies_required');
  }
  return Object.freeze({
    load() {
      try { return normalizeCloudzirPalette(storage.getItem(key)); } catch { return CLOUDZIR_PALETTES[0].id; }
    },
    save(value) {
      const normalized = normalizeCloudzirPalette(value);
      try { storage.setItem(key, normalized); } catch { /* preference remains valid for this session */ }
      return normalized;
    },
  });
}

export function normalizeVoiceAnimation(value) {
  return ANIMATIONS.has(value) ? value : 'mina';
}

export function createVoiceAnimationPreference({ storage, key = ANIMATION_STORAGE_KEY } = {}) {
  if (!storage?.getItem || !storage?.setItem || typeof key !== 'string' || !key) {
    throw new TypeError('voice_animation_preference_dependencies_required');
  }
  return Object.freeze({
    load() {
      try { return normalizeVoiceAnimation(storage.getItem(key)); } catch { return 'mina'; }
    },
    save(value) {
      const normalized = normalizeVoiceAnimation(value);
      try { storage.setItem(key, normalized); } catch { /* preference remains valid for this session */ }
      return normalized;
    },
  });
}

// After a barge-in the server stops generating, but chunks already in flight still arrive and
// must not be replayed (they belong to the killed turn). The window is deliberately SHORT and
// self-expiring: a flag cleared only by an explicit event would leave every later conversational
// reply silently dropped — the "des fois je l'entends, des fois non" failure.
export const PLAYBACK_SUPPRESSION_MS = 1_200;

export function isPlaybackSuppressed({ suppressedAt, now, windowMs = PLAYBACK_SUPPRESSION_MS } = {}) {
  if (!Number.isFinite(suppressedAt) || suppressedAt <= 0) return false;
  return now - suppressedAt < windowMs;
}

// ——— Bouclier de lecture ———
// Pendant qu'une réplique déterministe est lue, l'écho des haut-parleurs (imparfaitement annulé)
// déclenche le VAD serveur qui TUE la génération — le long brief des capacités mourait en boucle
// (« liste tes outils » → mute → « et voilà »). Le bouclier coupe l'ENVOI micro au serveur pendant
// la lecture ; le barge-in réel reste possible via le détecteur local d'énergie ci-dessous.
const READBACK_SHIELD_BASE_MS = 1_500;
const READBACK_SHIELD_PER_CHAR_MS = 70; // parole française ≈ 14 caractères/s
const READBACK_SHIELD_MAX_MS = 45_000;

export function readbackShieldDuration(text) {
  const length = String(text ?? '').length;
  if (length === 0) return 0;
  return Math.min(READBACK_SHIELD_BASE_MS + length * READBACK_SHIELD_PER_CHAR_MS, READBACK_SHIELD_MAX_MS);
}

export function isShieldActive({ shieldUntil, now } = {}) {
  return Number.isFinite(shieldUntil) && shieldUntil > 0 && now < shieldUntil;
}

// Après la fin RÉELLE de la parole, on laisse ce délai avant de rouvrir le micro : le temps que la
// queue d'écho des haut-parleurs retombe. Couvre aussi un creux passager entre deux chunks d'un long
// brief (jitter IPC/réseau) — bien plus court que ce délai, donc jamais pris pour une vraie fin.
export const READBACK_SHIELD_TAIL_MS = 900;

// Le bouclier micro tient tant que la voix de Mina COULE réellement — pas seulement pendant la borne
// estimée. Trois phases : (1) avant le premier chunk du tour (`lastAudioAt <= armedAt`), on mute en
// attendant que la lecture démarre ; (2) pendant la salve (file non vide OU dernier chunk < tailMs),
// on tient — un creux passager de la file au milieu d'un long brief ne rouvre PLUS le micro ; (3) à
// la fin réelle (file vide ET dernier chunk ≥ tailMs), on rouvre. Sans la phase (2), le brief long
// « que sais-tu faire » se faisait tuer par son propre écho pendant un creux de file, et le modèle
// enchaînait une clôture (« et voilà ») en croyant avoir déjà tout énoncé. Sans la borne estimée en
// garde-fou (isShieldActive), un silence anormal laisserait le micro muet indéfiniment.
export function isReadbackShieldHolding({
  shieldUntil, now, armedAt = 0, queuedSources = 0, lastAudioAt = 0, tailMs = READBACK_SHIELD_TAIL_MS,
} = {}) {
  if (!isShieldActive({ shieldUntil, now })) return false;
  const audioStarted = Number.isFinite(lastAudioAt) && lastAudioAt > (Number.isFinite(armedAt) ? armedAt : 0);
  if (!audioStarted) return true; // lecture pas encore commencée : on garde le micro muet
  if (queuedSources > 0) return true; // audio en cours de rendu
  return (now - lastAudioAt) < tailMs; // vient de jouer : tient sur un creux, rouvre à la vraie fin
}

// Vraie prise de parole = énergie SOUTENUE nettement au-dessus de l'écho résiduel post-AEC.
// L'écho retombe entre les syllabes ; une voix proche tient le niveau — d'où le critère de durée.
export function createBargeInDetector({ threshold = 0.09, sustainMs = 350, frameMs = 85 } = {}) {
  let accumulatedMs = 0;
  return Object.freeze({
    push(level) {
      if (Number.isFinite(level) && level >= threshold) {
        accumulatedMs += frameMs;
      } else {
        accumulatedMs = 0;
      }
      return accumulatedMs >= sustainMs;
    },
    reset() { accumulatedMs = 0; },
  });
}

export function reduceVoicePresence(current = STATES.idle, event = {}) {
  const next = EVENT_STATE[event?.type];
  return next ? STATES[next] : current;
}

export function normalizeVoiceLevel(value) {
  if (ArrayBuffer.isView(value)) {
    if (value.length === 0) return 0;
    let sum = 0;
    for (const sample of value) sum += Number.isFinite(sample) ? sample * sample : 0;
    return Math.min(1, Math.sqrt(sum / value.length));
  }
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function createVoicePresence({
  canvas, container, label, detail,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  reducedMotion = false,
} = {}) {
  if (!canvas?.getContext || !container?.dataset || !label || !detail
    || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
    throw new TypeError('voice_presence_dependencies_required');
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('voice_presence_canvas_unavailable');
  let state = STATES.idle;
  let level = 0;
  let frameId = null;
  let destroyed = false;

  const syncActivity = () => {
    container.dataset.audioActivity = state.mode === 'speaking' || (state.mode === 'listening' && level > 0.05)
      ? 'active'
      : state.mode === 'listening' ? 'idle' : 'off';
  };

  const syncText = () => {
    canvas.dataset.voiceState = state.mode;
    container.dataset.voiceState = state.mode;
    label.textContent = state.label;
    detail.textContent = state.detail;
    syncActivity();
  };

  const render = (timestamp = 0) => {
    const width = Math.max(1, canvas.clientWidth || 320);
    const height = Math.max(1, canvas.clientHeight || 220);
    const ratio = Math.max(1, Math.min(2, devicePixelRatio));
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const phase = reducedMotion ? 0 : timestamp / 1_000;
    const [primary, secondary] = COLORS[state.mode];
    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height) * 0.25;
    const response = state.mode === 'listening' ? level * base * 0.42 : state.mode === 'speaking' ? base * 0.16 : 0;
    const pulse = state.mode === 'thinking' ? (Math.sin(phase * 3.2) + 1) * base * 0.055 : 0;
    const radius = base + response + pulse;

    const glow = context.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * 1.55);
    glow.addColorStop(0, `${primary}cc`);
    glow.addColorStop(0.35, `${secondary}44`);
    glow.addColorStop(1, `${secondary}00`);
    context.beginPath();
    context.arc(cx, cy, radius * 1.55, 0, Math.PI * 2);
    context.fillStyle = glow;
    context.fill();

    context.save();
    context.strokeStyle = primary;
    context.lineWidth = 1.2;
    for (let ring = 0; ring < 3; ring += 1) {
      context.globalAlpha = 0.2 + ring * 0.13;
      context.beginPath();
      context.arc(cx, cy, radius * (0.68 + ring * 0.2), phase * (ring % 2 ? -0.4 : 0.45), Math.PI * (1.25 + ring * 0.28));
      context.stroke();
    }
    context.restore();

    const points = reducedMotion ? 28 : 52;
    context.beginPath();
    for (let index = 0; index < points; index += 1) {
      const angle = (index / points) * Math.PI * 2 + phase * (state.mode === 'thinking' ? 0.72 : 0.24);
      const noise = Math.sin(index * 2.17 + phase * 2.4) * (base * 0.08 + response * 0.22);
      const r = radius + noise;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.72;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath?.();
    context.strokeStyle = primary;
    context.globalAlpha = 0.78;
    context.lineWidth = 1.4;
    context.stroke();

    for (let index = 0; index < points; index += 1) {
      const angle = (index / points) * Math.PI * 2 + phase * 0.2;
      const r = radius * (0.72 + ((index * 17) % 19) / 48) + Math.sin(index + phase * 2) * response * 0.3;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.72;
      context.beginPath();
      context.arc(x, y, 0.8 + (index % 4) * 0.22, 0, Math.PI * 2);
      context.fillStyle = index % 5 === 0 ? secondary : primary;
      context.globalAlpha = 0.42 + (index % 3) * 0.18;
      context.fill();
    }
    context.globalAlpha = 1;
  };

  const loop = (timestamp) => {
    if (destroyed) return;
    render(timestamp);
    frameId = requestFrame(loop);
  };

  syncText();
  container.dataset.animation = 'mina';
  frameId = requestFrame(loop);
  return Object.freeze({
    dispatch(event) {
      state = reduceVoicePresence(state, event);
      if (state.mode !== 'listening') level = 0;
      syncText();
      return state;
    },
    setAnimation(value) {
      const animation = normalizeVoiceAnimation(value);
      container.dataset.animation = animation;
      return animation;
    },
    setLevel(value) {
      const next = normalizeVoiceLevel(value);
      level = level * 0.68 + next * 0.32;
      syncActivity();
      return level;
    },
    render,
    state: () => state,
    destroy() {
      destroyed = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },
  });
}
