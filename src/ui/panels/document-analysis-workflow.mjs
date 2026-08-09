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
  addCard(summary, 'Classement proposé', `${result.classification.category ?? 'non défini'} · conservation ${result.classification.retention ?? 'non définie'}`);
}

function renderFailure(summary, error) {
  summary.hidden = false;
  summary.replaceChildren();
  const reason = String(error?.message ?? '');
  const message = reason === 'document_path_required'
    ? 'Indiquez le chemin d’un fichier local avant de lancer l’analyse.'
    : reason === 'document_pdf_text_empty'
      ? 'Ce PDF ne contient pas de texte exploitable ; le PDF scanné n’est pas encore pris en charge.'
      : 'Analyse impossible sans exposer le contenu du document.';
  addCard(summary, 'Analyse non effectuée', message);
}

export async function analyzeDocument({ api, path } = {}) {
  const selected = selectedPath(path);
  if (typeof api?.documentIntake !== 'function' || typeof api?.documents?.parse !== 'function'
    || typeof api.documents.proposeClassification !== 'function') {
    throw new TypeError('document_analysis_api_required');
  }
  const record = await api.documentIntake({
    source: 'local_ui', path: selected, declaredName: declaredName(selected),
  });
  if (!record?.documentId || !record?.status || !record?.detectedType || !Array.isArray(record.reasons)) {
    throw new Error('document_intake_result_invalid');
  }
  if (record.status === 'blocked') return Object.freeze({ state: 'blocked', documentId: record.documentId, record });

  const observation = await api.documents.parse(record.documentId);
  const classification = await api.documents.proposeClassification(record.documentId, {});
  return Object.freeze({ state: 'analyzed', documentId: record.documentId, record, observation, classification });
}

export function bindDocumentAnalysis({ api, pathInput, submitButton, summary } = {}) {
  if (!pathInput || !submitButton || !summary?.replaceChildren) throw new TypeError('document_analysis_elements_required');

  const run = async () => {
    submitButton.disabled = true;
    try {
      const result = await analyzeDocument({ api, path: pathInput.value });
      renderAnalysis(summary, result);
      return result;
    } catch (error) {
      renderFailure(summary, error);
      throw error;
    } finally {
      submitButton.disabled = false;
    }
  };
  submitButton.addEventListener('click', () => { void run().catch(() => {}); });
  return Object.freeze({ run });
}
