import { h } from './dom';
import { lsGet, lsSet } from './misc';

/**
 * Free card translation. Nothing here costs money and no account or key is needed:
 *  1. Tesseract.js reads the card text inside the browser (OCR).
 *  2. The browser's built-in on-device translator (Chrome's Translator API) turns it into
 *     English. Where that isn't available, the free MyMemory service is used instead.
 *  3. The card code (e.g. ND/W67-001) is read too, so you can open the human fan translation.
 * Results are cached per card (card ids are image hashes), so each card is only read once.
 */

export interface Translation {
  isEnglish: boolean;
  original: string;
  english: string;
  code: string;
  via: 'browser' | 'mymemory' | 'none';
  at: number;
}

interface Settings {
  /** Translate automatically on hover. Off: show a "Translate" button instead. */
  auto: boolean;
  /** Allow the free online fallback (sends the card text, not the image, to MyMemory). */
  online: boolean;
}

const SETTINGS_KEY = 'wom-translate';
const CACHE_KEY = 'wom-translations-free';

export const getTranslateSettings = (): Settings => ({ auto: true, online: true, ...lsGet<Partial<Settings>>(SETTINGS_KEY, {}) });
export const setTranslateSettings = (p: Partial<Settings>) => lsSet(SETTINGS_KEY, { ...getTranslateSettings(), ...p });

// The earlier paid version stored an API key and results here; it is no longer used.
try {
  localStorage.removeItem('wom-anthropic-key');
  localStorage.removeItem('wom-translations');
} catch {
  /* storage blocked */
}

let cache: Record<string, Translation> | null = null;
const loadCache = () => (cache ??= lsGet<Record<string, Translation>>(CACHE_KEY, {}));
export const cachedTranslation = (id: string): Translation | undefined => loadCache()[id];
export const translationCount = () => Object.keys(loadCache()).length;
export function clearTranslations() {
  cache = {};
  localStorage.removeItem(CACHE_KEY);
}
function remember(id: string, t: Translation) {
  loadCache()[id] = t;
  lsSet(CACHE_KEY, cache);
}

// ─────────────────────────────── OCR ───────────────────────────────

type TWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let jpnWorker: Promise<TWorker> | null = null;
let engWorker: Promise<TWorker> | null = null;
const getJpn = () => (jpnWorker ??= import('tesseract.js').then((t) => t.createWorker(['jpn', 'eng'])));
const getEng = () =>
  (engWorker ??= import('tesseract.js').then(async (t) => {
    const w = await t.createWorker('eng');
    await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-' });
    return w;
  }));

/** Crop part of the image (fractions of width/height) and scale it up; small card text reads much better at 2x. */
async function crop(url: string, x: number, y: number, w: number, hgt: number, scale = 2): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const sx = bmp.width * x;
  const sy = bmp.height * y;
  const sw = bmp.width * w;
  const sh = bmp.height * hgt;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

const CJK = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
const CODE = /\b[A-Z0-9]{1,5}\/[A-Z0-9]{1,5}-[A-Z]{0,3}\d{1,3}[A-Z]{0,4}\b/;

/** Tidy OCR output: drop junk lines and the spaces Tesseract puts between Japanese characters. */
function cleanJapanese(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])/g, '').trim())
    .filter((l) => l.length > 1 && CJK.test(l))
    .join('\n');
}

// ─────────────────────────────── translation ───────────────────────────────

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}
const browserApi = (): TranslatorStatic | undefined => (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;
let browserTranslator: Promise<BrowserTranslator | null> | null = null;

/** Whether this browser has a free on-device Japanese→English translator, and if it's downloaded yet. */
export async function browserTranslatorStatus(): Promise<'unsupported' | 'ready' | 'needs-download' | 'unavailable'> {
  const api = browserApi();
  if (!api) return 'unsupported';
  try {
    const a = await api.availability({ sourceLanguage: 'ja', targetLanguage: 'en' });
    return a === 'available' ? 'ready' : a === 'unavailable' ? 'unavailable' : 'needs-download';
  } catch {
    return 'unavailable';
  }
}

/** Download the on-device translator. Must be called from a click (browsers require a user action). */
export async function enableBrowserTranslator() {
  const api = browserApi();
  if (!api) throw new Error('This browser has no built-in translator');
  browserTranslator = api.create({ sourceLanguage: 'ja', targetLanguage: 'en' });
  await browserTranslator;
}

async function viaBrowser(text: string): Promise<string | null> {
  const api = browserApi();
  if (!api) return null;
  if (!browserTranslator) {
    if ((await browserTranslatorStatus()) !== 'ready') return null;
    browserTranslator = api.create({ sourceLanguage: 'ja', targetLanguage: 'en' }).catch(() => null);
  }
  const t = await browserTranslator;
  return t ? t.translate(text) : null;
}

/** MyMemory: free, no key, limited to about 5,000 characters a day per user and 500 per request. */
async function viaMyMemory(text: string): Promise<string> {
  const chunks: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > 450 && cur) (chunks.push(cur), (cur = ''));
    cur = cur ? cur + '\n' + line : line;
  }
  if (cur) chunks.push(cur);
  const out: string[] = [];
  for (const c of chunks) {
    const r = await fetch(`https://api.mymemory.translated.net/get?langpair=ja|en&q=${encodeURIComponent(c)}`);
    const j = (await r.json()) as { responseStatus: number | string; responseData?: { translatedText?: string }; responseDetails?: string };
    if (Number(j.responseStatus) !== 200) throw new Error(j.responseDetails || 'Free translation service is unavailable right now');
    out.push(j.responseData?.translatedText ?? '');
  }
  return out.join('\n');
}

