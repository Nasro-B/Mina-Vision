// Consignes du jour en langage libre (SPEC-MINA-STANDARDISTE-001 §7 C4). Le propriétaire écrit ou
// dicte les consignes qui pilotent le TON et le FOND des réponses d'appel/SMS du jour (« aujourd'hui
// dis aux clients que je rappelle après 16h »). Distinct des ROUTINES structurées (déclencheurs
// horaires) : ici c'est du texte libre injecté dans le contexte du cerveau.
//
// Portée temporelle STRICTE : seules les consignes du JOUR COURANT s'appliquent. Une consigne d'hier
// EXPIRE automatiquement (jamais appliquée par erreur le lendemain) — la comparaison se fait sur le
// jour local dans le fuseau configuré, pas sur un simple delta de millisecondes.
//
// PUR / injectable : `store` (persistance — chiffrée au runtime via le coffre, en clair dans les tests)
// et `clock` sont injectés → testable sans horloge réelle ni disque. Une consigne ne peut PAS ordonner
// une action sortante : elle oriente la rédaction, mais tout envoi reste soumis à la confirmation (§4.3).

function localDay(epochMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(epochMs).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function createDailyInstructions({ store, clock = () => Date.now(), timezone = 'Europe/Paris', maxLength = 4000 } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
    throw new TypeError('daily_instructions_store_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    // Écrit les consignes du jour. Un texte vide efface (jamais de consigne fantôme conservée).
    set(text, { at = now() } = {}) {
      const clean = String(text ?? '').trim().slice(0, maxLength);
      const record = clean ? Object.freeze({ day: localDay(at, timezone), text: clean, updatedAt: at }) : null;
      store.write(record);
      return record;
    },
    // Renvoie les consignes SI elles datent du jour courant, sinon '' (expiration silencieuse).
    current({ at = now() } = {}) {
      const record = store.read();
      if (!record || record.day !== localDay(at, timezone)) return '';
      return record.text;
    },
    clear() { store.write(null); },
  });
}
