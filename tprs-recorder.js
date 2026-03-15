// ─────────────────────────────────────────────
//  modules/tprs/tprs-recorder.js
//  Enregistrement vocal (MediaRecorder) +
//  transcription en temps réel (SpeechRecognition).
//  Retourne { blob, transcript, duration, mimeType }
// ─────────────────────────────────────────────

const TprsRecorder = (() => {

  // ── État interne ──────────────────────────
  let _recorder     = null;
  let _chunks       = [];
  let _recognition  = null;
  let _transcript   = '';    // transcription finale accumulée
  let _startTime    = null;
  let _timerHandle  = null;
  let _onUpdate     = null;  // callback({ type, ... })

  // ── API publique ──────────────────────────

  return {

    get isRecording() {
      return _recorder?.state === 'recording';
    },

    // Démarre l'enregistrement.
    // onUpdate(event) reçoit :
    //   { type: 'timer',      elapsed: number }
    //   { type: 'transcript', final: string, interim: string }
    async start(onUpdate) {
      _onUpdate   = onUpdate;
      _chunks     = [];
      _transcript = '';

      // ── Microphone ────────────────────────
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const msg = err.name === 'NotAllowedError'
          ? 'Accès au microphone refusé. Autorise-le dans les réglages du navigateur.'
          : 'Impossible d\'accéder au microphone : ' + err.message;
        throw new Error(msg);
      }

      // ── MediaRecorder ────────────────────
      const mimeType = _bestMimeType();
      _recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      _recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) _chunks.push(e.data);
      };
      _recorder.start(300); // chunks toutes les 300 ms

      // ── Timer ────────────────────────────
      _startTime   = Date.now();
      _timerHandle = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _startTime) / 1000);
        onUpdate({ type: 'timer', elapsed });
      }, 1000);

      // ── SpeechRecognition (best-effort) ──
      _startRecognition(onUpdate);
    },

    // Arrête et retourne les résultats.
    stop() {
      return new Promise((resolve, reject) => {
        if (!_recorder) { reject(new Error('Aucun enregistrement en cours.')); return; }

        clearInterval(_timerHandle);
        _timerHandle = null;

        const duration = Math.floor((Date.now() - _startTime) / 1000);

        _stopRecognition();

        _recorder.onstop = () => {
          const mime = _recorder.mimeType || 'audio/webm';
          const blob = new Blob(_chunks, { type: mime });

          // Libérer le micro
          _recorder.stream?.getTracks().forEach(t => t.stop());
          _recorder = null;

          resolve({ blob, transcript: _transcript, duration, mimeType: mime });
        };

        _recorder.stop();
      });
    },

    // Annule sans retourner de résultat.
    cancel() {
      clearInterval(_timerHandle);
      _timerHandle = null;
      _stopRecognition();
      if (_recorder) {
        _recorder.stream?.getTracks().forEach(t => t.stop());
        try { _recorder.stop(); } catch {}
        _recorder = null;
      }
      _chunks     = [];
      _transcript = '';
    },

    // Crée une URL de lecture pour le blob (à révoquer après usage).
    createObjectURL(blob) {
      return URL.createObjectURL(blob);
    },
  };

  // ── Helpers privés ────────────────────────

  function _startRecognition(onUpdate) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; // pas disponible, on continue sans transcription

    try {
      _recognition = new SR();
      _recognition.lang            = 'pt-PT';
      _recognition.continuous      = true;
      _recognition.interimResults  = true;
      _recognition.maxAlternatives = 1;

      _recognition.onresult = (e) => {
        let finalPart  = '';
        let interimPart = '';
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalPart  += e.results[i][0].transcript + ' ';
          else                      interimPart += e.results[i][0].transcript;
        }
        _transcript = finalPart.trim();
        onUpdate({ type: 'transcript', final: _transcript, interim: interimPart.trim() });
      };

      // Sur certains navigateurs, onerror avec 'no-speech' est bénin
      _recognition.onerror = (e) => {
        if (e.error !== 'no-speech') console.warn('[Recorder] SpeechRecognition error:', e.error);
      };

      _recognition.start();
    } catch (err) {
      console.warn('[Recorder] SpeechRecognition non disponible :', err);
    }
  }

  function _stopRecognition() {
    if (_recognition) {
      try { _recognition.stop(); } catch {}
      _recognition = null;
    }
  }

  function _bestMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    return candidates.find(t => {
      try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
    }) || '';
  }

})();

export default TprsRecorder;
