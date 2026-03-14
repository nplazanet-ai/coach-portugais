// ─────────────────────────────────────────────
//  modules/home/home.js
// ─────────────────────────────────────────────

import State from '../../core/state.js';
import { getUnit } from '../../shared/data.js';

const HomeModule = {

  init() {
    // Rien à initialiser au démarrage
  },

  // Appelé à chaque fois qu'on arrive sur cet écran
  onEnter() {
    this.render();
  },

  render() {
    this._renderBanner();
    this._renderLastCours();
    this._renderUnitProgress();
  },

  // ── Bannière du jour ──────────────────────

  _renderBanner() {
    const el = document.getElementById('home-banner');
    if (!el) return;

    const now     = new Date();
    const streak  = window.computeStreak();
    const entries = State.get('entries') || [];

    const dateStr = now.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

    el.innerHTML = `
      <div class="banner-date">${dateStr}</div>
      <div class="banner-greeting">Bom dia&nbsp;! Pronto para <em>aprender&nbsp;?</em></div>
      <div class="banner-stats">
        <div class="bstat">
          <div class="bstat-val accent">${streak}</div>
          <div class="bstat-lbl">🔥 Streak</div>
        </div>
        <div class="bstat">
          <div class="bstat-val">${entries.length}</div>
          <div class="bstat-lbl">Sessions</div>
        </div>
        <div class="bstat">
          <div class="bstat-val">${_countUnits(entries)}</div>
          <div class="bstat-lbl">Unités</div>
        </div>
      </div>
    `;
  },

  // ── Dernier cours ─────────────────────────

  _renderLastCours() {
    const el = document.getElementById('home-last-cours');
    if (!el) return;

    const entries = State.get('entries') || [];
    if (entries.length === 0) {
      el.innerHTML = `
        <div class="last-cours">
          <div class="lc-header">
            <span class="lc-label">Dernier cours</span>
            <span class="badge badge-muted">—</span>
          </div>
          <div style="font-size:12px;color:var(--muted)">
            Aucun cours enregistré. Appuie sur "Après le cours" pour commencer.
          </div>
        </div>
      `;
      return;
    }

    const last  = entries[entries.length - 1];
    const unit  = last.type === 'manuel' ? getUnit(last.unit) : null;
    const badge = last.type === 'manuel'
      ? `<span class="badge badge-olive">Unité ${last.unit}</span>`
      : `<span class="badge badge-gold">Hors manuel</span>`;

    const notions = (last.notions || [])
      .map(n => `<span class="theme-chip">${n}</span>`)
      .join('');

    el.innerHTML = `
      <div class="last-cours">
        <div class="lc-header">
          <span class="lc-label">Dernier cours · ${_formatDate(last.date)}</span>
          ${badge}
        </div>
        <div class="themes-row">${notions || '<span style="font-size:12px;color:var(--muted)">Aucune notion saisie</span>'}</div>
      </div>
    `;
  },

  // ── Progression par unité ─────────────────

  _renderUnitProgress() {
    const el = document.getElementById('home-unit-progress');
    if (!el) return;

    const entries = State.get('entries') || [];
    const manuelEntries = entries.filter(e => e.type === 'manuel');

    if (manuelEntries.length === 0) {
      el.innerHTML = '';
      return;
    }

    // Compter les sessions par unité
    const counts = {};
    manuelEntries.forEach(e => {
      counts[e.unit] = (counts[e.unit] || 0) + 1;
    });

    const rows = Object.entries(counts)
      .sort((a, b) => a[0] - b[0])
      .slice(0, 4)
      .map(([u, c]) => {
        const unit = getUnit(Number(u));
        const pct  = Math.min(100, c * 20);
        return `
          <div class="unit-row">
            <div class="unit-row-header">
              <span class="unit-row-name">Unité ${u} · ${unit ? unit.title : '?'}</span>
              <span class="unit-row-pct">${pct}%</span>
            </div>
            <div class="prog-bar">
              <div class="prog-fill" style="width:${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');

    el.innerHTML = `
      <div class="card">
        <div class="card-label">Unités en cours</div>
        ${rows}
      </div>
    `;
  },

};

// ── Helpers privés ────────────────────────────

function _countUnits(entries) {
  return new Set(
    entries.filter(e => e.type === 'manuel').map(e => e.unit)
  ).size;
}

function _formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short'
  });
}

export default HomeModule;
