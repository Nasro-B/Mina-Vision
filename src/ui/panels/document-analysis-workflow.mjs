const MAX_PATH_LENGTH = 4_000;

function selectedPath(value) {
  const path = String(value ?? '').trim();
  if (!path) throw new Error('document_path_required');
  if (path.length > MAX_PATH_LENGTH) throw new Error('document_path_too_long');
  return path;
}

function declaredName(path) {
  const name = path.split(/[\\/]/u).filter(Boolean).at(-1);
  if (!name) throw new Error('document_declared_name_required');
  return name.slice(0, 500);
}

function documentTypeLabel(mediaType) {
  if (mediaType === 'application/pdf') return 'PDF';
  if (mediaType === 'image/png') return 'Image PNG';
  if (mediaType === 'image/jpeg') return 'Image JPEG';
  return String(mediaType ?? 'type inconnu');
}

function confidenceLabel(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return 'confiance non disponible';
  return `${Math.round(confidence * 100)} %`;
}

function blockCountLabel(value) {
  if (!Number.isInteger(value) || value < 0) return 'blocs non disponibles';
  return `${value} bloc${value === 1 ? '' : 's'}`;
}

function addCard(summary, label, value) {
  const card = summary.ownerDocument.createElement('article');
  const title = summary.ownerDocument.createElement('strong');
  const detail = summary.ownerDocument.createElement('small');
  title.textContent = label;
  detail.textContent = value;
  card.append(title, detail);
  summary.append(card);
}

function evidenceLocatorLabel(locator) {
  const kind = locator?.kind === 'pdf_text' || locator?.kind === 'ocr' ? locator.kind : 'inconnu';
  const page = Number.isInteger(locator?.page) && locator.page > 0 ? `page ${locator.page}` : 'page non disponible';
  if (kind === 'pdf_text' && Number.isInteger(locator?.start) && Number.isInteger(locator?.end)) {
    return `${page} · texte ${locator.start}–${locator.end}`;
  }
  if (kind === 'ocr' && Array.isArray(locator?.box) && locator.box.length === 4 && locator.box.every(Number.isFinite)) {
    return `${page} · zone OCR ${locator.box.join(', ')}`;
  }
  return `${page} · repère ${kind}`;
}

function renderEvidence(summary, projection) {
  const evidence = Array.isArray(projection?.evidence) ? projection.evidence : [];
  const parserId = typeof projection?.parserId === 'string' ? projection.parserId : 'parseur inconnu';
  const totalBlocks = Number.isInteger(projection?.totalBlocks) && projection.totalBlocks >= 0 ? projection.totalBlocks : evidence.length;
  const suffix = projection?.truncated === true ? ' · aperçu limité' : '';
  addCard(summary, 'Preuves locales', `${parserId} · ${evidence.length}/${totalBlocks} repère(s)${suffix}`);
  for (const item of evidence) {
    const confidence = confidenceLabel(item?.confidence);
    const index = Number.isInteger(item?.blockIndex) && item.blockIndex >= 0 ? item.blockIndex + 1 : '?';
    addCard(summary, `Preuve ${index}`, `${evidenceLocatorLabel(item?.locator)} · ${confidence}`);
  }
}

function renderAnalysis(summary, result) {
  summary.hidden = false;
  summary.replaceChildren();
  if (result.state === 'blocked') {
    addCard(summary, 'Fichier bloqué', documentTypeLabel(result.record.detectedType));
    addCard(summary, 'Politique de quarantaine', result.record.reasons.join(', ') || 'raison non précisée');
    return;
  }
  addCard(summary, 'Quarantaine', result.record.status);
  addCard(summary, 'Type détecté', documentTypeLabel(result.record.detectedType));
  addCard(summary, 'Extraction locale', `${result.observation.parserId} · ${result.observation.pageCount} pages · ${blockCountLabel(result.observation.blockCount)} · ${confidenceLabel(result.observation.confidence)}`);
  renderEvidence(summary, result.evidence);
  addCard(summary, 'Classement proposé', `${result.classification.category ?? 'non défini'} · conservation ${result.classification.retention ?? 'non définie'}`);
}

function renderFailure(summary, error) {
  summary.hidden = false;
  summary.replaceChildren();
  const reason = String(error?.message ?? '');
  const message = reason === 'document_path_required'
    ? 'Indiquez le chemin d’un fichier local avant de lancer l’analyse.'
    : reason === 'document_parse_cancelled'
      ? 'Analyse annulée. Aucun classement n’a été proposé.'
      : reason === 'document_pdf_text_empty'
      ? 'Ce PDF ne contient pas de texte exploitable ; le PDF scanné n’est pas encore pris en charge.'
      : 'Analyse impossible sans exposer le contenu du document.';
  addCard(summary, 'Analyse non effectuée', message);
}

