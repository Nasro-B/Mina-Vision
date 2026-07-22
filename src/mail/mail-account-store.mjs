const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const INDEX_NAME = 'mail/account/_index';

function accountName(accountId) {
  return `mail/account/${accountId}`;
}

function validateAccountId(accountId) {
  if (!ACCOUNT_ID.test(accountId ?? '')) throw new TypeError('mail_account_id_invalid');
}

async function readIndex(keyring) {
  const raw = await keyring.getSecret(INDEX_NAME);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeIndex(keyring, accountIds) {
  await keyring.setSecret(INDEX_NAME, JSON.stringify([...new Set(accountIds)].sort()));
}

export function createMailAccountStore({ keyring } = {}) {
  if (!keyring?.setSecret || !keyring?.getSecret || !keyring?.deleteSecret) {
    throw new TypeError('mail_account_store_keyring_required');
  }

  return Object.freeze({
    async save(accountId, record) {
      validateAccountId(accountId);
      if (!record || typeof record.provider !== 'string' || typeof record.address !== 'string'
        || ![1, 2, 3].includes(record.mode) || !record.credentials || typeof record.credentials !== 'object') {
        throw new TypeError('mail_account_record_invalid');
      }
      await keyring.setSecret(accountName(accountId), JSON.stringify(record));
      const index = await readIndex(keyring);
      if (!index.includes(accountId)) await writeIndex(keyring, [...index, accountId]);
      return Object.freeze({ accountId, saved: true });
    },

    async listStatus() {
      const index = await readIndex(keyring);
      const statuses = await Promise.all(index.map(async (accountId) => {
        const raw = await keyring.getSecret(accountName(accountId));
        if (!raw) return null;
        const record = JSON.parse(raw);
        return Object.freeze({ accountId, provider: record.provider, address: record.address, mode: record.mode, configured: true });
      }));
      return Object.freeze(statuses.filter(Boolean));
    },

    async getCredentials(accountId) {
      validateAccountId(accountId);
      const raw = await keyring.getSecret(accountName(accountId));
      if (!raw) return null;
      return Object.freeze({ ...JSON.parse(raw).credentials });
    },

    async delete(accountId) {
      validateAccountId(accountId);
      const removed = await keyring.deleteSecret(accountName(accountId));
      const index = await readIndex(keyring);
      if (index.includes(accountId)) await writeIndex(keyring, index.filter((entry) => entry !== accountId));
      return Boolean(removed);
    },
  });
}
