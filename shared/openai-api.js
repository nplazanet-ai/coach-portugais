// ─────────────────────────────────────────────
//  shared/openai-api.js
//  Utilitaires OpenAI :
//  - Whisper (gpt-4o-mini-transcribe) : transcription audio
//  - GPT-4o Audio (gpt-4o-audio-preview) : évaluation phonétique réelle
// ─────────────────────────────────────────────

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const WHISPER_MODEL   = 'gpt-4o-mini-transcribe';
const GPT4O_AUDIO     = 'gpt-4o-audio-preview';

// ── Utilitaires ──────────────────────────────

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}

function getMimeExtension(mimeType) {
  const base = (mimeType || '').split(';')[0].trim();
  const map = {
    'audio/webm': 'webm',
    'audio/ogg':  'ogg',
    'audio/mp4':  'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav':  'wav',
    'audio/flac': 'flac',
  };
  return map[base] || 'webm';
}

function getBestRecordingFormat() {
  const candidates = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find(t => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) || '';
}

// ── WHISPER : Transcription ───────────────────
//
// Envoie le blob audio à l'API Whisper et retourne le texte transcrit.
// language='pt' pour le portugais.

async function transcribe(blob, mimeType, apiKey) {
  if (!apiKey) throw new Error('Clé API OpenAI manquante.');

  const ext      = getMimeExtension(mimeType);
  const formData = new FormData();
  formData.append('file',            blob, `audio.${ext}`);
  formData.append('model',           WHISPER_MODEL);
  formData.append('language',        'pt');
  formData.append('response_format', 'text');

  let response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body:    formData,
    });
  } catch {
    throw new Error('Impossible de contacter l\'API OpenAI. Vérifie ta connexion.');
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Clé API OpenAI invalide.');
    if (response.status === 429) throw new Error('Limite API OpenAI atteinte. Réessaie dans quelques instants.');
    throw new Error(err.error?.message || `Erreur Whisper (${response.status})`);
  }

  const text = await response.text();
  return text.trim();
}

// ── GPT-4o Audio : Évaluation phonétique ─────
//
// Envoie le blob audio + contexte de l'histoire à GPT-4o Audio.
// Retourne { score, summary, positives[], errors[], pronunciation_tips[] }

async function evaluatePronunciation(blob, mimeType, story, transcript, apiKey) {
  if (!apiKey) throw new Error('Clé API OpenAI manquante.');

  const ext    = getMimeExtension(mimeType);
  const base64 = await blobToBase64(blob);

  const systemPrompt = `Tu es un coach expert en prononciation et expression orale du portugais européen (Portugal).
Tu analyses les retelling d'apprenants A1-A2 en écoutant directement l'audio pour évaluer la phonétique réelle.
Tu donnes des retours bienveillants, précis et pédagogiques, en français.
Retourne UNIQUEMENT un objet JSON valide, sans markdown ni explication.`;

  const userText = `Histoire cible (portugais européen) :
"${story.sentences.join(' ')}"

Guide de retelling fourni à l'apprenant : ${story.retelling_guide}
Vocabulaire attendu : ${(story.vocabulary_used || []).join(', ')}
Transcription Whisper : "${transcript || '(non disponible)'}"

Écoute l'audio et analyse la prononciation. Retourne cet objet JSON :

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
- score entre 0 et 100
- 1 à 2 points positifs (toujours)
- 0 à 4 erreurs maximum (les plus importantes)
- 1 à 3 conseils phonétiques sur le portugais européen
- Ton bienveillant, précis, motivant`;

  const body = {
    model:    GPT4O_AUDIO,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role:    'user',
        content: [
          { type: 'input_audio', input_audio: { data: base64, format: ext } },
          { type: 'text',        text: userText },
        ],
      },
    ],
    max_tokens: 800,
  };

  let response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Impossible de contacter l\'API OpenAI. Vérifie ta connexion.');
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Clé API OpenAI invalide.');
    if (response.status === 429) throw new Error('Limite API OpenAI atteinte. Réessaie dans quelques instants.');
    throw new Error(err.error?.message || `Erreur GPT-4o Audio (${response.status})`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Réponse GPT-4o illisible. Réessaie.');
  }
}

// ── GPT-4o Audio : Évaluation d'un drill ─────
//
// L'apprenant répète une phrase donnée.
// Retourne { score, feedback, tips[] }

async function evaluateDrillRepetition(blob, mimeType, expectedText, apiKey) {
  if (!apiKey) throw new Error('Clé API OpenAI manquante.');

  const ext    = getMimeExtension(mimeType);
  const base64 = await blobToBase64(blob);

  const body = {
    model:    GPT4O_AUDIO,
    messages: [
      {
        role:    'system',
        content: 'Tu es un coach de prononciation pour le portugais européen. Évalue la prononciation de l\'apprenant sur la phrase répétée. Réponds en JSON uniquement, sans markdown.',
      },
      {
        role:    'user',
        content: [
          { type: 'input_audio', input_audio: { data: base64, format: ext } },
          {
            type: 'text',
            text: `L'apprenant devait répéter : "${expectedText}"

Évalue sa prononciation et retourne :
{
  "score": 85,
  "feedback": "Retour bienveillant en 1-2 phrases.",
  "tips": ["Conseil 1", "Conseil 2"]
}`,
          },
        ],
      },
    ],
    max_tokens: 300,
  };

  let response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Impossible de contacter l\'API OpenAI. Vérifie ta connexion.');
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Erreur GPT-4o Audio (${response.status})`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Réponse GPT-4o illisible.');
  }
}

export {
  transcribe,
  evaluatePronunciation,
  evaluateDrillRepetition,
  blobToBase64,
  getMimeExtension,
  getBestRecordingFormat,
};
