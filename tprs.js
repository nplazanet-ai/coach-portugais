// ─────────────────────────────────────────────
//  modules/tprs/tprs.js
//  Module Oral TPRS.
//  Flux : Génération → Écoute → Quiz → Retelling guide
// ─────────────────────────────────────────────

import State        from '../../core/state.js';
import Storage      from '../../core/storage.js';
import TprsGenerator from './tprs-generator.js';

// ── État local de la session ──────────────────
let _story      = null;   // histoire générée
let _quizIndex  = 0;
let _quizScore  = 0;
let _utterance  = null;   // SpeechSynthesisUtterance en cours

// ─────────────────────────────────────────────

const TprsModule = {

  init() {
    window.tprsGenerate         = () => this.generate();
    window.tprsReplay           = () => this.replay();
    window.tprsGoToQuiz         = () => this.goToQuiz();
    window.tprsAnswer           = (ans) => this.answer(ans);
    window.tprsStopSpeech       = () => speechSynthesis.cancel();
  },

  onEnter() {
    _story     = null;
    _quizIndex = 0;
    _quizScore = 0;
    this._render();
  },

  // ── RENDU PRINCIPAL ──────────────────────

  _render() {
    const el = document.getElementById('tprs-content');
    if (!el) return;

    const lastEntry = _lastEntry();
    const hasApiKey = !!State.get('claudeApiKey');

    if (!lastEntry) {
      el.innerHTML = _tplEmpty(
        '📖',
        'Aucun cours enregistré',
        'Saisis d\'abord une séance dans le Journal pour que je génère une histoire adaptée.',
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="navigate('journal')">Ouvrir le journal</button>`
      );
      return;
    }

    if (!hasApiKey) {
      el.innerHTML = _tplEmpty(
        '🔑',
        'Clé API requise',
        'Configure ta clé Claude API dans les Réglages pour activer la génération d\'histoires personnalisées.',
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="navigate('settings')">Ouvrir les réglages</button>`
      );
      return;
    }

    this._renderReady(el, lastEntry);
  },

  _renderReady(el, entry) {
    const dateStr    = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const unitStr    = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
    const notions    = (entry.notions || []).slice(0, 3).join(' · ');
    const vocabCount = (entry.vocab || []).length;

    el.innerHTML = `
      <div class="tprs-source-card fade-up delay-1">
        <div class="tprs-source-label">Basé sur ton dernier cours</div>
        <div class="tprs-source-title">${unitStr} · ${dateStr}</div>
        ${notions    ? `<div class="tprs-source-notions">${notions}</div>` : ''}
        ${vocabCount ? `<div class="tprs-source-vocab">${vocabCount} mot${vocabCount > 1 ? 's' : ''} de vocabulaire</div>` : ''}
      </div>

      <div id="tprs-story-zone"></div>

      <button class="btn btn-primary fade-up delay-2" id="tprs-gen-btn" onclick="tprsGenerate()">
        ✨&nbsp; Générer l'histoire
      </button>
    `;
  },

  // ── GÉNÉRATION ───────────────────────────

  async generate() {
    const btn  = document.getElementById('tprs-gen-btn');
    const zone = document.getElementById('tprs-story-zone');
    if (!btn) return;

    btn.disabled    = true;
    btn.textContent = '⏳ Génération en cours…';

    try {
      _story = await TprsGenerator.generate(_lastEntry());
      this._renderStory();
    } catch (err) {
      btn.disabled    = false;
      btn.textContent = '✨ Générer l\'histoire';
      window.toast('Erreur : ' + err.message, 4000);
    }
  },

  // ── AFFICHAGE DE L'HISTOIRE ───────────────

  _renderStory() {
    const zone = document.getElementById('tprs-story-zone');
    const btn  = document.getElementById('tprs-gen-btn');
    if (btn)  btn.style.display = 'none';
    if (!zone || !_story) return;

    const sentences = _story.sentences
      .map((s, i) => `<div class="tprs-sentence fade-up" style="animation-delay:${0.05 + i * 0.07}s">${s}</div>`)
      .join('');

    const chips = (_story.vocabulary_used || [])
      .map(w => `<span class="tprs-vocab-chip">${w}</span>`)
      .join('');

    zone.innerHTML = `
      <div class="tprs-story-card fade-up delay-1">
        <div class="tprs-story-label">Histoire générée</div>
        <div class="tprs-story-title">${_story.title}</div>
        <div class="tprs-sentences">${sentences}</div>
        ${chips ? `<div class="tprs-vocab-row">${chips}</div>` : ''}
      </div>

      <div class="tprs-listen-bar fade-up delay-2">
        <button class="btn btn-primary tprs-listen-btn" id="tprs-listen-btn" onclick="tprsListen()">
          🔊&nbsp; Écouter l'histoire
        </button>
        <button class="btn btn-ghost tprs-replay-btn" id="tprs-replay-btn" style="display:none" onclick="tprsReplay()">
          ↺&nbsp; Réécouter
        </button>
      </div>

      <div id="tprs-quiz-zone"></div>
    `;

    // Exposer ici car le DOM vient d'être créé
    window.tprsListen = () => this.listen();
  },

  // ── LECTURE TTS ───────────────────────────

  listen() {
    if (!_story) return;

    if (!('speechSynthesis' in window)) {
      window.toast('Synthèse vocale non supportée sur cet appareil.', 3000);
      return;
    }

    speechSynthesis.cancel();

    const text      = _story.sentences.join(' ');
    _utterance      = new SpeechSynthesisUtterance(text);
    _utterance.lang = 'pt-PT';
    _utterance.rate = 0.82;

    // Cherche une voix portugaise (PT-PT en priorité, puis pt-BR, puis pt)
    const voices   = speechSynthesis.getVoices();
    const ptVoice  = voices.find(v => v.lang === 'pt-PT')
                  || voices.find(v => v.lang.startsWith('pt'));
    if (ptVoice) _utterance.voice = ptVoice;

    _utterance.onstart = () => {
      const btn = document.getElementById('tprs-listen-btn');
      if (btn) { btn.textContent = '⏸ Lecture…'; btn.onclick = () => speechSynthesis.cancel(); }
    };

    _utterance.onend = () => {
      this._afterListen();
    };

    _utterance.onerror = () => {
      window.toast('Erreur de lecture. Réessaie.', 2500);
      this._afterListen();
    };

    // Sur iOS les voix se chargent en asynchrone — réessai si vide
    if (voices.length === 0) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        const v = speechSynthesis.getVoices();
        const pt = v.find(x => x.lang === 'pt-PT') || v.find(x => x.lang.startsWith('pt'));
        if (pt) _utterance.voice = pt;
        speechSynthesis.speak(_utterance);
      }, { once: true });
    } else {
      speechSynthesis.speak(_utterance);
    }
  },

  replay() {
    this.listen();
  },

  _afterListen() {
    const listenBtn = document.getElementById('tprs-listen-btn');
    const replayBtn = document.getElementById('tprs-replay-btn');
    if (listenBtn) listenBtn.style.display = 'none';
    if (replayBtn) replayBtn.style.display = '';
    this._renderQuizPrompt();
  },

  // ── QUIZ ─────────────────────────────────

  _renderQuizPrompt() {
    const zone = document.getElementById('tprs-quiz-zone');
    if (!zone) return;

    zone.innerHTML = `
      <div class="tprs-quiz-intro fade-up">
        <div class="tprs-quiz-intro-text">Prêt pour les questions de compréhension ?</div>
        <button class="btn btn-primary" onclick="tprsGoToQuiz()">
          ❓&nbsp; Lancer le quiz
        </button>
      </div>
    `;
  },

  goToQuiz() {
    _quizIndex = 0;
    _quizScore = 0;
    this._renderQuestion();
  },

  _renderQuestion() {
    const zone = document.getElementById('tprs-quiz-zone');
    if (!zone || !_story) return;

    if (_quizIndex >= _story.questions.length) {
      this._renderQuizResult();
      return;
    }

    const q     = _story.questions[_quizIndex];
    const total = _story.questions.length;

    zone.innerHTML = `
      <div class="tprs-quiz-card fade-up">
        <div class="tprs-quiz-meta">${_quizIndex + 1} / ${total}</div>
        <div class="tprs-quiz-q">${q.text}</div>
        <div class="tprs-quiz-btns">
          <button class="btn tprs-btn-true"  onclick="tprsAnswer(true)">✓&nbsp; Vrai</button>
          <button class="btn tprs-btn-false" onclick="tprsAnswer(false)">✗&nbsp; Faux</button>
        </div>
      </div>
    `;
  },

  answer(userAnswer) {
    const q       = _story.questions[_quizIndex];
    const correct = userAnswer === q.answer;
    if (correct) _quizScore++;

    window.toast(
      correct
        ? '✓ Correct !'
        : `✗ Incorrect — c'était ${q.answer ? 'Vrai' : 'Faux'}`,
      1800
    );

    _quizIndex++;
    setTimeout(() => this._renderQuestion(), 1600);
  },

  _renderQuizResult() {
    const zone  = document.getElementById('tprs-quiz-zone');
    if (!zone) return;

    const total = _story.questions.length;
    const pct   = Math.round((_quizScore / total) * 100);
    const stars = pct >= 80 ? '⭐⭐⭐' : pct >= 50 ? '⭐⭐' : '⭐';

    // Enregistrer le score dans l'état
    const entry = _lastEntry();
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      prog[entry.id] = { score: pct, completedAt: new Date().toISOString() };
      State.set('tprsProgress', prog);
      Storage.save();
    }

    zone.innerHTML = `
      <div class="tprs-result-card fade-up">
        <div class="tprs-result-stars">${stars}</div>
        <div class="tprs-result-score">${_quizScore}/${total} bonnes réponses</div>
        <div class="tprs-result-pct">${pct}%</div>

        <div class="tprs-retelling-guide">
          <div class="trg-label">Guide de retelling</div>
          <div class="trg-words">${_story.retelling_guide}</div>
          <div class="trg-hint">Re-raconte l'histoire à voix haute en t'aidant de ces mots-clés.</div>
        </div>

        <button class="btn btn-secondary" style="margin-top:16px" onclick="tprsGenerate(); document.getElementById('tprs-quiz-zone').innerHTML='';">
          ✨&nbsp; Nouvelle histoire
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="navigate('home')">
          Retour à l'accueil
        </button>
      </div>
    `;
  },

};

// ── Helpers ───────────────────────────────────

function _lastEntry() {
  const entries = State.get('entries') || [];
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

function _tplEmpty(icon, title, sub, cta = '') {
  return `
    <div class="tprs-empty fade-up">
      <div class="tprs-empty-icon">${icon}</div>
      <div class="tprs-empty-title">${title}</div>
      <div class="tprs-empty-sub">${sub}</div>
      ${cta}
    </div>
  `;
}

export default TprsModule;
