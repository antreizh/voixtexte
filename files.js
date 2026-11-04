'use strict';

/*
 * Onglet « Fichiers » de la fenêtre 📚 : liste des fichiers son (enr_…) et des comptes-rendus
 * (cr_…) enregistrés, avec date et heure ; sélection multiple pour consulter, partager ou supprimer.
 */
const VTFiles = (() => {
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDur = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600);
    return (h ? h + ' h ' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ' min ' + pad(s % 60) + ' s';
  };
  const fmtSize = (b) => (b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' Ko' : (b / 1048576).toFixed(1) + ' Mo');
  const fmtWhen = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' + VT.formatTime(ms);
  };

  let entries = [];          // fichiers affichés
  const selected = new Set(); // clés sélectionnées
  let filter = 'all';
  let live = null;          // rafraîchissement pendant une retranscription
  let wasRunning = false;

  // Rassemble les fichiers son (base locale) et les comptes-rendus (liés aux enregistrements).
  async function load() {
    const list = [];
    let metas = [];
    try { metas = await VTAudio.list(); } catch { /* base indisponible */ }
    for (const m of metas) {
      const rec = VT.recordings.find((r) => r.audioId === m.id) || null;
      const n = rec ? rec.segments.length : 0;
      list.push({
        key: 'enr:' + m.id, type: 'enr', name: m.name, file: VTAudio.fileName(m), start: m.start,
        detail: `Son · ${fmtDur(m.duration)} · ${fmtSize(m.size)}` + (m.recovered ? ' · récupéré' : '') +
          (m.imported ? ` · importé (${m.source})` : '') +
          (n ? ` · ✓ texte (${n} phrase${n > 1 ? 's' : ''})` : ' · non retranscrit'),
        comment: m.comment || '',
        meta: m, rec,
      });
    }
    // Textes retranscrits : retrans_n_jjmmaa_hhmmss (n = % du son retranscrit ; 100 pour une dictée).
    for (const rec of VT.recordings) {
      const busy = VTAudio.isTranscribing() && VT.current === rec && rec.audioId;
      if (!rec.segments.length && !busy && rec.transPct == null) continue;
      const pct = rec.audioId ? Math.max(0, Math.min(100, rec.transPct ?? (rec.segments.length ? 100 : 0))) : 100;
      const name = transName(rec, pct);
      const n = rec.segments.length;
      list.push({
        key: 'retrans:' + rec.id, type: 'retrans', name, file: name + '.txt', start: rec.start,
        detail: `Texte · ${n} phrase${n > 1 ? 's' : ''} · ` +
          (rec.audioId ? (busy ? `retranscription en cours (${pct} %)` : `${pct} % du son ${rec.audioName || ''} retranscrit`) : 'dictée en direct'),
        comment: rec.transComment || '', rec,
      });
    }
    for (const rec of VT.recordings) {
      if (!rec.report) continue;
      const name = VTReport.crName(rec);
      list.push({
        key: 'cr:' + rec.id, type: 'cr', name, file: name + '.docx', start: rec.start,
        detail: 'Compte-rendu · ' + (rec.report.title || 'sans titre'), rec,
        comment: rec.report.comment || '',
      });
    }
    // Du plus récent au plus ancien ; pour une même source, le son avant son compte-rendu.
    const order = { enr: 0, retrans: 1, cr: 2 };
    entries = list.sort((a, b) => b.start - a.start || order[a.type] - order[b.type]);
    for (const k of [...selected]) if (!entries.some((e) => e.key === k)) selected.delete(k);
  }

  // retrans_n_jjmmaa_hhmmss (année sur deux chiffres)
  function transName(rec, pct) {
    const d = new Date(rec.start);
    return `retrans_${pct}_${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  const visible = () => entries.filter((e) => filter === 'all' || e.type === filter);

  function render() {
    const ul = $('filesList');
    ul.replaceChildren();
    const list = visible();
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = filter === 'cr' ? 'Aucun compte-rendu.' : filter === 'enr' ? 'Aucun fichier son.' : 'Aucun fichier enregistré.';
      ul.appendChild(li);
    }
    for (const e of list) {
      const li = document.createElement('li');
      li.classList.toggle('selected', selected.has(e.key));
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected.has(e.key);
      box.setAttribute('aria-label', 'Sélectionner ' + e.name);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(e.key); else selected.delete(e.key);
        li.classList.toggle('selected', box.checked);
        updateBar();
      });
      const icon = document.createElement('span');
      icon.className = 'ficon';
      icon.textContent = e.type === 'enr' ? '🔊' : e.type === 'retrans' ? '📝' : '📄';
      const info = document.createElement('span');
      info.className = 'finfo';
      const name = document.createElement('strong');
      name.textContent = e.name;
      const when = document.createElement('span');
      when.textContent = fmtWhen(e.start);
      const detail = document.createElement('span');
      detail.textContent = e.detail;
      info.append(name, when, detail);
      if (e.comment) {
        const c = document.createElement('em');
        c.className = 'fcomment';
        c.textContent = '💬 ' + e.comment;
        info.appendChild(c);
      }
      label.append(box, icon, info);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'tool small fedit';
      edit.textContent = '💬';
      edit.title = e.comment ? 'Modifier le commentaire' : 'Ajouter un commentaire';
      edit.setAttribute('aria-label', edit.title + ' de ' + e.name);
      edit.addEventListener('click', () => editComment(e));
      li.append(label, edit);
      ul.appendChild(li);
    }
    updateBar();
  }

  function selection() {
    return entries.filter((e) => selected.has(e.key));
  }

  function updateBar() {
    const sel = selection();
    const n = sel.length;
    $('filesCount').textContent = n ? `${n} fichier${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}` : 'Aucun fichier sélectionné';
    $('filesOpen').disabled = n !== 1;
    // Retranscription : un seul fichier son à la fois.
    // Pendant une retranscription, le bouton sert à l'arrêter.
    const running = VTAudio.isTranscribing();
    $('filesTranscribe').textContent = running ? '⏹ Arrêter la retranscription' : '📝 Retranscrire';
    $('filesTranscribe').disabled = !running && !(n === 1 && sel[0].type === 'enr');
    $('filesShare').disabled = !n;
    $('filesDelete').disabled = !n;
    const vis = visible();
    const all = $('filesAll');
    all.checked = vis.length > 0 && vis.every((e) => selected.has(e.key));
    all.indeterminate = !all.checked && vis.some((e) => selected.has(e.key));
  }

  async function refresh() {
    await load();
    render();
  }

  // ---------- Commentaire (300 caractères) ----------
  const MAX = 300;
  function editComment(e) {
    const dlg = $('commentDialog');
    const ta = $('commentText');
    $('commentFile').textContent = e.name;
    ta.value = e.comment;
    const count = () => { $('commentCount').textContent = `${ta.value.length} / ${MAX}`; };
    ta.oninput = count;
    count();
    $('commentSave').onclick = async () => {
      const text = ta.value.trim().slice(0, MAX);
      if (e.type === 'enr') {
        await VTAudio.setComment(e.meta.id, text);
      } else if (e.type === 'retrans') {
        e.rec.transComment = text;
        VT.persist();
      } else {
        e.rec.report.comment = text;
        VT.persist();
      }
      dlg.close();
      VT.toast(text ? 'Commentaire enregistré' : 'Commentaire supprimé');
      await refresh();
    };
    $('commentCancel').onclick = () => dlg.close();
    dlg.showModal();
    ta.focus();
  }

  // ---------- Actions ----------
  // Ouvre l'enregistrement d'un fichier son (en le recréant s'il avait été supprimé).
  function openSound(e) {
    let rec = e.rec;
    if (!rec) {
      rec = VT.newRecording();
      rec.start = e.meta.start;
      rec.audioId = e.meta.id;
      rec.audioName = e.meta.name;
    }
    $('historyDialog').close();
    VT.switchTo(rec);
    setTimeout(() => { const p = $('audioPanel'); if (p) p.scrollIntoView({ block: 'start' }); }, 300);
  }

  function consult() {
    const [e] = selection();
    if (!e) return;
    if (e.type === 'cr') {
      VTReport.preview(e.rec); // s'ouvre par-dessus la liste
      return;
    }
    if (e.type === 'retrans') {
      showText(e); // fenêtre de lecture, par-dessus la liste
      return;
    }
    openSound(e); // lecteur, retranscription, compte-rendu
  }

  // Lecture d'un texte retranscrit, même partiel, avec heures (et traductions éventuelles).
  function showText(e) {
    const rec = e.rec;
    $('textTitle').textContent = e.name;
    $('textInfo').textContent = e.detail + ' · ' + fmtWhen(rec.start);
    const body = $('textBody');
    body.replaceChildren();
    if (!rec.segments.length) {
      body.textContent = 'Aucune phrase n\'a encore été retranscrite.';
    }
    for (const s of rec.segments) {
      const line = document.createElement('p');
      const t = document.createElement('span');
      t.className = 'tv-time';
      t.textContent = VT.formatTime(s.t);
      if (s.tr) {
        const src = document.createElement('span'); // retranscription repérée par sa langue ; traduction en italique
        src.className = 'tv-src';
        if (s.trFrom) src.dataset.lang = s.trFrom.toUpperCase();
        src.textContent = VT.lineText(rec, s);
        const tr = document.createElement('span');
        tr.className = 'tv-tr';
        tr.textContent = '🇫🇷 ' + s.tr;
        line.append(t, ' ', src, document.createElement('br'), tr);
      } else {
        line.append(t, ' ' + VT.lineText(rec, s));
      }
      body.appendChild(line);
    }
    $('textOpen').onclick = () => { $('textDialog').close(); $('historyDialog').close(); VT.switchTo(rec); };
    $('textShare').onclick = async () => {
      const f = await toFile(e);
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        try { await navigator.share({ files: [f], title: e.name }); return; } catch (err) { if (err.name === 'AbortError') return; }
      }
      download([f]);
    };
    $('textClose').onclick = () => $('textDialog').close();
    $('textDialog').showModal();
  }

  // Retranscrit à la demande le fichier son choisi (texte affiché au fur et à mesure).
  function transcribeSelected() {
    const [e] = selection();
    if (VTAudio.isTranscribing()) {
      VTAudio.cancelTranscription();
      VT.toast('Retranscription arrêtée');
      setTimeout(refresh, 1500);
      return;
    }
    if (!e || e.type !== 'enr') return;
    if (VTAudio.isRecording() || VT.isListening()) return VT.toast('Arrêtez d\'abord l\'enregistrement en cours');
    openSound(e);
    VTAudio.transcribe(); // demande confirmation si le fichier a déjà un texte
  }

  async function toFile(e) {
    if (e.type === 'enr') return new File([e.meta.blob], e.file, { type: e.meta.blob.type || e.meta.mime });
    if (e.type === 'retrans') {
      return new File([VT.recordingText(e.rec, $('stamps').checked) + '\n'], e.file, { type: 'text/plain;charset=utf-8' });
    }
    const blob = await VTReport.toDocx(e.rec.report, e.rec);
    return new File([blob], e.file, { type: blob.type });
  }

  async function share() {
    const sel = selection();
    if (!sel.length) return;
    const btn = $('filesShare');
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const files = [];
      for (const e of sel) files.push(await toFile(e));
      if (navigator.canShare && navigator.canShare({ files })) {
        try {
          await navigator.share({ files, title: files.length === 1 ? files[0].name : files.length + ' fichiers VTS' });
        } catch (err) {
          if (err.name !== 'AbortError') download(files); // partage impossible : on enregistre
        }
      } else {
        download(files);
      }
    } catch (err) {
      alert('Partage impossible : ' + err.message);
    } finally {
      btn.textContent = '📤 Partager';
      updateBar();
    }
  }

  // Repli : enregistre les fichiers dans le téléphone (Téléchargements), l'un après l'autre.
  function download(files) {
    files.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, i * 400));
    VT.toast(files.length > 1 ? `${files.length} fichiers enregistrés dans les Téléchargements` : files[0].name + ' enregistré');
  }

  async function remove() {
    const sel = selection();
    if (!sel.length) return;
    const names = sel.map((e) => '• ' + e.name).slice(0, 8).join('\n') + (sel.length > 8 ? `\n… et ${sel.length - 8} autre(s)` : '');
    if (!confirm(`Supprimer définitivement ${sel.length > 1 ? 'ces ' + sel.length + ' fichiers' : 'ce fichier'} ?\n\n${names}`)) return;
    for (const e of sel) {
      const rec = e.rec;
      if (e.type === 'enr') {
        await VTAudio.remove(e.meta.id);
        if (rec) { delete rec.audioId; delete rec.audioName; }
      } else if (e.type === 'retrans' && rec) {
        if (VTAudio.isTranscribing() && VT.current === rec) VTAudio.cancelTranscription();
        rec.segments = [];
        delete rec.transPct;
        delete rec.transComment;
      } else if (rec) {
        delete rec.report;
      }
      // Enregistrement devenu vide (ni texte, ni son, ni compte-rendu) : supprimé aussi.
      if (rec && !rec.segments.length && !rec.audioId && !rec.report && VT.recordings.includes(rec)) VT.deleteRecording(rec);
      selected.delete(e.key);
    }
    VT.persist();
    VT.render();
    VT.toast(sel.length > 1 ? `${sel.length} fichiers supprimés` : 'Fichier supprimé');
    await refresh();
  }

  // ---------- Onglets et filtres ----------
  function showTab(id) {
    document.querySelectorAll('#historyDialog .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    $('tabRecs').hidden = id !== 'tabRecs';
    $('tabFiles').hidden = id !== 'tabFiles';
    if (id === 'tabFiles') { selected.clear(); refresh(); } // sélection vide à chaque ouverture
    // Pendant une retranscription, la liste suit l'avancement (pourcentage).
    clearInterval(live);
    if (id === 'tabFiles') {
      live = setInterval(() => {
        if (!$('historyDialog').open || $('tabFiles').hidden) return clearInterval(live);
        if (VTAudio.isTranscribing() || wasRunning) refresh();
        wasRunning = VTAudio.isTranscribing();
      }, 2000);
    }
  }

  document.querySelectorAll('#historyDialog .tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  document.querySelectorAll('.file-filters button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.file-filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
  $('filesAll').addEventListener('change', (ev) => {
    for (const e of visible()) { if (ev.target.checked) selected.add(e.key); else selected.delete(e.key); }
    render();
  });
  // Import de fichiers son depuis n'importe quel dossier du téléphone.
  $('filesImport').addEventListener('click', () => $('filesImportInput').click());
  $('filesImportInput').addEventListener('change', async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = ''; // permet de rechoisir le même fichier
    if (!files.length) return;
    const btn = $('filesImport');
    btn.disabled = true;
    btn.textContent = '⏳ Import…';
    const added = [], errors = [];
    for (const f of files) {
      try { added.push(await VTAudio.importFile(f)); } catch (err) { errors.push(err.message); }
    }
    btn.disabled = false;
    btn.textContent = '📂 Importer un son';
    selected.clear();
    added.forEach((m) => selected.add('enr:' + m.id)); // prêts pour « Retranscrire »
    filter = 'all';
    document.querySelectorAll('.file-filters button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.filter === 'all')));
    await refresh();
    if (added.length) VT.toast(added.length > 1 ? `${added.length} fichiers son importés` : `Importé : ${added[0].name} — touchez « Retranscrire »`);
    if (errors.length) alert('Import impossible :\n• ' + errors.join('\n• '));
  });

  $('filesOpen').addEventListener('click', consult);
  $('filesTranscribe').addEventListener('click', transcribeSelected);
  $('filesShare').addEventListener('click', share);
  $('filesDelete').addEventListener('click', remove);
  // La fenêtre 📚 s'ouvre toujours sur l'onglet Enregistrements.
  $('history').addEventListener('click', () => showTab('tabRecs'));

  return { refresh, showTab };
})();
