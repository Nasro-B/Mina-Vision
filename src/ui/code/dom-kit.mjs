// Micro-boîte à outils DOM des panneaux Mina Code : création d'éléments SANS innerHTML
// (même contrat de sécurité que renderer.js — texte via textContent uniquement).
// `documentRef` est injectable pour tester les panneaux hors navigateur.

export function createDomKit(documentRef = globalThis.document) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('code_ui_document_required');
  }

  function el(tag, { className, text, title, attributes } = {}, children = []) {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    if (title) node.title = title;
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    }
    for (const child of children) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  function clear(container) {
    if (typeof container.replaceChildren === 'function') {
      container.replaceChildren();
      return;
    }
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  return Object.freeze({ el, clear });
}
