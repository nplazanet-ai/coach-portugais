// ─────────────────────────────────────────────
//  core/state.js
//  État global de l'application.
//  Chaque module lit et écrit via ces objets.
//  Jamais de localStorage direct ailleurs.
// ─────────────────────────────────────────────

const State = (() => {

  // Structure de données par défaut
  const DEFAULTS = {
    // Journal de cours
    entries: [],          // [{ id, date, type:'manuel'|'libre', unit, notions, vocab, notes, photos, createdAt }]

    // Suivi
    streak: 0,
    lastActivityDate: null,

    // Préférences
    notifEnabled: false,
    notifTime: '19:00',
  };

  let _data = { ...DEFAULTS };

  // Abonnés aux changements (pub/sub léger)
  const _listeners = {};

  return {

    // ── LECTURE ──────────────────────────────

    get(key) {
      return _data[key];
    },

    getAll() {
      return { ..._data };
    },

    // ── ÉCRITURE ─────────────────────────────

    set(key, value) {
      _data[key] = value;
      _emit(key, value);
    },

    merge(partial) {
      Object.assign(_data, partial);
      Object.keys(partial).forEach(k => _emit(k, _data[k]));
    },

    // ── INITIALISATION ───────────────────────

    init(savedData) {
      _data = { ...DEFAULTS, ...savedData };
    },

    reset() {
      _data = { ...DEFAULTS };
    },

    // ── PUB/SUB ──────────────────────────────
    // Permet à un module d'écouter les changements d'un autre
    // Ex: le module transport écoute 'entries' pour mettre à jour les flashcards

    on(key, callback) {
      if (!_listeners[key]) _listeners[key] = [];
      _listeners[key].push(callback);
    },

    off(key, callback) {
      if (!_listeners[key]) return;
      _listeners[key] = _listeners[key].filter(cb => cb !== callback);
    },

  };

  function _emit(key, value) {
    (_listeners[key] || []).forEach(cb => cb(value));
  }

})();

export default State;
