import { describe, expect, it } from 'vitest';
import { mailMessageRow } from '../src/ui/panels/domain-panels.mjs';

describe('domain panel rows', () => {
  it('exposes a mail attachment export action only for a valid digest', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const row = mailMessageRow({
      messageId: 'mail-message-1',
      subject: 'Facture',
      from: 'fournisseur@example.test',
      attachments: [
        { digest, declaredFilename: 'devis.pdf', status: 'inspectable' },
        { digest: 'bad-digest', declaredFilename: 'ignore.pdf' },
        { digest: `sha256:${'b'.repeat(64)}`, declaredFilename: 'blocked.exe', status: 'blocked' },
      ],
    });

    expect(row.muted).toContain('3 pièce(s) jointe(s)');
    expect(row.actions).toEqual([{
      label: 'Exporter devis.pdf',
      name: 'mail-export-attachment',
      value: JSON.stringify({ messageId: 'mail-message-1', digest, suggestedName: 'devis.pdf' }),
    }]);
  });
});
