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

  // Rassemble les fichiers son (base locale) et les comptes-rendus (liés aux enregistrements).
  async function load() {
    const list = [];
    let metas = [];
    try { metas = await VTAudio.list(); } catch { /* base indisponible */ }
    for (const m of metas) {
      list.push({
        key: 'enr:' + m.id, type: 'enr', name: m.name, file: VTAudio.fileName(m), start: m.start,
        detail: `Son · ${fmtDur(m.duration)} · ${fmtSize(m.size)}` + (m.recovered ? ' · récupéré' : ''),
        meta: m, rec: VT.recordings.find((r) => r.audioId === m.id) || null,
      });
    }
    for (const rec of VT.recordings) {
      if (!rec.report) continue;
      const name = VTReport.crName(rec);
      list.push({
        key: 'cr:' + rec.id, type: 'cr', name, file: name + '.docx', start: rec.start,
        detail: 'Compte-rendu · ' + (rec.report.title || 'sans titre'), rec,
      });
    }
    // Du plus récent au plus ancien ; pour une même source, le son avant son compte-rendu.
    entries = list.sort((a, b) => b.start - a.start || (a.type === 'enr' ? -1 : 1));
    for (const k of [...selected]) if (!entries.some((e) => e.key === k)) selected.delete(k);
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
      icon.textContent = e.type === 'enr' ? '🔊' : '📄';
      const info = document.createElement('span');
      info.className = 'finfo';
      const name = document.createElement('strong');
      name.textContent = e.name;
      const when = document.createElement('span');
      when.textContent = fmtWhen(e.start);
      const detail = document.createElement('span');
      detail.textContent = e.detail;
      info.append(name, when, detail);
      label.append(box, icon, info);
      li.appendChild(label);
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

  // ---------- Actions ----------
  function consult() {
    const [e] = selection();
    if (!e) return;
    if (e.type === 'cr') {
      VTReport.preview(e.rec); // s'ouvre par-dessus la liste
      return;
    }
    // Fichier son : on ouvre son enregistrement (lecteur, retranscription, compte-rendu).
    let rec = e.rec;
    if (!rec) {
      rec = VT.newRecording();
      rec.start = e.meta.start;
      rec.audioId = e.meta.id;
      rec.audioName = e.meta.name;
    }
    $('historyDialog').close();
    VT.switchTo(rec);
    setTimeout(() => { const p = $('audioPlayer'); if (p) p.scrollIntoView({ block: 'center' }); }, 300);
  }

  async function toFile(e) {
    if (e.type === 'enr') return new File([e.meta.blob], e.file, { type: e.meta.blob.type || e.meta.mime });
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
  $('filesOpen').addEventListener('click', consult);
  $('filesShare').addEventListener('click', share);
  $('filesDelete').addEventListener('click', remove);
  // La fenêtre 📚 s'ouvre toujours sur l'onglet Enregistrements.
  $('history').addEventListener('click', () => showTab('tabRecs'));

  return { refresh, showTab };
})();
