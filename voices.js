'use strict';

/*
 * Distinction des voix pendant la dictée en direct.
 *
 * La reconnaissance vocale du navigateur ne dit pas qui parle. On ouvre donc le micro une
 * seule fois : le flux alimente la reconnaissance (start(track)) ET une analyse locale du son.
 * Pour chaque phrase, on mesure la hauteur de la voix (fondamentale) et son timbre (centroïde
 * spectral), puis on rattache la phrase à la voix connue la plus proche, ou à une nouvelle voix.
 * C'est une estimation : fiable entre voix graves et aiguës, moins entre voix très proches.
 */
const VTVoices = (() => {
  const MAX_VOICES = 6;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // start(MediaStreamTrack) est arrivé dans Chrome avec SpeechRecognition.available.
  const supported = () => Boolean(SR && typeof SR.available === 'function' && window.AudioContext &&
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  // ---------- Analyse du son ----------
  class Tracker {
    constructor(stream) {
      this.stream = stream;
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.ctx.createMediaStreamSource(stream).connect(this.analyser);
      this.time = new Float32Array(this.analyser.fftSize);
      this.freq = new Float32Array(this.analyser.frequencyBinCount);
      this.frames = [];
      this.floor = 0.01;
      this.timer = setInterval(() => this.sample(), 50);
    }

    sample() {
      const a = this.analyser;
      a.getFloatTimeDomainData(this.time);
      let e = 0;
      for (let i = 0; i < this.time.length; i++) e += this.time[i] * this.time[i];
      const rms = Math.sqrt(e / this.time.length);
      // Bruit de fond estimé en continu : on ne garde que les instants où quelqu'un parle.
      this.floor = rms < this.floor ? rms : this.floor * 1.003;
      if (rms < Math.max(0.008, this.floor * 2.5)) return;
      this.voiced = (this.voiced || 0) + 1; // activité vocale détectée (contrôle de bon fonctionnement)
      const f0 = this.pitch(this.ctx.sampleRate);
      if (!f0) return;
      a.getFloatFrequencyData(this.freq);
      const binHz = this.ctx.sampleRate / a.fftSize;
      let num = 0, den = 0;
      for (let i = Math.floor(100 / binHz); i < Math.min(this.freq.length, 5000 / binHz); i++) {
        const m = Math.pow(10, this.freq[i] / 20);
        num += m * i * binHz;
        den += m;
      }
      this.frames.push({ f0, cen: den ? num / den : 0 });
      if (this.frames.length > 1500) this.frames.shift(); // ~1 min au plus entre deux phrases
    }

    // Fréquence fondamentale par autocorrélation normalisée (voix : 70–400 Hz).
    // Calcul sur un échantillon sur deux : précision suffisante, deux fois moins de calcul.
    pitch(fullRate) {
      const n = this.time.length >> 1;
      const x = this.half || (this.half = new Float32Array(n));
      for (let i = 0; i < n; i++) x[i] = (this.time[2 * i] + this.time[2 * i + 1]) / 2;
      const rate = fullRate / 2;
      const minLag = Math.floor(rate / 400), maxLag = Math.min(n - 1, Math.floor(rate / 70));
      let best = 0, bestLag = 0;
      let e0 = 0;
      for (let i = 0; i < n - maxLag; i++) e0 += x[i] * x[i];
      for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0, e1 = 0;
        for (let i = 0; i < n - maxLag; i++) { c += x[i] * x[i + lag]; e1 += x[i + lag] * x[i + lag]; }
        const r = c / Math.sqrt(e0 * e1 + 1e-12);
        if (r > best) { best = r; bestLag = lag; }
      }
      return best > 0.55 && bestLag ? rate / bestLag : 0;
    }

    take() {
      const f = this.frames;
      this.frames = [];
      return f;
    }

    close() {
      clearInterval(this.timer);
      this.stream.getTracks().forEach((t) => t.stop());
      this.ctx.close().catch(() => {});
    }
  }

  // ---------- Regroupement par voix ----------
  const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const semis = (f) => 12 * Math.log2(f / 55);    // hauteur en demi-tons
  const octs = (c) => Math.log2(Math.max(c, 1)); // timbre (octaves)

  // Rattache une phrase à une voix de l'enregistrement ; renvoie son numéro (1, 2…) ou null.
  function assign(rec, frames) {
    if (frames.length < 4) return rec.lastVoice || null; // trop court pour juger
    const p = median(frames.map((f) => semis(f.f0)));
    const c = median(frames.map((f) => octs(f.cen)));
    rec.voices = rec.voices || [];
    let best = -1, bestD = Infinity;
    rec.voices.forEach((v, i) => {
      const d = Math.abs(v.p - p) + 3 * Math.abs(v.c - c);
      if (d < bestD) { bestD = d; best = i; }
    });
    let idx;
    if (best >= 0 && (bestD < 3.5 || rec.voices.length >= MAX_VOICES)) {
      idx = best;
      const v = rec.voices[idx];
      const w = Math.min(v.n, 20); // moyenne glissante : la voix peut varier un peu
      v.p = (v.p * w + p) / (w + 1);
      v.c = (v.c * w + c) / (w + 1);
      v.n++;
    } else {
      rec.voices.push({ p, c, n: 1 });
      idx = rec.voices.length - 1;
    }
    rec.lastVoice = idx + 1;
    return idx + 1;
  }

  // ---------- Session de dictée ----------
  let tracker = null;

  // Ouvre le micro et renvoie la piste à donner à la reconnaissance (ou null si indisponible).
  async function open() {
    if (!supported()) return null;
    close();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    tracker = new Tracker(stream);
    await tracker.ctx.resume().catch(() => {});
    return stream.getAudioTracks()[0];
  }

  function close() {
    if (tracker) { tracker.close(); tracker = null; }
  }

  // Voix de la phrase qui vient d'être reconnue.
  function voiceFor(rec) {
    if (!tracker) return null;
    return assign(rec, tracker.take());
  }

  // Nom affiché d'une voix (renommable par l'utilisateur).
  function label(rec, n) {
    return (rec.voiceNames && rec.voiceNames[n]) || 'Voix ' + n;
  }

  // Nombre de voix distinctes réellement présentes dans le texte.
  function count(rec) {
    return new Set(rec.segments.map((s) => s.voice).filter(Boolean)).size;
  }

  return { supported, open, close, voiceFor, label, count, assign, isOpen: () => Boolean(tracker),
    activity: () => (tracker ? tracker.voiced || 0 : 0) };
})();
