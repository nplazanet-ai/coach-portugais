// ─────────────────────────────────────────────
//  modules/journal/journal.js
// ─────────────────────────────────────────────

import State   from './state.js';
import Storage from './storage.js';
import { UNITS, getUnit } from './data.js';

// ── État local du formulaire ──────────────────
let _form = _emptyForm();

function _emptyForm() {
  return {
    type:    'manuel',   // 'manuel' | 'libre'
    unit:    null,
    notions: [],
    vocab:   [],         // [{ pt, fr }]
    notes:   '',
    photos:  [],         // base64 strings
    date:    _today(),
  };
}

// ─────────────────────────────────────────────

const JournalModule = {

  init() {
    // Exposer les fonctions nécessaires aux onclick du HTML
    window.openJournalSheet  = () => this.openSheet();
    window.closeJournalSheet = () => this.closeSheet();
    window.saveJournalEntry  = () => this.saveEntry();
    window.selectEntryType   = (t) => this.selectType(t);
    window.selectUnit        = (n) => this.selectUnit(n);
    window.toggleNotion      = (el, n) => this.toggleNotion(el, n);
    window.addVocabRow       = () => this.addVocabRow();
    window.removeVocab       = (i) => this.removeVocab(i);
    window.deleteEntry       = (id) => this.deleteEntry(id);
    window.pickPhoto         = () => this._pickPhoto();
  },

  onEnter() {
    this.renderList();
  },

  // ── LISTE DES ENTRÉES ────────────────────

  renderList() {
    const el = document.getElementById('journal-list');
    if (!el) return;

    const entries = [...(State.get('entries') || [])].reverse();

    if (entries.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📖</div>
          <div class="empty-text">
            Aucun cours enregistré pour l'instant.<br>
            Appuie sur le bouton pour commencer.
          </div>
        </div>
      `;
      return;
    }

    el.innerHTML = entries.map(e => this._renderEntry(e)).join('');
  },

  _renderEntry(e) {
    const isManuel = e.type === 'manuel';
    const unit     = isManuel ? getUnit(e.unit) : null;

    const badge = isManuel
      ? `<span class="badge badge-olive">Unité ${e.unit}</span>`
      : `<span class="badge badge-gold">Hors manuel</span>`;

    const notions = (e.notions || [])
      .map(n => `<span class="notion-chip">${n}</span>`)
      .join('');

    const vocabBlock = e.vocab?.length ? `
      <div class="entry-vocab">
        <div class="vocab-section-label">📚 Vocabulaire (${e.vocab.length} mot${e.vocab.length > 1 ? 's' : ''})</div>
        <div class="vocab-list">
          ${e.vocab.map(v => `
            <div class="vocab-item">
              <span class="pt">${v.pt}</span>
              <span class="fr"> — ${v.fr}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const photoBlock = e.photos?.length ? `
      <div class="entry-photo">
        <span>📷</span>
        <span class="photo-label">${e.photos.length} photo${e.photos.length > 1 ? 's' : ''}</span>
        <span class="badge badge-blue">OCR ✓</span>
      </div>
    ` : '';

    const noteBlock = e.notes ? `
      <div class="entry-note">${e.notes}</div>
    ` : '';

    return `
      <div class="entry-card fade-up">
        <div class="entry-top">
          <div class="entry-meta">
            <span class="entry-date">${_formatDate(e.date)}</span>
            ${badge}
          </div>
          <div class="entry-notions">${notions}</div>
        </div>
        ${vocabBlock}
        ${photoBlock}
        ${noteBlock}
        <div class="entry-actions">
          <button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')">Supprimer</button>
        </div>
      </div>
    `;
  },

  // ── SHEET : OUVRIR / FERMER ──────────────

  openSheet() {
    _form = _emptyForm();
    this._renderForm();
    document.getElementById('journal-overlay').classList.add('open');
    document.getElementById('journal-sheet').classList.add('open');
  },

  closeSheet() {
    document.getElementById('journal-overlay').classList.remove('open');
    document.getElementById('journal-sheet').classList.remove('open');
  },

  // ── SHEET : RENDU DU FORMULAIRE ──────────

  _renderForm() {
    // Date
    document.getElementById('form-date').value = _form.date;

    // Type toggle
    this._refreshTypeToggle();

    // Unités
    this._renderUnitsGrid();

    // Notions
    this._renderNotionsSuggestions();

    // Vocab
    this._renderVocabChips();

    // Notes
    document.getElementById('form-notes').value = '';

    // Photos
    this._renderPhotoPreviews();
  },

  // ── TYPE : MANUEL / LIBRE ────────────────

  selectType(type) {
    _form.type   = type;
    _form.unit   = null;
    _form.notions = [];
    this._refreshTypeToggle();
    this._renderUnitsGrid();
    this._renderNotionsSuggestions();
  },

  _refreshTypeToggle() {
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.remove('active-manuel', 'active-libre');
    });
    const active = document.querySelector(`[data-type="${_form.type}"]`);
    if (active) active.classList.add(_form.type === 'manuel' ? 'active-manuel' : 'active-libre');

    const unitsSection = document.getElementById('units-section');
    if (unitsSection) unitsSection.style.display = _form.type === 'manuel' ? 'block' : 'none';
  },

  // ── UNITÉS ───────────────────────────────

  _renderUnitsGrid() {
    const el = document.getElementById('units-grid');
    if (!el) return;
    el.innerHTML = UNITS.map(u => `
      <button class="unit-btn ${_form.unit === u.num ? 'selected' : ''}"
              onclick="selectUnit(${u.num})">${u.num}</button>
    `).join('');
  },

  selectUnit(num) {
    _form.unit    = num;
    _form.notions = [];
    this._renderUnitsGrid();
    this._renderNotionsSuggestions();
  },

  // ── NOTIONS ──────────────────────────────

  _renderNotionsSuggestions() {
    const el = document.getElementById('notions-suggestions');
    if (!el) return;

    let themes = [];
    if (_form.type === 'manuel' && _form.unit) {
      themes = getUnit(_form.unit)?.themes || [];
    }

    if (themes.length === 0 && _form.type === 'manuel') {
      el.innerHTML = `<span style="font-size:11px;color:var(--muted)">Sélectionne une unité pour voir les thèmes suggérés</span>`;
      return;
    }

    el.innerHTML = themes.map(t => `
      <span class="tag ${_form.notions.includes(t) ? 'selected' : ''}"
            onclick="toggleNotion(this, '${t}')">${t}</span>
    `).join('');
  },

  toggleNotion(el, notion) {
    if (_form.notions.includes(notion)) {
      _form.notions = _form.notions.filter(n => n !== notion);
      el.classList.remove('selected');
    } else {
      _form.notions.push(notion);
      el.classList.add('selected');
    }
  },

  // Saisie libre d'une notion (touche Entrée)
  handleNotionInput(e) {
    if (e.key !== 'Enter') return;
    const val = e.target.value.trim();
    if (!val || _form.notions.includes(val)) return;
    _form.notions.push(val);
    // Ajouter un tag visuel
    const el = document.getElementById('notions-suggestions');
    const tag = document.createElement('span');
    tag.className = 'tag selected';
    tag.textContent = val;
    tag.onclick = () => {
      _form.notions = _form.notions.filter(n => n !== val);
      tag.remove();
    };
    el.appendChild(tag);
    e.target.value = '';
  },

  // ── VOCABULAIRE ──────────────────────────

  addVocabRow() {
    const pt = document.getElementById('vocab-pt').value.trim();
    const fr = document.getElementById('vocab-fr').value.trim();
    if (!pt || !fr) { window.toast('⚠️ Saisis le mot PT et sa traduction'); return; }
    _form.vocab.push({ pt, fr });
    document.getElementById('vocab-pt').value = '';
    document.getElementById('vocab-fr').value = '';
    this._renderVocabChips();
  },

  removeVocab(i) {
    _form.vocab.splice(i, 1);
    this._renderVocabChips();
  },

  _renderVocabChips() {
    const el = document.getElementById('vocab-chips');
    if (!el) return;
    if (_form.vocab.length === 0) {
      el.innerHTML = `<span style="font-size:11px;color:var(--muted)">Aucun mot ajouté</span>`;
      return;
    }
    el.innerHTML = _form.vocab.map((v, i) => `
      <span class="vocab-chip">
        <span class="pt">${v.pt}</span>
        <span class="fr"> — ${v.fr}</span>
        <span class="vocab-chip-del" onclick="removeVocab(${i})">✕</span>
      </span>
    `).join('');
  },

  // ── PHOTOS ───────────────────────────────

  _pickPhoto() {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // caméra arrière sur mobile
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const b64 = await _fileToBase64(file);
      _form.photos.push(b64);
      this._renderPhotoPreviews();
      window.toast('📷 Photo ajoutée');
    };
    input.click();
  },

  _renderPhotoPreviews() {
    const el = document.getElementById('photo-previews');
    if (!el) return;
    if (_form.photos.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = _form.photos.map((b64, i) => `
      <div class="photo-preview-wrap">
        <img class="photo-preview" src="${b64}" alt="photo ${i+1}">
        <div class="photo-preview-del" onclick="_removePhoto(${i})">✕</div>
      </div>
    `).join('');
  },

  // ── SAUVEGARDE ───────────────────────────

  saveEntry() {
    const date  = document.getElementById('form-date').value;
    const notes = document.getElementById('form-notes').value.trim();

    // Validations
    if (!date) { window.toast('⚠️ Indique la date du cours'); return; }
    if (_form.type === 'manuel' && !_form.unit) {
      window.toast('⚠️ Sélectionne une unité'); return;
    }
    if (_form.notions.length === 0) {
      window.toast('⚠️ Ajoute au moins une notion'); return;
    }

    const entry = {
      id:        Date.now().toString(),
      date,
      type:      _form.type,
      unit:      _form.unit,
      notions:   [..._form.notions],
      vocab:     [..._form.vocab],
      notes,
      photos:    [..._form.photos],
      createdAt: new Date().toISOString(),
    };

    const entries = State.get('entries') || [];
    entries.push(entry);
    State.set('entries', entries);
    Storage.save();

    this.closeSheet();
    this.renderList();
    window.refreshHeader();
    window.toast('✓ Séance enregistrée !');
  },

  // ── SUPPRESSION ──────────────────────────

  deleteEntry(id) {
    if (!confirm('Supprimer cette entrée ?')) return;
    const entries = (State.get('entries') || []).filter(e => e.id !== id);
    State.set('entries', entries);
    Storage.save();
    this.renderList();
    window.refreshHeader();
    window.toast('Entrée supprimée');
  },

};

// ── Helpers ──────────────────────────────────

function _today() {
  return new Date().toISOString().split('T')[0];
}

function _formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Exposé pour les previews photos
window._removePhoto = function(i) {
  _form.photos.splice(i, 1);
  JournalModule._renderPhotoPreviews();
};

// Exposé pour la saisie libre de notion
window.handleNotionInput = (e) => JournalModule.handleNotionInput(e);

export default JournalModule;
