'use strict';

/*
 * Module « Compte-rendu » de VTS.
 *  1. Mots-clés dictés (« Point suivant », « Décision », « Action »…) → structure automatique.
 *  2. Option : rédaction par Claude (clé d'API personnelle, stockée sur l'appareil).
 *  3. Formulaire modifiable, puis export Word (.docx) ou PDF à la charte de l'organisation.
 */
const VTReport = (() => {
  // ---------- 1. Mots-clés ----------
  const KINDS = {
    point: 'Point',
    decision: 'Décision',
    action: 'Action',
    participants: 'Participants',
    next: 'Prochaine réunion',
  };

  const SEP = '\\s*[:,.;–-]?\\s*';
  const RULES = [
    ['next', /^(?:prochaine réunion|next meeting)/i],
    ['point', /^(?:point suivant|nouveau point|point (?:numéro |n° ?)?\d+|point|next point|new topic|topic)(?![a-zà-ÿ])/i],
    ['decision', /^(?:décision|il est décidé que?|on décide que?|decision)(?![a-zà-ÿ])/i],
    ['action', /^(?:action|à faire|tâche|to ?do)(?![a-zà-ÿ])/i],
    ['participants', /^(?:participants?|présents?|sont présents|attendees)(?![a-zà-ÿ])/i],
  ];

  function classify(raw) {
    for (const [kind, re] of RULES) {
      const m = raw.match(re);
      if (m) {
        const rest = raw.slice(m[0].length).replace(new RegExp('^' + SEP), '').trim();
        return { kind, text: rest };
      }
    }
    return { kind: null, text: raw };
  }

  // « Marie envoie le devis pour vendredi » → { owner: Marie, task: envoie le devis, due: vendredi }
  function parseAction(text) {
    let task = text.trim();
    let due = '';
    const dm = task.match(/^(.*?)\s+(?:pour|d'ici|d’ici|avant|by|before)\s+(?:le\s+|la\s+)?(.+)$/i);
    if (dm && dm[2].split(/\s+/).length <= 5) {
      task = dm[1];
      due = dm[2];
    }
    let owner = '';
    const om = task.match(/^([A-ZÀ-Ý][\p{L}'’-]+(?:\s+(?:et|and)\s+[A-ZÀ-Ý][\p{L}'’-]+)?)\s+(.+)$/u);
    if (om && !/^(?:Il|Elle|On|Nous|Vous|Ils|Elles|Le|La|Les|Un|Une|We|The)$/i.test(om[1])) {
      owner = om[1];
      task = om[2];
    }
    return { task: capitalize(task), owner, due };
  }

  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const splitList = (s) => s.split(/\s*(?:,|;|\bet\b|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  const isoDate = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const isoTime = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Compte-rendu vide, avec les métadonnées de l'enregistrement.
  function emptyReport(rec) {
    const st = settings();
    return {
      title: 'Réunion du ' + new Date(rec.start).toLocaleDateString('fr-FR', { dateStyle: 'long' }),
      date: isoDate(rec.start),
      time: isoTime(rec.start),
      location: '',
      author: st.author || '',
      participants: [],
      absents: [],
      summary: '',
      points: [],
      decisions: [],
      actions: [],
      nextMeeting: '',
      annex: false,
      source: 'keywords',
    };
  }

  // Construction à partir des mots-clés dictés (sans IA).
  function buildFromSegments(rec, base) {
    const r = base ? { ...base } : emptyReport(rec);
    r.participants = [...(base ? base.participants : [])];
    r.points = [];
    r.decisions = [];
    r.actions = [];
    let point = null;
    for (const seg of rec.segments) {
      switch (seg.kind) {
        case 'point':
          point = { title: seg.text, content: '' };
          r.points.push(point);
          break;
        case 'decision':
          r.decisions.push(seg.text);
          break;
        case 'action':
          r.actions.push(parseAction(seg.text));
          break;
        case 'participants':
          for (const p of splitList(seg.text)) {
            if (!r.participants.includes(p)) r.participants.push(capitalize(p));
          }
          break;
        case 'next':
          r.nextMeeting = seg.text;
          break;
        default:
          if (!point) {
            point = { title: 'Échanges', content: '' };
            r.points.push(point);
          }
          point.content += (point.content ? '\n' : '') + seg.text;
      }
    }
    r.source = 'keywords';
    return r;
  }

  // ---------- Réglages (charte + clé d'API) ----------
  const STORE_SETTINGS = 'voixtexte.settings';
  const DEFAULTS = {
    org: '', author: '', color: '#1F3864', logo: 'icons/logo-report.png', confidential: 'Document interne – diffusion restreinte',
    apiKey: '',
    blackout: true,
    voices: true,
    welcome: true,
    autoExport: true,
  };
  function settings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_SETTINGS) || '{}') }; } catch { return { ...DEFAULTS }; }
  }
  function saveSettings(st) {
    try { localStorage.setItem(STORE_SETTINGS, JSON.stringify(st)); return true; } catch { return false; }
  }

  // ---------- 2. Rédaction par Claude ----------
  const CLAUDE_MODEL = 'claude-opus-5-5';
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'participants', 'points', 'decisions', 'actions', 'nextMeeting'],
    properties: {
      title: { type: 'string', description: 'Titre court et explicite de la réunion' },
      summary: { type: 'string', description: 'Synthèse de 3 à 5 phrases' },
      participants: { type: 'array', items: { type: 'string' } },
      points: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['title', 'content'],
          properties: { title: { type: 'string' }, content: { type: 'string' } },
        },
      },
      decisions: { type: 'array', items: { type: 'string' } },
      actions: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['task', 'owner', 'due'],
          properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } },
        },
      },
      nextMeeting: { type: 'string' },
    },
  };

  const SYSTEM = `Tu es l'assistant de rédaction d'une organisation professionnelle. À partir de la transcription automatique d'une réunion, tu rédiges un compte-rendu clair, factuel et concis, dans la langue de la transcription.

La transcription vient d'une reconnaissance vocale : elle contient des erreurs de mots, pas de ponctuation et des répétitions. Corrige-les en t'appuyant sur le contexte, sans inventer d'information. Les lignes préfixées par une étiquette ([Point], [Décision], [Action], [Participants], [Prochaine réunion]) ont été balisées par l'orateur : respecte ces indications, et repère aussi les décisions et actions qui n'ont pas été balisées. Certaines lignes commencent par le nom d'une voix (« Voix 2 : », ou un prénom) : cette attribution est automatique et approximative, sers-t'en comme indice sans la tenir pour certaine.

- points : regroupe les échanges par sujet, chaque contenu en quelques phrases rédigées au style indirect.
- decisions : une phrase par décision effectivement prise.
- actions : tâche formulée avec un verbe d'action ; owner et due vides si non mentionnés.
- participants : les participants déjà connus (noms complétés si la transcription les précise) et les autres personnes citées comme présentes, sans doublon ; liste vide si aucun.
- nextMeeting : vide si non mentionnée.`;

  async function generateWithClaude(rec, report) {
    const st = settings();
    if (!st.apiKey) throw new Error('Ajoutez votre clé d\'API Claude dans les réglages ⚙️.');
    if (!rec.segments.length) throw new Error('La transcription est vide.');

    const { default: Anthropic } = await import('./vendor/anthropic-sdk-0.135.0.mjs');
    // La clé est saisie par l'utilisateur et ne sert que depuis son propre appareil.
    const client = new Anthropic({ apiKey: st.apiKey, dangerouslyAllowBrowser: true });

    const transcript = rec.segments.map((s) => `[${VT.formatTime(s.t)}] ${VT.lineText(rec, s)}`).join('\n');
    const context = [
      report.title && `Titre provisoire : ${report.title}`,
      `Date : ${report.date} ${report.time || ''}`,
      report.location && `Lieu : ${report.location}`,
      report.participants.length && `Participants déjà connus : ${report.participants.join(', ')}`,
    ].filter(Boolean).join('\n');

    const response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `${context}\n\n<transcription>\n${transcript}\n</transcription>`,
      }],
    });

    if (response.stop_reason === 'refusal') throw new Error('Claude a refusé de traiter cette transcription.');
    if (response.stop_reason === 'max_tokens') throw new Error('Réponse trop longue, tronquée. Réessayez.');
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('Réponse vide.');
    const data = JSON.parse(textBlock.text);

    return {
      ...report,
      title: data.title || report.title,
      summary: data.summary,
      participants: data.participants.length ? data.participants : report.participants,
      points: data.points,
      decisions: data.decisions,
      actions: data.actions,
      nextMeeting: data.nextMeeting || report.nextMeeting,
      source: 'claude',
    };
  }

  function claudeErrorMessage(e) {
    const status = e && e.status;
    if (status === 401) return 'Clé d\'API invalide. Vérifiez-la dans les réglages ⚙️.';
    if (status === 429) return 'Trop de requêtes ou crédit épuisé. Réessayez plus tard.';
    if (status === 400 && /credit/i.test(e.message || '')) return 'Crédit API insuffisant sur votre compte Anthropic.';
    if (status >= 500) return 'Service Claude momentanément indisponible. Réessayez.';
    if (e && e.name === 'APIConnectionError') return 'Connexion impossible. Vérifiez votre accès internet.';
    return (e && e.message) || 'Erreur inconnue.';
  }

  // ---------- 3a. Document HTML (aperçu + PDF) ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const paras = (s) => String(s || '').split(/\n+/).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
  function longDate(r) {
    const d = r.date ? new Date(r.date + 'T12:00') : new Date();
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (r.time ? ` – ${r.time.replace(':', ' h ')}` : '');
  }
  // Nom du compte-rendu : cr_jjmmaaaa_hhmmss, d'après le démarrage de la source (son ou dictée).
  const crName = (source) => 'cr_' + VT.formatStamp(source.start);

  function toHTML(r, rec) {
    const st = settings();
    const meta = [
      ['Date', longDate(r)],
      r.location && ['Lieu', r.location],
      r.participants.length && ['Participants', r.participants.join(', ')],
      r.absents.length && ['Excusés', r.absents.join(', ')],
      r.author && ['Rédacteur', r.author],
      ['Référence', crName(rec)],
    ].filter(Boolean);
    let n = 0;
    const section = (title, body) => `<h2><span class="num">${++n}</span>${esc(title)}</h2>${body}`;
    const filledPoints = r.points.filter((p) => p.title || p.content);
    const filledActions = r.actions.filter((a) => a.task);
    return `
<article class="doc" style="--brand:${esc(st.color)}">
  <header class="doc-head">
    ${st.logo ? `<img class="doc-logo" src="${st.logo}" alt="">` : ''}
    <div class="doc-org">${esc(st.org || '')}</div>
    <div class="doc-kind">Compte-rendu de réunion</div>
  </header>
  <h1 class="doc-title">${esc(r.title)}</h1>
  <table class="doc-meta">${meta.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
  ${r.summary ? section('Synthèse', `<div class="doc-summary">${paras(r.summary)}</div>`) : ''}
  ${filledPoints.length > 1 ? section('Ordre du jour', `<ol class="doc-agenda">${filledPoints.map((p) => `<li>${esc(p.title)}</li>`).join('')}</ol>`) : ''}
  ${filledPoints.length ? section('Points abordés', filledPoints.map((p, i) => `<h3>${n + 1}.${i + 1} ${esc(p.title)}</h3>${paras(p.content)}`).join('')) : ''}
  ${r.decisions.length ? section('Décisions', `<table class="doc-table"><thead><tr><th style="width:3.2em">N°</th><th>Décision</th></tr></thead><tbody>${r.decisions.map((d, i) => `<tr><td>D${i + 1}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table>`) : ''}
  ${filledActions.length ? section('Plan d\'actions', `<table class="doc-table"><thead><tr><th style="width:3.2em">N°</th><th>Action</th><th>Responsable</th><th>Échéance</th></tr></thead><tbody>${filledActions.map((a, i) => `<tr><td>A${i + 1}</td><td>${esc(a.task)}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td></tr>`).join('')}</tbody></table>`) : ''}
  ${r.nextMeeting ? section('Prochaine réunion', paras(r.nextMeeting)) : ''}
  ${r.annex && rec.segments.length ? `<section class="doc-annex">${section('Annexe – transcription intégrale', `<div class="doc-transcript">${rec.segments.map((s) => `<p><span>${VT.formatTime(s.t)}</span> ${esc(VT.lineText(rec, s))}</p>`).join('')}</div>`)}</section>` : ''}
  <footer class="doc-foot">${esc(st.confidential)}${st.org ? ' · ' + esc(st.org) : ''} · ${esc(crName(rec))}</footer>
</article>`;
  }

  // ---------- 3b. Document Word (.docx) ----------
  async function toDocx(r, rec) {
    const D = await import('./vendor/docx-9.12.0.mjs');
    const st = settings();
    const brand = (st.color || '#1F3864').replace('#', '').toUpperCase();
    const GREY = '595959';
    const FONT = 'Calibri';
    const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
    const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
    const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };

    const text = (t, o = {}) => new D.TextRun({ text: String(t ?? ''), font: FONT, ...o });
    const para = (t, o = {}) => new D.Paragraph({ children: [text(t, o.run)], spacing: { after: 120, line: 288 }, ...o.para });
    const cell = (t, o = {}) => new D.TableCell({
      children: [new D.Paragraph({ children: [text(t, { size: 20, ...o.run })] })],
      shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: o.width ? { size: o.width, type: D.WidthType.PERCENTAGE } : undefined,
    });
    const table = (head, rows, widths) => new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      borders,
      rows: [
        new D.TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { fill: brand, width: widths[i], run: { bold: true, color: 'FFFFFF' } })) }),
        ...rows.map((row, ri) => new D.TableRow({ children: row.map((c, i) => cell(c, { fill: ri % 2 ? 'F2F2F2' : undefined, width: widths[i] })) })),
      ],
    });

    let n = 0;
    const h2 = (t) => new D.Paragraph({
      children: [text(`${++n}.  ${t}`, { bold: true, size: 26, color: brand })],
      spacing: { before: 320, after: 120 },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: brand, space: 2 } },
      keepNext: true,
    });
    const h3 = (t) => new D.Paragraph({ children: [text(t, { bold: true, size: 22 })], spacing: { before: 200, after: 80 }, keepNext: true });
    const lines = (s) => String(s || '').split(/\n+/).filter(Boolean).map((l) => para(l, { run: { size: 22 } }));

    // En-tête de page : logo + organisation à gauche, nature du document à droite.
    const headChildren = [];
    if (st.logo) {
      try {
        const img = await logoForDocx(st.logo);
        headChildren.push(new D.ImageRun({ type: 'png', data: img.data, transformation: { width: img.width, height: img.height } }), text('   '));
      } catch { /* logo illisible : ignoré */ }
    }
    headChildren.push(text(st.org || '', { bold: true, size: 20, color: brand }));
    const header = new D.Header({
      children: [new D.Paragraph({
        children: [...headChildren, new D.TextRun({ children: [new D.Tab(), 'Compte-rendu de réunion'], font: FONT, size: 18, color: GREY })],
        tabStops: [{ type: D.TabStopType.RIGHT, position: D.TabStopPosition.MAX }],
        border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: brand, space: 4 } },
      })],
    });
    const footer = new D.Footer({
      children: [new D.Paragraph({
        children: [
          text(`${st.confidential}  ·  ${crName(rec)}`, { size: 16, color: GREY }),
          new D.TextRun({ children: [new D.Tab(), 'Page ', D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: GREY }),
        ],
        tabStops: [{ type: D.TabStopType.RIGHT, position: D.TabStopPosition.MAX }],
        border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: 'BFBFBF', space: 4 } },
      })],
    });

    const meta = [
      ['Date', longDate(r)],
      r.location && ['Lieu', r.location],
      r.participants.length && ['Participants', r.participants.join(', ')],
      r.absents.length && ['Excusés', r.absents.join(', ')],
      r.author && ['Rédacteur', r.author],
      ['Référence', crName(rec)],
    ].filter(Boolean);

    const body = [
      new D.Paragraph({ children: [text(r.title, { bold: true, size: 40, color: brand })], spacing: { before: 120, after: 240 } }),
      new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        borders: noBorders,
        rows: meta.map(([k, v]) => new D.TableRow({ children: [
          cell(k, { width: 22, fill: 'F2F2F2', run: { bold: true, color: GREY } }),
          cell(v, { width: 78 }),
        ] })),
      }),
    ];
    if (r.summary) {
      body.push(h2('Synthèse'));
      body.push(...String(r.summary).split(/\n+/).filter(Boolean).map((l) => new D.Paragraph({
        children: [text(l, { size: 22 })],
        shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' },
        border: { left: { style: D.BorderStyle.SINGLE, size: 24, color: brand, space: 8 } },
        spacing: { after: 80, line: 288 },
        indent: { left: 160, right: 160 },
      })));
    }
    const points = r.points.filter((p) => p.title || p.content);
    if (points.length > 1) {
      body.push(h2('Ordre du jour'));
      points.forEach((p, i) => body.push(para(`${i + 1}. ${p.title}`, { run: { size: 22 }, para: { indent: { left: 360 }, spacing: { after: 60 } } })));
    }
    if (points.length) {
      body.push(h2('Points abordés'));
      const sec = n;
      points.forEach((p, i) => { body.push(h3(`${sec}.${i + 1}  ${p.title}`), ...lines(p.content)); });
    }
    if (r.decisions.length) {
      body.push(h2('Décisions'), table(['N°', 'Décision'], r.decisions.map((d, i) => [`D${i + 1}`, d]), [10, 90]));
    }
    const actions = r.actions.filter((a) => a.task);
    if (actions.length) {
      body.push(h2('Plan d\'actions'), table(['N°', 'Action', 'Responsable', 'Échéance'], actions.map((a, i) => [`A${i + 1}`, a.task, a.owner, a.due]), [8, 52, 22, 18]));
    }
    if (r.nextMeeting) body.push(h2('Prochaine réunion'), ...lines(r.nextMeeting));
    if (r.annex && rec.segments.length) {
      body.push(new D.Paragraph({ children: [new D.PageBreak()] }), h2('Annexe – transcription intégrale'));
      for (const s of rec.segments) {
        body.push(new D.Paragraph({
          children: [text(VT.formatTime(s.t) + '  ', { size: 18, color: GREY }), text(VT.lineText(rec, s), { size: 20 })],
          spacing: { after: 40 },
        }));
      }
    }

    const doc = new D.Document({
      creator: st.author || st.org || 'VTS',
      title: r.title,
      description: 'Compte-rendu de réunion',
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{
        properties: { page: { margin: { top: 1300, bottom: 1100, left: 1134, right: 1134, header: 560, footer: 500 } } },
        headers: { default: header },
        footers: { default: footer },
        children: body,
      }],
    });
    return D.Packer.toBlob(doc);
  }

  // Logo → PNG (le format le plus sûr pour Word), hauteur 40 px dans l'en-tête.
  function logoForDocx(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const h = 40;
        const w = Math.round((img.width / img.height) * h) || h;
        const c = document.createElement('canvas');
        c.width = w * 3; c.height = h * 3;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const bin = atob(c.toDataURL('image/png').split(',')[1]);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        resolve({ data, width: w, height: h });
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function fileName(r, ext) {
    return `${crName(rec)}.${ext}`;
  }

  // ---------- Interface ----------
  const $ = (id) => document.getElementById(id);
  let rec = null;      // enregistrement concerné
  let report = null;   // compte-rendu en cours d'édition

  function ensureReport() {
    rec = VT.current;
    if (!rec.report) rec.report = buildFromSegments(rec);
    report = rec.report;
  }

  function save() {
    rec.report = report;
    VT.persist();
  }

  // Champ lié à une propriété du compte-rendu (sauvegarde à chaque frappe).
  function bindInput(el, get, set) {
    el.value = get() ?? '';
    el.oninput = () => { set(el.value); save(); };
  }
  const listToText = (a) => a.join('\n');
  const textToList = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

  function autoGrow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }

  function renderEditor() {
    bindInput($('rTitle'), () => report.title, (v) => { report.title = v; });
    bindInput($('rDate'), () => report.date, (v) => { report.date = v; });
    bindInput($('rTime'), () => report.time, (v) => { report.time = v; });
    bindInput($('rLocation'), () => report.location, (v) => { report.location = v; });
    bindInput($('rAuthor'), () => report.author, (v) => { report.author = v; });
    bindInput($('rParticipants'), () => listToText(report.participants), (v) => { report.participants = textToList(v); });
    bindInput($('rAbsents'), () => listToText(report.absents), (v) => { report.absents = textToList(v); });
    bindInput($('rSummary'), () => report.summary, (v) => { report.summary = v; });
    bindInput($('rDecisions'), () => listToText(report.decisions), (v) => { report.decisions = textToList(v); });
    bindInput($('rNext'), () => report.nextMeeting, (v) => { report.nextMeeting = v; });
    const annex = $('rAnnex');
    annex.checked = report.annex;
    annex.onchange = () => { report.annex = annex.checked; save(); };

    // Points
    const pts = $('rPoints');
    pts.replaceChildren();
    report.points.forEach((p, i) => {
      const box = document.createElement('div');
      box.className = 'r-item';
      const title = document.createElement('input');
      title.placeholder = 'Intitulé du point';
      bindInput(title, () => p.title, (v) => { p.title = v; });
      const content = document.createElement('textarea');
      content.placeholder = 'Ce qui a été dit';
      content.rows = 3;
      bindInput(content, () => p.content, (v) => { p.content = v; });
      autoGrow(content);
      box.append(rowWithDelete(title, () => { report.points.splice(i, 1); save(); renderEditor(); }), content);
      pts.appendChild(box);
    });

    // Actions
    const acts = $('rActions');
    acts.replaceChildren();
    report.actions.forEach((a, i) => {
      const box = document.createElement('div');
      box.className = 'r-item';
      const task = document.createElement('input');
      task.placeholder = 'Action';
      bindInput(task, () => a.task, (v) => { a.task = v; });
      const owner = document.createElement('input');
      owner.placeholder = 'Responsable';
      bindInput(owner, () => a.owner, (v) => { a.owner = v; });
      const due = document.createElement('input');
      due.placeholder = 'Échéance';
      bindInput(due, () => a.due, (v) => { a.due = v; });
      const two = document.createElement('div');
      two.className = 'r-two';
      two.append(owner, due);
      box.append(rowWithDelete(task, () => { report.actions.splice(i, 1); save(); renderEditor(); }), two);
      acts.appendChild(box);
    });

    document.querySelectorAll('#reportDialog textarea').forEach(autoGrow);
    const src = $('rSource');
    src.textContent = report.source === 'claude' ? '✨ Rédigé par Claude — relisez avant diffusion' : 'Structuré à partir des mots-clés dictés';
  }

  function rowWithDelete(input, onDelete) {
    const row = document.createElement('div');
    row.className = 'r-row';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tool small';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Supprimer');
    del.onclick = onDelete;
    row.append(input, del);
    return row;
  }

  function open() {
    if (VT.isListening()) VT.toast('La dictée continue ; actualisez la structure à la fin.');
    ensureReport();
    renderEditor();
    $('reportDialog').showModal();
  }

  async function shareOrDownload(blob, name, share) {
    const file = new File([blob], name, { type: blob.type });
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: report.title }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    VT.toast('Fichier enregistré : ' + name);
  }

  async function busy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  function init() {
    $('report').addEventListener('click', open);
    $('closeReport').addEventListener('click', () => $('reportDialog').close());

    $('rRebuild').addEventListener('click', () => {
      if ((report.source === 'claude' || report.summary) &&
          !confirm('Reconstruire depuis les mots-clés ? Les points, décisions et actions actuels seront remplacés.')) return;
      report = buildFromSegments(rec, report);
      save();
      renderEditor();
      VT.toast('Structure actualisée');
    });

    $('rClaude').addEventListener('click', (e) => busy(e.currentTarget, '⏳ Rédaction en cours…', async () => {
      if (!settings().apiKey) {
        VT.toast('Ajoutez d\'abord votre clé d\'API dans ⚙️');
        openSettings();
        return;
      }
      if (report.source === 'claude' && !confirm('Rédiger à nouveau avec Claude ? Vos modifications seront remplacées.')) return;
      try {
        report = await generateWithClaude(rec, report);
        save();
        renderEditor();
        VT.toast('Compte-rendu rédigé');
      } catch (err) {
        alert('Rédaction impossible : ' + claudeErrorMessage(err));
      }
    }));

    $('rAddPoint').addEventListener('click', () => { report.points.push({ title: '', content: '' }); save(); renderEditor(); });
    $('rAddAction').addEventListener('click', () => { report.actions.push({ task: '', owner: '', due: '' }); save(); renderEditor(); });

    $('rPdf').addEventListener('click', () => {
      const area = $('printArea');
      area.innerHTML = toHTML(report, rec);
      const oldTitle = document.title;
      document.title = fileName(report, 'pdf').replace(/\.pdf$/, ''); // nom proposé pour le PDF
      $('reportDialog').close();
      document.body.classList.add('printing');
      const done = () => {
        document.body.classList.remove('printing');
        document.title = oldTitle;
        window.removeEventListener('afterprint', done);
      };
      window.addEventListener('afterprint', done);
      setTimeout(() => window.print(), 50);
    });

    $('rPreview').addEventListener('click', () => {
      $('previewArea').innerHTML = toHTML(report, rec);
      $('previewDialog').showModal();
    });
    $('closePreview').addEventListener('click', () => $('previewDialog').close());

    const docxHandler = (share) => (e) => busy(e.currentTarget, '⏳', async () => {
      try {
        const blob = await toDocx(report, rec);
        await shareOrDownload(blob, fileName(report, 'docx'), share);
      } catch (err) {
        alert('Création du document Word impossible : ' + err.message);
      }
    });
    $('rDocx').addEventListener('click', docxHandler(false));
    $('rShare').addEventListener('click', docxHandler(true));

    // Réglages
    $('settings').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', () => $('settingsDialog').close());
    $('sLogo').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        pendingLogo = await resizeImage(f, 400);
        $('sLogoPreview').src = pendingLogo;
        $('sLogoPreview').hidden = false;
      } catch { VT.toast('Image illisible'); }
    });
    $('sLogoClear').addEventListener('click', () => { pendingLogo = ''; $('sLogoPreview').hidden = true; $('sLogo').value = ''; });
    $('settingsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const st = {
        org: $('sOrg').value.trim(),
        author: $('sAuthor').value.trim(),
        color: $('sColor').value,
        confidential: $('sConf').value.trim(),
        logo: pendingLogo,
        apiKey: $('sKey').value.trim(),
        blackout: $('sBlackout').checked,
        voices: $('sVoices').checked,
        welcome: $('sWelcome').checked,
        autoExport: $('sAutoExport').checked,
      };
      if (st.voices) { try { localStorage.removeItem('voixtexte.noTrack'); } catch { /* ignoré */ } }
      if (!saveSettings(st)) { alert('Enregistrement impossible (stockage plein ?). Essayez un logo plus léger.'); return; }
      $('settingsDialog').close();
      document.body.classList.toggle('no-welcome', !st.welcome);
      VT.toast('Réglages enregistrés');
    });
  }

  let pendingLogo = '';
  function openSettings() {
    const st = settings();
    $('sOrg').value = st.org;
    $('sAuthor').value = st.author;
    $('sColor').value = st.color;
    $('sConf').value = st.confidential;
    $('sBlackout').checked = st.blackout;
    $('sVoices').checked = st.voices;
    $('sWelcome').checked = st.welcome;
    $('sAutoExport').checked = st.autoExport;
    $('sKey').value = st.apiKey;
    pendingLogo = st.logo;
    $('sLogoPreview').src = st.logo || '';
    $('sLogoPreview').hidden = !st.logo;
    $('settingsDialog').showModal();
  }

  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // Aperçu du compte-rendu d'un enregistrement (onglet Fichiers).
  function preview(source) {
    $('previewArea').innerHTML = toHTML(source.report, source);
    $('previewDialog').showModal();
  }

  return { KINDS, classify, parseAction, buildFromSegments, toHTML, toDocx, generateWithClaude, init, settings, crName, preview };
})();
