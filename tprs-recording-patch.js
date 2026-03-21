// ─────────────────────────────────────────────
//  tprs-recording-patch.js
//  Patch du module oral TPRS :
//  - bindQuestionEvents : quiz avec handlers programmatiques
//  - finishSession      : sauvegarde de la progression complète
//  - drillRecord        : drill de répétition + évaluation GPT-4o Audio
// ─────────────────────────────────────────────

import Storage from './storage.js';
import State   from './state.js';
import TprsRecorder from './tprs-recorder.js';
import {
  transcribe,
  evaluateDrillRepetition,
  getBestRecordingFormat,
} from './shared/openai-api.js';

// ── bindQuestionEvents ────────────────────────
//
// Attache les handlers vrai/faux sur le container de question
// et dispatche oral:next-question quand l'utilisateur répond.
// Remplace les onclick inline pour permettre une extension future.
//
// @param container  — l'élément DOM de la carte de question
// @param q          — { text, answer } (objet question)
// @param idx        — index courant dans le tableau de questions
// @param state      — état de la session (référence partagée avec tprs.js)

function bindQuestionEvents(container, q, idx, state) {
  const trueBtn  = container.querySelector('.tprs-btn-true');
  const falseBtn = container.querySelector('.tprs-btn-false');

  if (!trueBtn || !falseBtn) return;

  // Supprimer les anciens onclick inline
  trueBtn.removeAttribute('onclick');
  falseBtn.removeAttribute('onclick');

  function handleAnswer(userAnswer) {
    trueBtn.disabled  = true;
    falseBtn.disabled = true;

    const correct = userAnswer === q.answer;
    if (correct) state.quizScore = (state.quizScore || 0) + 1;

    document.dispatchEvent(new CustomEvent('oral:next-question', {
      detail: { answer: userAnswer, correct, idx },
    }));
  }

  trueBtn.addEventListener('click',  () => handleAnswer(true));
  falseBtn.addEventListener('click', () => handleAnswer(false));
}

// ── finishSession ─────────────────────────────
//
// Enregistre la progression complète dans l'état et Storage.
// Appelé en fin de session (après analyse finale).
//
// @param state — état de la session (quizScore, drillScores, pronunciationScore…)

function finishSession(state) {
  const entryId = state.entryId;
  if (!entryId) return;

  const prog = State.get('tprsProgress') || {};
  if (!prog[entryId]) prog[entryId] = {};

  if (state.quizScore      !== undefined) prog[entryId].quizScore       = state.quizScore;
  if (state.quizTotal      !== undefined) prog[entryId].quizTotal        = state.quizTotal;
  if (state.drillScores?.length)          prog[entryId].drillAvgScore    = _avg(state.drillScores);
  if (state.pronunciationScore !== undefined) {
    prog[entryId].pronunciationScore = state.pronunciationScore;
  }
  prog[entryId].completedAt = new Date().toISOString();

  State.set('tprsProgress', prog);
  Storage.save();

  document.dispatchEvent(new CustomEvent('oral:finish-session', {
    detail: { entryId, prog: prog[entryId] },
  }));
}

// ── drillRecord ───────────────────────────────
//
// Gère le flux complet d'un drill de répétition :
//   1. Lance l'enregistrement MediaRecorder
//   2. Affiche chrono + état "en cours"
//   3. À l'arrêt : transcrit avec Whisper, évalue avec GPT-4o Audio
//   4. Affiche le feedback dans #drill-feedback
//
// @param container — l'élément DOM du drill courant (contient #drill-feedback)
// @param state     — état de la session (référence partagée)

async function drillRecord(container, state) {
  const feedbackEl = container.querySelector('#drill-feedback');
  const recordBtn  = container.querySelector('#drill-record-btn');
  const stopBtn    = container.querySelector('#drill-stop-btn');
  const timerEl    = container.querySelector('#drill-timer');

  if (!feedbackEl) return;

  // Masquer le bouton record, afficher stop + timer
  if (recordBtn) recordBtn.style.display = 'none';
  if (stopBtn)   stopBtn.style.display   = '';
  if (timerEl)   timerEl.style.display   = '';

  feedbackEl.innerHTML = '<span class="muted">Enregistrement…</span>';

  let drillBlob     = null;
  let drillMimeType = '';

  try {
    await TprsRecorder.start((event) => {
      if (event.type === 'timer' && timerEl) {
        const m = Math.floor(event.elapsed / 60);
        const s = String(event.elapsed % 60).padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
      }
    });

    // Activer le bouton stop
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.onclick  = async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Arrêt…';

        try {
          const result  = await TprsRecorder.stop();
          drillBlob     = result.blob;
          drillMimeType = result.mimeType || getBestRecordingFormat() || 'audio/webm';

          // Afficher état "Analyse en cours…"
          if (timerEl) timerEl.style.display = 'none';
          feedbackEl.innerHTML = '<div class="drill-analysing"><div class="tprs-analysing-spinner small"></div><span>Analyse GPT-4o…</span></div>';

          const openaiKey    = Storage.getOpenAIKey();
          const expectedText = state.drillSentence || '';

          if (openaiKey && drillBlob) {
            const evalResult = await evaluateDrillRepetition(
              drillBlob, drillMimeType, expectedText, openaiKey
            );
            _renderDrillFeedback(feedbackEl, evalResult);
            if (!state.drillScores) state.drillScores = [];
            state.drillScores.push(evalResult.score || 0);
          } else {
            feedbackEl.innerHTML = '<span class="muted">Clé API OpenAI requise pour l\'évaluation phonétique.</span>';
          }

          // Remettre le bouton record visible pour un nouvel essai
          if (recordBtn) recordBtn.style.display = '';
          if (stopBtn)   stopBtn.style.display   = 'none';

        } catch (err) {
          feedbackEl.innerHTML = `<span class="error-text">Erreur : ${err.message}</span>`;
          if (recordBtn) recordBtn.style.display = '';
          if (stopBtn)   stopBtn.style.display   = 'none';
        }
      };
    }

  } catch (err) {
    feedbackEl.innerHTML = `<span class="error-text">Microphone inaccessible : ${err.message}</span>`;
    if (recordBtn) recordBtn.style.display = '';
    if (stopBtn)   stopBtn.style.display   = 'none';
  }
}

// ── Helpers privés ────────────────────────────

function _renderDrillFeedback(el, result) {
  const score      = result.score || 0;
  const scoreClass = score >= 75 ? 'score-great' : score >= 50 ? 'score-ok' : 'score-low';
  const tips       = (result.tips || [])
    .map(t => `<div class="drill-tip">💡 ${t}</div>`)
    .join('');

  el.innerHTML = `
    <div class="drill-feedback-inner">
      <div class="drill-score ${scoreClass}">${score}<span>/100</span></div>
      <div class="drill-feedback-text">${result.feedback || ''}</div>
      ${tips}
    </div>
  `;
}

function _avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

export { bindQuestionEvents, finishSession, drillRecord };
