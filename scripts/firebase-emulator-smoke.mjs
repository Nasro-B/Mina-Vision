import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, deleteDoc, doc, getFirestore, setDoc } from 'firebase/firestore';
import { connectStorageEmulator, deleteObject, getStorage, ref, uploadBytes } from 'firebase/storage';

const LOOPBACK = Object.freeze({ host: '127.0.0.1', auth: 9099, firestore: 8080, storage: 9199 });
const PROJECT_ID = 'mina-vision';

function assertEmulatorEnvironment() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `${LOOPBACK.host}:${LOOPBACK.firestore}`) {
    throw new Error('firebase_emulator_environment_required');
  }
}

async function expectsPermissionDenied(operation) {
  try {
    await operation();
  } catch (error) {
    if (['permission-denied', 'storage/unauthorized'].includes(error?.code)) return;
    throw error;
  }
  throw new Error('firebase_emulator_rule_not_enforced');
}

assertEmulatorEnvironment();

const app = initializeApp({
  apiKey: 'emulator-public-key',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  appId: '1:000000000000:android:1f50486ff6bdffdf00f233',
}, 'mina-emulator-smoke');

const auth = getAuth(app);
connectAuthEmulator(auth, `http://${LOOPBACK.host}:${LOOPBACK.auth}`, { disableWarnings: true });
const { user } = await signInAnonymously(auth);

const firestore = getFirestore(app);
connectFirestoreEmulator(firestore, LOOPBACK.host, LOOPBACK.firestore);
const eventId = 'emulator-relay-event';
const relay = doc(firestore, 'relay', eventId);
const envelope = Object.freeze({
  version: 2,
  eventId,
  threadId: 'emulator-thread',
  senderDeviceId: 'emulator-device',
  deviceSequence: 1,
  keyEpoch: 1,
  routingClass: 'chat',
  createdAtMs: Date.now(),
  expiresAtMs: Date.now() + 60_000,
  payloadCiphertext: 'AQID',
  nonce: 'nonce',
  authTag: 'tag',
  signature: 'signature',
  target: 'pc',
  relayedAtMs: Date.now(),
});

const storage = getStorage(app);
connectStorageEmulator(storage, LOOPBACK.host, LOOPBACK.storage);
const ownedObject = ref(storage, `owners/${user.uid}/devices/emulator-device/blobs/probe`);

try {
  await setDoc(relay, envelope);
  await expectsPermissionDenied(() => setDoc(doc(firestore, 'relay', 'emulator-invalid'), {
    ...envelope,
    eventId: 'emulator-invalid',
    plaintext: 'must be rejected',
  }));

  await uploadBytes(ownedObject, new Uint8Array([1, 2, 3]));
  await expectsPermissionDenied(() => uploadBytes(
    ref(storage, 'owners/not-the-owner/devices/emulator-device/blobs/blocked'),
    new Uint8Array([4]),
  ));

  console.log(JSON.stringify({
    firestore: 'rules_enforced',
    storage: 'rules_enforced',
    network: 'loopback_only',
  }));
} finally {
  await deleteDoc(relay).catch(() => {});
  await deleteObject(ownedObject).catch(() => {});
  await signOut(auth).catch(() => {});
  await deleteApp(app).catch(() => {});
}
