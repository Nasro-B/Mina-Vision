// Rendu des panneaux de domaine (e-mail, personnel, impression, maison, personnalité).
// Module PUR : aucun import Node, jamais — la CSP du renderer bloque node:* (incident du
// 2026-07-22). Aucune innerHTML non plus : le contrat de sécurité UI interdit l'injection HTML.

const EMPTY = 'Rien à afficher.';
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function listItem(text, { badge = null, badgeClass = 'badge', muted = null, action = null, actions = null } = {}) {
  const item = document.createElement('li');
  const label = document.createElement('strong');
  label.textContent = text;
  item.append(label);
  if (badge) {
    const chip = document.createElement('span');
    chip.className = badgeClass;
    chip.textContent = badge;
    item.append(' ', chip);
  }
  if (muted) {
    const detail = document.createElement('span');
    detail.className = 'muted';
    detail.textContent = ` — ${muted}`;
    item.append(detail);
  }
  // `action` (héritage, un seul bouton) ou `actions` (plusieurs) — boutons construits en DOM pur
  // (jamais innerHTML) ; la valeur voyage par dataset, pas par une chaîne interpolée dans du HTML.
  for (const entry of [...(actions ?? []), ...(action ? [action] : [])]) {
    if (!entry?.label || !entry?.name) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button ghost compact';
    button.textContent = entry.label;
    button.dataset.action = entry.name;
    button.dataset.value = String(entry.value ?? '');
    item.append(' ', button);
  }
  return item;
}

export function renderList(target, entries, mapper, { empty = EMPTY } = {}) {
  const list = typeof target === 'string' ? document.querySelector(target) : target;
  if (!list) return;
  list.textContent = '';
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    const placeholder = document.createElement('li');
    placeholder.className = 'muted';
    placeholder.textContent = empty;
    list.append(placeholder);
    return;
  }
  for (const entry of rows) {
    const shape = mapper(entry);
    if (shape) list.append(listItem(shape.text, shape));
  }
}

// « Indisponible » est un état HONNÊTE, pas une erreur masquée : quand un domaine n'est pas
// composé, on l'écrit tel quel avec sa raison au lieu d'afficher une liste vide trompeuse.
export function renderUnavailable(target, reason) {
  const list = typeof target === 'string' ? document.querySelector(target) : target;
  if (!list) return;
  list.textContent = '';
  const item = document.createElement('li');
  item.className = 'muted';
  item.textContent = `Indisponible — ${reason}`;
  list.append(item);
}

export const mailAccountRow = (account) => ({
  text: account?.address ?? account?.accountId ?? 'compte',
  badge: account?.state ?? account?.status ?? 'inconnu',
  badgeClass: account?.state === 'operational' || account?.status === 'operational' ? 'badge ready' : 'badge warning',
  muted: account?.provider ?? null,
});

export const mailMessageRow = (message) => ({
  text: message?.subject ?? '(sans objet)',
  muted: [message?.from, message?.date, Array.isArray(message?.attachments) && message.attachments.length > 0
    ? `${message.attachments.length} pièce(s) jointe(s)`
    : null].filter(Boolean).join(' · ') || null,
  actions: (Array.isArray(message?.attachments) ? message.attachments : [])
    .filter((attachment) => DIGEST.test(attachment?.digest ?? '') && attachment?.status === 'inspectable' && typeof message?.messageId === 'string')
    .map((attachment) => ({
      label: `Exporter ${attachment.declaredFilename ?? 'pièce jointe'}`,
      name: 'mail-export-attachment',
      value: JSON.stringify({
        messageId: message.messageId,
        digest: attachment.digest,
        suggestedName: attachment.declaredFilename ?? null,
      }),
    })),
});

export const taskRow = (task) => ({
  text: task?.title ?? task?.summary ?? 'tâche',
  badge: task?.status ?? null,
  badgeClass: task?.status === 'completed' ? 'badge ready' : 'badge',
  muted: task?.due ?? task?.dueDate ?? null,
});

export const routineRow = (routine) => ({
  text: routine?.name ?? routine?.routineId ?? 'routine',
  badge: routine?.status ?? null,
  badgeClass: routine?.status === 'active' ? 'badge ready' : 'badge',
});

export const contactRow = (contact) => ({
  text: contact?.displayName ?? contact?.name ?? 'contact',
  muted: contact?.endpoint ?? contact?.email ?? null,
});

// Appareil appairé au canal `mina_app`. « Connecté » ne s'affiche que si le PC voit vraiment
// une session ouverte — approuvé et connecté sont deux choses différentes.
export const chatDeviceRow = (device) => ({
  text: `${device?.label ?? device?.deviceId ?? 'appareil'} — époque ${device?.keyEpoch ?? '?'}`,
  badge: device?.connected ? 'connecté' : 'appairé',
  badgeClass: device?.connected ? 'badge ready' : 'badge',
  muted: device?.lastSeenAtMs
    ? `vu ${new Date(device.lastSeenAtMs).toLocaleString('fr-FR')}`
    : 'jamais connecté depuis l’appairage',
  actions: [
    // W6 : envoi d'un fichier PC → téléphone, seulement si l'appareil est CONNECTÉ maintenant
    // (l'envoi direct exige une session active — pas de file fantôme).
    ...(device?.connected ? [{ label: 'Envoyer un fichier', name: 'chat-send-file', value: device?.deviceId ?? '' }] : []),
    { label: 'Révoquer', name: 'chat-revoke', value: device?.deviceId ?? '' },
  ],
});

export const printerRow = (printer) => ({
  text: printer?.name ?? printer?.printerId ?? 'imprimante',
  badge: printer?.approved === true ? 'autorisée' : 'non autorisée',
  badgeClass: printer?.approved === true ? 'badge ready' : 'badge warning',
  muted: printer?.status ?? null,
});

export const homeDeviceRow = (device) => ({
  text: device?.name ?? device?.deviceId ?? 'appareil',
  badge: device?.reachable === true ? 'joignable' : 'injoignable',
  badgeClass: device?.reachable === true ? 'badge ready' : 'badge warning',
  muted: device?.room ?? device?.connector ?? null,
});

export const homeAuditRow = (event) => ({
  text: event?.command ?? event?.action ?? 'commande',
  badge: event?.outcome ?? event?.result ?? null,
  badgeClass: event?.outcome === 'applied' ? 'badge ready' : 'badge',
  muted: event?.deviceId ?? null,
});

export const personalityRow = ([label, value]) => ({
  text: label,
  muted: value == null || value === '' ? 'non défini' : String(value),
});
