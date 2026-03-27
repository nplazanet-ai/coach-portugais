// ─────────────────────────────────────────────
//  modules/journal/journal.js
// ─────────────────────────────────────────────

import State   from './state.js';
import Storage from './storage.js';
import { UNITS, getUnit } from './data.js';

// ── État local du formulaire ──────────────────
let _form   = _emptyForm();
let _editId = null; // id de l'entrée en cours d'édition (null = nouvelle séance)

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
    window.editEntry         = (id) => this.editEntry(id);
    window.viewEntry         = (id) => this.viewEntry(id);
    window.pickPhoto         = () => this._showPhotoPicker();
    window.pickPhotoCamera   = () => this._pickPhoto(true);
    window.pickPhotoGallery  = () => this._pickPhoto(false);
    window.closePhotoPicker  = () => this._closePhotoPicker();
    window.closeDetailSheet  = () => this._closeDetailSheet();

    // Fermer la sheet journal uniquement sur un vrai tap (pas un scroll)
    const overlay = document.getElementById('journal-overlay');
    let _touchStartY = 0;
    overlay.addEventListener('touchstart', (e) => { _touchStartY = e.touches[0].clientY; }, { passive: true });
    overlay.addEventListener('touchend',   (e) => {
      if (Math.abs(e.changedTouches[0].clientY - _touchStartY) < 10) this.closeSheet();
    });
    overlay.addEventListener('click', () => this.closeSheet());
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
          <button class="btn btn-secondary btn-sm" onclick="viewEntry('${e.id}')">Afficher</button>
          <button class="btn btn-secondary btn-sm" onclick="editEntry('${e.id}')">Modifier</button>
          <button class="btn btn-danger btn-sm"    onclick="deleteEntry('${e.id}')">Supprimer</button>
        </div>
      </div>
    `;
  },

  // ── SHEET : OUVRIR / FERMER ──────────────

  openSheet(entry = null) {
    _editId = entry ? entry.id : null;
    _form   = entry ? {
      type:    entry.type,
      unit:    entry.unit,
      notions: [...(entry.notions || [])],
      vocab:   [...(entry.vocab   || [])],
      notes:   entry.notes || '',
      photos:  [...(entry.photos  || [])],
      date:    entry.date,
    } : _emptyForm();
    this._renderForm();
    document.getElementById('journal-sheet-title').textContent =
      entry ? '✏️ Modifier la séance' : '📖 Nouvelle séance';
    document.getElementById('journal-save-btn').textContent =
      entry ? 'Enregistrer les modifications' : 'Enregistrer la séance';
    document.getElementById('journal-overlay').classList.add('open');
    document.getElementById('journal-sheet').classList.add('open');
    document.getElementById('journal-sheet').scrollTop = 0;
  },

  editEntry(id) {
    const entry = (State.get('entries') || []).find(e => e.id === id);
    if (!entry) return;
    this.openSheet(entry);
  },

  closeSheet() {
    document.getElementById('journal-overlay').classList.remove('open');
    document.getElementById('journal-sheet').classList.remove('open');
    _editId = null;
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
    document.getElementById('form-notes').value = _form.notes || '';

    // Notion input field reset
    const notionInput = document.getElementById('notion-input');
    if (notionInput) notionInput.value = '';

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
    } else {
      el.innerHTML = themes.map(t => `
        <span class="tag ${_form.notions.includes(t) ? 'selected' : ''}"
              onclick="toggleNotion(this, '${t}')">${t}</span>
      `).join('');
    }

    // Ajouter les notions libres (non présentes dans les thèmes de l'unité)
    _form.notions.filter(n => !themes.includes(n)).forEach(n => {
      const tag = document.createElement('span');
      tag.className = 'tag selected';
      tag.textContent = n;
      tag.onclick = () => {
        _form.notions = _form.notions.filter(x => x !== n);
        tag.remove();
      };
      el.appendChild(tag);
    });
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

  // Ajouter une notion depuis le champ texte
  _addNotion(val) {
    if (!val || _form.notions.includes(val)) return;
    _form.notions.push(val);
    const el = document.getElementById('notions-suggestions');
    const tag = document.createElement('span');
    tag.className = 'tag selected';
    tag.textContent = val;
    tag.onclick = () => {
      _form.notions = _form.notions.filter(n => n !== val);
      tag.remove();
    };
    el.appendChild(tag);
  },

  addNotionFromInput() {
    const input = document.getElementById('notion-input');
    const val = input.value.trim();
    this._addNotion(val);
    input.value = '';
  },

  // Saisie libre d'une notion (touche Entrée)
  handleNotionInput(e) {
    if (e.key !== 'Enter') return;
    const val = e.target.value.trim();
    this._addNotion(val);
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

  _showPhotoPicker() {
    document.getElementById('photo-picker-overlay').classList.add('open');
    document.getElementById('photo-picker-sheet').classList.add('open');
  },

  _closePhotoPicker() {
    document.getElementById('photo-picker-overlay').classList.remove('open');
    document.getElementById('photo-picker-sheet').classList.remove('open');
  },

  _pickPhoto(useCamera) {
    this._closePhotoPicker();
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';
    if (useCamera) input.capture = 'environment';
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

    // Auto-ajouter une notion en cours de saisie si l'utilisateur n'a pas appuyé sur Entrée/+
    const notionInput = document.getElementById('notion-input');
    if (notionInput?.value.trim()) this.addNotionFromInput();

    // Validations
    if (!date) { window.toast('⚠️ Indique la date du cours'); return; }
    if (_form.type === 'manuel' && !_form.unit) {
      window.toast('⚠️ Sélectionne une unité'); return;
    }
    if (_form.notions.length === 0) {
      window.toast('⚠️ Ajoute au moins une notion'); return;
    }

    const updated = {
      id:        _editId || Date.now().toString(),
      date,
      type:      _form.type,
      unit:      _form.unit,
      notions:   [..._form.notions],
      vocab:     [..._form.vocab],
      notes,
      photos:    [..._form.photos],
      createdAt: _editId
        ? ((State.get('entries') || []).find(e => e.id === _editId)?.createdAt || new Date().toISOString())
        : new Date().toISOString(),
    };

    let entries = State.get('entries') || [];
    if (_editId) {
      entries = entries.map(e => e.id === _editId ? updated : e);
    } else {
      entries.push(updated);
    }
    State.set('entries', entries);
    Storage.save();

    this.closeSheet();
    this.renderList();
    window.refreshHeader();
    window.toast(_editId ? '✓ Séance modifiée !' : '✓ Séance enregistrée !');
  },

  // ── VUE DÉTAIL ───────────────────────────

  viewEntry(id) {
    const e = (State.get('entries') || []).find(e => e.id === id);
    if (!e) return;
    const isManuel = e.type === 'manuel';
    const badge = isManuel
      ? `<span class="badge badge-olive">Unité ${e.unit}</span>`
      : `<span class="badge badge-gold">Hors manuel</span>`;

    const notions = (e.notions || []).map(n => `<span class="notion-chip">${n}</span>`).join('');

    const vocab = e.vocab?.length ? `
      <div class="form-group">
        <div class="form-label">📚 Vocabulaire</div>
        <div class="vocab-list">
          ${e.vocab.map(v => `<div class="vocab-item"><span class="pt">${v.pt}</span><span class="fr"> — ${v.fr}</span></div>`).join('')}
        </div>
      </div>` : '';

    const photos = e.photos?.length ? `
      <div class="form-group">
        <div class="form-label">📷 Photos (${e.photos.length})</div>
        <div class="detail-photos">
          ${e.photos.map(b64 => `<img class="detail-photo" src="${b64}">`).join('')}
        </div>
      </div>` : '';

    const notes = e.notes ? `
      <div class="form-group">
        <div class="form-label">Notes</div>
        <div class="entry-note" style="border:none;padding:0">${e.notes}</div>
      </div>` : '';

    document.getElementById('detail-content').innerHTML = `
      <div style="margin-bottom:12px">
        <span class="entry-date">${_formatDate(e.date)}</span> ${badge}
      </div>
      <div class="form-group">
        <div class="form-label">Notions abordées</div>
        <div class="tags" style="margin-top:4px">${notions}</div>
      </div>
      ${vocab}${photos}${notes}
    `;
    document.getElementById('detail-overlay').classList.add('open');
    document.getElementById('detail-sheet').classList.add('open');
    document.getElementById('detail-sheet').scrollTop = 0;
  },

  _closeDetailSheet() {
    document.getElementById('detail-overlay').classList.remove('open');
    document.getElementById('detail-sheet').classList.remove('open');
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

// Exposés pour la saisie libre de notion
window.handleNotionInput  = (e) => JournalModule.handleNotionInput(e);
window.addNotionFromInput = ()  => JournalModule.addNotionFromInput();

export default JournalModule;
