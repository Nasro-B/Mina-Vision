// I/O audio HFP via Web Audio du renderer (SPEC-MINA-COMMS-001 §6, Phase 6). AUCUNE dépendance native :
// réutilise exactement la stack audio de la voix (navigator.mediaDevices.getUserMedia + AudioContext,
// que Chromium expose côté renderer). Un endpoint HFP = un périphérique Bluetooth mains-libres, qui
// apparaît comme un couple audioinput (micro sur HFP = RX) + audiooutput (haut-parleur = TX) partageant
// le même groupId. Ce module fournit l'énumération et l'ouverture/fermeture d'un lien SCO. Les objets
// Web Audio sont INJECTÉS → testable en Node pur. Le binding à un deviceId SIGNÉ (identité, §6.1) est un
// mapping séparé établi à l'appairage : ici on ne renvoie que des candidats matériels (groupId/label).

// Énumère les endpoints HFP : un micro et une sortie du MÊME groupId physique. Un micro sans sortie
// appairée n'est pas un endpoint d'appel (HFP est bidirectionnel).
export async function enumerateHfpAudioEndpoints(mediaDevices) {
  if (typeof mediaDevices?.enumerateDevices !== 'function') throw new TypeError('hfp_media_devices_required');
  const devices = (await mediaDevices.enumerateDevices()) ?? [];
  const inputs = devices.filter((d) => d?.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const outputs = devices.filter((d) => d?.kind === 'audiooutput');
  return inputs
    .map((input) => {
      const output = outputs.find((o) => o.groupId && o.groupId === input.groupId) ?? null;
      return Object.freeze({
        endpointId: input.groupId || input.deviceId,
        inputDeviceId: input.deviceId,
        outputDeviceId: output?.deviceId ?? null,
        label: input.label || '',
        hasOutput: output !== null,
      });
    })
    .filter((endpoint) => endpoint.hasOutput);
}

// Ouvre un lien SCO : capture RX via getUserMedia sur le micro HFP (avec annulation d'écho), prépare le
// contexte TX vers la sortie HFP. Retourne un handle { healthy, close } — la même forme que le port
// audio attend. Perte de piste (readyState 'ended') → non sain (jamais un appel muet, §7).
export async function openHfpScoLink({ mediaDevices, createAudioContext } = {}, { inputDeviceId, outputDeviceId = null } = {}) {
  if (typeof mediaDevices?.getUserMedia !== 'function') throw new TypeError('hfp_media_devices_required');
  if (!inputDeviceId) throw new Error('hfp_sco_input_required');
  const stream = await mediaDevices.getUserMedia({
    audio: { deviceId: { exact: inputDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = typeof createAudioContext === 'function' ? createAudioContext() : null;
  const tracks = typeof stream?.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
  let alive = true;
  return Object.freeze({
    endpointId: inputDeviceId,
    outputDeviceId,
    rxStream: stream,
    txContext: context,
    healthy: () => alive && tracks.length > 0 && tracks.every((track) => track.readyState !== 'ended'),
    close: () => {
      alive = false;
      for (const track of tracks) track.stop?.();
      context?.close?.();
    },
  });
}
