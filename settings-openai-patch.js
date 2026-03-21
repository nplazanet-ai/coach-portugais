// ─────────────────────────────────────────────
//  settings-openai-patch.js
//  Bloc de réglages pour la clé API OpenAI.
//  Exporté et inséré dynamiquement dans settings.js.
// ─────────────────────────────────────────────

import Storage from './storage.js';

// ── renderOpenAIKeyBlock ──────────────────────
//
// Retourne le HTML du bloc clé OpenAI (style identique au bloc Claude).

function renderOpenAIKeyBlock() {
  const key        = Storage.getOpenAIKey();
  const configured = !!key;
  const badgeText  = configured ? '✓ Configurée' : 'Non configurée';
  const badgeClass = configured ? 'api-key-badge configured' : 'api-key-badge missing';

  return `
    <div class="settings-group" id="openai-key-group">
      <div class="sg-label">Intelligence Artificielle</div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🔊</span>
          <div>
            <div class="setting-name">
              Clé API OpenAI
              <span id="openai-key-badge" class="${badgeClass}">${badgeText}</span>
            </div>
            <div class="setting-desc">Pour Whisper (transcription) et GPT-4o Audio (phonétique)</div>
          </div>
        </div>
      </div>
      <div style="padding: 0 14px 14px">
        <div class="api-key-field">
          <input type="password" class="form-input" id="openai-key-input"
            placeholder="sk-…"
            value="${_escapeHtml(key)}"
            autocomplete="off" autocorrect="off" spellcheck="false">
          <button class="api-key-eye" id="openai-key-eye" data-action="toggleOpenAIKey">👁</button>
        </div>
        <button class="btn btn-secondary" style="margin-top:8px;font-size:12px;padding:9px 14px"
          id="openai-key-save-btn">
          Enregistrer la clé
        </button>
      </div>
    </div>
  `;
}

// ── bindOpenAIKeyEvents ───────────────────────
//
// Attache les handlers du bloc clé OpenAI dans le container donné.
//
// @param container — l'élément DOM qui contient le HTML rendu par renderOpenAIKeyBlock()

function bindOpenAIKeyEvents(container) {
  const saveBtn = container.querySelector('#openai-key-save-btn');
  const eyeBtn  = container.querySelector('#openai-key-eye');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const input = container.querySelector('#openai-key-input');
      if (!input) return;
      const key = input.value.trim();
      Storage.setOpenAIKey(key);
      _updateBadge(container, key);
      window.toast(key ? 'Clé OpenAI enregistrée ✓' : 'Clé OpenAI effacée');
    });
  }

  if (eyeBtn) {
    eyeBtn.addEventListener('click', () => {
      const input = container.querySelector('#openai-key-input');
      if (!input) return;
      if (input.type === 'password') {
        input.type        = 'text';
        eyeBtn.textContent = '🙈';
      } else {
        input.type        = 'password';
        eyeBtn.textContent = '👁';
      }
    });
  }
}

// ── Helpers privés ────────────────────────────

function _updateBadge(container, key) {
  const badge = container.querySelector('#openai-key-badge');
  if (!badge) return;
  if (key) {
    badge.textContent = '✓ Configurée';
    badge.className   = 'api-key-badge configured';
  } else {
    badge.textContent = 'Non configurée';
    badge.className   = 'api-key-badge missing';
  }
}

function _escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export { renderOpenAIKeyBlock, bindOpenAIKeyEvents };
