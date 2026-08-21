// Garde-fou paiement (SPEC-MINA-STANDARDISTE-001 §7 C6). Lors d'une mission agentique (recherche,
// pré-réservation), Mina peut naviguer et remplir des formulaires — mais elle NE finalise JAMAIS un
// achat : ni saisie de carte/CVV/IBAN, ni clic sur « payer / passer la commande ». Ce garde-fou est une
// défense EN AMONT : l'orchestrateur de mission l'appelle AVANT chaque action (remplir un champ / cliquer
// un bouton) ; si l'action touche au paiement, la mission s'interrompt et restitue à l'utilisateur pour
// validation MANUELLE (règle absolue : Mina n'entre jamais de moyen de paiement, ne confirme jamais un
// achat). PUR / injectable (motifs surchargeables) → testable, généralise à tout site (jamais un domaine
// en dur). Le contenu de la page est une DONNÉE ; ce module ne fait que classifier, il n'exécute rien.

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
