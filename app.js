'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  mic: $('mic'), lang: $('lang'), status: $('status'), saved: $('saved'), title: $('title'),
  transcript: $('transcript'), final: $('final'), interim: $('interim'), placeholder: $('placeholder'),
  newRec: $('new'), copy: $('copy'), share: $('share'), download: $('download'),
  unsupported: $('unsupported'), blackout: $('blackout'), unmask: $('unmask'), maskBtn: $('maskBtn'), history: $('history'), historyDialog: $('historyDialog'),
  historyList: $('historyList'), closeHistory: $('closeHistory'), stamps: $('stamps'),
};

// ---------- Stockage ----------
// Chaque enregistrement : { id, start, segments: [{ t: horodatage ms, text }] }.
// Chaque phrase reconnue est ajoutée et sauvegardée immédiatement, au fil de la voix.
const STORE_RECS = 'voixtexte.recordings';
const STORE_CURRENT = 'voixtexte.current';
const STORE_LANG = 'voixtexte.lang';
const STORE_STAMPS = 'voixtexte.stamps';
const OLD_STORE_TEXT = 'voixtexte.text';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* ignoré */ } },
};

function loadRecordings() {
  try {
    const data = JSON.parse(store.get(STORE_RECS) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

let recordings = loadRecordings();

function newRecording() {
  const rec = { id: Date.now().toString(36), start: Date.now(), segments: [] };
  recordings.unshift(rec);
  return rec;
}

// Migration depuis l'ancienne version (un seul texte brut).
const oldText = store.get(OLD_STORE_TEXT);
if (oldText && oldText.trim()) {
  const rec = newRecording();
  rec.segments.push({ t: rec.start, text: oldText.trim() });
}
store.remove(OLD_STORE_TEXT);

let current = recordings.find((r) => r.id === store.get(STORE_CURRENT)) || recordings[0] || newRecording();

function persist() {
  // On ne garde pas les enregistrements vides autres que celui en cours.
  recordings = recordings.filter((r) => r.segments.length || r.audioId || r === current);
  const ok = store.set(STORE_RECS, JSON.stringify(recordings)) && store.set(STORE_CURRENT, current.id);
  if (ok) {
    els.saved.textContent = '✓ ' + formatTime(Date.now());
    els.saved.title = 'Dernière sauvegarde';
  } else {
    els.saved.textContent = '⚠ sauvegarde impossible';
  }
}

// ---------- Mise en forme ----------
const pad = (n) => String(n).padStart(2, '0');
function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// jjmmaaaa_hhmmss : base des noms de fichiers (Enr_… et cr_…)
function formatStamp(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function formatDate(ms) {
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function joinText(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a + ' ' + b;
}
// Texte d'une phrase, préfixé de son étiquette (« [Décision] … ») s'il y en a une.
function segmentText(seg) {
  const label = seg.kind ? VTReport.KINDS[seg.kind] : '';
  return label ? `[${label}] ${seg.text}` : seg.text;
}
function recordingText(rec, withStamps = false) {
  if (withStamps) {
    return rec.segments.map((s) => `[${formatTime(s.t)}] ${segmentText(s)}`).join('\n');
  }
  return rec.segments.map(segmentText).join('\n');
}
function exportText() {
  return recordingText(current, els.stamps.checked).trim();
}

// ---------- Affichage ----------
function render(interim = '') {
  const text = recordingText(current);
  // Une ligne par phrase, avec un badge coloré pour les mots-clés reconnus.
  els.final.replaceChildren(...current.segments.map((seg) => {
    const line = document.createElement('div');
    line.className = 'seg';
    if (seg.kind) {
      const badge = document.createElement('span');
      badge.className = 'badge kind-' + seg.kind;
      badge.textContent = VTReport.KINDS[seg.kind];
      line.append(badge, ' ');
    }
    line.append(seg.text);
    return line;
  }));
  const pending = pendingKind ? VTReport.KINDS[pendingKind] + ' : ' : '';
  els.interim.textContent = pending + interim;
  els.placeholder.hidden = Boolean(text || interim || pending);
  els.title.textContent = (current.audioName ? '🔊 ' + current.audioName + ' — ' : 'Enregistrement du ') + formatDate(current.start);
  if (audioApi()) audioApi().renderPanel();
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
// Module audio (audio.js, chargé après ce fichier).
const audioApi = () => (typeof VTAudio !== 'undefined' ? VTAudio : null);

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
// Sur Chrome Android, le mode « continuous » duplique les résultats : on enchaîne
// plutôt des sessions courtes, relancées automatiquement.
const isAndroid = /Android/i.test(navigator.userAgent);

let recognition = null;
let listening = false;      // l'utilisateur veut écouter
let savedIndexes = new Set(); // résultats finaux déjà sauvegardés pour la session en cours
let wakeLock = null;
let restartTimer = null;

// Mot-clé prononcé seul (« Décision… » puis pause) : il s'applique à la phrase suivante.
let pendingKind = null;

function addSegment(rec, raw, t = Date.now()) {
  const { kind, text } = VTReport.classify(raw.trim());
  if (kind && !text) {
    pendingKind = kind;
    return;
  }
  if (!text) return;
  const seg = { t, text: capitalize(text) };
  const finalKind = kind || pendingKind;
  if (finalKind) seg.kind = finalKind;
  pendingKind = null;
  rec.segments.push(seg);
  persist();
}

function createRecognition() {
  const r = new SpeechRecognition();
  // Les phrases de cette session vont dans l'enregistrement actif au démarrage,
  // même si l'utilisateur en change pendant que les derniers résultats arrivent.
  const target = current;
  r.lang = els.lang.value;
  r.interimResults = true;
  r.continuous = !isAndroid;
  r.maxAlternatives = 1;

  r.onstart = () => {
    savedIndexes = new Set();
    setStatus('Écoute en cours…', true);
  };

  r.onresult = (event) => {
    let interimText = '';
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        // Phrase validée : sauvegarde immédiate, une seule fois.
        if (!savedIndexes.has(i)) {
          savedIndexes.add(i);
          addSegment(target, res[0].transcript);
        }
      } else {
        interimText = joinText(interimText, res[0].transcript.trim());
      }
    }
    render(interimText);
  };

  r.onerror = (event) => {
    // Appli en arrière-plan : le navigateur coupe la reconnaissance ; reprise au retour.
    if (document.visibilityState === 'hidden') return;
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
        return; // relance automatique dans onend
      default:
        setStatus('Erreur : ' + event.error);
    }
    unmask(); // une erreur doit rester visible
  };

  r.onend = () => {
    render();
    if (listening && document.visibilityState === 'hidden') {
      setStatus('En attente (appli en arrière-plan)…', true);
    } else if (listening) {
      // Relance automatique : le navigateur coupe après un silence ou une phrase.
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!listening || r !== recognition) return; // session remplacée ou arrêtée
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
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* non disponible : pas grave */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function start() {
  if (!SpeechRecognition || listening) return;
  listening = true;
  // Enregistrement encore vide : son heure de début est celle du démarrage de la dictée.
  if (!current.segments.length && !current.audioId) { current.start = Date.now(); persist(); }
  if (recognition) { try { recognition.abort(); } catch { /* déjà arrêtée */ } }
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

// ---------- Écran noir pendant l'écoute ----------
// L'écran devient noir (discret, et économe sur les écrans OLED) ; l'écoute continue
// dessous. Un toucher sur le coin gris réaffiche l'appli.
const themeMeta = document.querySelector('meta[name="theme-color"]');
const themeColor = themeMeta.content;

function mask() {
  els.blackout.hidden = false;
  els.maskBtn.hidden = true;
  themeMeta.content = '#000000';
  document.body.classList.add('masked');
  const fs = document.documentElement.requestFullscreen;
  if (fs && !document.fullscreenElement) fs.call(document.documentElement).catch(() => {});
}

function unmask() {
  if (els.blackout.hidden) return;
  els.blackout.hidden = true;
  els.maskBtn.hidden = !isBusy();
  themeMeta.content = themeColor;
  document.body.classList.remove('masked');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

const isBusy = () => listening || Boolean(audioApi() && audioApi().isRecording());
els.unmask.addEventListener('click', unmask);

// Coin gauche : retour à l'écran d'accueil du téléphone sans arrêter l'enregistrement.
// Une page web ne peut pas déclencher elle-même le bouton Accueil : on l'indique, et
// l'enregistrement continue quand l'appli passe en arrière-plan.
els.homeCorner = $('homeCorner');
els.homeHint = $('homeHint');
els.homeCorner.addEventListener('click', () => {
  els.homeHint.hidden = false;
  clearTimeout(els.homeHint._t);
  els.homeHint._t = setTimeout(() => { els.homeHint.hidden = true; }, 4000);
});
els.maskBtn.addEventListener('click', mask);
// Une sortie du plein écran (geste système, bouton retour) réaffiche aussi l'appli.
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) unmask(); });

function stop() {
  listening = false;
  unmask();
  els.maskBtn.hidden = true;
  clearTimeout(restartTimer);
  els.mic.setAttribute('aria-pressed', 'false');
  els.mic.setAttribute('aria-label', 'Démarrer la transcription');
  if (recognition) {
    try { recognition.stop(); } catch { /* ignoré */ }
  }
  releaseWakeLock();
  setStatus('En pause');
}

// Change d'enregistrement en cours (en coupant proprement l'écoute si besoin).
function switchTo(rec) {
  const wasListening = listening;
  if (wasListening) stop();
  current = rec;
  pendingKind = null;
  persist();
  render();
  if (wasListening) setTimeout(start, 300);
}

// ---------- Historique ----------
function renderHistory() {
  els.historyList.replaceChildren();
  const list = recordings.filter((r) => r.segments.length || r.audioId || r === current);
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aucun enregistrement.';
    els.historyList.appendChild(li);
    return;
  }
  for (const rec of list) {
    const li = document.createElement('li');
    if (rec === current) li.className = 'current';

    const open = document.createElement('button');
    open.className = 'open';
    const title = document.createElement('strong');
    title.textContent = formatDate(rec.start);
    const preview = document.createElement('span');
    const n = rec.segments.length;
    preview.textContent = (rec.audioName ? `🔊 ${rec.audioName} · ` : '') + `${n} phrase${n > 1 ? 's' : ''} — ${recordingText(rec) || '(vide)'}`;
    open.append(title, preview);
    open.addEventListener('click', () => {
      els.historyDialog.close();
      if (rec !== current) switchTo(rec);
    });

    const del = document.createElement('button');
    del.className = 'tool small';
    del.textContent = '🗑️';
    del.title = 'Supprimer';
    del.setAttribute('aria-label', 'Supprimer cet enregistrement');
    del.addEventListener('click', () => {
      if (!confirm('Supprimer l\'enregistrement du ' + formatDate(rec.start) + ' ?')) return;
      recordings = recordings.filter((r) => r !== rec);
      if (rec.audioId && audioApi()) audioApi().remove(rec.audioId);
      if (rec === current) switchTo(recordings[0] || newRecording());
      else persist();
      renderHistory();
    });

    li.append(open, del);
    els.historyList.appendChild(li);
  }
}

els.history.addEventListener('click', () => {
  renderHistory();
  els.historyDialog.showModal();
});
els.closeHistory.addEventListener('click', () => els.historyDialog.close());
els.historyDialog.addEventListener('click', (e) => {
  if (e.target === els.historyDialog) els.historyDialog.close(); // clic hors de la fenêtre
});
els.stamps.addEventListener('change', () => store.set(STORE_STAMPS, els.stamps.checked ? '1' : ''));

// ---------- Actions ----------
const STORE_MODE = 'voixtexte.mode';
let mode = store.get(STORE_MODE) === 'audio' ? 'audio' : 'text';
function setMode(m) {
  if (isBusy()) return toast('Arrêtez d\'abord l\'enregistrement en cours');
  mode = m;
  store.set(STORE_MODE, m);
  document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  els.mic.classList.toggle('audio-mode', m === 'audio');
  els.mic.setAttribute('aria-label', m === 'audio' ? 'Démarrer l\'enregistrement audio' : 'Démarrer la transcription');
  // La dictée a besoin de la reconnaissance vocale ; l'enregistrement audio, de MediaRecorder.
  const ok = m === 'audio' ? Boolean(window.MediaRecorder && navigator.mediaDevices) : Boolean(SpeechRecognition);
  els.mic.disabled = !ok;
  els.unsupported.hidden = ok || m === 'audio';
  if (isBusy()) return;
  if (!ok) setStatus(m === 'audio' ? 'Enregistrement audio non pris en charge' : 'Dictée non prise en charge');
  else setStatus(m === 'audio' ? 'Mode audio : appuyez sur le micro pour enregistrer' : 'Prêt');
}
document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

els.mic.addEventListener('click', () => {
  if (audioApi() && audioApi().isRecording()) return VTAudio.stop();
  if (listening) return stop();
  if (mode === 'audio') return VTAudio.start();
  start();
  if (listening) {
    if (VTReport.settings().blackout) mask();
    else els.maskBtn.hidden = false;
  }
});

els.lang.addEventListener('change', () => {
  store.set(STORE_LANG, els.lang.value);
  if (listening) {
    stop();
    setTimeout(start, 300);
  }
});

els.newRec.addEventListener('click', () => {
  if (!current.segments.length) return toast('Enregistrement déjà vide');
  switchTo(newRecording());
  toast('Nouvel enregistrement — l\'ancien est dans 📚');
});

els.copy.addEventListener('click', async () => {
  const text = exportText();
  if (!text) return toast('Rien à copier');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Texte copié');
});

els.share.addEventListener('click', async () => {
  const text = exportText();
  if (!text) return toast('Rien à partager');
  if (navigator.share) {
    try { await navigator.share({ title: 'Transcription du ' + formatDate(current.start), text }); } catch { /* annulé */ }
  } else {
    toast('Partage non disponible, utilisez Copier');
  }
});

els.download.addEventListener('click', () => {
  const text = exportText();
  if (!text) return toast('Rien à télécharger');
  const d = new Date(current.start);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `transcription-${stamp}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Le verrou d'écran est libéré quand l'appli passe en arrière-plan : on le reprend au retour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && listening) {
    requestWakeLock();
    try { recognition.start(); } catch { /* déjà active */ }
  }
});

// ---------- Initialisation ----------
const savedLang = store.get(STORE_LANG);
if (savedLang && [...els.lang.options].some((o) => o.value === savedLang)) {
  els.lang.value = savedLang;
}
els.stamps.checked = store.get(STORE_STAMPS) === '1';

if (!SpeechRecognition) {
  els.unsupported.hidden = false;
  els.mic.disabled = true;
  setStatus('Non pris en charge');
} else if (!window.isSecureContext) {
  setStatus('Ouvrez l\'appli en HTTPS pour accéder au micro.');
}

store.set(STORE_CURRENT, current.id);
render();

// Accès pour le module compte-rendu (report.js).
window.VT = {
  get current() { return current; },
  persist, toast, formatDate, formatTime, formatStamp, segmentText, recordingText,
  isListening: () => listening,
  get recordings() { return recordings; },
  newRecording, switchTo, addSegment, render, setStatus, mask, unmask, requestWakeLock, releaseWakeLock,
  lang: () => els.lang.value,
  setMaskBtn: (show) => { els.maskBtn.hidden = !show; },
};
VTReport.init();
setMode(mode);

// Raccourcis de l'icône (appui long sur Android) : ?action=nouveau | compte-rendu
(() => {
  const action = new URLSearchParams(location.search).get('action');
  if (!action) return;
  history.replaceState(null, '', location.pathname); // pas de répétition au rechargement
  if (action === 'nouveau' && current.segments.length) switchTo(newRecording());
  if (action === 'compte-rendu') document.getElementById('report').click();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
