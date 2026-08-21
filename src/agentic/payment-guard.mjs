// Détecteur d'étape de paiement (SPEC-MINA-STANDARDISTE-001 §7 C6). Lors d'une mission agentique, Mina
// PEUT finaliser un achat — mais un paiement n'est JAMAIS silencieux ni autonome : ce module repère
// l'instant où l'action touche au paiement (champ carte/CVV/IBAN, bouton « payer / passer la commande »,
// validation sur page de paiement) et renvoie `blocked:true` pour que l'orchestrateur OUVRE UNE
// CONFIRMATION EXPLICITE (article + montant + moyen) au propriétaire AVANT de procéder. `blocked` = « ne
// pas continuer sans confirmation », pas « abandonner à jamais » : sur OK propriétaire, la mission
// reprend et l'achat se termine.
//
// RÈGLE DE SÉCURITÉ INTANGIBLE : Mina n'entre JAMAIS un identifiant de paiement en clair (numéro de carte,
// CVV, IBAN) depuis une config ou un fichier. Un champ carte détecté ici DÉCLENCHE le remplissage par
// l'AUTOFILL sécurisé du navigateur / un gestionnaire de mots de passe (le propriétaire approuve l'élément
// dans SON interface), pas une saisie au clavier par Mina. C'est pourquoi le champ carte reste signalé même
// quand le paiement est autorisé : il route vers le canal sécurisé, il ne l'interdit pas.
//
// PUR / injectable (motifs surchargeables) → testable, généralise à tout site (jamais un domaine en dur).
// Le contenu de la page est une DONNÉE ; ce module ne fait que classifier, il n'exécute rien.

const CARD_FIELD = /card.?number|num[ée]ro de carte|carte bancaire|carte de cr[ée]dit|\bcvv\b|\bcvc\b|\bcsc\b|crypto?gramme|iban|\bbic\b|exp(iry|iration)|date d'expiration|\bcc-(number|csc|exp)/iu;
const PAY_ACTION = /\b(pay|payer|payer maintenant|passer (la )?commande|valider (la )?commande|valider le paiement|confirmer (l'|le |la )?(achat|commande|paiement|r[ée]servation)|place (the )?order|buy now|acheter( maintenant)?|proceed to (payment|checkout)|complete purchase|r[ée]server et payer)\b/iu;
const PAY_URL = /\/(checkout|payment|paiement|billing|pay|order-?confirm|purchase)\b/iu;
const SUBMIT_LABEL = /submit|valider|continuer|suivant|next|confirmer|proceed|terminer|finaliser/iu;

function blocked(reason, evidence) {
  return Object.freeze({ blocked: true, reason, evidence: String(evidence).slice(0, 200) });
}

export function createPaymentGuard({ cardField = CARD_FIELD, payAction = PAY_ACTION, payUrl = PAY_URL, submitLabel = SUBMIT_LABEL } = {}) {
  return Object.freeze({
    // Inspecte l'action que Mina S'APPRÊTE à exécuter. Renvoie {blocked:true, reason, evidence} pour
    // interrompre, ou {blocked:false} pour laisser passer. Aucun effet de bord.
    inspect({ url = '', actionLabel = '', fieldName = '', fieldLabel = '', fieldAutocomplete = '' } = {}) {
      const fieldSignature = `${fieldName} ${fieldLabel} ${fieldAutocomplete}`.trim();
      if (fieldSignature && cardField.test(fieldSignature)) {
        return blocked('champ de paiement (carte/CVV/IBAN)', fieldSignature);
      }
      const label = String(actionLabel ?? '');
      if (label && payAction.test(label)) {
        return blocked('bouton de paiement / passage de commande', label);
      }
      if (label && submitLabel.test(label) && payUrl.test(String(url))) {
        return blocked('validation sur une page de paiement', `${url} :: ${label}`);
      }
      return Object.freeze({ blocked: false });
    },
  });
}
