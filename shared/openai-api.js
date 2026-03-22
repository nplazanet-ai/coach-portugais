// ─────────────────────────────────────────────
//  shared/openai-api.js
//  Utilitaires OpenAI :
//  - Whisper (gpt-4o-mini-transcribe) : transcription audio
//  - GPT-4o Audio (gpt-4o-audio-preview) : évaluation phonétique réelle
//
//  Tous les blobs audio sont convertis en WAV PCM 16-bit / 16 kHz
//  avant envoi : GPT-4o Audio n'accepte que 'wav' et 'mp3'.
// ─────────────────────────────────────────────

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const WHISPER_MODEL   = 'gpt-4o-mini-transcribe';
const GPT4O_AUDIO     = 'gpt-4o-audio-preview';

// ── Conversion WebM → WAV via Web Audio API ──
//
// Chrome Android enregistre en audio/webm;codecs=opus.
// GPT-4o Audio n'accepte que 'wav' ou 'mp3'.
// On décode via AudioContext puis on réencode en WAV PCM 16-bit mono 16 kHz.

async function convertToWav(blob) {
  const arrayBuffer  = await blob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const wav = _audioBufferToWav(audioBuffer);
    return new Blob([wav], { type: 'audio/wav' });
  } catch (e) {
    throw new Error('Décodage audio impossible : ' + e.message);
  } finally {
    audioContext.close();
  }
}

// Encode un AudioBuffer en WAV PCM 16-bit mono 16 kHz
function _audioBufferToWav(buffer) {
  const sampleRate = 16000; // optimal pour Whisper
  const samples    = _downsampleToMono(buffer, sampleRate);

  const dataLength   = samples.length * 2; // 16-bit = 2 bytes/sample
  const arrayBuffer  = new ArrayBuffer(44 + dataLength);
  const view         = new DataView(arrayBuffer);

  _writeString(view, 0,  'RIFF');
  view.setUint32(4,  36 + dataLength, true);
  _writeString(view, 8,  'WAVE');
  _writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);       // taille chunk fmt
  view.setUint16(20, 1,  true);       // PCM
  view.setUint16(22, 1,  true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2,  true); // byte rate (mono 16-bit)
  view.setUint16(32, 2,  true);       // block align
  view.setUint16(34, 16, true);       // bits per sample
  _writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return arrayBuffer;
}

// Downmix multicanal → mono + resample linéaire vers targetRate
function _downsampleToMono(buffer, targetRate) {
  const nCh     = buffer.numberOfChannels;
  const length  = buffer.length;
  const mono    = new Float32Array(length);

  for (let ch = 0; ch < nCh; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / nCh;
  }

  if (buffer.sampleRate === targetRate) return mono;

  const ratio     = buffer.sampleRate / targetRate;
  const newLength = Math.round(length / ratio);
  const out       = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const pos  = i * ratio;
    const idx  = Math.floor(pos);
    const frac = pos - idx;
    out[i] = (mono[idx] || 0) + frac * ((mono[idx + 1] || 0) - (mono[idx] || 0));
  }

  return out;
}

function _writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// Convertit un Blob en base64 (sans préfixe data:…)
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader  = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Erreur lecture audio'));
    reader.readAsDataURL(blob);
  });
}

// Retourne le meilleur format MediaRecorder disponible sur l'appareil
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
// Convertit en WAV puis envoie à l'API Whisper.
// mimeType conservé en signature pour compatibilité mais ignoré (on convertit toujours).

async function transcribe(blob, mimeType, apiKey) {
  if (!apiKey) throw new Error('Clé API OpenAI manquante.');

  const wavBlob  = await convertToWav(blob);
  const formData = new FormData();
  formData.append('file',            wavBlob, 'audio.wav');
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

  return (await response.text()).trim();
}

// ── GPT-4o Audio : Évaluation phonétique ─────
//
// Convertit en WAV (format accepté), envoie en base64 à GPT-4o Audio.
// Retourne { score, summary, positives[], errors[], pronunciation_tips[] }

async function evaluatePronunciation(blob, mimeType, story, transcript, apiKey) {
  if (!apiKey) throw new Error('Clé API OpenAI manquante.');

  const wavBlob  = await convertToWav(blob);
  const base64   = await blobToBase64(wavBlob);

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
  "positives": ["Point positif 1", "Point positif 2"],
  "errors": [
    {
      "type": "vocabulaire|grammaire|prononciation|omission",
      "expected": "ce qui était attendu",
      "said": "ce qui a été dit (ou 'non prononcé')",
      "tip": "Conseil pédagogique précis en français"
    }
  ],
  "pronunciation_tips": ["Conseil phonétique général 1", "Conseil phonétique général 2"]
}

Contraintes : score 0-100, 1-2 positifs, 0-4 erreurs max, 1-3 conseils phonétiques, ton bienveillant.`;

  const body = {
    model:    GPT4O_AUDIO,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role:    'user',
        content: [
          { type: 'input_audio', input_audio: { data: base64, format: 'wav' } },
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
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
// L'apprenant répète une phrase donnée. Retourne { score, feedback, tips[] }

async function evaluateDrillRepetition(blob, mimeType, expectedText, apiKey) {
  if (!apiKey) throw new Error('Clé API OpenAI manquante.');

  const wavBlob  = await convertToWav(blob);
  const base64   = await blobToBase64(wavBlob);

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
          { type: 'input_audio', input_audio: { data: base64, format: 'wav' } },
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
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
  convertToWav,
  blobToBase64,
  getBestRecordingFormat,
};
