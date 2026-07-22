// Résumé parlable du journal pour la couche vocale déterministe. Module PUR — importé par le
// RENDERER : aucun import Node ici, jamais (la CSP du renderer bloque node:* ; un import
// node:crypto transitif a réellement tué le chargement de renderer.js le 2026-07-22).

export function composeJournalBrief(entries = []) {
  if (!entries.length) return "Mon journal d'activité est vide pour aujourd'hui.";
  const labels = {
    mission_started: 'mission lancée',
    mission_completed: 'mission terminée',
    mission_error: 'mission en erreur',
    action_error: 'action en erreur',
    voice_engine: 'bascule vocale',
    crash: 'incident interne',
  };
  const counts = new Map();
  for (const entry of entries) {
    const label = labels[entry.kind] ?? entry.kind;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([label, count]) => `${count} ${label}`).join(', ');
  return `Journal récent : ${summary}. Dernier événement : ${entries[0].kind}.`;
}
