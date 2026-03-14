// ─────────────────────────────────────────────
//  modules/progress/progress.js
// ─────────────────────────────────────────────

import State   from '../../core/state.js';
import { getUnit } from '../../shared/data.js';

const ProgressModule = {

  init() {},

  onEnter() {
    this.render();
  },

  render() {
    this._renderScores();
    this._renderCalendar();
    this._renderUnitProgress();
  },

  _renderScores() {
    const streak  = window.computeStreak();
    const entries = State.get('entries') || [];
    const el = document.getElementById('progress-scores');
    if (!el) return;

    el.innerHTML = `
      <div class="score-row">
        <div class="score-card">
          <div class="score-val olive">${streak}</div>
          <div class="score-lbl">🔥 Streak</div>
        </div>
        <div class="score-card">
          <div class="score-val terra">${entries.length}</div>
          <div class="score-lbl">Sessions</div>
        </div>
      </div>
    `;
  },

  _renderCalendar() {
    const el = document.getElementById('progress-calendar');
    if (!el) return;

    const entries     = State.get('entries') || [];
    const sessionDates = new Set(entries.map(e => e.date));
    const today        = _today();

    // Construire les 28 derniers jours
    const days = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }

    const cells = days.map(d => {
      const day = new Date(d + 'T12:00:00').getDate();
      if (d === today)               return `<div class="day-cell today">${day}</div>`;
      if (sessionDates.has(d))       return `<div class="day-cell done">${day}</div>`;
      if (d > today)                 return `<div class="day-cell future"></div>`;
      return `<div class="day-cell missed">${day}</div>`;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <div class="card-label">28 derniers jours</div>
        <div class="day-labels">
          ${['L','M','M','J','V','S','D'].map(d => `<div class="day-lbl">${d}</div>`).join('')}
        </div>
        <div class="streak-grid">${cells}</div>
      </div>
    `;
  },

  _renderUnitProgress() {
    const el = document.getElementById('progress-units');
    if (!el) return;

    const entries = State.get('entries') || [];
    const counts  = {};

    entries.forEach(e => {
      const key = e.type === 'manuel' ? `manuel-${e.unit}` : 'libre';
      counts[key] = (counts[key] || 0) + 1;
    });

    if (Object.keys(counts).length === 0) {
      el.innerHTML = `
        <div class="card">
          <div class="card-label">Maîtrise par unité</div>
          <div class="empty-text" style="font-size:12px;color:var(--muted)">
            Enregistre tes cours pour voir ta progression.
          </div>
        </div>
      `;
      return;
    }

    const rows = Object.entries(counts)
      .sort((a, b) => {
        // Trier : unités manuelles en premier par numéro, puis hors-manuel
        if (a[0] === 'libre') return 1;
        if (b[0] === 'libre') return -1;
        return Number(a[0].split('-')[1]) - Number(b[0].split('-')[1]);
      })
      .map(([key, c]) => {
        const pct  = Math.min(100, c * 20);
        let name, fillClass = '';

        if (key === 'libre') {
          name      = 'Hors manuel · Fiches prof';
          fillClass = 'prog-fill-gold';
        } else {
          const num  = Number(key.split('-')[1]);
          const unit = getUnit(num);
          name = `Unité ${num} · ${unit?.title || '?'}`;
        }

        return `
          <div class="unit-row">
            <div class="unit-row-header">
              <span class="unit-row-name">${name}</span>
              <span class="unit-row-pct">${pct}%</span>
            </div>
            <div class="prog-bar">
              <div class="prog-fill ${fillClass}" style="width:${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');

    el.innerHTML = `
      <div class="card">
        <div class="card-label">Maîtrise par unité</div>
        ${rows}
      </div>
    `;
  },

};

function _today() {
  return new Date().toISOString().split('T')[0];
}

export default ProgressModule;
