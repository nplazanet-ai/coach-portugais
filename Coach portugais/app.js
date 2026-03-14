// ─────────────────────────────────────────────
//  core/app.js
//  Point d'entrée. Gère :
//  - l'initialisation de l'app
//  - la navigation entre modules
//  - le toast global
//  - le service worker PWA
// ─────────────────────────────────────────────

import Storage  from './storage.js';
import State    from './state.js';

import HomeModule     from '../modules/home/home.js';
import JournalModule  from '../modules/journal/journal.js';
import ProgressModule from '../modules/progress/progress.js';
import SettingsModule from '../modules/settings/settings.js';

// ── REGISTRE DES MODULES ─────────────────────
// Pour ajouter un module : l'inscrire ici + créer son dossier

const MODULES = {
  home:     HomeModule,
  journal:  JournalModule,
  progress: ProgressModule,
  settings: SettingsModule,
};

// ── NAVIGATION ───────────────────────────────

let _currentPage = 'home';

function navigate(page) {
  if (page === _currentPage) return;
  if (!MODULES[page]) { console.warn('[App] Module inconnu :', page); return; }

  // Animation sortie
  const oldEl = document.getElementById('page-' + _currentPage);
  if (oldEl) {
    oldEl.classList.remove('active');
    oldEl.classList.add('exit');
    setTimeout(() => oldEl.classList.remove('exit'), 280);
  }

  // Animation entrée
  const newEl = document.getElementById('page-' + page);
  if (newEl) {
    newEl.classList.add('active');
  }

  // Mettre à jour la nav
  document.querySelectorAll('#bottom-nav .nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  _currentPage = page;

  // Notifier le module entrant (pour refresh des données)
  if (MODULES[page]?.onEnter) MODULES[page].onEnter();
}

// Exposé globalement pour les onclick HTML
window.navigate = navigate;

// ── TOAST GLOBAL ─────────────────────────────

let _toastTimer = null;

function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// Exposé pour que les modules puissent l'appeler
window.toast = toast;

// ── STREAK (calcul global) ────────────────────

function computeStreak() {
  const entries = State.get('entries') || [];
  if (entries.length === 0) return 0;

  const dates = [...new Set(entries.map(e => e.date))].sort().reverse();
  const today = _today();
  let streak = 0;
  let check  = today;

  for (const d of dates) {
    if (d === check) {
      streak++;
      const prev = new Date(check + 'T12:00:00');
      prev.setDate(prev.getDate() - 1);
      check = prev.toISOString().split('T')[0];
    } else if (d < check) {
      break;
    }
  }
  return streak;
}

function _today() {
  return new Date().toISOString().split('T')[0];
}

// Exposé pour les modules
window.computeStreak = computeStreak;

// ── HEADER : mise à jour du streak ───────────

function refreshHeader() {
  const streak = computeStreak();
  const el = document.querySelector('.streak-pill .count');
  if (el) el.textContent = streak;
}

window.refreshHeader = refreshHeader;

// ── SERVICE WORKER (PWA) ─────────────────────

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[PWA] Service worker enregistré'))
      .catch(e => console.warn('[PWA] Erreur SW :', e));
  }
}

// ── INIT ─────────────────────────────────────

function init() {
  // 1. Charger les données sauvegardées
  Storage.load();

  // 2. Initialiser chaque module
  Object.values(MODULES).forEach(mod => {
    if (mod.init) mod.init();
  });

  // 3. Afficher la page d'accueil
  const homeEl = document.getElementById('page-home');
  if (homeEl) homeEl.classList.add('active');
  if (MODULES.home?.onEnter) MODULES.home.onEnter();

  // 4. Mettre à jour le header
  refreshHeader();

  // 5. Swipe sheet global (fermeture par glissement)
  _initSheetSwipe();

  // 6. PWA
  registerSW();
}

// ── SWIPE POUR FERMER LES SHEETS ─────────────

function _initSheetSwipe() {
  document.querySelectorAll('.sheet').forEach(sheet => {
    let startY = 0;
    sheet.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      if (e.touches[0].clientY - startY > 90) {
        // Chercher la fonction de fermeture associée
        const closeId = sheet.dataset.closeBtn;
        if (closeId && window[closeId]) window[closeId]();
      }
    }, { passive: true });
  });
}

// Lancement
document.addEventListener('DOMContentLoaded', init);

export { navigate, toast, computeStreak, refreshHeader };
