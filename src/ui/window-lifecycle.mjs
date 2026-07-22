export async function loadAndShowWindow(window, file) {
  window.once('ready-to-show', () => window.show());
  await window.loadFile(file);
}
