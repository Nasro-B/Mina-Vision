import { describe, expect, it } from 'vitest';
import { createPresentationTemplateRegistry } from '../src/publication/presentation-template-registry.mjs';

describe('presentation-template-registry', () => {
  const registry = createPresentationTemplateRegistry();

  it('liste les 4 templates v1', () => {
    expect(registry.list()).toEqual([
      'presentation-mina-v1', 'presentation-corporate-v1', 'presentation-training-v1', 'presentation-pitch-v1',
    ]);
  });

  it('résout un template en thème + pied de page', () => {
    expect(registry.get('presentation-corporate-v1')).toMatchObject({ id: 'presentation-corporate-v1', themeId: 'corporate-blue-v1', footer: 'Mina Vision' });
  });

  it('refuse un template inconnu', () => {
    expect(() => registry.get('presentation-neon-v9')).toThrow('publication_presentation_template_unknown');
  });
});
