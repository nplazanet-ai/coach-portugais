// ─────────────────────────────────────────────
//  tprs.js — Module Oral TPRS
//  4 écrans : Sélection → Histoire → Quiz → Feedback
// ─────────────────────────────────────────────

import State         from './state.js';
import Storage       from './storage.js';
import TprsGenerator from './tprs-generator.js';
import TprsRecorder  from './tprs-recorder.js';
import TprsAnalyser  from './tprs-analyser.js';
import { drillRecord } from './tprs-recording-patch.js';
import { transcribe, evaluatePronunciation } from './shared/openai-api.js';

// ── État ──────────────────────────────────────
const _state = {
  story:              null,
  selectedEntry:      null,
  entryId:            null,
  quizIndex:          0,
  quizScore:          0,
  quizTotal:          0,
  quizAnswers:        [],
  drillWords:         [],
  drillIndex:         0,
  drillSentence:      '',
  drillScores:        [],
  pronunciationScore: undefined,
  recBlob:            null,
  recMimeType:        '',
  recTranscript:      '',
  recDuration:        0,
  recObjectURL:       null,
};

let _micState      = 'idle'; // 'idle' | 'recording' | 'done'
let _micTranscript = '';

// ─────────────────────────────────────────────
const TprsModule = {

  init() {
    window.tprsGenerate       = ()    => this.generate();
    window.tprsSelectEntry    = (id)  => this.selectEntry(id);
    window.tprsReplay         = (id)  => this.replaySession(id);
    window.tprsSurprise       = ()    => this.surprise();
    window.tprsBackToList     = ()    => this.onEnter();
    window.tprsGoToQuiz       = ()    => this.goToQuiz();
    window.tprsQuizMic        = ()    => this._handleQuizMic();
    window.tprsSkipQuestion   = ()    => this._skipQuestion();
    window.tprsValidateAnswer = ()    => this._validateOralAnswer();
    window.tprsNextQuestion   = ()    => this.renderQuestionScreen();
    window.tprsDrillModel     = (w)   => this._drillSpeak(w);
    window.tprsDrillRecord    = ()    => {
      const card = document.querySelector('.tprs-drill-word-card.active-drill');
      if (card) drillRecord(card, _state);
    };
    window.tprsStartRetelling  = () => this._renderRetellingPrompt();
    window.tprsStartRecording  = () => this.startRecording();
    window.tprsStopRecording   = () => this.stopRecording();
    window.trpsCancelRecording = () => this.cancelRecording();
    window.tprsAnalyse         = () => this.analyse();
    window.tprsRetryRecording  = () => this._renderRetellingPrompt();
    window.tprsStopSpeech      = () => speechSynthesis.cancel();
  },

  onEnter() {
    Object.assign(_state, {
      story: null, selectedEntry: null, entryId: null,
      quizIndex: 0, quizScore: 0, quizTotal: 0, quizAnswers: [],
      drillWords: [], drillIndex: 0, drillSentence: '', drillScores: [],
      pronunciationScore: undefined,
      recBlob: null, recMimeType: '', recTranscript: '', recDuration: 0,
    });
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }
    speechSynthesis.cancel();
    _micState = 'idle'; _micTranscript = '';
    this._render();
  },

  // ── ÉCRAN 1 ──────────────────────────────

  _render() {
    const el = document.getElementById('tprs-content');
    if (!el) return;

    if (!State.get('claudeApiKey')) {
      el.innerHTML = _tplEmpty('🔑', 'Clé API Claude requise',
        'Configure ta clé dans les Réglages pour générer des histoires TPRS.',
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="navigate('settings')">Ouvrir les réglages</button>`);
      return;
    }
    const entries = [...(State.get('entries') || [])].reverse();
    if (!entries.length) {
      el.innerHTML = _tplEmpty('📖', 'Aucun cours enregistré',
        'Saisis d\'abord une séance dans le Journal.',
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="navigate('journal')">Ouvrir le journal</button>`);
      return;
    }
    this._renderEntryList(el, entries, State.get('tprsProgress') || {});
  },

  _renderEntryList(el, entries, progress) {
    const withSession = entries.filter(e =>
      progress[e.id] && (progress[e.id].quizScore !== undefined || progress[e.id].pronunciationScore !== undefined)
    );
    const sessionHTML = withSession.length ? `
      <div class="tprs-section-label">Sessions passées</div>
      ${withSession.map(e => _tplSessionCard(e, progress[e.id])).join('')}
      <div class="tprs-section-label" style="margin-top:20px">Tous tes cours</div>
    ` : `<div class="tprs-section-label">Choisis un cours · <span style="font-weight:400">~4 min · 3 questions</span></div>`;

    el.innerHTML = `
      ${sessionHTML}
      ${entries.map(e => _tplEntryCard(e, progress[e.id])).join('')}
      <div class="tprs-entry-card tprs-surprise-card fade-up" onclick="tprsSurprise()">
        <div class="tprs-entry-info">
          <div class="tprs-entry-title">🎲 Surprise</div>
          <div class="tprs-entry-date">Une unité choisie au hasard</div>
        </div>
        <button class="btn btn-primary tprs-entry-gen-btn" onclick="tprsSurprise()">🎲 Go</button>
      </div>
    `;
  },

  selectEntry(entryId) {
    const entry = (State.get('entries') || []).find(e => e.id === entryId);
    if (!entry) return;
    Object.assign(_state, {
      selectedEntry: entry, entryId,
      story: null, quizIndex: 0, quizScore: 0, quizAnswers: [],
      drillWords: [], drillScores: [], pronunciationScore: undefined,
    });
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }

    const saved = Storage.getTPRSStory(entryId);
    const el = document.getElementById('tprs-content');
    if (saved) { _state.story = saved; this._renderStory(el); }
    else       { this._renderReady(el, entry); }
  },

  surprise() {
    const entries = State.get('entries') || [];
    if (entries.length) this.selectEntry(entries[Math.floor(Math.random() * entries.length)].id);
  },

  replaySession(entryId) {
    const entry = (State.get('entries') || []).find(e => e.id === entryId);
    if (!entry) return;
    const saved = Storage.getTPRSStory(entryId);
    if (!saved) { this.selectEntry(entryId); return; }
    Object.assign(_state, {
      selectedEntry: entry, entryId, story: saved,
      quizIndex: 0, quizScore: 0, quizAnswers: [],
      drillWords: saved.drill_words || [], drillScores: [], pronunciationScore: undefined,
    });
    const el = document.getElementById('tprs-content');
    this._renderStory(el);
  },

  _renderReady(el, entry) {
    const dateStr    = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const unitStr    = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
    const notions    = (entry.notions || []).slice(0, 3).join(' · ');
    const vocabCount = (entry.vocab || []).length;
    el.innerHTML = `
      <button class="btn btn-ghost tprs-back-btn" onclick="tprsBackToList()">← Retour à la liste</button>
      <div class="tprs-source-card fade-up delay-1">
        <div class="tprs-source-label">Cours sélectionné</div>
        <div class="tprs-source-title">${unitStr} · ${dateStr}</div>
        ${notions    ? `<div class="tprs-source-notions">${notions}</div>` : ''}
        ${vocabCount ? `<div class="tprs-source-vocab">${vocabCount} mot${vocabCount > 1 ? 's' : ''} de vocabulaire</div>` : ''}
      </div>
      <div class="tprs-meta-hint fade-up delay-2">⏱ ~4 minutes · histoire absurde garantie 🐙</div>
      <button class="btn btn-primary fade-up delay-2" id="tprs-gen-btn" onclick="tprsGenerate()">
        ✨&nbsp; Générer l'histoire
      </button>
    `;
  },

  // ── GÉNÉRATION ────────────────────────────

  async generate() {
    const btn = document.getElementById('tprs-gen-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération en cours…'; }
    try {
      _state.story     = await TprsGenerator.generate(_state.selectedEntry || _lastEntry());
      _state.quizTotal = (_state.story?.questions || []).length;
      _state.drillWords = _state.story?.drill_words || [];
      if (_state.entryId) Storage.saveTPRSStory(_state.entryId, _state.story);
      const el = document.getElementById('tprs-content');
      this._renderStory(el);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Générer l\'histoire'; }
      window.toast('Erreur : ' + err.message, 4000);
    }
  },

  // ── ÉCRAN 2 : HISTOIRE ────────────────────

  _renderStory(el) {
    if (!el || !_state.story) return;
    const s          = _state.story;
    const characters = (s.characters || []).join(' · ') || '';
    const keyBadge   = s.key_structure
      ? `<div class="tprs-key-badge">Structure clé : <strong>${s.key_structure}</strong></div>` : '';
    const sentences  = s.sentences
      .map((t, i) => `<div class="tprs-sentence fade-up" style="animation-delay:${.05 + i * .07}s">${t}</div>`)
      .join('');

    el.innerHTML = `
      <div class="tprs-story-header fade-up">
        <div class="tprs-story-header-title">${s.title}</div>
        ${characters ? `<div class="tprs-story-header-chars">${characters}</div>` : ''}
      </div>
      ${keyBadge}
      <div class="tprs-listen-bar fade-up delay-1">
        <button class="btn btn-primary tprs-listen-btn" id="tprs-listen-btn" onclick="tprsListen()">🔊&nbsp; Écouter l'histoire</button>
        <button class="btn btn-ghost tprs-replay-btn" id="tprs-replay-btn" style="display:none" onclick="tprsListen()">↺&nbsp; Réécouter</button>
      </div>
      <div class="tprs-story-card fade-up delay-1">
        <div class="tprs-sentences">${sentences}</div>
      </div>
      <div class="tprs-ready-banner fade-up delay-2">📖 Mémorise bien — les questions arrivent</div>
      <button class="btn btn-primary fade-up delay-2" style="margin-top:12px" onclick="tprsGoToQuiz()">Je suis prêt(e) →</button>
      <button class="btn btn-ghost fade-up" style="margin-top:8px;font-size:13px" onclick="tprsBackToList()">← Autre unité</button>
    `;
    window.tprsListen = () => this.listen();
  },

  listen() {
    if (!_state.story || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const listenBtn = document.getElementById('tprs-listen-btn');
    const replayBtn = document.getElementById('tprs-replay-btn');
    const utt   = new SpeechSynthesisUtterance(_state.story.sentences.join(' '));
    utt.lang    = 'pt-PT';
    utt.rate    = 0.85;
    const setVoice = (v) => {
      const pt = v.find(x => x.lang === 'pt-PT') || v.find(x => x.lang.startsWith('pt'));
      if (pt) utt.voice = pt;
    };
    const voices = speechSynthesis.getVoices();
    if (voices.length) setVoice(voices);
    else speechSynthesis.addEventListener('voiceschanged', () => setVoice(speechSynthesis.getVoices()), { once: true });
    utt.onstart = () => { if (listenBtn) { listenBtn.textContent = '⏸ Lecture…'; listenBtn.onclick = () => speechSynthesis.cancel(); } };
    utt.onend = utt.onerror = () => { if (listenBtn) listenBtn.style.display = 'none'; if (replayBtn) replayBtn.style.display = ''; };
    speechSynthesis.speak(utt);
  },

  // ── ÉCRAN 3 : QUIZ ────────────────────────

  goToQuiz() {
    _state.quizIndex = 0; _state.quizScore = 0; _state.quizAnswers = [];
    _micState = 'idle'; _micTranscript = '';
    this.renderQuestionScreen();
  },

  renderQuestionScreen() {
    const el = document.getElementById('tprs-content');
    if (!el || !_state.story) return;
    const questions = _state.story.questions || [];
    if (_state.quizIndex >= questions.length) { this._renderFeedbackScreen(); return; }

    const q     = questions[_state.quizIndex];
    const total = questions.length;
    _micState = 'idle'; _micTranscript = '';

    const typeLabels = {
      oui_non:       '👍 Oui ou Non ?',
      choix_binaire: '🔀 Choisis la bonne réponse',
      ouverte:       '💬 Réponds librement',
    };
    const dots = Array.from({ length: total }, (_, i) => {
      const cls = i < _state.quizIndex ? 'done' : i === _state.quizIndex ? 'active' : '';
      return `<div class="qa-dot ${cls}"></div>`;
    }).join('');

    let choiceHTML = '';
    if (q.type === 'oui_non') {
      choiceHTML = `<div class="qa-choice-grid">
        <button class="btn qa-btn-sim" data-answer="sim">👍 Sim</button>
        <button class="btn qa-btn-nao" data-answer="nao">👎 Não</button>
      </div>`;
    } else if (q.type === 'choix_binaire' && q.choices?.length >= 2) {
      const flip = Math.random() > 0.5;
      const a    = { text: q.choices[flip ? 1 : 0], correct: !flip };
      const b    = { text: q.choices[flip ? 0 : 1], correct: flip };
      choiceHTML = `<div class="qa-choice-grid">
        <button class="btn qa-btn-choice" data-correct="${a.correct}">${a.text}</button>
        <button class="btn qa-btn-choice" data-correct="${b.correct}">${b.text}</button>
      </div>`;
    }

    const hasOpenAI = !!Storage.getOpenAIKey();

    el.innerHTML = `
      <div class="qa-screen">
        <div class="qa-progress">${dots}</div>
        <div class="qa-counter">${_state.quizIndex + 1} / ${total}</div>
        <div class="qa-type-label">${typeLabels[q.type] || '❓ Question'}</div>
        <div class="qa-question-card">
          <div class="qa-question-text">${q.question}</div>
          ${q.hint ? `<div class="qa-hint">💡 ${q.hint}</div>` : ''}
        </div>
        ${hasOpenAI ? `
        <div class="qa-mic-zone">
          <button class="qa-mic-btn idle" id="qa-mic-btn" onclick="tprsQuizMic()">
            <span class="qa-mic-icon">🎙️</span>
            <span class="qa-mic-label">Appuie pour répondre</span>
          </button>
          <div class="qa-mic-transcript" id="qa-mic-transcript" style="display:none"></div>
        </div>
        ${choiceHTML ? `<div class="qa-or"><span>ou</span></div>` : ''}` : ''}
        ${choiceHTML}
        ${q.answerKeywords?.length ? `
        <div class="qa-keywords">
          <span class="qa-keywords-label">Mots-clés :</span>
          ${q.answerKeywords.map(k => `<span class="qa-keyword-chip">${k}</span>`).join('')}
        </div>` : ''}
        <div class="qa-actions" id="qa-actions">
          <button class="btn btn-ghost qa-skip-btn" onclick="tprsSkipQuestion()">Passer</button>
          ${q.type === 'ouverte' ? `<button class="btn btn-primary qa-validate-btn" id="qa-validate-btn" onclick="tprsValidateAnswer()" disabled>✓ Valider</button>` : ''}
        </div>
        <div id="qa-model-answer" style="display:none" class="qa-model-answer fade-up">
          <div class="qa-model-label">Réponse modèle :</div>
          <div class="qa-model-text">${q.expectedAnswer || ''}</div>
          <button class="btn btn-primary" style="margin-top:12px" onclick="tprsNextQuestion()">Suivant →</button>
        </div>
      </div>
    `;

    el.querySelectorAll('.qa-btn-sim, .qa-btn-nao').forEach(btn => {
      btn.addEventListener('click', () => {
        const isSim   = btn.classList.contains('qa-btn-sim');
        const correct = q.expectedAnswer?.toLowerCase().startsWith('sim') ? isSim : !isSim;
        this._recordAnswer(q, isSim ? 'sim' : 'não', correct);
      });
    });
    el.querySelectorAll('.qa-btn-choice').forEach(btn => {
      btn.addEventListener('click', () => this._recordAnswer(q, btn.textContent.trim(), btn.dataset.correct === 'true'));
    });
  },

  _recordAnswer(q, userText, correct) {
    if (correct) _state.quizScore++;
    _state.quizAnswers.push({ question: q, transcript: userText, correct });
    const el = document.getElementById('tprs-content');
    if (el) {
      el.querySelectorAll('.qa-btn-sim,.qa-btn-nao,.qa-btn-choice').forEach(b => b.disabled = true);
      el.querySelectorAll('.qa-skip-btn,#qa-validate-btn').forEach(b => b.style.display = 'none');
    }
    window.toast(correct ? '✓ Correto!' : '✗ Errado', 1400);
    const modelEl = document.getElementById('qa-model-answer');
    if (modelEl) modelEl.style.display = '';
    _state.quizIndex++;
  },

  _skipQuestion() {
    const q = (_state.story?.questions || [])[_state.quizIndex];
    if (q) _state.quizAnswers.push({ question: q, transcript: '', correct: false });
    _state.quizIndex++;
    this.renderQuestionScreen();
  },

  _validateOralAnswer() {
    const q = (_state.story?.questions || [])[_state.quizIndex];
    if (!q) return;
    const norm     = _micTranscript.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const keywords = (q.answerKeywords || []).map(k => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const found    = keywords.filter(k => norm.includes(k));
    const correct  = q.acceptShortAnswer ? found.length >= 1 : found.length >= Math.ceil(keywords.length / 2);
    this._recordAnswer(q, _micTranscript, correct);
  },

  async _handleQuizMic() {
    const micBtn = document.getElementById('qa-mic-btn');
    if (!micBtn || _micState === 'recording') return;
    const openaiKey = Storage.getOpenAIKey();
    if (!openaiKey) { window.toast('Clé OpenAI requise', 2000); return; }
    const q = _state.story?.questions?.[_state.quizIndex];
    if (!q) return;

    _micState = 'recording';
    micBtn.className = 'qa-mic-btn recording';
    micBtn.innerHTML = '<span class="qa-mic-icon">●</span><span class="qa-mic-label">Enregistrement…</span>';
    micBtn.disabled  = true;

    let stream;
    const chunks = [];
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch {
      _micState = 'idle';
      micBtn.className = 'qa-mic-btn idle';
      micBtn.innerHTML = '<span class="qa-mic-icon">🎙️</span><span class="qa-mic-label">Appuie pour répondre</span>';
      micBtn.disabled  = false;
      window.toast('Microphone inaccessible', 2000);
      return;
    }

    const mime     = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                   : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    recorder.start(300);

    let count = 3;
    micBtn.innerHTML = `<span class="qa-mic-icon">●</span><span class="qa-mic-label">⏹ ${count}…</span>`;
    const cd = setInterval(() => {
      count--;
      if (count > 0) micBtn.innerHTML = `<span class="qa-mic-icon">●</span><span class="qa-mic-label">⏹ ${count}…</span>`;
      else { clearInterval(cd); if (recorder.state === 'recording') recorder.stop(); }
    }, 1000);

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      micBtn.innerHTML = '<span class="qa-mic-icon">🔄</span><span class="qa-mic-label">Whisper…</span>';
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      try {
        const text = await transcribe(blob, mime, openaiKey);
        _micTranscript   = text;
        _micState        = 'done';
        micBtn.className = 'qa-mic-btn done';
        micBtn.innerHTML = `<span class="qa-mic-icon">✓</span><span class="qa-mic-label">${text || '(silence)'}</span>`;
        micBtn.disabled  = false;
        const transcriptEl = document.getElementById('qa-mic-transcript');
        if (transcriptEl) { transcriptEl.textContent = `"${text}"`; transcriptEl.style.display = ''; }

        const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (q.type === 'oui_non') {
          const isSim = /\b(sim|vrai|verdade|certo|yes|oui)\b/.test(norm);
          const isNao = /\b(nao|falso|errado|faux|non|no)\b/.test(norm);
          if (isSim || isNao) {
            const correct = q.expectedAnswer?.toLowerCase().startsWith('sim') ? isSim : isNao;
            setTimeout(() => this._recordAnswer(q, text, correct), 600);
          } else {
            const vBtn = document.getElementById('qa-validate-btn');
            if (vBtn) vBtn.disabled = false;
          }
        } else if (q.type === 'choix_binaire') {
          const correctNorm = (q.choices?.[0] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          setTimeout(() => this._recordAnswer(q, text, correctNorm && norm.includes(correctNorm)), 600);
        } else {
          const vBtn = document.getElementById('qa-validate-btn');
          if (vBtn) vBtn.disabled = false;
        }
      } catch {
        _micState = 'idle';
        micBtn.className = 'qa-mic-btn idle';
        micBtn.innerHTML = '<span class="qa-mic-icon">🎙️</span><span class="qa-mic-label">Réessayer</span>';
        micBtn.disabled  = false;
      }
    };
  },

  // ── ÉCRAN 4 : FEEDBACK ────────────────────

  _renderFeedbackScreen() {
    const el    = document.getElementById('tprs-content');
    if (!el)    return;
    const total = (_state.story?.questions || []).length;
    const score = total > 0 ? Math.round((_state.quizScore / total) * 100) : 0;
    const entry = _state.selectedEntry || _lastEntry();

    // Sauvegarder
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      if (!prog[entry.id]) prog[entry.id] = {};
      prog[entry.id].quizScore  = score;
      prog[entry.id].quizDoneAt = new Date().toISOString();
      prog[entry.id].completedAt = new Date().toISOString();
      State.set('tprsProgress', prog);
      Storage.save();
    }

    // SVG ring
    const r     = 54;
    const circ  = +(2 * Math.PI * r).toFixed(1);
    const off   = +(circ * (1 - score / 100)).toFixed(1);
    const col   = score >= 75 ? '#3A7D5C' : score >= 50 ? '#B8922A' : '#C45C32';
    const msg   = score >= 75 ? 'Muito bem!' : score >= 50 ? 'Bom trabalho!' : 'Continue a praticar!';

    // Vocab
    const vocabUsed  = _state.story?.vocabulary_used || [];
    const entryVocab = entry?.vocab || [];
    const vocabHTML  = vocabUsed.length ? `
      <div class="feedback-card feedback-card-vocab">
        <div class="feedback-card-label">📚 Vocabulaire exercé</div>
        <div class="feedback-vocab-grid">
          ${vocabUsed.map(word => {
            const m = entryVocab.find(v => v.pt?.toLowerCase() === word.toLowerCase());
            return `<div class="feedback-vocab-chip"><span class="fvc-pt">${word}</span>${m ? `<span class="fvc-fr">${m.fr}</span>` : ''}</div>`;
          }).join('')}
        </div>
        <div class="feedback-vocab-note">✓ Disponibles dans tes flashcards</div>
      </div>` : '';

    // Drill
    const drillWords = (_state.drillWords?.length ? _state.drillWords : vocabUsed.slice(0, 2)).slice(0, 2);
    const drillHTML  = drillWords.length ? `
      <div class="feedback-card feedback-card-drill">
        <div class="feedback-card-label">🔊 Drilling phonétique</div>
        <div class="feedback-drill-desc">Répète ces mots à voix haute pour travailler ta prononciation.</div>
        ${drillWords.map((word, i) => `
          <div class="tprs-drill-word-card ${i === 0 ? 'active-drill' : ''}" data-word="${word}" id="drill-card-${i}">
            <div class="drill-word-text"><em>${word}</em></div>
            <div class="drill-word-actions">
              <button class="btn btn-ghost drill-model-btn" onclick="tprsDrillModel('${word}')">🔊 Modèle</button>
              <button class="drill-mic-btn" id="drill-record-btn" onclick="activateDrill(${i},'${word}');tprsDrillRecord()">🎙️ Ma voix</button>
            </div>
            <div id="drill-feedback-${i}" style="display:none"></div>
          </div>`).join('')}
      </div>` : '';

    el.innerHTML = `
      <div class="feedback-screen fade-up">
        <div class="feedback-score-row">
          <svg viewBox="0 0 120 120" class="feedback-score-svg" width="110" height="110">
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="#DDD5C8" stroke-width="8"/>
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="8"
              stroke-dasharray="${circ}" stroke-dashoffset="${off}"
              stroke-linecap="round" transform="rotate(-90 60 60)"/>
            <text x="60" y="55" text-anchor="middle" font-size="26" font-weight="700" fill="${col}" font-family="DM Sans,sans-serif">${score}</text>
            <text x="60" y="71" text-anchor="middle" font-size="11" fill="#8C7B6A" font-family="DM Sans,sans-serif">/100</text>
          </svg>
          <div class="feedback-score-msg">
            <div class="feedback-score-pt">${msg}</div>
            <div class="feedback-score-detail">${_state.quizScore}/${total} questions correctes</div>
          </div>
        </div>
        ${vocabHTML}
        ${drillHTML}
        <div class="feedback-card feedback-card-tip">
          <div class="feedback-card-label">💡 Astuce du jour</div>
          <div class="feedback-tip-text" id="feedback-tip-text"><span class="tip-loading">Génération…</span></div>
        </div>
        <div class="feedback-actions">
          <button class="btn btn-primary" onclick="tprsBackToList()">✓ Terminer</button>
          <button class="btn btn-ghost" onclick="tprsReplayStory()">↺ Rejouer</button>
        </div>
      </div>
    `;

    // Init drill
    if (drillWords.length) {
      _state.drillSentence = drillWords[0];
      window.activateDrill = (idx, word) => {
        document.querySelectorAll('.tprs-drill-word-card').forEach(c => c.classList.remove('active-drill'));
        const card = document.getElementById(`drill-card-${idx}`);
        if (card) card.classList.add('active-drill');
        _state.drillSentence = word;
        // Redirect drill-feedback id pour drillRecord()
        document.querySelectorAll('[id^="drill-feedback-"]').forEach(fb => fb.id = 'drill-feedback-tmp');
        const fb = document.getElementById(`drill-feedback-${idx}`);
        if (fb) { fb.id = 'drill-feedback'; fb.style.display = ''; }
      };
      // Expose feedback div for first word
      const fb0 = document.getElementById('drill-feedback-0');
      if (fb0) { fb0.id = 'drill-feedback'; fb0.style.display = ''; }
    }

    window.tprsReplayStory = () => {
      if (_state.story) {
        _state.quizIndex = 0; _state.quizScore = 0; _state.quizAnswers = [];
        this._renderStory(document.getElementById('tprs-content'));
      }
    };

    // Tip du jour
    TprsAnalyser.generateTip(_state.story).then(tip => {
      const el = document.getElementById('feedback-tip-text');
      if (el) el.innerHTML = `<span>${tip || _phoneticsOfDay()}</span>`;
    }).catch(() => {
      const el = document.getElementById('feedback-tip-text');
      if (el) el.innerHTML = `<span>${_phoneticsOfDay()}</span>`;
    });
  },

  // ── Drill TTS ─────────────────────────────
  _drillSpeak(word) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(word);
    utt.lang  = 'pt-PT';
    utt.rate  = 0.75;
    const v   = speechSynthesis.getVoices();
    const pt  = v.find(x => x.lang === 'pt-PT') || v.find(x => x.lang.startsWith('pt'));
    if (pt) utt.voice = pt;
    speechSynthesis.speak(utt);
  },

  // ── LEGACY RETELLING ──────────────────────
  _renderRetellingPrompt() {
    const zone = document.getElementById('tprs-retell-zone') || document.getElementById('tprs-content');
    if (!zone || !_state.story) return;
    zone.innerHTML = `
      <div class="tprs-retell-card fade-up">
        <div class="tprs-retell-label">Retelling</div>
        <div class="tprs-retell-title">Re-raconte l'histoire à l'oral</div>
        <div class="tprs-retelling-guide">
          <div class="trg-label">Mots-clés</div>
          <div class="trg-words">${_state.story.retelling_guide}</div>
          <div class="trg-hint">Utilise ces mots-clés pour reconstruire l'histoire en portugais.</div>
        </div>
        <button class="btn tprs-rec-btn" onclick="tprsStartRecording()">
          <span class="tprs-rec-icon">🎙️</span><span>Commencer l'enregistrement</span>
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="navigate('home')">Passer · terminer</button>
      </div>
    `;
  },

  async startRecording() {
    const zone = document.getElementById('tprs-content');
    if (!zone) return;
    _state.recBlob = null; _state.recMimeType = ''; _state.recTranscript = ''; _state.recDuration = 0;
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }
    const hasOpenAI = !!Storage.getOpenAIKey();
    zone.innerHTML = `
      <div class="tprs-recording-card fade-up" id="tprs-rec-card">
        <div class="tprs-rec-status">Accès au microphone…</div>
        <div class="tprs-rec-timer" id="tprs-rec-timer">0:00</div>
        <div class="tprs-rec-transcript" id="tprs-rec-transcript">
          <span class="tprs-transcript-placeholder">${hasOpenAI ? 'Whisper transcrit après l\'arrêt…' : 'Transcription en cours…'}</span>
        </div>
        <button class="btn tprs-rec-btn tprs-rec-stop" id="tprs-rec-stop-btn" onclick="tprsStopRecording()" disabled>
          <span class="tprs-rec-icon">⏹</span><span>Arrêter</span>
        </button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="trpsCancelRecording()">Annuler</button>
      </div>
    `;
    try {
      await TprsRecorder.start((ev) => {
        if (ev.type === 'timer') _updateTimer(ev.elapsed);
        if (ev.type === 'transcript' && !hasOpenAI) { _updateTranscript(ev.final, ev.interim); _state.recTranscript = ev.final; }
      });
      const stopBtn = document.getElementById('tprs-rec-stop-btn');
      const card    = document.getElementById('tprs-rec-card');
      const status  = card?.querySelector('.tprs-rec-status');
      if (status)  status.textContent = 'Enregistrement en cours…';
      if (stopBtn) stopBtn.disabled   = false;
      if (card)    card.classList.add('is-recording');
    } catch (err) {
      zone.innerHTML = _tplEmpty('🎙️', 'Microphone inaccessible', err.message,
        `<button class="btn btn-secondary" style="margin-top:16px" onclick="tprsStartRetelling()">Réessayer</button>`);
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
      const openaiKey = Storage.getOpenAIKey();
      if (openaiKey && _state.recBlob) {
        const tEl = document.getElementById('tprs-rec-transcript');
        if (tEl) tEl.innerHTML = '<span class="tprs-transcript-placeholder">Transcription Whisper…</span>';
        try { _state.recTranscript = await transcribe(_state.recBlob, _state.recMimeType, openaiKey); if (tEl) tEl.textContent = _state.recTranscript; }
        catch { _state.recTranscript = result.transcript || ''; }
      } else { _state.recTranscript = result.transcript || ''; }
      this._renderReview();
    } catch (err) { window.toast('Erreur : ' + err.message, 3500); this._renderRetellingPrompt(); }
  },

  cancelRecording() { TprsRecorder.cancel(); this._renderRetellingPrompt(); },

  _renderReview() {
    const zone = document.getElementById('tprs-content');
    if (!zone) return;
    const mins = Math.floor(_state.recDuration / 60);
    const secs = String(_state.recDuration % 60).padStart(2, '0');
    const hasT  = _state.recTranscript?.trim().length > 5;
    const hasOA = !!Storage.getOpenAIKey();
    zone.innerHTML = `
      <div class="tprs-review-card fade-up">
        <div class="tprs-review-label">Enregistrement · ${mins}:${secs}</div>
        <div class="tprs-review-title">Écoute ton retelling</div>
        <audio class="tprs-audio-player" src="${_state.recObjectURL}" controls></audio>
        ${hasT ? `<div class="tprs-transcript-box"><div class="tprs-transcript-label">Transcription ${hasOA ? 'Whisper' : 'auto'}</div><div class="tprs-transcript-text">${_state.recTranscript}</div></div>`
               : `<div class="tprs-transcript-box"><div class="tprs-transcript-label">Transcription</div><div class="tprs-transcript-text muted">Non disponible.</div></div>`}
        <button class="btn btn-primary" style="margin-top:12px" onclick="tprsAnalyse()">${hasOA ? '🎧 Analyser avec GPT-4o Audio' : '🤖 Analyser ma prononciation'}</button>
        <button class="btn btn-ghost" style="margin-top:8px" onclick="tprsRetryRecording()">↺ Recommencer</button>
      </div>
    `;
  },

  async analyse() {
    const zone = document.getElementById('tprs-content');
    if (!zone || !_state.story) return;
    const openaiKey = Storage.getOpenAIKey();
    zone.innerHTML = `<div class="tprs-analysing fade-up"><div class="tprs-analysing-spinner"></div><div class="tprs-analysing-text">${openaiKey ? 'GPT-4o Audio évalue…' : 'Claude analyse…'}</div></div>`;
    try {
      let result;
      if (openaiKey && _state.recBlob) result = await evaluatePronunciation(_state.recBlob, _state.recMimeType, _state.story, _state.recTranscript, openaiKey);
      else result = await TprsAnalyser.analyse({ transcript: _state.recTranscript, story: _state.story, duration: _state.recDuration });
      _state.pronunciationScore = result.score;
      this._renderAnalysis(result);
    } catch (err) { window.toast('Erreur : ' + err.message, 4000); this._renderReview(); }
  },

  _renderAnalysis(result) {
    const zone  = document.getElementById('tprs-content');
    if (!zone)  return;
    const entry = _state.selectedEntry || _lastEntry();
    if (entry) {
      const prog = State.get('tprsProgress') || {};
      if (!prog[entry.id]) prog[entry.id] = {};
      prog[entry.id].pronunciationScore = result.score;
      prog[entry.id].analysedAt         = new Date().toISOString();
      State.set('tprsProgress', prog); Storage.save();
    }
    const sc  = result.score >= 75 ? 'score-great' : result.score >= 50 ? 'score-ok' : 'score-low';
    const pos = (result.positives || []).map(p => `<div class="tprs-feedback-item positive">✓ ${p}</div>`).join('');
    const err = (result.errors || []).map(e => `<div class="tprs-feedback-item error"><div class="tprs-error-header"><span class="tprs-error-badge">${_badgeLabel(e.type)}</span><span class="tprs-error-words">${e.said ? `<s>${e.said}</s> → ` : ''}<strong>${e.expected}</strong></span></div><div class="tprs-error-tip">${e.tip}</div></div>`).join('');
    const tip = (result.pronunciation_tips || []).map(t => `<div class="tprs-tip-item">💡 ${t}</div>`).join('');
    zone.innerHTML = `
      <div class="tprs-analysis-card fade-up">
        <div class="tprs-score-row">
          <div class="tprs-score-ring ${sc}"><span class="tprs-score-val">${result.score}</span><span class="tprs-score-unit">/100</span></div>
          <div class="tprs-score-summary">${result.summary}</div>
        </div>
        ${pos ? `<div class="tprs-feedback-section"><div class="tprs-feedback-label">Points positifs</div>${pos}</div>` : ''}
        ${err ? `<div class="tprs-feedback-section"><div class="tprs-feedback-label">Points à améliorer</div>${err}</div>` : ''}
        ${tip ? `<div class="tprs-feedback-section"><div class="tprs-feedback-label">Phonétique</div>${tip}</div>` : ''}
        <div class="tprs-analysis-actions">
          <button class="btn btn-primary" onclick="tprsBackToList()">← Nouvelle session</button>
          <button class="btn btn-ghost" onclick="navigate('home')">Retour à l'accueil</button>
        </div>
      </div>
    `;
    if (_state.recObjectURL) { URL.revokeObjectURL(_state.recObjectURL); _state.recObjectURL = null; }
  },

};

