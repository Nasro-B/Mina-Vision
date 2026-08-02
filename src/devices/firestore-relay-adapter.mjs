// Façade Firestore du relais : la SEULE partie du canal qui parle au SDK Firebase.
//
// Le reste du code ne connaît que `{ watch, put, remove }`, ce qui garde le relais testable sans
// réseau et rend le fournisseur remplaçable. Aucun contenu en clair ne passe ici : les documents
// sont déjà chiffrés et signés quand ils arrivent.

import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection, deleteDoc, doc, getFirestore, onSnapshot, query, setDoc, where,
} from 'firebase/firestore';

const COLLECTION = 'relay';

/**
 * @param {object} options
 * @param {object} options.config configuration Firebase (issue de google-services.json)
 * @param {string} options.appName nom d'instance, pour ne pas entrer en conflit avec la sauvegarde
 */
export async function createFirestoreRelayAdapter({ config, appName = 'mina-chat-relay' } = {}) {
  if (!config?.projectId || !config?.apiKey || !config?.appId) {
    throw new TypeError('firestore_relay_config_incomplete');
  }
  const app = initializeApp(config, appName);
  // Session anonyme : les règles exigent une authentification. Ce n'est PAS la sécurité du
  // canal — celle-ci tient à la signature et au chiffrement, vérifiés côté PC.
  await signInAnonymously(getAuth(app));
  const database = getFirestore(app);

  return Object.freeze({
    watch(target, handler) {
      const scoped = query(collection(database, COLLECTION), where('target', '==', target));
      return onSnapshot(
        scoped,
        (snapshot) => {
          const documents = snapshot.docChanges()
            .filter((change) => change.type === 'added')
            .map((change) => change.doc.data());
          if (documents.length > 0) void handler(documents);
        },
        // Une erreur d'écoute ne doit pas passer inaperçue : sans ça, le relais paraîtrait
        // fonctionner alors qu'il n'écoute plus rien.
        (error) => handler.onError?.(error),
      );
    },

    async put(document) {
      await setDoc(doc(database, COLLECTION, document.eventId), document);
    },

    async remove(eventId) {
      await deleteDoc(doc(database, COLLECTION, eventId));
    },
  });
}

/** Extrait la configuration client depuis un `google-services.json`. */
export function firebaseConfigFromGoogleServices(googleServices, packageName = 'fr.mina.gateway') {
  const client = (googleServices?.client ?? [])
    .find((entry) => entry?.client_info?.android_client_info?.package_name === packageName);
  if (!client) throw new Error('google_services_client_introuvable');
  const apiKey = client.api_key?.[0]?.current_key;
  if (!apiKey) throw new Error('google_services_api_key_absente');
  return Object.freeze({
    apiKey,
    appId: client.client_info.mobilesdk_app_id,
    authDomain: `${googleServices.project_info.project_id}.firebaseapp.com`,
    projectId: googleServices.project_info.project_id,
    messagingSenderId: googleServices.project_info.project_number,
    storageBucket: googleServices.project_info.storage_bucket,
  });
}
