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

import State         from './state.js';
import Storage       from './storage.js';
import TprsGenerator from './tprs-generator.js';
import TprsRecorder  from './tprs-recorder.js';
import TprsAnalyser  from './tprs-analyser.js';
import { bindQuestionEvents, finishSession, drillRecord } from './tprs-recording-patch.js';
import { transcribe, evaluatePronunciation } from './shared/openai-api.js';

// ── État local de la session ──────────────────
let _utterance = null;

// Objet d'état partagé avec les patch functions
const _state = {
  story:             null,
  selectedEntry:     null,   // entrée du journal choisie pour cette session
  quizIndex:         0,
  quizScore:         0,
  quizTotal:         0,
  entryId:           null,
  // Retelling
  recBlob:           null,
  recMimeType:       '',
  recTranscript:     '',
  recDuration:       0,
  recObjectURL:      null,
  // Drill
  drillIndex:        0,
  drillSentence:     '',
  drillScores:       [],
  pronunciationScore: undefined,
};


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
    window.tprsNextDrill      = ()    => this._nextDrill();
    window.tprsDrillRecord    = ()    => {
      const container = document.querySelector('.tprs-drill-card');
      if (container) drillRecord(container, _state);
    };
    window.tprsSelectEntry    = (id)  => this.selectEntry(id);
    window.tprsBackToList     = ()    => this.onEnter();
    window.tprsQuizMic        = ()    => this._handleQuizMic();

    // ── Listeners patch ──────────────────────
    document.addEventListener('oral:next-question', (e) => {
      const { correct } = e.detail;
      window.toast(correct ? '✓ Correct !' : `✗ Incorrect — c'était ${_state.story?.questions[_state.quizIndex]?.answer ? 'Vrai' : 'Faux'}`, 1800);
      _state.quizIndex++;
      setTimeout(() => this.renderQuestionScreen(), 1600);
    });

    document.addEventListener('oral:finish-session', () => {
      // Feedback toast de fin de session
      window.toast('Session enregistrée ✓');
    });

    document.addEventListener('oral:render', (e) => {
      if (e.detail?.phase === 'drill') this._renderDrilling();
    });
  },

  onEnter() {
    _state.story             = null;
    _state.selectedEntry     = null;
    _state.quizIndex         = 0;
    _state.quizScore         = 0;
    _state.quizTotal         = 0;
    _state.entryId           = null;
    _state.recBlob           = null;
    _state.recMimeType       = '';
    _state.recTranscript     = '';
    _state.recDuration       = 0;
    _state.drillIndex        = 0;
    _state.drillSentence     = '';
    _state.drillScores       = [];
    _state.pronunciationScore = undefined;
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }
    this._render();
  },

  // ── RENDU PRINCIPAL — ÉCRAN 1 : sélection du cours ───

  _render() {
    const el = document.getElementById('tprs-content');
    if (!el) return;

    const hasApiKey = !!State.get('claudeApiKey');
    const entries   = [...(State.get('entries') || [])].reverse(); // plus récent en premier
    const progress  = State.get('tprsProgress') || {};

    if (!hasApiKey) {
      el.innerHTML = _tplEmpty(
        '🔑',
        'Clé API Claude requise',
        'Configure ta clé dans les Réglages pour générer des histoires TPRS personnalisées.',
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="navigate('settings')">Ouvrir les réglages</button>`
      );
      return;
    }

    if (!entries.length) {
      el.innerHTML = _tplEmpty(
        '📖',
        'Aucun cours enregistré',
        'Saisis d\'abord une séance dans le Journal pour générer une histoire adaptée.',
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="navigate('journal')">Ouvrir le journal</button>`
      );
      return;
    }

    this._renderEntryList(el, entries, progress);
  },

  _renderEntryList(el, entries, progress) {
    const withSession = entries.filter(e =>
      progress[e.id] && (progress[e.id].quizScore !== undefined || progress[e.id].pronunciationScore !== undefined)
    );

    const sessionHTML = withSession.length ? `
      <div class="tprs-section-label">Sessions passées</div>
      ${withSession.map(e => _tplSessionCard(e, progress[e.id])).join('')}
      <div class="tprs-section-label" style="margin-top:20px">Tous tes cours</div>
    ` : '<div class="tprs-section-label">Choisis un cours</div>';

    el.innerHTML = `
      ${sessionHTML}
      ${entries.map(e => _tplEntryCard(e, progress[e.id])).join('')}
    `;
  },

  // ── Sélection d'un cours ─────────────────
  // Appelé depuis les boutons "Générer" / "Rejouer"

  selectEntry(entryId) {
    const entries = State.get('entries') || [];
    const entry   = entries.find(e => e.id === entryId);
    if (!entry) return;

    // Reset état session
    _state.story             = null;
    _state.selectedEntry     = entry;
    _state.entryId           = entryId;
    _state.quizIndex         = 0;
    _state.quizScore         = 0;
    _state.quizTotal         = 0;
    _state.recBlob           = null;
    _state.recMimeType       = '';
    _state.recTranscript     = '';
    _state.recDuration       = 0;
    _state.drillIndex        = 0;
    _state.drillScores       = [];
    _state.pronunciationScore = undefined;
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }

    const el = document.getElementById('tprs-content');
    this._renderReady(el, entry);
  },

  // ── ÉCRAN 1b : confirmation + bouton Générer ──

  _renderReady(el, entry) {
    const dateStr    = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const unitStr    = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
    const notions    = (entry.notions || []).slice(0, 3).join(' · ');
    const vocabCount = (entry.vocab || []).length;

    el.innerHTML = `
      <button class="btn btn-ghost" style="margin-bottom:12px;font-size:13px" onclick="tprsBackToList()">
        ← Retour à la liste
      </button>

      <div class="tprs-source-card fade-up delay-1">
        <div class="tprs-source-label">Cours sélectionné</div>
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
      _state.story = await TprsGenerator.generate(_state.selectedEntry || _lastEntry());
      _state.quizTotal = (_state.story?.questions || []).length;
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
    if (!zone || !_state.story) return;

    const sentences = _state.story.sentences
      .map((s, i) => `<div class="tprs-sentence fade-up" style="animation-delay:${0.05 + i * 0.07}s">${s}</div>`)
      .join('');

    const chips = (_state.story.vocabulary_used || [])
      .map(w => `<span class="tprs-vocab-chip">${w}</span>`)
      .join('');

    zone.innerHTML = `
      <div class="tprs-story-card fade-up delay-1">
        <div class="tprs-story-label">Histoire générée</div>
        <div class="tprs-story-title">${_state.story.title}</div>
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
    if (!_state.story) return;
    if (!('speechSynthesis' in window)) {
      window.toast('Synthèse vocale non supportée sur cet appareil.', 3000);
      return;
    }

    speechSynthesis.cancel();

    const text = _state.story.sentences.join(' ');
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
    _state.quizIndex = 0;
    _state.quizScore = 0;
    this.renderQuestionScreen();
  },

  renderQuestionScreen() {
    const zone = document.getElementById('tprs-quiz-zone');
    if (!zone || !_state.story) return;

    if (_state.quizIndex >= _state.story.questions.length) {
      this._renderQuizResult();
      return;
    }

    const q     = _state.story.questions[_state.quizIndex];
    const total = _state.story.questions.length;

    const hasOpenAI = !!Storage.getOpenAIKey();

    zone.innerHTML = `
      <div class="tprs-quiz-card fade-up">
        <div class="tprs-quiz-meta">${_state.quizIndex + 1} / ${total}</div>
        <div class="tprs-quiz-q">${q.text}</div>

        ${hasOpenAI ? `
        <button class="btn tprs-quiz-mic-btn" id="quiz-mic-btn" onclick="tprsQuizMic()">
          🎙️&nbsp; Répondre à voix haute
        </button>
        <div id="quiz-mic-status" class="tprs-quiz-mic-status" style="display:none"></div>
        <div class="tprs-quiz-or"><span>ou</span></div>
        ` : ''}

        <div class="tprs-quiz-btns">
          <button class="btn tprs-btn-true">✓&nbsp; Vrai</button>
          <button class="btn tprs-btn-false">✗&nbsp; Faux</button>
        </div>
      </div>
    `;

    bindQuestionEvents(zone, q, _state.quizIndex, _state);
  },

  // ── Réponse orale au quiz (MediaRecorder → Whisper) ──

  async _handleQuizMic() {
    const micBtn = document.getElementById('quiz-mic-btn');
    const status = document.getElementById('quiz-mic-status');
    if (!micBtn) return;

    const openaiKey = Storage.getOpenAIKey();
    if (!openaiKey) {
      window.toast('Clé API OpenAI requise pour la réponse vocale', 2500);
      return;
    }

    micBtn.disabled     = true;
    micBtn.textContent  = '⏳ Accès micro…';
    if (status) { status.style.display = ''; status.textContent = ''; }

    let stream, recorder;
    const chunks = [];

    try {
      stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      window.toast('Microphone inaccessible', 2000);
      micBtn.disabled    = false;
      micBtn.textContent = '🎙️ Répondre à voix haute';
      return;
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';

    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    recorder.start(300);

    // Compte à rebours 3 s
    let count = 3;
    micBtn.textContent = `⏹ ${count}…`;
    const countdown = setInterval(() => {
      count--;
      if (count > 0) {
        micBtn.textContent = `⏹ ${count}…`;
      } else {
        clearInterval(countdown);
        if (recorder.state === 'recording') recorder.stop();
      }
    }, 1000);

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      micBtn.textContent = '🔄 Whisper…';

      const usedMime = mime || 'audio/webm';
      const blob     = new Blob(chunks, { type: usedMime });

      try {
        const text  = await transcribe(blob, usedMime, openaiKey);
        if (status) status.textContent = `"${text}"`;

        const lower   = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isTrue  = /\b(vrai|sim|verdade|certo|e verdade|yes)\b/.test(lower);
        const isFalse = /\b(faux|falso|nao|nao e|errado|errada|incorrect|non)\b/.test(lower);

        if (isTrue || isFalse) {
          micBtn.style.display = 'none';
          setTimeout(() => this.answer(isTrue), 600);
        } else {
          if (status) status.textContent = `"${text}" — dis « vrai » ou « falso »`;
          micBtn.disabled    = false;
          micBtn.textContent = '🎙️ Réessayer';
        }
      } catch {
        if (status) status.textContent = 'Erreur — utilise les boutons';
        micBtn.disabled    = false;
        micBtn.textContent = '🎙️ Réessayer';
      }
    };
  },

  answer(userAnswer) {
    const q       = _state.story.questions[_state.quizIndex];
    const correct = userAnswer === q.answer;
    if (correct) _state.quizScore++;

    window.toast(
      correct ? '✓ Correct !' : `✗ Incorrect — c'était ${q.answer ? 'Vrai' : 'Faux'}`,
      1800
    );

    _state.quizIndex++;
    setTimeout(() => this.renderQuestionScreen(), 1600);
  },

  _renderQuizResult() {
    const zone  = document.getElementById('tprs-quiz-zone');
    if (!zone) return;

    const total = _state.story.questions.length;
    const pct   = Math.round((_state.quizScore / total) * 100);
    const stars = pct >= 80 ? '⭐⭐⭐' : pct >= 50 ? '⭐⭐' : '⭐';

    // Sauvegarder le score quiz
    const entry = _state.selectedEntry || _lastEntry();
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      if (!prog[entry.id]) prog[entry.id] = {};
      prog[entry.id].quizScore   = pct;
      prog[entry.id].quizDoneAt  = new Date().toISOString();
      State.set('tprsProgress', prog);
      Storage.save();
    }

    zone.innerHTML = `
      <div class="tprs-result-card fade-up">
        <div class="tprs-result-stars">${stars}</div>
        <div class="tprs-result-score">${_state.quizScore}/${total} bonnes réponses</div>
        <div class="tprs-result-pct">${pct}%</div>
      </div>
    `;

    // Enchaîner sur le drill si clé OpenAI disponible, sinon retelling
    const openaiKey = Storage.getOpenAIKey();
    if (openaiKey && _state.story?.sentences?.length > 0) {
      setTimeout(() => this._renderDrillingPrompt(), 400);
    } else {
      setTimeout(() => this._renderRetellingPrompt(), 400);
    }
  },

  // ─────────────────────────────────────────
  // PHASE 3.5 — DRILL (répétition phonétique)
  // Disponible uniquement si clé OpenAI configurée.
  // ─────────────────────────────────────────

  _renderDrillingPrompt() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone || !_state.story) return;

    _state.drillIndex  = 0;
    _state.drillScores = [];

    zone.innerHTML = `
      <div class="tprs-drill-intro fade-up">
        <div class="tprs-drill-label">Phase 3.5 · Drill phonétique</div>
        <div class="tprs-drill-title">Répète chaque phrase à voix haute</div>
        <div class="tprs-drill-desc">GPT-4o Audio va évaluer ta prononciation en temps réel.</div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="tprsStartDrill()">
          🔊&nbsp; Commencer le drill
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="tprsSkipDrill()">
          Passer · aller au retelling
        </button>
      </div>
    `;

    window.tprsStartDrill = () => this._renderDrilling();
    window.tprsSkipDrill  = () => this._renderRetellingPrompt();

    setTimeout(() => zone.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  },

  _renderDrilling() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone || !_state.story) return;

    const sentences = _state.story.sentences;
    if (_state.drillIndex >= sentences.length) {
      this._renderDrillSummary();
      return;
    }

    const sentence = sentences[_state.drillIndex];
    const total    = sentences.length;
    _state.drillSentence = sentence;

    zone.innerHTML = `
      <div class="tprs-drill-card fade-up">
        <div class="tprs-drill-meta">${_state.drillIndex + 1} / ${total}</div>
        <div class="tprs-drill-sentence">${sentence}</div>
        <div class="tprs-drill-actions">
          <button class="btn btn-ghost tprs-drill-listen-btn" onclick="tprsDrillListen()">
            🔊&nbsp; Écouter
          </button>
          <button class="btn tprs-rec-btn" id="drill-record-btn" onclick="tprsDrillRecord()">
            🎙️&nbsp; Répéter
          </button>
          <button class="btn tprs-rec-btn tprs-rec-stop" id="drill-stop-btn"
            style="display:none" disabled>
            ⏹&nbsp; Arrêter
          </button>
        </div>
        <div class="tprs-drill-timer" id="drill-timer" style="display:none">0:00</div>
        <div id="drill-feedback"></div>
        <button class="btn btn-secondary" style="margin-top:14px" id="drill-next-btn"
          onclick="tprsNextDrill()">
          Suivant →
        </button>
      </div>
    `;

    this.bindFeedbackEvents(zone);
    window.tprsDrillListen = () => this._drillSpeak(sentence);
  },

  bindFeedbackEvents(container) {
    const recordBtn = container.querySelector('#drill-record-btn');
    if (recordBtn) {
      recordBtn.addEventListener('click', () => drillRecord(container, _state));
    }
  },

  _drillSpeak(sentence) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(sentence);
    utt.lang   = 'pt-PT';
    utt.rate   = 0.78;
    const voices = speechSynthesis.getVoices();
    const pt     = voices.find(v => v.lang === 'pt-PT') || voices.find(v => v.lang.startsWith('pt'));
    if (pt) utt.voice = pt;
    speechSynthesis.speak(utt);
  },

  _nextDrill() {
    _state.drillIndex++;
    this._renderDrilling();
  },

  _renderDrillSummary() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone) return;

    const scores = _state.drillScores;
    const avg    = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    const stars  = avg >= 80 ? '⭐⭐⭐' : avg >= 50 ? '⭐⭐' : '⭐';

    zone.innerHTML = `
      <div class="tprs-result-card fade-up">
        <div class="tprs-result-stars">${stars}</div>
        <div class="tprs-result-score">Drill terminé · Score moyen</div>
        <div class="tprs-result-pct">${avg}/100</div>
      </div>
    `;

    setTimeout(() => this._renderRetellingPrompt(), 500);
  },

  // ─────────────────────────────────────────
  // PHASE 4 — RETELLING (ENREGISTREMENT)
  // ─────────────────────────────────────────

  _renderRetellingPrompt() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone || !_state.story) return;

    zone.innerHTML = `
      <div class="tprs-retell-card fade-up">
        <div class="tprs-retell-header">
          <div class="tprs-retell-label">Phase 4 · Retelling</div>
          <div class="tprs-retell-title">Re-raconte l'histoire à l'oral</div>
        </div>

        <div class="tprs-retelling-guide">
          <div class="trg-label">Mots-clés</div>
          <div class="trg-words">${_state.story.retelling_guide}</div>
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
    _state.recBlob       = null;
    _state.recMimeType   = '';
    _state.recTranscript = '';
    _state.recDuration   = 0;
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }

    const hasOpenAI = !!Storage.getOpenAIKey();

    // Afficher l'écran d'enregistrement en attente de permission
    zone.innerHTML = `
      <div class="tprs-recording-card fade-up" id="tprs-rec-card">
        <div class="tprs-rec-status">Accès au microphone…</div>
        <div class="tprs-rec-timer" id="tprs-rec-timer">0:00</div>
        <div class="tprs-rec-transcript" id="tprs-rec-transcript">
          <span class="tprs-transcript-placeholder">${hasOpenAI ? 'Whisper transcrit après l\'arrêt…' : 'Transcription en cours…'}</span>
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
        if (event.type === 'transcript' && !hasOpenAI) {
          _updateTranscript(event.final, event.interim);
          _state.recTranscript = event.final;
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
      const result        = await TprsRecorder.stop();
      _state.recBlob      = result.blob;
      _state.recMimeType  = result.mimeType || 'audio/webm';
      _state.recDuration  = result.duration;
      _state.recObjectURL = TprsRecorder.createObjectURL(_state.recBlob);

      // Transcription Whisper (si clé OpenAI disponible)
      const openaiKey = Storage.getOpenAIKey();
      if (openaiKey && _state.recBlob) {
        const transcriptEl = document.getElementById('tprs-rec-transcript');
        if (transcriptEl) transcriptEl.innerHTML = '<span class="tprs-transcript-placeholder">Transcription Whisper…</span>';
        try {
          _state.recTranscript = await transcribe(_state.recBlob, _state.recMimeType, openaiKey);
          if (transcriptEl) transcriptEl.textContent = _state.recTranscript;
        } catch {
          // Whisper a échoué — on continue avec le transcript SpeechRecognition
          _state.recTranscript = result.transcript || '';
        }
      } else {
        _state.recTranscript = result.transcript || '';
      }

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

    const mins = Math.floor(_state.recDuration / 60);
    const secs = String(_state.recDuration % 60).padStart(2, '0');
    const hasTranscript = _state.recTranscript && _state.recTranscript.trim().length > 5;
    const hasOpenAI     = !!Storage.getOpenAIKey();
    const analyseLabel  = hasOpenAI ? '🎧&nbsp; Analyser avec GPT-4o Audio' : '🤖&nbsp; Analyser ma prononciation';

    zone.innerHTML = `
      <div class="tprs-review-card fade-up">
        <div class="tprs-review-header">
          <div class="tprs-review-label">Enregistrement · ${mins}:${secs}</div>
          <div class="tprs-review-title">Écoute ton retelling</div>
        </div>

        <audio class="tprs-audio-player" src="${_state.recObjectURL}" controls></audio>

        ${hasTranscript ? `
        <div class="tprs-transcript-box">
          <div class="tprs-transcript-label">Transcription ${hasOpenAI ? 'Whisper' : 'auto'}</div>
          <div class="tprs-transcript-text">${_state.recTranscript}</div>
        </div>
        ` : `
        <div class="tprs-transcript-box tprs-transcript-empty">
          <div class="tprs-transcript-label">Transcription automatique</div>
          <div class="tprs-transcript-text muted">Non disponible sur cet appareil.<br>${hasOpenAI ? '' : 'Claude analysera sur la base de la durée et du guide.'}</div>
        </div>
        `}

        <button class="btn btn-primary" style="margin-top:12px" onclick="tprsAnalyse()">
          ${analyseLabel}
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="tprsRetryRecording()">
          ↺&nbsp; Recommencer
        </button>
      </div>
    `;
  },

  // ─────────────────────────────────────────
  // PHASE 5 — ANALYSE (GPT-4o Audio ou Claude)
  // ─────────────────────────────────────────

  async analyse() {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone || !_state.story) return;

    const openaiKey = Storage.getOpenAIKey();
    const label     = openaiKey ? 'GPT-4o Audio évalue ta phonétique…' : 'Claude analyse ta prononciation…';

    zone.innerHTML = `
      <div class="tprs-analysing fade-up">
        <div class="tprs-analysing-spinner"></div>
        <div class="tprs-analysing-text">${label}</div>
      </div>
    `;

    try {
      let result;
      if (openaiKey && _state.recBlob) {
        // ── GPT-4o Audio : évaluation phonétique réelle ──
        result = await evaluatePronunciation(
          _state.recBlob,
          _state.recMimeType,
          _state.story,
          _state.recTranscript,
          openaiKey
        );
      } else {
        // ── Fallback : analyse textuelle Claude ──────────
        result = await TprsAnalyser.analyse({
          transcript: _state.recTranscript,
          story:      _state.story,
          duration:   _state.recDuration,
        });
      }
      _state.pronunciationScore = result.score;
      this._renderAnalysis(result);
      finishSession(_state);
    } catch (err) {
      window.toast('Erreur d\'analyse : ' + err.message, 4000);
      this._renderReview();
    }
  },

  _renderAnalysis(result) {
    const zone = document.getElementById('tprs-retell-zone');
    if (!zone) return;

    // Sauvegarder l'analyse dans l'état
    const entry = _state.selectedEntry || _lastEntry();
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      if (!prog[entry.id]) prog[entry.id] = {};
      prog[entry.id].pronunciationScore = result.score;
      prog[entry.id].analysedAt         = new Date().toISOString();
      State.set('tprsProgress', prog);
      Storage.save();
    }

    const scoreRing = result.score >= 75 ? 'score-great' : result.score >= 50 ? 'score-ok' : 'score-low';

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

    // ── Vocabulaire exercé ───────────────────
    const vocabUsed   = _state.story?.vocabulary_used || [];
    const entryVocab  = (entry?.vocab || []);
    const vocabCards  = vocabUsed.map(word => {
      const match = entryVocab.find(v => v.pt?.toLowerCase() === word.toLowerCase());
      return `<div class="tprs-vocab-review-chip">
        <span class="tprs-vocab-pt">${word}</span>
        ${match ? `<span class="tprs-vocab-fr">${match.fr}</span>` : ''}
      </div>`;
    }).join('');

    const vocabSection = vocabCards ? `
      <div class="tprs-feedback-section">
        <div class="tprs-feedback-label">📚 Vocabulaire exercé</div>
        <div class="tprs-vocab-review-grid">${vocabCards}</div>
        <button class="btn btn-ghost" style="margin-top:10px;font-size:12px" onclick="openTransport()">
          🚇&nbsp; Réviser en mode transport
        </button>
      </div>
    ` : '';

    // ── Astuce phonétique du jour ────────────
    const tip = _phoneticsOfDay();

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

        ${vocabSection}

        <div class="tprs-feedback-section tprs-tip-section">
          <div class="tprs-feedback-label">💡 Astuce du jour</div>
          <div class="tprs-tip-of-day">${tip}</div>
        </div>

        <div class="tprs-analysis-actions">
          <button class="btn btn-primary" onclick="tprsBackToList()">
            ← Nouvelle session
          </button>
          <button class="btn btn-ghost" onclick="navigate('home')">
            Retour à l'accueil
          </button>
        </div>

      </div>
    `;

    // Révoquer l'URL blob maintenant qu'on n'en a plus besoin
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }
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

// ── Templates : cartes de sélection ──────────

function _tplEntryCard(entry, session) {
  const dateStr    = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const unitStr    = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
  const notions    = (entry.notions || []).slice(0, 3).join(' · ');
  const vocabCount = (entry.vocab || []).length;
  const quizScore  = session?.quizScore  !== undefined ? `<span class="tprs-score-chip">Quiz ${session.quizScore}%</span>`  : '';
  const pronScore  = session?.pronunciationScore !== undefined ? `<span class="tprs-score-chip">Phon. ${session.pronunciationScore}/100</span>` : '';

  return `
    <div class="tprs-entry-card fade-up">
      <div class="tprs-entry-info">
        <div class="tprs-entry-title">${unitStr}</div>
        <div class="tprs-entry-date">${dateStr}</div>
        ${notions    ? `<div class="tprs-entry-notions">${notions}</div>` : ''}
        ${vocabCount ? `<div class="tprs-entry-vocab">${vocabCount} mot${vocabCount > 1 ? 's' : ''}</div>` : ''}
        ${quizScore || pronScore ? `<div class="tprs-entry-scores">${quizScore}${pronScore}</div>` : ''}
      </div>
      <button class="btn btn-primary tprs-entry-gen-btn" onclick="tprsSelectEntry('${entry.id}')">
        ✨ Générer
      </button>
    </div>
  `;
}

function _tplSessionCard(entry, session) {
  const dateStr  = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const unitStr  = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
  const doneAt   = session.completedAt || session.analysedAt || session.quizDoneAt;
  const doneStr  = doneAt ? new Date(doneAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
  const quizChip = session.quizScore  !== undefined ? `<span class="tprs-score-chip">Quiz ${session.quizScore}%</span>` : '';
  const pronChip = session.pronunciationScore !== undefined ? `<span class="tprs-score-chip">Phon. ${session.pronunciationScore}/100</span>` : '';

  return `
    <div class="tprs-session-card fade-up">
      <div class="tprs-session-info">
        <div class="tprs-session-title">${unitStr} · ${dateStr}</div>
        <div class="tprs-session-meta">
          ${quizChip}${pronChip}
          ${doneStr ? `<span class="tprs-date-chip">${doneStr}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-secondary tprs-session-replay-btn" onclick="tprsSelectEntry('${entry.id}')">
        ↺ Rejouer
      </button>
    </div>
  `;
}

// ── Astuce phonétique du jour ─────────────────

const _PHONETICS = [
  'Le « e » non accentué se prononce presque muet en portugais européen — <em>tarde</em> sonne « tard ».',
  'Le « o » non accentué se ferme vers « u » — <em>amor</em> sonne comme « amur ».',
  'Le « lh » équivaut au « gli » italien ou « ll » espagnol — <em>filho</em> = « fi-lyu ».',
  'Le « nh » se prononce « gn » français — <em>minhoca</em> = « mi-gno-ca ».',
  'Le « ão » final est nasalisé — prononce comme si tu pinçais le nez sur « ãm ».',
  'Le « rr » est uvulaire comme en français — roule-le dans la gorge, pas avec la langue.',
  'Le « s » entre deux voyelles se prononce « z » — <em>casa</em> = « ca-za ».',
];

function _phoneticsOfDay() {
  return _PHONETICS[new Date().getDay() % _PHONETICS.length];
}

export default TprsModule;
