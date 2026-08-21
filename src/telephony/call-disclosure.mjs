// Message d'information et consentement d'appel (SPEC-MINA-COMMS-001 §8.3, §8.4, §17). Transforme
// l'exigence RGPD en GATE de code : le texte de base §8.3 (validé comme base produit par Nasro, repris
// VERBATIM de la spec — jamais inventé) ne devient diffusable qu'une fois `legallyValidated` mis à true
// APRÈS revue juridique. Tant que ce n'est pas le cas, `disclosureText()` LÈVE et `canGoLive()` est
// false : Mina ne peut ni diffuser le message ni décrocher en live. Refus de l'appelant → terminer
// sans rien conserver (§8.5). Le numéro du caller ID doit être CONFIRMÉ avant d'entrer dans une tâche
// (§8.4). Module PUR, non câblé au runtime.

// §8.3 — texte définitif à VALIDER juridiquement avant activation live (le gate ci-dessous l'impose).
export const DISCLOSURE_BASE_TEXT = "Bonjour, je suis Mina, l'assistante IA de Sourire Concept. "
  + 'Cet échange est traité pour prendre votre message. '
  + "L'audio n'est pas conservé, mais une synthèse sera enregistrée. "
  + 'Vous pouvez refuser. Puis-je continuer ?';

export function createCallDisclosure({ legallyValidated = false, text = DISCLOSURE_BASE_TEXT } = {}) {
  const validated = legallyValidated === true;

  return Object.freeze({
    legallyValidated: validated,

    // Gate §17 : le décrochage live exige un texte validé juridiquement. Jamais automatique.
    canGoLive: () => validated,

    disclosureText() {
      if (!validated) throw new Error('call_disclosure_not_legally_validated');
      return text;
    },

    recordConsent(answer) {
      const granted = answer === true || answer === 'granted'
        || /^(oui|yes|d.accord|ok|continuez?)$/iu.test(String(answer ?? '').trim());
      if (!granted) return Object.freeze({ consent: 'refused', outcome: 'end_no_retention' }); // §8.5 : ne rien conserver
      return Object.freeze({ consent: 'granted', outcome: 'proceed' });
    },

    // §8.4 : le numéro issu du caller ID est PROPOSÉ mais doit être confirmé (égal + non vide).
    callerIdConfirmed(proposed, confirmed) {
      return typeof confirmed === 'string' && confirmed.length > 0 && confirmed === proposed;
    },
  });
}
