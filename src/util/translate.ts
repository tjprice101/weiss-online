import { h } from './dom';
import { lsGet, lsSet } from './misc';

/**
 * Card translation with Claude (vision). Runs entirely in the browser with the user's own
 * Anthropic API key, which stays in this browser's localStorage. Results are cached per card
 * (card ids are image hashes), so each card is only ever sent once.
 */

export type TranslateModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export const TRANSLATE_MODELS: { id: TranslateModel; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

export interface Translation {
  isEnglish: boolean;
  language: string;
  name: string;
  traits: string[];
  abilities: string[];
  flavor: string;
  at: number;
}

interface Settings {
  model: TranslateModel;
  /** Translate automatically on hover. Off: show a "Translate" button instead. */
  auto: boolean;
}

const KEY_KEY = 'wom-anthropic-key';
const SETTINGS_KEY = 'wom-translate';
const CACHE_KEY = 'wom-translations';

export const getApiKey = () => lsGet<string>(KEY_KEY, '');
export const setApiKey = (k: string) => (k ? lsSet(KEY_KEY, k.trim()) : localStorage.removeItem(KEY_KEY));
export const getTranslateSettings = (): Settings => ({ model: 'claude-opus-5-5', auto: true, ...lsGet<Partial<Settings>>(SETTINGS_KEY, {}) });
export const setTranslateSettings = (p: Partial<Settings>) => lsSet(SETTINGS_KEY, { ...getTranslateSettings(), ...p });

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

const PROMPT = `This image is a trading card, most likely from the Weiss Schwarz card game.

If every piece of game text on the card is already in English, set is_english to true and leave the other text fields empty.

Otherwise translate the card into natural English for a player who knows the game:
- name: the card's name.
- traits: each trait, in English.
- abilities: one entry per ability, in order. Keep the ability keywords and game terms players use in English: 【AUTO】, 【CONT】, 【ACT】, ENCORE, BRAINSTORM, BOND, BACKUP, CHANGE, ASSIST, CLOCK, STOCK, MEMORY, WAITING ROOM, CLIMAX, LEVEL, SOUL, POWER, RESOLUTION ZONE. Write costs as [(1)] and keep 【】 brackets.
- flavor: the flavor text, or empty if there is none.
- source_language: the language the card is printed in (for example "Japanese").

Translate only text that is printed on the card. If a part is unreadable, write [unreadable] for that part rather than guessing.`;

const inflight = new Map<string, Promise<Translation>>();

/** Translate a card image (object URL or http URL). Cached per card id; concurrent calls share one request. */
export function translateCard(id: string, url: string): Promise<Translation> {
  const hit = cachedTranslation(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = request(url)
      .then((t) => (remember(id, t), t))
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

async function imagePayload(url: string): Promise<{ media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }> {
  let blob = await (await fetch(url)).blob();
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ok.includes(blob.type)) {
    // Re-encode anything else (e.g. AVIF, BMP) as JPEG.
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read image'))), 'image/jpeg', 0.92));
  }
  const data = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  return { media_type: blob.type as 'image/jpeg', data };
}

async function request(url: string): Promise<Translation> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Add your Anthropic API key in Account → Card translation');
  const { model } = getTranslateSettings();
  // Loaded on first use so the SDK isn't part of the main bundle.
  const [{ default: Anthropic }, { z }, { betaZodOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('zod'),
    import('@anthropic-ai/sdk/helpers/beta/zod'),
  ]);
  const Schema = z.object({
    is_english: z.boolean(),
    source_language: z.string(),
    name: z.string(),
    traits: z.array(z.string()),
    abilities: z.array(z.string()),
    flavor: z.string(),
  });
  // The key belongs to the person using this browser and never leaves it except to call the API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const image = await imagePayload(url);
  try {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      // A short translation task: low effort keeps hover latency down.
      output_config: { effort: 'low', format: betaZodOutputFormat(Schema) },
      // Haiku has no server-side fallback; the others retry a declined request on another model.
      ...(model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', ...image } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });
    if (res.stop_reason === 'refusal') throw new Error('The model declined to translate this card');
    const out = res.parsed_output;
    if (!out) throw new Error(res.stop_reason === 'max_tokens' ? 'Translation was cut off' : 'Could not read the translation');
    return { isEnglish: out.is_english, language: out.source_language, name: out.name, traits: out.traits, abilities: out.abilities, flavor: out.flavor, at: Date.now() };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic API key was rejected. Check it in Account → Card translation.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('Your API key does not have access to this model.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API. Try again in a moment.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API.');
    if (e instanceof Anthropic.APIError) throw new Error(`Translation failed (${e.status}): ${e.message}`);
    throw e;
  }
}

/**
 * A translation panel that follows whichever card is being previewed. Call show() on hover;
 * it waits briefly so sweeping the mouse across cards doesn't send every one of them.
 */
export function translationBox(cls = '') {
  const el = h('div', { class: `translation ${cls}`, 'aria-live': 'polite' });
  let current = '';
  let timer = 0;
  const render = (t: Translation) => {
    el.replaceChildren();
    if (t.isEnglish) return;
    el.append(
      h('div', { class: 'tr-head' }, `Translated from ${t.language || 'another language'}`),
      t.name ? h('div', { class: 'tr-name' }, t.name) : '',
      t.traits.length ? h('div', { class: 'tr-traits' }, t.traits.map((x) => `《${x}》`).join(' ')) : '',
      ...t.abilities.map((a) => h('p', { class: 'tr-ability' }, a)),
      t.flavor ? h('p', { class: 'tr-flavor' }, t.flavor) : '',
    );
  };
  const run = (id: string, url: string) => {
    el.replaceChildren(h('div', { class: 'tr-status' }, 'Translating…'));
    translateCard(id, url).then(
      (t) => current === id && render(t),
      (e: Error) => current === id && el.replaceChildren(h('div', { class: 'tr-status error' }, e.message)),
    );
  };
  return {
    el,
    show(id: string | undefined, url: string | undefined) {
      clearTimeout(timer);
      if (!id || !url || id === current) return;
      current = id;
      const hit = cachedTranslation(id);
      if (hit) return render(hit);
      el.replaceChildren();
      if (!getApiKey()) return;
      if (!getTranslateSettings().auto) {
        el.append(h('button', { class: 'btn sm', onclick: () => run(id, url) }, '🌐 Translate this card'));
        return;
      }
      timer = window.setTimeout(() => current === id && run(id, url), 450);
    },
    clear() {
      clearTimeout(timer);
      current = '';
      el.replaceChildren();
    },
  };
}
