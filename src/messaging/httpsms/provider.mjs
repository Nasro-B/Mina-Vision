// Adapts createHttpsmsClient to the common SMS provider interface { id, send, health, getStatus }
// shared with the native (Huawei ADB) provider, so sms-router.mjs can treat both interchangeably.
export function createHttpsmsProvider({ client } = {}) {
  if (!client?.send || !client?.getStatus || !client?.health) throw new TypeError('httpsms_provider_client_required');
  return Object.freeze({
    id: 'httpsms',
    send: async ({ from, to, content, requestId }) => {
      const result = await client.send({ from, to, content, requestId });
      return Object.freeze({
        providerId: 'httpsms',
        requestId,
        providerMessageId: result?.id ?? null,
        accepted: result?.status === 'pending' || result?.status === 'sent',
        state: result?.status ?? 'unknown',
      });
    },
    getStatus: (providerMessageId) => client.getStatus(providerMessageId),
    health: () => client.health(),
  });
}
