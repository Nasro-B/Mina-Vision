// Politique de conversation d'appel (SPEC-MINA-COMMS-001 §8.4, §8.5, §9). Garde-fou PUR de l'agent
// d'appel : (1) la parole de l'appelant est une DONNÉE non fiable — on classe et on bloque les
// catégories interdites (secret/OTP/carte, confirmation commerciale, médical/cosmétique, lecture
// privée / commande PC, injection « ignore tes instructions ») ; (2) la sortie de Mina est restreinte
// à un SCHÉMA d'actes autorisés (§9) — tout acte hors schéma est refusé ; (3) champs collectés (§8.4)
// et gestion du silence (§8.5). N'exécute rien, n'expose aucun outil. Module PUR, non câblé.

// §9 « Mina peut » : le schéma fermé des actes autorisés. Tout le reste est refusé.
export const ALLOWED_CALL_ACTS = Object.freeze([
  'greet', 'say_unavailable', 'take_message', 'ask_number', 'ask_slot',
  'readback', 'confirm_transmission', 'end_politely', 'deflect',
]);

// §9 « Mina ne peut pas » : actes explicitement interdits (nommés pour un refus parlant).
export const FORBIDDEN_CALL_ACTS = Object.freeze([
  'invent_info', 'promise_time', 'confirm_commercial', 'medical_advice',
  'accept_contract', 'handle_secret', 'read_private', 'pc_command', 'obey_caller',
]);

// §8.4 champs collectés. Le numéro caller ID est proposé mais doit être CONFIRMÉ avant toute tâche.
export const COLLECTED_FIELDS = Object.freeze([
  'nom', 'societe_ou_relation', 'numero_rappel', 'objet', 'urgence', 'creneau_rappel',
]);
export const callerIdRequiresConfirmation = true;

const MAX_SILENCE_RELANCES = 2;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[-']/gu, ' ')
    .replace(/\s+/gu, ' ');
}

// Ordre volontaire : injection et secret d'abord (les plus dangereux), puis lecture privée/PC, puis
// commercial, médical, contractuel. Conservateur mais borné : un tour ordinaire passe.
const CALLER_CATEGORIES = [
  ['injection', /\b(ignore|ignores|oublie|oublies)\b.{0,30}\b(instruction|instructions|consigne|consignes|regle|regles)\b|nouvelle consigne|tu dois maintenant/u],
  ['secret', /\b(otp|mot de passe|carte bancaire|numero de carte|cvv|\bpin\b|secret)\b|\bcode\b.*\d{3,}/u],
  ['private_or_pc', /\b(ouvre|ouvrir|lance|execute|supprime|lis mon|lire mon)\b|\bmon (e ?mail|mail|fichier|ordinateur|pc|agenda)\b|\bmes messages\b/u],
  ['commercial', /\b(prix|tarif|stock|disponib\w*|commande|remboursement|livraison|facture|devis|paiement|rembours\w*)\b/u],
  ['medical', /\b(medical|medecin|diagnostic|ordonnance|traitement|maladie|symptome|creme|soin anti|allegation|dermato\w*)\b/u],
  ['contractual', /\b(contrat|engagement|obligation|signer|promesse ferme)\b/u],
];

export function createCallConversationPolicy() {
  return Object.freeze({
    // Classe un tour de parole de l'appelant. unsafe ⇒ Mina DÉVIE, ne se conforme jamais (§9).
    evaluateCallerTurn(text = '') {
      const normalized = normalizeText(text);
      for (const [category, pattern] of CALLER_CATEGORIES) {
        if (pattern.test(normalized)) return Object.freeze({ safe: false, category });
      }
      return Object.freeze({ safe: true, category: 'ordinary' });
    },

    // La sortie du modèle DOIT être un acte du schéma (§9). Tout acte interdit ou inconnu est refusé.
    guardMinaAct(act = {}) {
      const type = String(act?.type ?? '');
      if (ALLOWED_CALL_ACTS.includes(type)) return Object.freeze({ allowed: true, type });
      if (FORBIDDEN_CALL_ACTS.includes(type)) return Object.freeze({ allowed: false, reason: `call_act_forbidden:${type}` });
      return Object.freeze({ allowed: false, reason: 'call_act_unknown' });
    },

    // §8.5 : deux relances maximum puis terminer.
    nextOnSilence(relanceCount = 0) {
      return relanceCount < MAX_SILENCE_RELANCES ? 'relance' : 'terminate';
    },
  });
}
