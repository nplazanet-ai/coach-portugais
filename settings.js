// ─────────────────────────────────────────────
//  modules/settings/settings.js
// ─────────────────────────────────────────────

import State   from './state.js';
import Storage from './storage.js';
import { renderOpenAIKeyBlock, bindOpenAIKeyEvents } from './settings-openai-patch.js';

const SettingsModule = {

  init() {
    window.toggleNotif   = () => this.toggleNotif();
    window.saveNotifTime = () => this.saveNotifTime();
    window.exportData    = () => Storage.exportJSON();
    window.confirmReset  = () => this.confirmReset();
    window.saveApiKey    = () => this.saveApiKey();
    window.toggleApiKey  = () => this.toggleApiKeyVisibility();
  },

  onEnter() {
    this._renderNotif();
    this._renderApiKey();
    this._renderOpenAIKey();
  },

  // ── NOTIFICATIONS ────────────────────────

  _renderNotif() {
    const enabled = State.get('notifEnabled');
    const time    = State.get('notifTime') || '19:00';

    const toggle = document.getElementById('notif-toggle');
    const desc   = document.getElementById('notif-desc');
    const row    = document.getElementById('notif-time-row');
    const input  = document.getElementById('notif-time-input');

    if (toggle) toggle.classList.toggle('on', enabled);
    if (desc)   desc.textContent = enabled ? `Activé · ${time}` : 'Désactivé';
    if (row)    row.style.display = enabled ? '' : 'none';
    if (input)  input.value = time;
  },

  toggleNotif() {
    const next = !State.get('notifEnabled');
    State.set('notifEnabled', next);
    Storage.save();
    this._renderNotif();
    window.toast(next ? 'Rappel activé' : 'Rappel désactivé');
  },

  saveNotifTime() {
    const input = document.getElementById('notif-time-input');
    if (!input) return;
    State.set('notifTime', input.value);
    Storage.save();
    this._renderNotif();
  },

  // ── CLÉ API CLAUDE ───────────────────────

  _renderApiKey() {
    const key   = State.get('claudeApiKey') || '';
    const input = document.getElementById('api-key-input');
    const badge = document.getElementById('api-key-badge');

    if (input) input.value = key;
    if (badge) {
      if (key) {
        badge.textContent = '✓ Configurée';
        badge.className   = 'api-key-badge configured';
      } else {
        badge.textContent = 'Non configurée';
        badge.className   = 'api-key-badge missing';
      }
    }
  },

  saveApiKey() {
    const input = document.getElementById('api-key-input');
    if (!input) return;
    const key = input.value.trim();
    State.set('claudeApiKey', key);
    Storage.save();
    this._renderApiKey();
    window.toast(key ? 'Clé API enregistrée ✓' : 'Clé API effacée');
  },

  toggleApiKeyVisibility() {
    const input = document.getElementById('api-key-input');
    const btn   = document.getElementById('api-key-eye');
    if (!input) return;
    if (input.type === 'password') {
      input.type   = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      input.type   = 'password';
      if (btn) btn.textContent = '👁';
    }
  },

  // ── CLÉ API OPENAI ───────────────────────

  _renderOpenAIKey() {
    const container = document.getElementById('settings-openai-section');
    if (!container) return;
    container.innerHTML = renderOpenAIKeyBlock();
    bindOpenAIKeyEvents(container);
  },

  // ── RESET ────────────────────────────────

  confirmReset() {
    const confirmed = window.confirm(
      'Supprimer toutes les données ?\n\nCette action est irréversible.'
    );
    if (!confirmed) return;
    Storage.clear();
    window.toast('Données effacées');
    window.refreshHeader();
  },

};

export default SettingsModule;
