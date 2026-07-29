// Templates de présentation versionnés, SANS contenu IA : chacun fixe thème (couleurs/contrastes),
// pied de page et intention. Le contenu réel vient toujours de l'utilisateur ou d'un modèle de données.

const TEMPLATES = Object.freeze({
  'presentation-mina-v1': { themeId: 'mina-light-v1', footer: 'Mina Vision', intent: 'Général' },
  'presentation-corporate-v1': { themeId: 'corporate-blue-v1', footer: 'Mina Vision', intent: 'Entreprise' },
  'presentation-training-v1': { themeId: 'mina-light-v1', footer: 'Mina Vision · Formation', intent: 'Formation' },
  'presentation-pitch-v1': { themeId: 'mina-dark-v1', footer: 'Mina Vision', intent: 'Pitch' },
});

export function createPresentationTemplateRegistry() {
  return Object.freeze({
    list: () => Object.keys(TEMPLATES),
    get(templateId) {
      const template = TEMPLATES[String(templateId)];
      if (!template) throw new Error(`publication_presentation_template_unknown:${templateId}`);
      return Object.freeze({ id: String(templateId), ...template });
    },
  });
}
