// Routeur de canal de paiement (SPEC-MINA-STANDARDISTE-001 §7 C6, décision D8). Trois canaux sûrs sont
// supportés ; Mina choisit le meilleur DISPONIBLE selon le contexte, et n'émet qu'une INSTRUCTION de
// remplissage — jamais une valeur de carte/CVV/IBAN (règle intangible : Mina ne tape aucun identifiant
// de paiement en clair). Ordre de préférence par défaut, du plus sûr au moins sûr :
//   1. merchant_account  — moyen déjà enregistré chez le marchand (Mina ne touche AUCUNE donnée carte).
//   2. browser_autofill  — cartes du profil Chrome (le navigateur remplit, le propriétaire valide).
//   3. password_manager  — handoff vers un gestionnaire (le propriétaire approuve l'élément, il remplit).
// Aucun canal disponible → restitution au propriétaire (jamais de repli sur une saisie manuelle en clair).
// PUR / injectable (ordre surchargeable) → testable, générique.

export const PAYMENT_CHANNELS = Object.freeze(['merchant_account', 'browser_autofill', 'password_manager']);

const INSTRUCTION = Object.freeze({
  merchant_account: 'payer avec le moyen déjà enregistré chez le marchand (aucune donnée carte manipulée)',
  browser_autofill: 'déclencher l’autofill du navigateur et laisser le propriétaire valider dans Chrome',
  password_manager: 'demander au gestionnaire de mots de passe de remplir (approbation par élément du propriétaire)',
});

export function createPaymentChannelRouter({ preferredOrder = PAYMENT_CHANNELS } = {}) {
  const order = (Array.isArray(preferredOrder) ? preferredOrder : PAYMENT_CHANNELS).filter((c) => INSTRUCTION[c]);
  if (order.length === 0) throw new TypeError('payment_channel_router_order_invalid');

  return Object.freeze({
    // Choisit un canal SÛR selon ce qui est réellement disponible. Ne renvoie JAMAIS de credential.
    select({ merchantHasSavedMethod = false, browserAutofillAvailable = false, passwordManagerAvailable = false } = {}) {
      const availability = Object.freeze({
        merchant_account: merchantHasSavedMethod === true,
        browser_autofill: browserAutofillAvailable === true,
        password_manager: passwordManagerAvailable === true,
      });
      for (const channel of order) {
        if (availability[channel]) return Object.freeze({ channel, instruction: INSTRUCTION[channel] });
      }
      return Object.freeze({
        channel: null,
        instruction: 'aucun canal de paiement sécurisé disponible — restituer au propriétaire (jamais de saisie carte en clair)',
      });
    },
  });
}
