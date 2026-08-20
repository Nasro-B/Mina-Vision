function documentTypeLabel(mediaType) {
  if (mediaType === 'application/pdf') return 'PDF';
  if (mediaType === 'image/png') return 'Image PNG';
  if (mediaType === 'image/jpeg') return 'Image JPEG';
  return 'Type inconnu';
}

function byteLabel(size) {
  return Number.isInteger(size) && size >= 0 ? `${size} octets` : 'taille non disponible';
}

function safeRecord(record) {
  return Object.freeze({
    documentId: typeof record?.documentId === 'string' && record.documentId.length > 0 ? record.documentId.slice(0, 160) : null,
    declaredName: typeof record?.declaredName === 'string' && record.declaredName.length > 0
      ? record.declaredName.slice(0, 500)
      : 'Document sans nom',
    detectedType: typeof record?.detectedType === 'string' ? record.detectedType : null,
    size: record?.size,
    status: typeof record?.status === 'string' ? record.status : 'inconnu',
    reasons: Array.isArray(record?.reasons) ? record.reasons.filter((reason) => typeof reason === 'string').slice(0, 8) : [],
    observedAt: typeof record?.observedAt === 'string' ? record.observedAt : null,
  });
}

function addCard(list, label, value, actions = []) {
  const card = list.ownerDocument.createElement('article');
  const title = list.ownerDocument.createElement('strong');
  const detail = list.ownerDocument.createElement('small');
  title.textContent = label;
  detail.textContent = value;
  card.append(title, detail);
  if (actions.length > 0) {
    const actionRow = list.ownerDocument.createElement('div');
    actionRow.className = 'quarantine-actions';
    actionRow.append(...actions);
    card.append(actionRow);
  }
  list.append(card);
  return card;
}

function createForgetButton(list, record, forgetRecord) {
  if (!record.documentId || typeof forgetRecord !== 'function') return null;
  const button = list.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'action-button danger compact';
  button.dataset.action = 'document-forget-source';
  button.textContent = 'Oublier + supprimer source';
  button.setAttribute('aria-label', `Oublier ${record.declaredName} et supprimer sa source locale en quarantaine`);
  button.addEventListener('click', () => {
    button.disabled = true;
    void forgetRecord(record).catch(() => {
      button.disabled = false;
    });
  });
  return button;
}

function renderRecords(list, records, forgetRecord = null) {
  list.replaceChildren();
  if (records.length === 0) {
    addCard(list, 'Quarantaine locale', 'Aucun document enregistré.');
    return;
  }
  for (const record of records) {
    const details = [
      documentTypeLabel(record.detectedType),
      byteLabel(record.size),
      record.status,
      record.reasons.join(', '),
      record.observedAt,
    ].filter(Boolean).join(' · ');
    const forgetButton = createForgetButton(list, record, forgetRecord);
    addCard(list, record.declaredName, details, forgetButton ? [forgetButton] : []);
  }
}

function renderFailure(list) {
  list.replaceChildren();
  addCard(list, 'Quarantaine locale indisponible', 'La liste n’a pas été chargée.');
}

function defaultConfirmForget(declaredName) {
  if (typeof globalThis.confirm !== 'function') return false;
  return globalThis.confirm(`Oublier "${declaredName}" et supprimer sa source locale en quarantaine ?`);
}

export function bindDocumentQuarantineList({
  api, refreshButton, list, confirmForget = defaultConfirmForget,
} = {}) {
  if (!refreshButton || !list?.replaceChildren) throw new TypeError('document_quarantine_list_elements_required');

  const forgetRecord = async (record) => {
    if (typeof api?.documents?.forget !== 'function') throw new TypeError('document_forget_api_required');
    if (confirmForget(record.declaredName) !== true) return Object.freeze({ cancelled: true });
    const result = await api.documents.forget({ documentId: record.documentId, deleteSource: true });
    addCard(list, 'Source supprimée', `${record.declaredName} a été oublié localement.`);
    return result;
  };

  const refresh = async () => {
    if (typeof api?.documents?.list !== 'function') throw new TypeError('document_quarantine_list_api_required');
    refreshButton.disabled = true;
    try {
      const records = await api.documents.list();
      if (!Array.isArray(records)) throw new Error('document_quarantine_list_invalid');
      const projection = Object.freeze(records.map(safeRecord));
      renderRecords(list, projection, api?.documents?.forget ? forgetRecord : null);
      return projection;
    } catch (error) {
      renderFailure(list);
      throw error;
    } finally {
      refreshButton.disabled = false;
    }
  };

  refreshButton.addEventListener('click', () => { void refresh().catch(() => {}); });
  return Object.freeze({ refresh });
}
