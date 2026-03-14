// ─────────────────────────────────────────────
//  shared/data.js
//  Données statiques : unités et thèmes
//  du manuel Português XXI 1 (Lidel).
// ─────────────────────────────────────────────

export const UNITS = [
  { num: 1,  title: 'Apresentações',   themes: ['Salutations', 'Se présenter', 'Nationalités', 'Alphabet', 'Épeler'] },
  { num: 2,  title: 'A família',       themes: ['Famille', 'Adjectifs', 'Verbe ser / estar', 'Chiffres', 'Possessifs'] },
  { num: 3,  title: 'O dia a dia',     themes: ['Routine quotidienne', 'Heures', 'Verbes en -ar', 'Repas', 'Verbes réfléchis'] },
  { num: 4,  title: 'A cidade',        themes: ['Ville', 'Directions', 'Transports', 'Prépositions', 'Hay / Ter'] },
  { num: 5,  title: 'O trabalho',      themes: ['Professions', 'Lieu de travail', 'Verbes en -er/-ir', 'Horaires', 'Interrogation'] },
  { num: 6,  title: 'As compras',      themes: ['Achats', 'Vêtements', 'Prix', 'Couleurs', 'Démonstratifs'] },
  { num: 7,  title: 'O tempo livre',   themes: ['Loisirs', 'Sports', 'Goûts', 'Fréquence', 'Ir + infinitif'] },
  { num: 8,  title: 'A casa',          themes: ['Logement', 'Meubles', 'Localisation', 'Tâches ménagères', 'Comparatifs'] },
  { num: 9,  title: 'A saúde',         themes: ['Corps humain', 'Médecin', 'Symptômes', 'Conseils', 'Impératif'] },
  { num: 10, title: 'As viagens',      themes: ['Voyages', 'Hôtel', 'Passé (pretérito perfeito)', 'Pays', 'Participe passé'] },
  { num: 11, title: 'A alimentação',   themes: ['Restaurant', 'Nourriture', 'Commander', 'Recettes', 'Quantité'] },
  { num: 12, title: 'Os planos',       themes: ['Projets', 'Futur', 'Invitations', 'Météo', 'Conditionnel'] },
];

// Récupérer une unité par son numéro
export function getUnit(num) {
  return UNITS.find(u => u.num === num) || null;
}
