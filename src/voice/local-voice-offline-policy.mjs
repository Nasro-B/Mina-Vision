const rejectRemoteFetch = async () => {
  throw new Error('local_voice_network_forbidden');
};

export function applyLocalVoiceOfflinePolicy({ offline = false, runtime = globalThis } = {}) {
  if (offline === true) runtime.fetch = rejectRemoteFetch;
}
