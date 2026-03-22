// ─────────────────────────────────────────────
//  tprs-generator.js
//  Génère une histoire TPRS absurde et personnalisée
//  avec 3 types de questions authentiques TPRS.
// ─────────────────────────────────────────────

import State from './state.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-opus-4-6';

const TprsGenerator = {

  async generate(journalEntry) {
    const apiKey = State.get('claudeApiKey');
    if (!apiKey) throw new Error('Clé API Claude manquante. Configure-la dans les Réglages.');

    const body = {
      model:      MODEL,
      max_tokens: 1800,
      system:     _systemPrompt(),
      messages:   [{ role: 'user', content: _userPrompt(journalEntry) }],
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
      if (response.status === 401) throw new Error('Clé API invalide. Vérifie-la dans les Réglages.');
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
  return `Tu es un enseignant expert en méthode TPRS (Teaching Proficiency through Reading and Storytelling) pour le portugais européen (Portugal, pas Brésil).

Tu crées des histoires courtes, simples et captivantes pour des apprenants A1-A2.

RÈGLE ABSOLUE — HUMOUR ET ABSURDE :
L'histoire DOIT avoir des personnages improbables et une situation grotesque.
EXEMPLES ACCEPTABLES : un poulpe chauffeur de taxi, une girafe astronaute,
un pingouin boulanger amoureux d'une tortue célèbre, un chat philosophe.
EXEMPLES INTERDITS : João étudiant, Maria secrétaire, situation banale.
Si l'histoire ne fait pas sourire, c'est un échec.

Règles absolues :
- Portugais européen uniquement (orthographe et expressions de Portugal)
- Phrases simples (sujet + verbe + complément)
- Histoire cohérente avec un mini-arc narratif absurde
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

Génère une histoire TPRS absurde et amusante. Format JSON attendu :

{
  "title": "Titre absurde en portugais",
  "characters": ["Personagem 1 (description courte)", "Personagem 2 (description)"],
  "key_structure": "structure grammaticale cible ex: ir + infinitif",
  "sentences": [
    "Phrase 1 avec <strong>structure cible</strong>.",
    "Phrase 2.",
    "Phrase 3.",
    "Phrase 4.",
    "Phrase 5."
  ],
  "questions": [
    {
      "type": "oui_non",
      "question": "O [personnage] é um [animal bizarre] ?",
      "hint": "conseil grammatical court en français",
      "expectedAnswer": "Sim, o [personnage] é um [animal].",
      "answerKeywords": ["sim", "mot-clé"],
      "acceptShortAnswer": true
    },
    {
      "type": "choix_binaire",
      "question": "O [personnage] vai de [option A] ou de [option B] ?",
      "hint": "conseil grammatical court en français",
      "expectedAnswer": "Vai de [option correcte].",
      "choices": ["option correcte", "option incorrecte"],
      "answerKeywords": ["option-correcte"],
      "acceptShortAnswer": true
    },
    {
      "type": "ouverte",
      "question": "O que é que o [personnage] vai fazer ?",
      "hint": "conseil grammatical court en français",
      "expectedAnswer": "Vai [verbe à l'infinitif].",
      "answerKeywords": ["mot1", "mot2"],
      "acceptShortAnswer": false
    }
  ],
  "retelling_guide": "mot-clé 1 / mot-clé 2 / mot-clé 3 / mot-clé 4 / mot-clé 5",
  "vocabulary_used": ["mot1", "mot2", "mot3"],
  "drill_words": ["mot-difficile-1", "mot-difficile-2"]
}

Contraintes :
- 5 à 7 phrases
- Les balises <strong> et </strong> doivent encadrer la structure grammaticale cible dans les phrases
- Utiliser au moins 60 % du vocabulaire listé
- 3 questions (1 oui_non + 1 choix_binaire + 1 ouverte) — dans cet ordre
- Pour choix_binaire : choices[0] est TOUJOURS la réponse correcte
- retelling_guide : 5 à 8 mots-clés en portugais séparés par " / "
- drill_words : 1 à 2 mots phonétiquement difficiles pour francophones (ex: "lh", nasales, "ão")
- L'histoire doit faire sourire !`;
}

export default TprsGenerator;
