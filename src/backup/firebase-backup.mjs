function validateObjectKey(key) {
  if (!key || key.startsWith('/') || key.includes('\\')) throw new Error('firebase_object_key_invalid');
  const parts = key.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('firebase_object_key_invalid');
  return parts.join('/');
}

async function defaultSdkLoader() {
  const [app, appCheck, auth, storage] = await Promise.all([
    import('firebase/app'),
    import('firebase/app-check'),
    import('firebase/auth'),
    import('firebase/storage'),
  ]);
  return { ...app, ...appCheck, ...auth, ...storage };
}

export async function createFirebaseSdkClient({
  config,
  appCheckProvider,
  sdkLoader = defaultSdkLoader,
} = {}) {
  if (!config || Object.keys(config).some((key) => /(?:private|serviceaccount|clientemail)/iu.test(key))) {
    throw new Error('firebase_service_credentials_forbidden');
  }
  for (const key of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId']) {
    if (!config[key]) throw new TypeError(`firebase_public_config_missing:${key}`);
  }
  const sdk = await sdkLoader();
  const app = sdk.initializeApp(config, 'mina-vision-backup');
  if (appCheckProvider) {
    sdk.initializeAppCheck(app, { provider: appCheckProvider, isTokenAutoRefreshEnabled: true });
  }
  const auth = sdk.getAuth(app);
  const storage = sdk.getStorage(app);

  async function listRecursive(prefix) {
    const output = [];
    async function visit(reference) {
      const result = await sdk.listAll(reference);
      output.push(...result.items.map((item) => item.fullPath));
      for (const child of result.prefixes) await visit(child);
    }
    await visit(sdk.ref(storage, prefix));
    return output;
  }

  return Object.freeze({
    authenticate: async (token) => (await sdk.signInWithCustomToken(auth, token)).user,
    put: async (path, bytes) => sdk.uploadBytes(sdk.ref(storage, path), bytes, {
      contentType: 'application/octet-stream',
      cacheControl: 'no-store',
    }),
    get: async (path) => {
      try {
        return Buffer.from(await sdk.getBytes(sdk.ref(storage, path)));
      } catch (error) {
        if (error?.code === 'storage/object-not-found') return null;
        throw error;
      }
    },
    exists: async (path) => {
      try {
        await sdk.getMetadata(sdk.ref(storage, path));
        return true;
      } catch (error) {
        if (error?.code === 'storage/object-not-found') return false;
        throw error;
      }
    },
    delete: async (path) => sdk.deleteObject(sdk.ref(storage, path)),
    list: listRecursive,
  });
}

export function createFirebaseBackup({
  client,
  authTokenProvider,
  expectedOwnerId,
  deviceId,
} = {}) {
  if (!client?.authenticate || !client?.put || !client?.get || !client?.exists
    || !client?.delete || !client?.list || typeof authTokenProvider !== 'function'
    || !expectedOwnerId || !deviceId) {
    throw new TypeError('firebase_backup_configuration_required');
  }
  let authentication;

  async function owner() {
    authentication ??= (async () => {
      const token = await authTokenProvider();
      if (!token) throw new Error('firebase_auth_token_unavailable');
      const identity = await client.authenticate(token);
      if (identity?.uid !== expectedOwnerId) throw new Error('firebase_owner_mismatch');
      return identity.uid;
    })();
    return authentication;
  }

  async function scoped(key) {
    const uid = await owner();
    return `owners/${uid}/devices/${validateObjectKey(deviceId)}/${validateObjectKey(key)}`;
  }

  async function putObject(key, ciphertext) {
    if (!(ciphertext instanceof Uint8Array)) throw new TypeError('firebase_ciphertext_bytes_required');
    await client.put(await scoped(key), Buffer.from(ciphertext));
  }

  async function getObject(key) {
    const value = await client.get(await scoped(key));
    return value === null ? null : Buffer.from(value);
  }

  async function hasObject(key) {
    return client.exists(await scoped(key));
  }

  async function deleteObject(key) {
    await client.delete(await scoped(key));
  }

  async function listObjects(prefix) {
    const base = await scoped(prefix);
    const deviceBase = base.slice(0, base.length - validateObjectKey(prefix).length);
    return (await client.list(base)).map((key) => key.slice(deviceBase.length));
  }

  return Object.freeze({ putObject, getObject, hasObject, deleteObject, listObjects });
}
