// ─────────────────────────────────────────────
//  tprs-analyser.js
//  Analyse la prononciation du retelling +
//  génère le tip du jour via Claude.
// ─────────────────────────────────────────────

import State from './state.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-6';

const TprsAnalyser = {

  // ── ANALYSE RETELLING ────────────────────
  async analyse({ transcript, story, duration }) {
    const apiKey = State.get('claudeApiKey');
    if (!apiKey) throw new Error('Clé API Claude manquante.');

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
          'Content-Type':                                  'application/json',
          'x-api-key':                                     apiKey,
          'anthropic-version':                             '2023-06-01',
          'anthropic-dangerous-direct-browser-access':     'true',
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

  // ── GÉNÉRATION DU TIP DU JOUR ─────────────
  //
  // Génère un conseil phonétique personnalisé via Claude.
  // Commence toujours par ☝️
  // Retourne une string.

  async generateTip(story) {
    const apiKey = State.get('claudeApiKey');
    if (!apiKey) return null;

    const keyStructure = story?.key_structure || '';
    const vocabUsed    = (story?.vocabulary_used || []).join(', ');

    const body = {
      model:      MODEL,
      max_tokens: 150,
      system:     'Tu es un coach expert en portugais européen. Tu donnes UN seul conseil phonétique concret et précis pour francophones apprenant le portugais. Réponds en 1-2 phrases uniquement, en français, commençant OBLIGATOIREMENT par ☝️',
      messages: [{
        role: 'user',
        content: `Génère un conseil phonétique du jour sur le portugais européen, en lien avec${keyStructure ? ` la structure "${keyStructure}" ou` : ''} l'un de ces mots : ${vocabUsed || 'vocabulaire courant'}. 1-2 phrases, commence par ☝️`,
      }],
    };

    try {
      const response = await fetch(ANTHROPIC_API, {
        method:  'POST',
        headers: {
          'Content-Type':                                  'application/json',
          'x-api-key':                                     apiKey,
          'anthropic-version':                             '2023-06-01',
          'anthropic-dangerous-direct-browser-access':     'true',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.content?.[0]?.text?.trim() || null;
    } catch {
      return null;
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

Analyse le retelling et retourne un objet JSON :

{
  "score": 72,
  "summary": "Phrase de résumé bienveillante en français (1 phrase).",
  "positives": ["Point positif 1", "Point positif 2"],
  "errors": [
    {
      "type": "vocabulaire|grammaire|prononciation|omission",
      "expected": "ce qui était attendu",
      "said": "ce qui a été dit (ou 'non prononcé')",
      "tip": "Conseil pédagogique précis en français"
    }
  ],
  "pronunciation_tips": ["Conseil phonétique 1", "Conseil phonétique 2"]
}

Contraintes : score 0-100, 1-2 positifs, 0-4 erreurs max, 1-3 conseils phonétiques, ton bienveillant.${!hasTranscript ? ` Score basé sur la durée (${duration}s pour ${story.sentences.length} phrases).` : ''}`;
}

export default TprsAnalyser;
