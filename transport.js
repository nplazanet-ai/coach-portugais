// ─────────────────────────────────────────────
//  modules/transport/transport.js
//  Mode transport — flashcards vocabulaire
//  Fonctionne 100 % hors connexion.
//  Données : entries[*].vocab [{pt, fr}]
// ─────────────────────────────────────────────

import State from './state.js';

const SESSION_SIZE = 10;  // cartes par session

const TransportModule = {

  // ── État interne ──────────────────────────

  _deck:    [],   // toutes les cartes disponibles [{pt, fr, unit}]
  _session: [],   // cartes de la session en cours
  _index:   0,    // carte courante
  _score:   0,    // bonnes réponses
  _answered: false, // réponse déjà donnée pour la carte courante

  // ── Init ──────────────────────────────────

  init() {
    window.openTransport  = () => this.open();
    window.closeTransport = () => this.close();
  },

  // ── Ouvrir / fermer ───────────────────────

  open() {
    const overlay = document.getElementById('transport-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    this._buildDeck();
    this._renderStart();
  },

  close() {
    const overlay = document.getElementById('transport-overlay');
    if (overlay) overlay.classList.remove('open');
  },

  // ── Construction du deck ──────────────────

  _buildDeck() {
    const entries   = State.get('entries')   || [];
    const vocabDico = State.get('vocabDico') || [];
    const seen      = new Set();
    this._deck      = [];

    // Mots des entrées de journal
    entries.forEach(entry => {
      const unit = entry.type === 'manuel' ? entry.unit : null;
      (entry.vocab || []).forEach(({ pt, fr }) => {
        if (!pt || !fr) return;
        const key = pt.toLowerCase().trim();
        if (seen.has(key)) return;
        seen.add(key);
        this._deck.push({ pt: pt.trim(), fr: fr.trim(), unit });
      });
    });

    // Mots du dictionnaire importé (Excel / CSV)
    vocabDico.forEach(({ pt, fr }) => {
      if (!pt || !fr) return;
      const key = pt.toLowerCase().trim();
      if (seen.has(key)) return;
      seen.add(key);
      this._deck.push({ pt: pt.trim(), fr: fr.trim(), unit: null });
    });

    // Mélanger
    _shuffle(this._deck);
  },

  // ── Écran de démarrage ────────────────────

  _renderStart() {
    const body = document.getElementById('tr-body');
    if (!body) return;
    _hideProgress();

    const count   = this._deck.length;
    const session = Math.min(SESSION_SIZE, count);

    if (count === 0) {
      body.innerHTML = `
        <div class="tr-empty">
          <div class="tr-empty-icon">📚</div>
          <div class="tr-empty-text">
            Aucun mot dans ton vocabulaire.<br>
            Ajoute du vocabulaire lors de tes prochaines séances dans le journal.
          </div>
        </div>
        <div style="margin-top:auto;padding-top:20px">
          <button class="btn btn-ghost" onclick="closeTransport()">Fermer</button>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="tr-start">
        <div class="tr-start-icon">🚇</div>
        <div class="tr-start-title">Mode <em>transport</em></div>
        <div class="tr-start-sub">
          Entraîne-toi n'importe où, sans connexion.<br>
          Traduis chaque mot du portugais en français.
        </div>
        <div class="tr-start-count">
          📚 ${count} mot${count > 1 ? 's' : ''} disponible${count > 1 ? 's' : ''}
          · session de ${session}
        </div>
      </div>
      <div class="tr-start-btns">
        <button class="btn btn-primary" onclick="TransportModule._startSession()">
          Commencer →
        </button>
        <button class="btn btn-ghost" onclick="closeTransport()">Annuler</button>
      </div>
    `;

    // Exposer pour le onclick inline
    window.TransportModule = this;
  },

  // ── Session ───────────────────────────────

  _startSession() {
    this._session  = this._deck.slice(0, Math.min(SESSION_SIZE, this._deck.length));
    this._index    = 0;
    this._score    = 0;
    this._answered = false;
    this._renderQuestion();
  },

  _renderQuestion() {
    const body = document.getElementById('tr-body');
    if (!body) return;

    const card     = this._session[this._index];
    const total    = this._session.length;
    const pct      = (this._index / total) * 100;

    // Barre de progression
    _showProgress(this._index + 1, total, this._score);
    document.querySelector('.tr-progress-fill').style.width = pct + '%';

    // 4 options : 1 correcte + 3 distracteurs
    const options = this._buildOptions(card);

    const metaLabel = card.unit
      ? `<span class="badge badge-olive" style="font-size:9px">Unité ${card.unit}</span>`
      : `<span class="badge badge-gold" style="font-size:9px">Hors manuel</span>`;

    body.innerHTML = `
      <div class="tr-card">
        <div class="tr-card-hint">Traduis en français</div>
        <div class="tr-card-word">${_escape(card.pt)}</div>
        <div class="tr-card-meta">${metaLabel}</div>
      </div>
      <div class="tr-options" id="tr-options">
        ${options.map((opt, i) => `
          <button class="tr-option" onclick="TransportModule._checkAnswer(${i})">
            ${_escape(opt)}
          </button>
        `).join('')}
      </div>
      <div id="tr-feedback"></div>
      <div class="tr-next-btn" id="tr-next" style="display:none">
        <button class="btn btn-primary" onclick="TransportModule._nextCard()">
          ${this._index + 1 < total ? 'Suivant →' : 'Voir le résultat'}
        </button>
      </div>
    `;

    this._answered = false;
    window.TransportModule = this;
  },

  _buildOptions(card) {
    // Distracteurs : autres mots FR du deck (hors la bonne réponse)
    const pool = this._deck
      .filter(c => c.fr.toLowerCase() !== card.fr.toLowerCase())
      .map(c => c.fr);
    _shuffle(pool);
    const distractors = pool.slice(0, 3);

    // Si pas assez de distracteurs, on complète avec des faux génériques
    const fillers = ['ser', 'ter', 'fazer', 'ir', 'dizer', 'ver', 'dar', 'ficar']
      .filter(f => f !== card.fr);
    while (distractors.length < 3) {
      distractors.push(fillers[distractors.length] || '—');
    }

    const opts = [card.fr, ...distractors];
    _shuffle(opts);
    return opts;
  },

  _checkAnswer(chosenIndex) {
    if (this._answered) return;
    this._answered = true;

    const card     = this._session[this._index];
    const optEls   = document.querySelectorAll('.tr-option');
    const feedback = document.getElementById('tr-feedback');
    const next     = document.getElementById('tr-next');

    // Trouver quelle option est la bonne
    let correctIndex = -1;
    optEls.forEach((el, i) => {
      if (el.textContent.trim() === card.fr) correctIndex = i;
      el.classList.add('disabled');
    });

    const isCorrect = (chosenIndex === correctIndex);

    if (isCorrect) {
      this._score++;
      optEls[chosenIndex].classList.add('correct');
      if (feedback) feedback.innerHTML = `
        <div class="tr-feedback ok">
          <span class="tr-feedback-icon">✓</span>
          <span>Correct !</span>
        </div>`;
    } else {
      optEls[chosenIndex].classList.add('wrong');
      if (correctIndex >= 0) optEls[correctIndex].classList.add('correct');
      if (feedback) feedback.innerHTML = `
        <div class="tr-feedback ko">
          <span class="tr-feedback-icon">✗</span>
          <span>La bonne réponse était : <strong>${_escape(card.fr)}</strong></span>
        </div>`;
    }

    _showProgress(this._index + 1, this._session.length, this._score);
    if (next) next.style.display = '';
  },

  _nextCard() {
    this._index++;
    if (this._index >= this._session.length) {
      this._renderEnd();
    } else {
      this._renderQuestion();
    }
  },

  // ── Écran de fin ──────────────────────────

  _renderEnd() {
    const body  = document.getElementById('tr-body');
    if (!body) return;
    _hideProgress();

    const total   = this._session.length;
    const score   = this._score;
    const pct     = Math.round((score / total) * 100);
    const emoji   = pct === 100 ? '🏆' : pct >= 70 ? '🎉' : pct >= 40 ? '💪' : '📖';
    const comment = pct === 100 ? 'Parfait !'
      : pct >= 70 ? 'Très bien !'
      : pct >= 40 ? 'Continue comme ça !'
      : 'À retravailler !';

    body.innerHTML = `
      <div class="tr-end">
        <div class="tr-end-icon">${emoji}</div>
        <div class="tr-end-title">${comment}</div>
        <div class="tr-end-score">
          <strong>${score}/${total}</strong>
          bonne${score > 1 ? 's' : ''} réponse${score > 1 ? 's' : ''} · ${pct}&nbsp;%
        </div>
      </div>
      <div class="tr-end-btns">
        <button class="btn btn-primary" onclick="TransportModule._startSession()">
          Recommencer
        </button>
        <button class="btn btn-ghost" onclick="closeTransport()">Fermer</button>
      </div>
    `;
    window.TransportModule = this;
  },

};

// ── Helpers privés ────────────────────────────

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function _escape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _showProgress(current, total, score) {
  const bar = document.getElementById('tr-progress');
  if (!bar) return;
  bar.style.display = '';
  bar.innerHTML = `
    <div class="tr-progress-bar">
      <div class="tr-progress-fill" style="width:${((current - 1) / total) * 100}%"></div>
    </div>
    <div class="tr-progress-info">
      <span>${current} / ${total}</span>
      <span class="tr-score-badge">✓ ${score}</span>
    </div>
  `;
}

function _hideProgress() {
  const bar = document.getElementById('tr-progress');
  if (bar) bar.style.display = 'none';
}

export default TransportModule;
