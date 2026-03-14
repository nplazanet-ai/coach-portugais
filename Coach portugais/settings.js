// ─────────────────────────────────────────────
//  modules/settings/settings.js
// ─────────────────────────────────────────────

import State   from '../../core/state.js';
import Storage from '../../core/storage.js';

const SettingsModule = {

  init() {
    window.toggleNotif     = () => this.toggleNotif();
    window.saveNotifTime   = () => this.saveNotifTime();
    window.exportData      = () => Storage.exportJSON();
    window.confirmReset    = () => this.confirmReset();
  },

  onEnter() {
    this.render();
  },

  render() {
    const notifEnabled = State.get('notifEnabled');
    const notifTime    = State.get('notifTime') || '19:00';

    // Toggle
    const toggle = document.getElementById('notif-toggle');
    if (toggle) toggle.classList.toggle('on', notifEnabled);

    // Description
    const desc = document.getElementById('notif-desc');
    if (desc) desc.textContent = notifEnabled ? `Activé · ${notifTime}` : 'Désactivé';

    // Heure
    const timeRow = document.getElementById('notif-time-row');
    if (timeRow) timeRow.style.display = notifEnabled ? 'flex' : 'none';

    const timeInput = document.getElementById('notif-time-input');
    if (timeInput) timeInput.value = notifTime;
  },

  toggleNotif() {
    const current = State.get('notifEnabled');
    State.set('notifEnabled', !current);

    if (!current && 'Notification' in window) {
      Notification.requestPermission();
    }

    Storage.save();
    this.render();
    window.toast(!current ? '🔔 Rappel activé' : 'Rappel désactivé');
  },

  saveNotifTime() {
    const val = document.getElementById('notif-time-input').value;
    State.set('notifTime', val);
    Storage.save();
    this.render();
    window.toast('Heure enregistrée');
  },

  confirmReset() {
    if (!confirm('Effacer toutes les données ? Cette action est irréversible.')) return;
    Storage.clear();
    window.toast('Données réinitialisées');
    this.render();
    window.refreshHeader();
    // Notifier les autres modules
    window.navigate('home');
  },

};

export default SettingsModule;
