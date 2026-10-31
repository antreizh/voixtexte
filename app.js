'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  mic: $('mic'), lang: $('lang'), status: $('status'), transcript: $('transcript'),
  final: $('final'), interim: $('interim'), placeholder: $('placeholder'),
  clear: $('clear'), copy: $('copy'), share: $('share'), download: $('download'),
  unsupported: $('unsupported'),
};

const STORE_TEXT = 'voixtexte.text';
const STORE_LANG = 'voixtexte.lang';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Sur Chrome Android, le mode « continuous » duplique les résultats : on enchaîne
// plutôt des sessions courtes, relancées automatiquement.
const isAndroid = /Android/i.test(navigator.userAgent);

let recognition = null;
let listening = false;   // l'utilisateur veut écouter
let committed = store.get(STORE_TEXT) || '';  // texte validé des sessions précédentes
let sessionFinal = '';   // texte validé de la session en cours
let wakeLock = null;
let restartTimer = null;

// ---------- Affichage ----------
function joinText(a, b) {
  if (!a) return b;
  if (!b) return a;
  return /[\s\n]$/.test(a) ? a + b : a + ' ' + b;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fullText() {
  return joinText(committed, sessionFinal).trim();
}

function render(interim = '') {
  const text = joinText(committed, sessionFinal);
  els.final.textContent = text;
  els.interim.textContent = interim ? (text ? ' ' : '') + interim : '';
  els.placeholder.hidden = Boolean(text || interim);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function setStatus(msg, live = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('live', live);
}

let toastEl;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------- Reconnaissance ----------
function commitSession() {
  if (sessionFinal.trim()) {
    committed = joinText(committed, capitalize(sessionFinal.trim()));
    store.set(STORE_TEXT, committed);
  }
  sessionFinal = '';
}

function createRecognition() {
  const r = new SpeechRecognition();
  r.lang = els.lang.value;
  r.interimResults = true;
  r.continuous = !isAndroid;
  r.maxAlternatives = 1;

  r.onstart = () => setStatus('Écoute en cours…', true);

  r.onresult = (event) => {
    // On reconstruit tout le texte de la session à partir de event.results,
    // ce qui évite les doublons quel que soit le navigateur.
    let finalText = '';
    let interimText = '';
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      const t = res[0].transcript.trim();
      if (!t) continue;
      if (res.isFinal) finalText = joinText(finalText, t);
      else interimText = joinText(interimText, t);
    }
    sessionFinal = finalText;
    render(interimText);
  };

  r.onerror = (event) => {
    switch (event.error) {
      case 'not-allowed':
      case 'service-not-allowed':
        stop();
        setStatus('Accès au micro refusé. Autorisez le micro dans les réglages du navigateur.');
        break;
      case 'network':
        setStatus('Erreur réseau : la reconnaissance nécessite une connexion.');
        break;
      case 'audio-capture':
        stop();
        setStatus('Aucun micro détecté.');
        break;
      case 'language-not-supported':
        stop();
        setStatus('Langue non prise en charge par ce navigateur.');
        break;
      case 'no-speech':
      case 'aborted':
        break; // relance automatique dans onend
      default:
        setStatus('Erreur : ' + event.error);
    }
  };

  r.onend = () => {
    commitSession();
    render();
    if (listening) {
      // Relance automatique : le navigateur coupe après un silence ou une phrase.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!listening) return;
        try { r.start(); } catch { /* déjà démarré */ }
      }, 150);
    } else {
      setStatus('En pause');
    }
  };

  return r;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* non disponible : pas grave */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function start() {
  if (!SpeechRecognition || listening) return;
  listening = true;
  recognition = createRecognition();
  try {
    recognition.start();
  } catch (e) {
    listening = false;
    setStatus('Impossible de démarrer : ' + e.message);
    return;
  }
  els.mic.setAttribute('aria-pressed', 'true');
  els.mic.setAttribute('aria-label', 'Arrêter la transcription');
  setStatus('Démarrage…', true);
  requestWakeLock();
}

function stop() {
  listening = false;
  clearTimeout(restartTimer);
  els.mic.setAttribute('aria-pressed', 'false');
  els.mic.setAttribute('aria-label', 'Démarrer la transcription');
  if (recognition) {
    try { recognition.stop(); } catch { /* ignoré */ }
  }
  releaseWakeLock();
  setStatus('En pause');
}

// ---------- Actions ----------
els.mic.addEventListener('click', () => (listening ? stop() : start()));

els.lang.addEventListener('change', () => {
  store.set(STORE_LANG, els.lang.value);
  if (listening) {
    // Redémarre avec la nouvelle langue.
    stop();
    setTimeout(start, 300);
  }
});

els.clear.addEventListener('click', () => {
  if (!fullText() || confirm('Effacer tout le texte ?')) {
    committed = '';
    sessionFinal = '';
    store.set(STORE_TEXT, '');
    render();
  }
});

els.copy.addEventListener('click', async () => {
  const text = fullText();
  if (!text) return toast('Rien à copier');
  try {
    await navigator.clipboard.writeText(text);
    toast('Texte copié');
  } catch {
    // Repli pour les navigateurs plus anciens.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Texte copié');
  }
});

els.share.addEventListener('click', async () => {
  const text = fullText();
  if (!text) return toast('Rien à partager');
  if (navigator.share) {
    try { await navigator.share({ title: 'Transcription', text }); } catch { /* annulé */ }
  } else {
    toast('Partage non disponible, utilisez Copier');
  }
});

els.download.addEventListener('click', () => {
  const text = fullText();
  if (!text) return toast('Rien à télécharger');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `transcription-${stamp}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Le verrou d'écran est libéré quand l'appli passe en arrière-plan : on le reprend au retour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && listening) requestWakeLock();
});

// ---------- Initialisation ----------
const savedLang = store.get(STORE_LANG);
if (savedLang && [...els.lang.options].some((o) => o.value === savedLang)) {
  els.lang.value = savedLang;
}

if (!SpeechRecognition) {
  els.unsupported.hidden = false;
  els.mic.disabled = true;
  setStatus('Non pris en charge');
} else if (!window.isSecureContext) {
  setStatus('Ouvrez l\'appli en HTTPS pour accéder au micro.');
}

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
