// Rendu des panneaux de domaine (e-mail, personnel, impression, maison, personnalité).
// Module PUR : aucun import Node, jamais — la CSP du renderer bloque node:* (incident du
// 2026-07-22). Aucune innerHTML non plus : le contrat de sécurité UI interdit l'injection HTML.

const EMPTY = 'Rien à afficher.';

function listItem(text, { badge = null, badgeClass = 'badge', muted = null } = {}) {
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
  muted: [message?.from, message?.date].filter(Boolean).join(' · ') || null,
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