// ─────────────────────────────── pipeline ───────────────────────────────

const inflight = new Map<string, Promise<Translation>>();

/** Read and translate a card image. Cached per card id; concurrent calls share one run. */
export function translateCard(id: string, url: string, landscape = false, progress?: (m: string) => void): Promise<Translation> {
  const hit = cachedTranslation(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = run(url, landscape, progress)
      .then((t) => (remember(id, t), t))
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

async function run(url: string, landscape: boolean, progress?: (m: string) => void): Promise<Translation> {
  progress?.('Reading card text… (the first time downloads the free text reader)');
  // Name and abilities sit in the lower part of portrait cards; climax (landscape) cards are read whole.
  const [jpn, eng] = await Promise.all([getJpn(), getEng()]);
  const textArea = landscape ? await crop(url, 0, 0, 1, 1, 1.5) : await crop(url, 0, 0.5, 1, 0.5, 2);
  const codeArea = landscape ? await crop(url, 0, 0.85, 1, 0.15, 3) : await crop(url, 0, 0.9, 1, 0.1, 3);
  const [{ data: textData }, { data: codeData }] = await Promise.all([jpn.recognize(textArea), eng.recognize(codeArea)]);
  const code = (codeData.text.toUpperCase().replace(/\s+/g, ' ').match(CODE) ?? [''])[0];
  const original = cleanJapanese(textData.text);
  if (!original) return { isEnglish: true, original: '', english: '', code, via: 'none', at: Date.now() };

  progress?.('Translating…');
  let english = await viaBrowser(original).catch(() => null);
  let via: Translation['via'] = 'browser';
  if (english == null) {
    if (!getTranslateSettings().online) {
      return { isEnglish: false, original, english: '', code, via: 'none', at: Date.now() };
    }
    english = await viaMyMemory(original);
    via = 'mymemory';
  }
  return { isEnglish: false, original, english, code, via, at: Date.now() };
}

/** Free fan translations: search Heart of the Cards for the card code. */
export const fanTranslationUrl = (code: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(`site:heartofthecards.com "${code}"`)}`;

/**
 * A translation panel that follows whichever card is being previewed. Call show() on hover;
 * it waits briefly so sweeping the mouse across cards doesn't read every one of them.
 */
export function translationBox(cls = '') {
  const el = h('div', { class: `translation ${cls}`, 'aria-live': 'polite' });
  let current = '';
  let timer = 0;
  const render = (t: Translation) => {
    el.replaceChildren();
    if (t.isEnglish) return;
    const orig = h('p', { class: 'tr-original', hidden: true }, t.original);
    el.append(
      h('div', { class: 'tr-head' }, t.english ? 'Rough machine translation (free)' : 'Japanese text found'),
      t.english ? h('p', { class: 'tr-english' }, t.english) : h('p', { class: 'tr-status' }, 'Turn on the free online translator or your browser’s translator in Account → Card translation to see English.'),
      h('div', { class: 'tr-links' },
        h('button', { class: 'link-btn', onclick: () => (orig.hidden = !orig.hidden) }, 'Show text read from card'),
        t.code ? h('a', { href: fanTranslationUrl(t.code), target: '_blank', rel: 'noopener noreferrer', title: 'Accurate translations by Weiss Schwarz players' }, `Fan translation for ${t.code} ↗`) : '',
      ),
      orig,
    );
  };
  const runBox = (id: string, url: string, landscape: boolean) => {
    const status = h('div', { class: 'tr-status' }, 'Reading card text…');
    el.replaceChildren(status);
    translateCard(id, url, landscape, (m) => current === id && (status.textContent = m)).then(
      (t) => current === id && render(t),
      (e: Error) => current === id && el.replaceChildren(h('div', { class: 'tr-status error' }, 'Translation failed: ' + e.message)),
    );
  };
  return {
    el,
    show(id: string | undefined, url: string | undefined, landscape = false) {
      clearTimeout(timer);
      if (!id || !url || id === current) return;
      current = id;
      const hit = cachedTranslation(id);
      if (hit) return render(hit);
      el.replaceChildren();
      if (!getTranslateSettings().auto) {
        el.append(h('button', { class: 'btn sm', onclick: () => runBox(id, url, landscape) }, '🌐 Translate this card'));
        return;
      }
      timer = window.setTimeout(() => current === id && runBox(id, url, landscape), 600);
    },
    clear() {
      clearTimeout(timer);
      current = '';
      el.replaceChildren();
    },
  };
}
