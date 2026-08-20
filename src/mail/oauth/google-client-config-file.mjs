const FILE_PREFIX = 'client_secret_';
const FILE_SUFFIX = '.json';

// Reads the standard "Desktop app" OAuth client JSON Google Cloud Console produces on download
// (client_secret_<id>.apps.googleusercontent.com.json), so it can be dropped into env/ instead of
// retyping clientId/clientSecret by hand at the connect-google-account.mjs prompt.
export function loadGoogleClientConfigFromEnvDir(envDir, { readdirSync, readFileSync }) {
  let names;
  try {
    names = readdirSync(envDir);
  } catch {
    return null;
  }
  const match = names.find((name) => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX));
  if (!match) return null;
  const parsed = JSON.parse(readFileSync(`${envDir}/${match}`, 'utf8'));
  const section = parsed.installed ?? parsed.web;
  if (!section?.client_id || !section?.client_secret) return null;
  return {
    clientId: section.client_id,
    clientSecret: section.client_secret,
    ...(section.project_id ? { projectId: section.project_id } : {}),
  };
}

export function checkGoogleClientProjectMatch({ googleClientConfig, expectedProjectId } = {}) {
  const oauthProjectId = googleClientConfig?.projectId?.trim();
  const firebaseProjectId = expectedProjectId?.trim();
  if (!oauthProjectId || !firebaseProjectId) return Object.freeze({ ok: true });
  if (oauthProjectId === firebaseProjectId) {
    return Object.freeze({ ok: true, oauthProjectId, firebaseProjectId });
  }
  return Object.freeze({
    ok: false,
    reason: 'google_oauth_project_mismatch',
    oauthProjectId,
    firebaseProjectId,
  });
}
