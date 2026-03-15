// ─────────────────────────────────────────────
//  modules/tprs/tprs.js
//  Module Oral TPRS.
//  Flux complet :
//    1. Génération (Claude)
//    2. Écoute (SpeechSynthesis pt-PT)
//    3. Quiz vrai/faux (circling)
//    4. Retelling (guide + enregistrement)
//    5. Analyse prononciation (Claude, transcript SpeechRecognition)
// ─────────────────────────────────────────────

import State         from '../../core/state.js';
import Storage       from '../../core/storage.js';
import TprsGenerator from './tprs-generator.js';
import TprsRecorder  from './tprs-recorder.js';
import TprsAnalyser  from './tprs-analyser.js';

// ── État local de la session ──────────────────
let _story      = null;
let _quizIndex  = 0;
let _quizScore  = 0;
let _utterance  = null;
// Retelling
let _recBlob    = null;   // Blob audio du retelling
let _recTranscript = '';  // Transcription STT
let _recDuration   = 0;   // Durée en secondes
let _recObjectURL  = null; // URL temporaire pour le lecteur audio

// ─────────────────────────────────────────────

const TprsModule = {

  init() {
    window.tprsGenerate       = ()    => this.generate();
    window.tprsReplay         = ()    => this.replay();
    window.tprsGoToQuiz       = ()    => this.goToQuiz();
    window.tprsAnswer         = (ans) => this.answer(ans);
    window.tprsStopSpeech     = ()    => speechSynthesis.cancel();
    window.tprsStartRetelling = ()    => this._renderRetellingPrompt();
    window.tprsStartRecording = ()    => this.startRecording();
    window.tprsStopRecording  = ()    => this.stopRecording();
    window.trpsCancelRecording= ()    => this.cancelRecording();
    window.tprsAnalyse        = ()    => this.analyse();
    window.tprsRetryRecording = ()    => this._renderRetellingPrompt();
  },

  onEnter() {
    _story         = null;
    _quizIndex     = 0;
    _quizScore     = 0;
    _recBlob       = null;
    _recTranscript = '';
    _recDuration   = 0;
    if (_recObjectURL) { URL.revokeObjectURL(_recObjectURL); _recObjectURL = null; }
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

  // ─────────────────────────────────────────
  // PHASE 1 — GÉNÉRATION
  // ─────────────────────────────────────────

  async generate() {
    const btn = document.getElementById('tprs-gen-btn');
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

  // ─────────────────────────────────────────
  // PHASE 2 — ÉCOUTE (TTS)
  // ─────────────────────────────────────────

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
      <div id="tprs-retell-zone"></div>
    `;

    window.tprsListen = () => this.listen();
  },

  listen() {
    if (!_story) return;
    if (!('speechSynthesis' in window)) {
      window.toast('Synthèse vocale non supportée sur cet appareil.', 3000);
      return;
    }

    speechSynthesis.cancel();

    const text = _story.sentences.join(' ');
    _utterance      = new SpeechSynthesisUtterance(text);
    _utterance.lang = 'pt-PT';
    _utterance.rate = 0.82;

    const voices  = speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang === 'pt-PT')
                 || voices.find(v => v.lang.startsWith('pt'));
    if (ptVoice) _utterance.voice = ptVoice;

    _utterance.onstart = () => {
      const btn = document.getElementById('tprs-listen-btn');
      if (btn) { btn.textContent = '⏸ Lecture…'; btn.onclick = () => { speechSynthesis.cancel(); }; }
    };

    _utterance.onend   = () => this._afterListen();
    _utterance.onerror = () => { window.toast('Erreur de lecture.', 2000); this._afterListen(); };

    if (voices.length === 0) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        const v  = speechSynthesis.getVoices();
        const pt = v.find(x => x.lang === 'pt-PT') || v.find(x => x.lang.startsWith('pt'));
        if (pt) _utterance.voice = pt;
        speechSynthesis.speak(_utterance);
      }, { once: true });
    } else {
      speechSynthesis.speak(_utterance);
    }
  },

  replay() { this.listen(); },

  _afterListen() {
    const listenBtn = document.getElementById('tprs-listen-btn');
    const replayBtn = document.getElementById('tprs-replay-btn');
    if (listenBtn) listenBtn.style.display = 'none';
    if (replayBtn) replayBtn.style.display = '';
    this._renderQuizPrompt();
  },

  // ─────────────────────────────────────────
  // PHASE 3 — QUIZ (CIRCLING)
  // ─────────────────────────────────────────

  _renderQuizPrompt() {
    const zone = document.getElementById('tprs-quiz-zone');
    if (!zone) return;
    zone.innerHTML = `
      <div class="tprs-quiz-intro fade-up">
        <div class="tprs-quiz-intro-text">Prêt pour les questions de compréhension ?</div>
        <button class="btn btn-primary" onclick="tprsGoToQuiz()">❓&nbsp; Lancer le quiz</button>
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
      correct ? '✓ Correct !' : `✗ Incorrect — c'était ${q.answer ? 'Vrai' : 'Faux'}`,
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

    // Sauvegarder le score quiz
    const entry = _lastEntry();
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      if (!prog[entry.id]) prog[entry.id] = {};
      prog[entry.id].quizScore    = pct;
      prog[entry.id].quizDoneAt  = new Date().toISOString();
      State.set('tprsProgress', prog);
      Storage.save();
    }

    zone.innerHTML = `
      <div class="tprs-result-card fade-up">
        <div class="tprs-result-stars">${stars}</div>
        <div class="tprs-result-score">${_quizScore}/${total} bonnes réponses</div>
        <div class="tprs-result-pct">${pct}%</div>
      </div>
    `;

    // Enchaîner directement sur le retelling
    setTimeout(() => this._renderRetellingPrompt(), 400);
  },

  // ─────────────────────────────────────────
  // PHASE 4 — RETELLING (ENREGISTREMENT)
  // ─────────────────────────────────────────

  _renderRetellingPrompt() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone || !_story) return;

    zone.innerHTML = `
      <div class="tprs-retell-card fade-up">
        <div class="tprs-retell-header">
          <div class="tprs-retell-label">Phase 4 · Retelling</div>
          <div class="tprs-retell-title">Re-raconte l'histoire à l'oral</div>
        </div>

        <div class="tprs-retelling-guide">
          <div class="trg-label">Mots-clés</div>
          <div class="trg-words">${_story.retelling_guide}</div>
          <div class="trg-hint">Utilise ces mots-clés pour reconstruire l'histoire en portugais.</div>
        </div>

        <button class="btn tprs-rec-btn" id="tprs-rec-start" onclick="tprsStartRecording()">
          <span class="tprs-rec-icon">🎙️</span>
          <span>Commencer l'enregistrement</span>
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="navigate('home')">
          Passer · terminer la session
        </button>
      </div>
    `;

    // Scroll jusqu'au retelling
    setTimeout(() => zone.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  },

  async startRecording() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone) return;

    // Reset état
    _recBlob       = null;
    _recTranscript = '';
    _recDuration   = 0;
    if (_recObjectURL) { URL.revokeObjectURL(_recObjectURL); _recObjectURL = null; }

    // Afficher l'écran d'enregistrement en attente de permission
    zone.innerHTML = `
      <div class="tprs-recording-card fade-up" id="tprs-rec-card">
        <div class="tprs-rec-status">Accès au microphone…</div>
        <div class="tprs-rec-timer" id="tprs-rec-timer">0:00</div>
        <div class="tprs-rec-transcript" id="tprs-rec-transcript">
          <span class="tprs-transcript-placeholder">Transcription en cours…</span>
        </div>
        <button class="btn tprs-rec-btn tprs-rec-stop" id="tprs-rec-stop-btn" onclick="tprsStopRecording()" disabled>
          <span class="tprs-rec-icon">⏹</span>
          <span>Arrêter</span>
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="trpsCancelRecording()">Annuler</button>
      </div>
    `;

    try {
      await TprsRecorder.start((event) => {
        if (event.type === 'timer') {
          _updateTimer(event.elapsed);
        }
        if (event.type === 'transcript') {
          _updateTranscript(event.final, event.interim);
          _recTranscript = event.final;
        }
      });

      // Permission obtenue — activer le bouton stop et l'animation
      const status  = zone.querySelector('.tprs-rec-status');
      const stopBtn = document.getElementById('tprs-rec-stop-btn');
      const card    = document.getElementById('tprs-rec-card');
      if (status)  status.textContent = 'Enregistrement en cours…';
      if (stopBtn) stopBtn.disabled   = false;
      if (card)    card.classList.add('is-recording');

    } catch (err) {
      zone.innerHTML = _tplEmpty(
        '🎙️',
        'Microphone inaccessible',
        err.message,
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="tprsStartRetelling()">Réessayer</button>`
      );
    }
  },

  async stopRecording() {
    const stopBtn = document.getElementById('tprs-rec-stop-btn');
    if (stopBtn) { stopBtn.disabled = true; stopBtn.innerHTML = '<span>Arrêt…</span>'; }

    try {
      const result = await TprsRecorder.stop();
      _recBlob       = result.blob;
      _recTranscript = result.transcript;
      _recDuration   = result.duration;
      _recObjectURL  = TprsRecorder.createObjectURL(_recBlob);
      this._renderReview();
    } catch (err) {
      window.toast('Erreur d\'enregistrement : ' + err.message, 3500);
      this._renderRetellingPrompt();
    }
  },

  cancelRecording() {
    TprsRecorder.cancel();
    this._renderRetellingPrompt();
  },

  _renderReview() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone) return;

    const mins = Math.floor(_recDuration / 60);
    const secs = String(_recDuration % 60).padStart(2, '0');
    const hasTranscript = _recTranscript && _recTranscript.trim().length > 5;

    zone.innerHTML = `
      <div class="tprs-review-card fade-up">
        <div class="tprs-review-header">
          <div class="tprs-review-label">Enregistrement · ${mins}:${secs}</div>
          <div class="tprs-review-title">Écoute ton retelling</div>
        </div>

        <audio class="tprs-audio-player" src="${_recObjectURL}" controls></audio>

        ${hasTranscript ? `
        <div class="tprs-transcript-box">
          <div class="tprs-transcript-label">Ce que tu as dit (transcription auto)</div>
          <div class="tprs-transcript-text">${_recTranscript}</div>
        </div>
        ` : `
        <div class="tprs-transcript-box tprs-transcript-empty">
          <div class="tprs-transcript-label">Transcription automatique</div>
          <div class="tprs-transcript-text muted">Non disponible sur cet appareil.<br>Claude analysera sur la base de la durée et du guide.</div>
        </div>
        `}

        <button class="btn btn-primary" style="margin-top:12px" onclick="tprsAnalyse()">
          🤖&nbsp; Analyser ma prononciation
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="tprsRetryRecording()">
          ↺&nbsp; Recommencer
        </button>
      </div>
    `;
  },

  // ─────────────────────────────────────────
  // PHASE 5 — ANALYSE (CLAUDE)
  // ─────────────────────────────────────────

  async analyse() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone || !_story) return;

    zone.innerHTML = `
      <div class="tprs-analysing fade-up">
        <div class="tprs-analysing-spinner"></div>
        <div class="tprs-analysing-text">Claude analyse ta prononciation…</div>
      </div>
    `;

    try {
      const result = await TprsAnalyser.analyse({
        transcript: _recTranscript,
        story:      _story,
        duration:   _recDuration,
      });
      this._renderAnalysis(result);
    } catch (err) {
      window.toast('Erreur d\'analyse : ' + err.message, 4000);
      this._renderReview();
    }
  },

  _renderAnalysis(result) {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone) return;

    // Sauvegarder l'analyse dans l'état
    const entry = _lastEntry();
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      if (!prog[entry.id]) prog[entry.id] = {};
      prog[entry.id].pronunciationScore = result.score;
      prog[entry.id].analysedAt         = new Date().toISOString();
      State.set('tprsProgress', prog);
      Storage.save();
    }

    const scoreColor = result.score >= 75 ? 'var(--olive)' : result.score >= 50 ? 'var(--gold)' : 'var(--terra)';
    const scoreRing  = result.score >= 75 ? 'score-great' : result.score >= 50 ? 'score-ok' : 'score-low';

    const positives = (result.positives || [])
      .map(p => `<div class="tprs-feedback-item positive">✓ ${p}</div>`)
      .join('');

    const errors = (result.errors || [])
      .map(e => `
        <div class="tprs-feedback-item error">
          <div class="tprs-error-header">
            <span class="tprs-error-badge">${_badgeLabel(e.type)}</span>
            <span class="tprs-error-words">
              ${e.said ? `<s>${e.said}</s> → ` : ''}<strong>${e.expected}</strong>
            </span>
          </div>
          <div class="tprs-error-tip">${e.tip}</div>
        </div>
      `).join('');

    const tips = (result.pronunciation_tips || [])
      .map(t => `<div class="tprs-tip-item">💡 ${t}</div>`)
      .join('');

    zone.innerHTML = `
      <div class="tprs-analysis-card fade-up">

        <div class="tprs-score-row">
          <div class="tprs-score-ring ${scoreRing}">
            <span class="tprs-score-val">${result.score}</span>
            <span class="tprs-score-unit">/100</span>
          </div>
          <div class="tprs-score-summary">${result.summary}</div>
        </div>

        ${positives ? `
        <div class="tprs-feedback-section">
          <div class="tprs-feedback-label">Points positifs</div>
          ${positives}
        </div>
        ` : ''}

        ${errors ? `
        <div class="tprs-feedback-section">
          <div class="tprs-feedback-label">Points à améliorer</div>
          ${errors}
        </div>
        ` : ''}

        ${tips ? `
        <div class="tprs-feedback-section">
          <div class="tprs-feedback-label">Phonétique portugaise</div>
          ${tips}
        </div>
        ` : ''}

        <div class="tprs-analysis-actions">
          <button class="btn btn-primary" onclick="tprsGenerate(); document.getElementById('tprs-quiz-zone').innerHTML=''; document.getElementById('tprs-retell-zone').innerHTML='';">
            ✨&nbsp; Nouvelle histoire
          </button>
          <button class="btn btn-ghost" onclick="navigate('home')">
            Retour à l'accueil
          </button>
        </div>

      </div>
    `;

    // Révoquer l'URL blob maintenant qu'on n'en a plus besoin
    if (_recObjectURL) { URL.revokeObjectURL(_recObjectURL); _recObjectURL = null; }
  },

};

// ── Helpers UI internes ───────────────────────

function _updateTimer(elapsed) {
  const el = document.getElementById('tprs-rec-timer');
  if (!el) return;
  const m = Math.floor(elapsed / 60);
  const s = String(elapsed % 60).padStart(2, '0');
  el.textContent = `${m}:${s}`;
}

function _updateTranscript(finalText, interim) {
  const el = document.getElementById('tprs-rec-transcript');
  if (!el) return;
  if (!finalText && !interim) return;
  el.innerHTML = finalText
    ? `${finalText} <span class="tprs-interim">${interim}</span>`
    : `<span class="tprs-interim">${interim}</span>`;
}

function _badgeLabel(type) {
  const labels = { vocabulaire: 'Vocab', grammaire: 'Gram.', prononciation: 'Prono.', omission: 'Omis' };
  return labels[type] || type;
}

// ── Helpers data ──────────────────────────────

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
