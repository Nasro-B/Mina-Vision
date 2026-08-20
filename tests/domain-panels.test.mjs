import { describe, expect, it } from 'vitest';
import { mailMessageRow } from '../src/ui/panels/domain-panels.mjs';

describe('domain panel rows', () => {
  it('exposes a mail attachment export action only for a valid digest', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const row = mailMessageRow({
      subject: 'Facture',
      from: 'fournisseur@example.test',
      attachments: [
        { digest, declaredFilename: 'devis.pdf' },
        { digest: 'bad-digest', declaredFilename: 'ignore.pdf' },
      ],
    });

    expect(row.muted).toContain('2 pièce(s) jointe(s)');
    expect(row.actions).toEqual([{
      label: 'Exporter devis.pdf',
      name: 'mail-export-attachment',
      value: digest,
    }]);
  });
});
