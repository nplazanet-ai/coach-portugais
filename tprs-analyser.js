// ─────────────────────────────────────────────
//  modules/tprs/tprs-analyser.js
//  Analyse la prononciation du retelling :
//  compare la transcription STT avec l'histoire
//  cible et retourne un feedback structuré via Claude.
// ─────────────────────────────────────────────

import State from './state.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-6';

const TprsAnalyser = {

  // ── ANALYSE PRINCIPALE ───────────────────
  //
  // Paramètres :
  //   transcript   — ce que SpeechRecognition a entendu (string)
  //   story        — l'objet histoire généré (sentences, retelling_guide, vocabulary_used)
  //   duration     — durée de l'enregistrement en secondes
  //
  // Retourne :
  //   { score, summary, positives[], errors[], pronunciation_tips[] }

  async analyse({ transcript, story, duration }) {
    const apiKey = State.get('claudeApiKey');
    if (!apiKey) throw new Error('Clé API Claude manquante.');

    // Si pas de transcription (SpeechRecognition indisponible), on analyse
    // quand même sur la base de la durée et du retelling guide
    const hasTranscript = transcript && transcript.trim().length > 5;

    const body = {
      model:      MODEL,
      max_tokens: 800,
      system:     _systemPrompt(),
      messages:   [{ role: 'user', content: _userPrompt({ transcript, story, duration, hasTranscript }) }],
    };

    let response;
    try {
      response = await fetch(ANTHROPIC_API, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Impossible de contacter l\'API Claude. Vérifie ta connexion.');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Clé API invalide.');
      if (response.status === 429) throw new Error('Limite API atteinte. Réessaie dans quelques instants.');
      throw new Error(err.error?.message || `Erreur API (${response.status})`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Réponse Claude illisible. Réessaie.');
    }
  },

};

// ── PROMPTS ──────────────────────────────────

function _systemPrompt() {
  return `Tu es un coach expert en prononciation et expression orale du portugais européen (Portugal).

Tu analyses les retelling d'apprenants A1-A2 en comparant ce qu'ils ont dit avec l'histoire cible.
Tu donnes des retours bienveillants, précis et pédagogiques, en français.

Retourne UNIQUEMENT un objet JSON valide, sans markdown ni explication.`;
}

function _userPrompt({ transcript, story, duration, hasTranscript }) {
  const expectedText = story.sentences.join(' ');
  const guide        = story.retelling_guide;
  const vocabUsed    = (story.vocabulary_used || []).join(', ');

  const transcriptSection = hasTranscript
    ? `Transcription de ce que l'apprenant a dit :
"${transcript}"`
    : `Transcription non disponible (SpeechRecognition indisponible sur cet appareil).
Durée de l'enregistrement : ${duration} secondes.
Analyse uniquement sur la base du guide de retelling et du vocabulaire attendu.`;

  return `Histoire cible (portugais européen) :
"${expectedText}"

Guide de retelling fourni à l'apprenant : ${guide}
Vocabulaire attendu : ${vocabUsed}

${transcriptSection}

Analyse le retelling et retourne un objet JSON au format suivant :

{
  "score": 72,
  "summary": "Phrase de résumé bienveillante en français (1 phrase).",
  "positives": [
    "Point positif 1",
    "Point positif 2"
  ],
  "errors": [
    {
      "type": "vocabulaire|grammaire|prononciation|omission",
      "expected": "ce qui était attendu",
      "said": "ce qui a été dit (ou 'non prononcé')",
      "tip": "Conseil pédagogique précis en français"
    }
  ],
  "pronunciation_tips": [
    "Conseil phonétique général 1",
    "Conseil phonétique général 2"
  ]
}

Contraintes :
- score entre 0 et 100 (base : qualité + couverture du vocabulaire + fluidité estimée)
- 1 à 2 points positifs (toujours)
- 0 à 4 erreurs maximum (les plus importantes)
- 1 à 3 conseils phonétiques généraux sur le portugais européen
- Si transcription absente : score basé sur la durée (${duration}s pour ${story.sentences.length} phrases) et encouragements
- Ton bienveillant, précis, motivant`;
}

export default TprsAnalyser;
