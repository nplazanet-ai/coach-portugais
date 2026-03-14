// ─────────────────────────────────────────────
//  core/storage.js
//  Seul fichier autorisé à lire/écrire
//  dans localStorage.
//  Si demain on passe à Google Drive ou
//  une base en ligne, on ne modifie
//  que ce fichier.
// ─────────────────────────────────────────────

import State from './state.js';

const STORAGE_KEY = 'coach-pt-v1';

const Storage = {

  // ── CHARGEMENT au démarrage ───────────────

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        State.init(saved);
      }
    } catch (e) {
      console.warn('[Storage] Erreur de chargement :', e);
    }
  },

  // ── SAUVEGARDE (appelée après chaque mutation) ─

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(State.getAll()));
    } catch (e) {
      console.warn('[Storage] Erreur de sauvegarde :', e);
    }
  },

  // ── EXPORT JSON (bouton dans Réglages) ────

  exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      ...State.getAll(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `coach-portugais-${_today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── RESET complet ─────────────────────────

  clear() {
    localStorage.removeItem(STORAGE_KEY);
    State.reset();
  },

};

function _today() {
  return new Date().toISOString().split('T')[0];
}

export default Storage;
