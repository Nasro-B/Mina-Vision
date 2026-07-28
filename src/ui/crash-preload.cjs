// Preload MINIMAL de l'écran de crash de dernier recours (plan de durcissement T1.3).
//
// L'écran de crash s'affiche quand Mina n'a AUCUNE fenêtre après une exception non rattrapée. Ce
// pont n'expose que deux gestes, tous deux sûrs et sans privilège nouveau : copier le rapport
// d'incident dans le presse-papiers, et relancer l'application. Aucune donnée n'entre ni ne sort
// hors de ces deux canaux nommés — le reste de l'API Mina n'est délibérément pas exposé ici.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('minaCrash', {
  copy: (text) => ipcRenderer.invoke('mina:crash:copy', String(text ?? '')),
  relaunch: () => ipcRenderer.invoke('mina:crash:relaunch'),
});