function setProposedCategory(categorySelect, category) {
  if (![...categorySelect.options].some((option) => option.value === category)) return;
  categorySelect.value = category;
}

export async function analyzeDocument({ api, path, onParseStarted = null, onParseFinished = null } = {}) {
  const selected = selectedPath(path);
  if (typeof api?.documentIntake !== 'function' || typeof api?.documents?.parse !== 'function'
    || typeof api.documents.evidence !== 'function' || typeof api.documents.proposeClassification !== 'function') {
    throw new TypeError('document_analysis_api_required');
  }
  const record = await api.documentIntake({
    source: 'local_ui', path: selected, declaredName: declaredName(selected),
  });
  if (!record?.documentId || !record?.status || !record?.detectedType || !Array.isArray(record.reasons)) {
    throw new Error('document_intake_result_invalid');
  }
  if (record.status === 'blocked') return Object.freeze({ state: 'blocked', documentId: record.documentId, record });

  onParseStarted?.(record.documentId);
  const observation = await api.documents.parse(record.documentId);
  onParseFinished?.();
  const evidence = await api.documents.evidence(record.documentId);
  const classification = await api.documents.proposeClassification(record.documentId, {});
  return Object.freeze({ state: 'analyzed', documentId: record.documentId, record, observation, evidence, classification });
}

export function bindDocumentAnalysis({
  api, pathInput, submitButton, summary, categorySelect = null, confirmButton = null, cancelButton = null,
} = {}) {
  if (!pathInput || !submitButton || !summary?.replaceChildren) throw new TypeError('document_analysis_elements_required');
  const confirmationEnabled = Boolean(categorySelect && confirmButton);
  const cancellationEnabled = Boolean(cancelButton && typeof api?.documents?.cancel === 'function');
  let pendingProposalId = null;
  let activeDocumentId = null;
  const setCancellationState = (active) => {
    if (!cancelButton) return;
    cancelButton.hidden = !active;
    cancelButton.disabled = !active || !cancellationEnabled;
  };
  setCancellationState(false);

  const run = async () => {
    submitButton.disabled = true;
    if (confirmationEnabled) confirmButton.disabled = true;
    pendingProposalId = null;
    activeDocumentId = null;
    setCancellationState(false);
    try {
      const result = await analyzeDocument({
        api,
        path: pathInput.value,
        onParseStarted: (documentId) => {
          activeDocumentId = documentId;
          setCancellationState(true);
        },
        onParseFinished: () => {
          activeDocumentId = null;
          setCancellationState(false);
        },
      });
      renderAnalysis(summary, result);
      if (confirmationEnabled && result.state === 'analyzed' && typeof result.classification?.id === 'string') {
        pendingProposalId = result.classification.id;
        setProposedCategory(categorySelect, result.classification.category);
        confirmButton.disabled = false;
      }
      return result;
    } catch (error) {
      renderFailure(summary, error);
      throw error;
    } finally {
      submitButton.disabled = false;
      activeDocumentId = null;
      setCancellationState(false);
    }
  };

  const cancel = async () => {
    if (!cancellationEnabled || !activeDocumentId) throw new Error('document_parse_cancellation_unavailable');
    cancelButton.disabled = true;
    try {
      const result = await api.documents.cancel(activeDocumentId);
      if (result?.cancelled !== true && activeDocumentId) cancelButton.disabled = false;
      return result;
    } catch (error) {
      if (activeDocumentId) cancelButton.disabled = false;
      throw error;
    }
  };

  const confirm = async () => {
    if (!confirmationEnabled || !pendingProposalId) throw new Error('document_classification_confirmation_unavailable');
    if (typeof api?.documents?.confirmClassification !== 'function') throw new TypeError('document_classification_confirmation_api_required');
    confirmButton.disabled = true;
    try {
      const confirmed = await api.documents.confirmClassification(pendingProposalId, { category: categorySelect.value });
      pendingProposalId = null;
      addCard(summary, 'Classement confirmé', `${confirmed?.category ?? 'non défini'} · conservation ${confirmed?.retention ?? 'non définie'}`);
      return confirmed;
    } catch (error) {
      addCard(summary, 'Classement non confirmé', 'La proposition reste inchangée.');
      confirmButton.disabled = false;
      throw error;
    }
  };

  submitButton.addEventListener('click', () => { void run().catch(() => {}); });
  cancelButton?.addEventListener('click', () => { void cancel().catch(() => {}); });
  if (confirmationEnabled) confirmButton.addEventListener('click', () => { void confirm().catch(() => {}); });
  return Object.freeze({ run, cancel, confirm });
}
