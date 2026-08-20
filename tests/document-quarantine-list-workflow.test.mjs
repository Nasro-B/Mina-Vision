import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { bindDocumentQuarantineList } from '../src/ui/panels/document-quarantine-list-workflow.mjs';

function quarantineListDom() {
  const dom = new JSDOM(`
    <button id="document-quarantine-refresh" type="button">Actualiser</button>
    <div id="document-quarantine-list"></div>
  `);
  return {
    refreshButton: dom.window.document.querySelector('#document-quarantine-refresh'),
    list: dom.window.document.querySelector('#document-quarantine-list'),
  };
}

describe('liste locale de quarantaine documentaire', () => {
  it('affiche uniquement les métadonnées prévues après une action explicite', async () => {
    const { refreshButton, list } = quarantineListDom();
    const api = {
      documents: {
        list: async () => [{
          documentId: 'document-1', declaredName: 'facture.pdf', detectedType: 'application/pdf',
          size: 13, status: 'inspectable', reasons: [], observedAt: '2026-08-09T10:00:00.000Z',
          digest: `sha256:${'a'.repeat(64)}`, rawBytes: '%PDF secret', text: 'texte secret',
        }],
      },
    };

    const binding = bindDocumentQuarantineList({ api, refreshButton, list });
    await binding.refresh();

    expect(list.textContent).toContain('facture.pdf');
    expect(list.textContent).toContain('PDF');
    expect(list.textContent).toContain('13 octets');
    expect(list.textContent).not.toContain('sha256:');
    expect(list.textContent).not.toContain('%PDF secret');
    expect(list.textContent).not.toContain('texte secret');
    expect(refreshButton.disabled).toBe(false);
  });

  it('oublie un document et supprime sa source locale seulement après confirmation explicite', async () => {
    const { refreshButton, list } = quarantineListDom();
    const records = [{
      documentId: 'document-1', declaredName: 'facture.pdf', detectedType: 'application/pdf',
      size: 13, status: 'inspectable', reasons: [], observedAt: '2026-08-09T10:00:00.000Z',
    }];
    const api = {
      documents: {
        list: vi.fn(async () => records),
        forget: vi.fn(async () => ({ documentId: 'document-1', chunksRemoved: 2, sourceFileDeleted: true })),
      },
    };
    const confirmForget = vi.fn(() => true);

    const binding = bindDocumentQuarantineList({ api, refreshButton, list, confirmForget });
    await binding.refresh();
    const forgetButton = list.querySelector('button[data-action="document-forget-source"]');

    expect(forgetButton?.className).toContain('danger');
    forgetButton.click();
    await Promise.resolve();

    expect(confirmForget).toHaveBeenCalledWith('facture.pdf');
    expect(api.documents.forget).toHaveBeenCalledWith({ documentId: 'document-1', deleteSource: true });
    expect(list.textContent).toContain('Source supprimée');
  });

  it('ne supprime rien quand la confirmation locale est refusée', async () => {
    const { refreshButton, list } = quarantineListDom();
    const api = {
      documents: {
        list: async () => [{
          documentId: 'document-1', declaredName: 'facture.pdf', detectedType: 'application/pdf',
          size: 13, status: 'inspectable', reasons: [], observedAt: '2026-08-09T10:00:00.000Z',
        }],
        forget: vi.fn(async () => ({})),
      },
    };

    const binding = bindDocumentQuarantineList({ api, refreshButton, list, confirmForget: () => false });
    await binding.refresh();
    list.querySelector('button[data-action="document-forget-source"]').click();
    await Promise.resolve();

    expect(api.documents.forget).not.toHaveBeenCalled();
  });
});