// ── Helpers UI ────────────────────────────────
function _updateTimer(elapsed) {
  const el = document.getElementById('tprs-rec-timer');
  if (!el) return;
  el.textContent = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
}
function _updateTranscript(finalText, interim) {
  const el = document.getElementById('tprs-rec-transcript');
  if (!el || (!finalText && !interim)) return;
  el.innerHTML = finalText ? `${finalText} <span class="tprs-interim">${interim}</span>` : `<span class="tprs-interim">${interim}</span>`;
}
function _badgeLabel(type) {
  return { vocabulaire: 'Vocab', grammaire: 'Gram.', prononciation: 'Prono.', omission: 'Omis' }[type] || type;
}
function _lastEntry() {
  const e = State.get('entries') || [];
  return e.length ? e[e.length - 1] : null;
}
function _tplEmpty(icon, title, sub, cta = '') {
  return `<div class="tprs-empty fade-up"><div class="tprs-empty-icon">${icon}</div><div class="tprs-empty-title">${title}</div><div class="tprs-empty-sub">${sub}</div>${cta}</div>`;
}
function _tplEntryCard(entry, session) {
  const dateStr    = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const unitStr    = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
  const notions    = (entry.notions || []).slice(0, 3).join(' · ');
  const vocabCount = (entry.vocab || []).length;
  const quizScore  = session?.quizScore !== undefined ? `<span class="tprs-score-chip">Quiz ${session.quizScore}%</span>` : '';
  const pronScore  = session?.pronunciationScore !== undefined ? `<span class="tprs-score-chip">Phon. ${session.pronunciationScore}/100</span>` : '';
  const hasSaved   = !!Storage.getTPRSStory(entry.id);
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
        ${hasSaved ? '↺ Reprendre' : '✨ Générer'}
      </button>
    </div>`;
}
function _tplSessionCard(entry, session) {
  const dateStr  = new Date(entry.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const unitStr  = entry.type === 'manuel' ? `Unité ${entry.unit}` : 'Hors manuel';
  const doneAt   = session.completedAt || session.analysedAt || session.quizDoneAt;
  const doneStr  = doneAt ? new Date(doneAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
  const quizChip = session.quizScore !== undefined ? `<span class="tprs-score-chip">Quiz ${session.quizScore}%</span>` : '';
  const pronChip = session.pronunciationScore !== undefined ? `<span class="tprs-score-chip">Phon. ${session.pronunciationScore}/100</span>` : '';
  return `
    <div class="tprs-session-card fade-up">
      <div class="tprs-session-info">
        <div class="tprs-session-title">${unitStr} · ${dateStr}</div>
        <div class="tprs-session-meta">${quizChip}${pronChip}${doneStr ? `<span class="tprs-date-chip">${doneStr}</span>` : ''}</div>
      </div>
      <button class="btn btn-secondary tprs-session-replay-btn" onclick="tprsReplay('${entry.id}')">↺ Rejouer</button>
    </div>`;
}
const _PHONETICS = [
  '☝️ Le « e » non accentué se prononce presque muet — <em>tarde</em> sonne « tard ».',
  '☝️ Le « o » non accentué se ferme vers « u » — <em>amor</em> sonne comme « amur ».',
  '☝️ Le « lh » équivaut au « gli » italien — <em>filho</em> = « fi-lyu ».',
  '☝️ Le « nh » se prononce « gn » français — <em>minhoca</em> = « mi-gno-ca ».',
  '☝️ Le « ão » final est nasalisé — prononce comme si tu pinçais le nez.',
  '☝️ Le « rr » est uvulaire comme en français — roule dans la gorge.',
  '☝️ Le « s » entre deux voyelles se prononce « z » — <em>casa</em> = « ca-za ».',
];
function _phoneticsOfDay() {
  return _PHONETICS[new Date().getDay() % _PHONETICS.length];
}

export default TprsModule;
