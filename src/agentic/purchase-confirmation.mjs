// Passerelle de confirmation d'achat (SPEC-MINA-STANDARDISTE-001 §7 C6). « Mina doit pouvoir payer »,
// mais JAMAIS en silence : tout achat passe par cette passerelle qui (1) refuse au-dessus d'un PLAFOND
// configurable, (2) demande une CONFIRMATION EXPLICITE au propriétaire (récap article/montant/moyen),
// (3) journalise la décision (traçabilité : quoi, combien, quand, approuvé ou refusé). Elle NE touche
// PAS au moyen de paiement (le canal sécurisé — autofill/gestionnaire — est branché en aval, décision
// D8) : elle décide seulement SI on procède.
//
// PUR / injectable : `confirmOwner` (la confirmation propriétaire — UI/voix) et `journal` sont injectés
// → testable sans UI ni disque. Anti-injection : un achat ne peut être demandé que par le propriétaire
// (mission qu'il a lancée), jamais par un contenu observé (SMS/appel/page) — c'est la responsabilité de
// l'appelant de n'appeler `authorize` que depuis un contexte propriétaire.

export function createPurchaseConfirmation({ confirmOwner, journal, maxAmount = Infinity, allowedCurrencies = null, now = () => Date.now() } = {}) {
  if (typeof confirmOwner !== 'function' || typeof journal?.record !== 'function') {
    throw new TypeError('purchase_confirmation_dependencies_required');
  }
  const cap = Number.isFinite(maxAmount) ? maxAmount : Infinity;

  return Object.freeze({
    async authorize({ item, amount, currency = 'EUR', merchant = '', at = now() } = {}) {
      const amt = Number(amount);
      if (typeof item !== 'string' || !item.trim() || !Number.isFinite(amt) || amt <= 0) {
        throw new TypeError('purchase_request_invalid');
      }
      const base = { item: item.trim().slice(0, 200), amount: amt, currency: String(currency || 'EUR'), merchant: String(merchant || '').slice(0, 120), at };

      if (allowedCurrencies && !allowedCurrencies.includes(base.currency)) {
        journal.record(Object.freeze({ ...base, decision: 'denied_currency' }));
        return Object.freeze({ proceed: false, reason: 'devise_non_autorisee', ...base });
      }
      if (amt > cap) {
        // Plafond dépassé : refus AVANT toute confirmation (on ne propose même pas de payer au-dessus).
        journal.record(Object.freeze({ ...base, decision: 'denied_over_cap' }));
        return Object.freeze({ proceed: false, reason: 'plafond_depasse', cap, ...base });
      }
      const approved = (await confirmOwner(Object.freeze({ ...base }))) === true;
      journal.record(Object.freeze({ ...base, decision: approved ? 'approved' : 'rejected' }));
      return Object.freeze({ proceed: approved, reason: approved ? null : 'refus_proprietaire', ...base });
    },
  });
}
