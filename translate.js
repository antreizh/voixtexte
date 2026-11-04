'use strict';

/*
 * Traduction simultanée en français.
 * Chaque phrase validée (dictée en direct ou retranscription d'un fichier son) est traduite
 * dès qu'elle arrive ; la traduction s'affiche sous la phrase d'origine.
 * Moteur :
 *  1. traducteur intégré à Chrome (sur l'appareil : gratuit, privé, hors connexion une fois
 *     la langue téléchargée), s'il est disponible ;
 *  2. sinon Claude, si une clé d'API est saisie dans les réglages.
 */
const VTTranslate = (() => {
  const TARGET = 'fr';
  let engine = null;      // 'local' | 'claude' | null
  let translator = null;  // traducteur intégré pour la langue source courante
  let translatorSrc = null;
  let queue = Promise.resolve(); // une phrase après l'autre : l'ordre est conservé
  let ready = Promise.resolve();  // choix du moteur en cours
  let warned = false;

  const enabled = () => Boolean(VTReport.settings().translate);
  const source = () => VT.lang().split('-')[0].toLowerCase();

  // Les API du navigateur peuvent rester bloquées (téléchargement d'un modèle) : délai maximum.
  const withTimeout = (promise, ms) => Promise.race([
    promise, new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), ms)),
  ]);

  // Choisit le moteur ; à appeler sur un geste de l'utilisateur (démarrage de la dictée…),
  // car le traducteur intégré peut devoir télécharger la langue.
  function prepare() {
    ready = choose();
    return ready;
  }

  async function choose() {
    engine = null;
    if (!enabled() || source() === TARGET) return null;
    if ('Translator' in self) {
      try {
        const opts = { sourceLanguage: source(), targetLanguage: TARGET };
        const avail = await withTimeout(Translator.availability(opts), 4000);
        if (avail !== 'unavailable') {
          if (!translator || translatorSrc !== source()) {
            translator = await withTimeout(Translator.create({
              ...opts,
              monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                  VT.setStatus(`Téléchargement de la traduction… ${Math.round(e.loaded * 100)} %`, true);
                });
              },
            }), avail === 'available' ? 8000 : 120000);
            translatorSrc = source();
          }
          engine = 'local';
          return engine;
        }
      } catch { translator = null; /* on essaie Claude */ }
    }
    if (VTReport.settings().apiKey) { engine = 'claude'; return engine; }
    VT.toast('Traduction indisponible : ajoutez une clé Claude dans ⚙️ (ou utilisez Chrome à jour)');
    return null;
  }

  async function viaClaude(text, before) {
    const { default: Anthropic } = await import('./vendor/anthropic-sdk-0.135.0.mjs');
    const client = new Anthropic({ apiKey: VTReport.settings().apiKey, dangerouslyAllowBrowser: true });
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: 'Tu traduis en français, au fil de l\'eau, les phrases d\'une transcription automatique de réunion (reconnaissance vocale : ponctuation absente, mots parfois mal reconnus). Traduis fidèlement la phrase demandée, en corrigeant d\'après le contexte les mots manifestement mal reconnus. Réponds uniquement par la traduction, sans guillemets ni commentaire.',
      messages: [{
        role: 'user',
        content: (before ? `Contexte (phrases précédentes, à ne pas traduire) : ${before}\n\n` : '') + `Phrase à traduire : ${text}`,
      }],
    });
    if (res.stop_reason === 'refusal') throw new Error('refus');
    const block = res.content.find((b) => b.type === 'text');
    return block ? block.text.trim() : '';
  }

  // Traduit une phrase qui vient d'être ajoutée.
  function translate(rec, seg) {
    if (!enabled() || source() === TARGET || !seg.text) return;
    const idx = rec.segments.indexOf(seg);
    const before = rec.segments.slice(Math.max(0, idx - 3), idx).map((s) => s.text).join(' ');
    queue = queue.then(() => ready).then(async () => {
      if (!engine) return;
      try {
        const tr = engine === 'local'
          ? await withTimeout(translator.translate(seg.text), 10000)
          : await viaClaude(seg.text, before);
        if (tr) {
          seg.tr = tr;
          seg.trFrom = source(); // langue d'origine, affichée en étiquette
          VT.persist();
          if (VT.current === rec) VT.render();
        }
      } catch (e) {
        if (!warned) { warned = true; VT.toast('Traduction interrompue : ' + (e.message || 'erreur')); }
      }
    });
  }

  // Bascule rapide sur l'écran principal.
  function bindToggle() {
    const box = document.getElementById('trToggle');
    box.checked = enabled();
    box.addEventListener('change', async () => {
      VTReport.updateSettings({ translate: box.checked });
      warned = false;
      if (box.checked && source() === TARGET) {
        VT.toast('Choisissez la langue parlée dans le menu en haut (ex. English) : elle sera traduite en français');
      }
      if (box.checked && (VT.isListening() || VTAudio.isTranscribing())) await prepare();
    });
  }
  bindToggle();

  return { prepare, translate, engine: () => engine };
})();
