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

function addCard(list, label, value) {
  const card = list.ownerDocument.createElement('article');
  const title = list.ownerDocument.createElement('strong');
  const detail = list.ownerDocument.createElement('small');
  title.textContent = label;
  detail.textContent = value;
  card.append(title, detail);
  list.append(card);
}

function renderRecords(list, records) {
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
    addCard(list, record.declaredName, details);
  }
}

function renderFailure(list) {
  list.replaceChildren();
  addCard(list, 'Quarantaine locale indisponible', 'La liste n’a pas été chargée.');
}

export function bindDocumentQuarantineList({ api, refreshButton, list } = {}) {
  if (!refreshButton || !list?.replaceChildren) throw new TypeError('document_quarantine_list_elements_required');

  const refresh = async () => {
    if (typeof api?.documents?.list !== 'function') throw new TypeError('document_quarantine_list_api_required');
    refreshButton.disabled = true;
    try {
      const records = await api.documents.list();
      if (!Array.isArray(records)) throw new Error('document_quarantine_list_invalid');
      const projection = Object.freeze(records.map(safeRecord));
      renderRecords(list, projection);
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
