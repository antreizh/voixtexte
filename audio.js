'use strict';

/*
 * Enregistrement audio de VTS.
 *  - Le son du micro est enregistré (MediaRecorder) et sauvegardé sur l'appareil (IndexedDB),
 *    par morceaux de 5 s : une coupure (batterie, appli fermée) ne fait perdre que quelques secondes.
 *  - Fichier nommé « Enr_hh:mn:ss » d'après l'heure de début, exportable dans le téléphone.
 *  - Sur demande : retranscription du fichier en texte (moteur vocal du navigateur, alimenté
 *    par le son du fichier), puis compte-rendu.
 */
const VTAudio = (() => {
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDur = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad(s % 60);
  };
  const fileName = (meta) => meta.name + '.' + (/mp4|m4a|aac/.test(meta.mime) ? 'm4a' : /ogg/.test(meta.mime) ? 'ogg' : 'webm');

  // ---------- Base locale (IndexedDB) ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('vts-audio', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('audio', { keyPath: 'id' });            // métadonnées + fichier final
          const c = d.createObjectStore('chunks', { autoIncrement: true }); // morceaux en cours
          c.createIndex('audioId', 'audioId');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(stores, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const getMeta = (id) => tx(['audio'], 'readonly', (t) => reqP(t.objectStore('audio').get(id)));
  const putMeta = (m) => tx(['audio'], 'readwrite', (t) => { t.objectStore('audio').put(m); });
  const addChunk = (audioId, idx, blob) => tx(['chunks'], 'readwrite', (t) => { t.objectStore('chunks').add({ audioId, idx, blob }); });
  async function takeChunks(audioId) {
    return tx(['chunks'], 'readwrite', async (t) => {
      const idx = t.objectStore('chunks').index('audioId');
      const rows = await reqP(idx.getAll(audioId));
      const keys = await reqP(idx.getAllKeys(audioId));
      keys.forEach((k) => t.objectStore('chunks').delete(k));
      return rows.sort((a, b) => a.idx - b.idx).map((r) => r.blob);
    });
  }
  async function remove(id) {
    try {
      await takeChunks(id);
      await tx(['audio'], 'readwrite', (t) => { t.objectStore('audio').delete(id); });
    } catch { /* déjà supprimé */ }
  }

  // ---------- Enregistrement ----------
  let rec = null; // { stream, mr, meta, chunks, timer, target }

  function pickMime() {
    for (const t of ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  async function start() {
    if (rec) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      VT.setStatus(e.name === 'NotAllowedError' ? 'Accès au micro refusé. Autorisez le micro dans les réglages du navigateur.' : 'Micro indisponible : ' + e.message);
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    // Chaque fichier son a son propre enregistrement (texte + compte-rendu associés).
    const cur = VT.current;
    if (cur.segments.length || cur.audioId) VT.switchTo(VT.newRecording());
    const target = VT.current;

    const startMs = Date.now();
    const mime = pickMime();
    const meta = {
      id: 'a' + startMs.toString(36),
      name: 'Enr_' + VT.formatTime(startMs), // Enr_hh:mn:ss
      start: startMs, mime: mime || 'audio/webm', duration: 0, size: 0, status: 'recording',
    };
    target.start = startMs;
    target.audioId = meta.id;
    target.audioName = meta.name;
    VT.persist();
    await putMeta(meta);

    let mr;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    } catch {
      mr = new MediaRecorder(stream);
    }
    meta.mime = mr.mimeType || meta.mime;
    const chunks = [];
    let idx = 0;
    mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      chunks.push(e.data);
      addChunk(meta.id, idx++, e.data).catch(() => {}); // sauvegarde au fil de l'eau
    };
    rec = { stream, mr, meta, chunks, target, startMs };
    mr.onstop = () => finish(rec).catch((err) => VT.setStatus('Erreur de sauvegarde : ' + err.message));
    mr.start(5000);

    rec.timer = setInterval(tick, 1000);
    tick();
    $('mic').setAttribute('aria-pressed', 'true');
    $('mic').setAttribute('aria-label', 'Arrêter l\'enregistrement audio');
    VT.requestWakeLock();
    if (VTReport.settings().blackout) VT.mask();
    else VT.setMaskBtn(true);
    VT.render();
  }

  function tick() {
    if (!rec) return;
    VT.setStatus(`⏺️ ${rec.meta.name} · ${fmtDur((Date.now() - rec.startMs) / 1000)}`, true);
  }

  function stop() {
    if (!rec || rec.mr.state === 'inactive') return;
    rec.mr.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    clearInterval(rec.timer);
    $('mic').setAttribute('aria-pressed', 'false');
    $('mic').setAttribute('aria-label', 'Démarrer l\'enregistrement audio');
    VT.releaseWakeLock();
    VT.setStatus('Sauvegarde du fichier son…');
  }

  async function finish(r) {
    const { meta, chunks } = r;
    meta.duration = (Date.now() - r.startMs) / 1000;
    const blob = new Blob(chunks, { type: meta.mime });
    meta.blob = blob;
    meta.size = blob.size;
    meta.status = 'done';
    await putMeta(meta);
    await takeChunks(meta.id); // morceaux devenus inutiles
    rec = null;
    VT.unmask();
    VT.setMaskBtn(false);
    VT.setStatus(`✓ ${meta.name} enregistré (${fmtDur(meta.duration)})`);
    if (VTReport.settings().autoExport) exportFile(meta, false);
    VT.render();
    afterRecording(r.target, meta);
  }

  // Après l'enregistrement : proposer la retranscription.
  function afterRecording(target, meta) {
    const dlg = $('afterRecDialog');
    $('afterRecText').textContent = `${meta.name} est sauvegardé (${fmtDur(meta.duration)}).`;
    $('afterRecGo').onclick = () => { dlg.close(); if (VT.current !== target) VT.switchTo(target); transcribe(); };
    $('afterRecLater').onclick = () => dlg.close();
    dlg.showModal();
  }

  // Récupération d'un enregistrement interrompu (appli fermée, batterie…).
  async function recover() {
    try {
      const metas = await tx(['audio'], 'readonly', (t) => reqP(t.objectStore('audio').getAll()));
      for (const m of metas) {
        if (m.status !== 'recording' || (rec && rec.meta.id === m.id)) continue;
        const parts = await takeChunks(m.id);
        if (!parts.length) { await remove(m.id); continue; }
        m.blob = new Blob(parts, { type: m.mime });
        m.size = m.blob.size;
        m.duration = parts.length * 5; // estimation (morceaux de 5 s)
        m.status = 'done';
        m.recovered = true;
        await putMeta(m);
        if (!VT.recordings.some((r) => r.audioId === m.id)) {
          const r = VT.newRecording();
          r.start = m.start; r.audioId = m.id; r.audioName = m.name;
          VT.persist();
        }
        VT.toast(`${m.name} récupéré après une interruption`);
        VT.render();
      }
    } catch { /* IndexedDB indisponible */ }
  }

  // ---------- Fichier : export / partage ----------
  function exportFile(meta, share) {
    const name = fileName(meta);
    if (share) {
      const file = new File([meta.blob], name, { type: meta.blob.type || meta.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: meta.name }).catch(() => {});
        return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(meta.blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    VT.toast(meta.name + ' exporté dans les Téléchargements');
  }

  // ---------- Panneau du fichier son de l'enregistrement affiché ----------
  let shownId = null;
  let shownUrl = null;
  async function renderPanel() {
    const r = VT.current;
    const panel = $('audioPanel');
    if (!r.audioId || (rec && rec.meta.id === r.audioId)) {
      panel.hidden = true;
      return;
    }
    if (shownId === r.audioId) { panel.hidden = false; return; }
    const meta = await getMeta(r.audioId).catch(() => null);
    if (VT.current !== r) return; // l'utilisateur a changé d'enregistrement entre-temps
    if (!meta || !meta.blob) { panel.hidden = true; return; }
    shownId = r.audioId;
    if (shownUrl) URL.revokeObjectURL(shownUrl);
    shownUrl = URL.createObjectURL(meta.blob);
    const player = $('audioPlayer');
    player.src = shownUrl;
    fixDuration(player);
    $('audioName').textContent = meta.name;
    $('audioInfo').textContent = ` · ${fmtDur(meta.duration)} · ${meta.size < 1048576 ? Math.max(1, Math.round(meta.size / 1024)) + ' Ko' : (meta.size / 1048576).toFixed(1) + ' Mo'}` + (meta.recovered ? ' · récupéré' : '');
    $('audioSave').onclick = () => exportFile(meta, false);
    $('audioShare').onclick = () => exportFile(meta, true);
    $('audioTranscribe').hidden = false;
    panel.hidden = false;
  }

  // Les fichiers WebM de Chrome n'indiquent pas leur durée : on la force pour pouvoir avancer.
  function fixDuration(player) {
    player.onloadedmetadata = () => {
      if (player.duration !== Infinity) return;
      player.currentTime = 1e101;
      player.ontimeupdate = () => { player.ontimeupdate = null; player.currentTime = 0; };
    };
  }

  // ---------- Retranscription du fichier ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // La reconnaissance d'un flux audio (et non du micro) est arrivée avec SpeechRecognition.available.
  const canTranscribe = () => Boolean(SR && typeof SR.available === 'function' && window.AudioContext);
  let job = null;

  async function transcribe() {
    const target = VT.current;
    if (!target.audioId) return;
    if (job) return cancel();
    if (!canTranscribe()) {
      alert('La retranscription d\'un fichier son n\'est pas disponible dans ce navigateur. Utilisez Chrome à jour sur Android ou sur ordinateur. Le fichier son reste disponible.');
      return;
    }
    if (VT.isListening() || rec) return VT.toast('Arrêtez d\'abord l\'enregistrement en cours');
    if (target.segments.length && !confirm('Ce fichier a déjà un texte. Le remplacer par une nouvelle retranscription ?')) return;

    const ctx = new AudioContext(); // créé pendant le geste de l'utilisateur
    const meta = await getMeta(target.audioId);
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(await meta.blob.arrayBuffer());
    } catch {
      ctx.close();
      alert('Fichier son illisible.');
      return;
    }
    target.segments = [];
    delete target.report;
    VT.persist();
    VT.render();

    const lang = VT.lang();
    let local = false;
    try { local = (await SR.available({ langs: [lang], processLocally: true })) === 'available'; } catch { /* inconnu */ }

    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest); // pas vers les haut-parleurs : lecture silencieuse
    const track = dest.stream.getAudioTracks()[0];

    job = { ctx, src, track, target, done: false, t0: 0, duration: buffer.duration, r: null };
    const r = new SR();
    job.r = r;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    if (local) r.processLocally = true;
    let saved = new Set();
    r.onstart = () => { saved = new Set(); };
    r.onresult = (ev) => {
      let interim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) {
          if (!saved.has(i)) {
            saved.add(i);
            const t = meta.start + Math.max(0, ctx.currentTime - job.t0) * 1000;
            VT.addSegment(target, res[0].transcript, Math.round(t));
          }
        } else interim += res[0].transcript;
      }
      if (VT.current === target) VT.render(interim.trim());
    };
    r.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      job.error = ev.error;
    };
    r.onend = () => {
      if (!job) return;
      if (job.done || job.error) return endJob();
      try { r.start(track); } catch { /* relance */ } // le moteur coupe après un silence : on reprend
    };

    src.onended = () => {
      // Laisser au moteur le temps de rendre la dernière phrase.
      setTimeout(() => { if (job) { job.done = true; try { r.stop(); } catch { endJob(); } } }, 2500);
    };

    $('audioTranscribe').textContent = '⏹ Arrêter';
    $('audioProgress').hidden = false;
    VT.requestWakeLock();
    await ctx.resume();
    job.t0 = ctx.currentTime;
    src.start();
    r.start(track);
    job.timer = setInterval(progress, 500);
    progress();
  }

  function progress() {
    if (!job) return;
    const pos = Math.min(job.duration, job.ctx.currentTime - job.t0);
    $('audioProgress').querySelector('span').style.width = (100 * pos / job.duration).toFixed(1) + '%';
    $('audioProgress').querySelector('small').textContent =
      `Retranscription… ${fmtDur(pos)} / ${fmtDur(job.duration)} — environ ${fmtDur(job.duration - pos)} restantes. Gardez l'appli ouverte.`;
    VT.setStatus('Retranscription en cours…', true);
  }

  function cancel() {
    if (!job) return;
    job.cancelled = true;
    job.done = true;
    try { job.src.stop(); } catch { /* déjà arrêté */ }
    try { job.r.abort(); } catch { endJob(); }
  }

  function endJob() {
    if (!job) return;
    const { target, error, cancelled } = job;
    clearInterval(job.timer);
    try { job.ctx.close(); } catch { /* ignoré */ }
    job = null;
    VT.releaseWakeLock();
    $('audioTranscribe').textContent = '📝 Retranscrire';
    $('audioProgress').hidden = true;
    VT.persist();
    if (VT.current === target) VT.render();
    if (error) {
      VT.setStatus('Retranscription interrompue : ' + (error === 'network' ? 'connexion nécessaire' : error));
      return;
    }
    const n = target.segments.length;
    VT.setStatus(cancelled ? `Retranscription arrêtée (${n} phrases)` : `✓ Retranscription terminée (${n} phrases)`);
    if (!cancelled && n && confirm(`Retranscription terminée : ${n} phrase${n > 1 ? 's' : ''}.\n\nCréer le compte-rendu maintenant ?`)) {
      if (VT.current !== target) VT.switchTo(target);
      document.getElementById('report').click();
    }
  }

  // ---------- Initialisation ----------
  $('audioTranscribe').addEventListener('click', () => transcribe());
  recover().then(() => renderPanel());

  return {
    start, stop, remove, renderPanel, transcribe,
    isRecording: () => Boolean(rec),
    isTranscribing: () => Boolean(job),
  };
})();
