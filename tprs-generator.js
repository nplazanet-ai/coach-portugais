// ─────────────────────────────────────────────
//  modules/tprs/tprs-generator.js
//  Génère une histoire TPRS personnalisée
//  à partir du dernier journal entry, via Claude API.
// ─────────────────────────────────────────────

import State from './state.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-6';

const TprsGenerator = {

  // ── GÉNÉRATION DE L'HISTOIRE ─────────────
  //  Retourne un objet story parsé depuis le JSON Claude.

  async generate(journalEntry) {
    const apiKey = State.get('claudeApiKey');
    if (!apiKey) throw new Error('Clé API Claude manquante. Configure-la dans les Réglages.');

    const body = {
      model:      MODEL,
      max_tokens: 1200,
      system:     _systemPrompt(),
      messages:   [{ role: 'user', content: _userPrompt(journalEntry) }],
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
    } catch (networkErr) {
      throw new Error('Impossible de contacter l\'API Claude. Vérifie ta connexion.');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Clé API invalide. Vérifie-la dans les Réglages.');
      if (response.status === 429) throw new Error('Limite API atteinte. Réessaie dans quelques instants.');
      throw new Error(err.error?.message || `Erreur API (${response.status})`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    try {
      return JSON.parse(text);
    } catch {
      // Parfois Claude ajoute du markdown — on extrait le JSON
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Réponse Claude illisible. Réessaie.');
    }
  },

};

// ── PROMPTS ──────────────────────────────────

function _systemPrompt() {
  return `Tu es un enseignant expert en méthode TPRS (Teaching Proficiency through Reading and Storytelling) pour le portugais européen (Portugal, pas Brésil).

Tu crées des histoires courtes, simples et captivantes pour des apprenants A1-A2, en utilisant leur vocabulaire récent pour maximiser la rétention.

Règles absolues :
- Portugais européen uniquement (orthographe et expressions de Portugal)
- Phrases simples (sujet + verbe + complément)
- Histoire cohérente avec un mini-arc narratif
- Retourne UNIQUEMENT un objet JSON valide, sans markdown, sans explication`;
}

function _userPrompt(entry) {
  const unitStr    = entry.type === 'manuel'
    ? `Unité ${entry.unit} du manuel Português XXI 1 (Lidel)`
    : 'Contenu hors manuel';

  const notions    = (entry.notions || []).join(', ') || 'non précisées';

  const vocabLines = (entry.vocab || []).length > 0
    ? (entry.vocab || []).map(v => `• ${v.pt} — ${v.fr}`).join('\n')
    : '(aucun vocabulaire saisi)';

  return `Contexte du dernier cours :
- ${unitStr}
- Notions : ${notions}
- Vocabulaire :
${vocabLines}

Génère une histoire TPRS adaptée. Format JSON attendu :

{
  "title": "Titre de l'histoire en portugais",
  "sentences": [
    "Phrase 1.",
    "Phrase 2.",
    "Phrase 3.",
    "Phrase 4.",
    "Phrase 5."
  ],
  "questions": [
    { "text": "Question vrai/faux ?", "answer": true  },
    { "text": "Question vrai/faux ?", "answer": false },
    { "text": "Question vrai/faux ?", "answer": true  }
  ],
  "retelling_guide": "mot-clé 1 / mot-clé 2 / mot-clé 3 / ...",
  "vocabulary_used": ["mot1", "mot2", "mot3"]
}

Contraintes :
- 5 à 7 phrases
- Utiliser au moins 60 % du vocabulaire listé
- 3 questions vrai/faux simples
- retelling_guide : 5 à 8 mots-clés en portugais séparés par " / "`;
}

export default TprsGenerator;
