import { changePassword, currentProfile, deleteCurrentProfile, hasPassword, renameProfile, signOut } from '../store';
import { exportBackup, importBackup } from '../store/backup';
import { confirmDialog, h, promptDialog, toast } from '../util/dom';
import { pickFiles } from './uploads';
import { getPrefs, setPref, type Prefs } from '../util/prefs';
import {
  clearTranslations,
  getApiKey,
  getTranslateSettings,
  setApiKey,
  setTranslateSettings,
  translationCount,
  TRANSLATE_MODELS,
  type TranslateModel,
} from '../util/translate';

export function renderAccount(root: HTMLElement) {
  const p = currentProfile();
  if (!p) return;
  const page = h('div', { class: 'page narrow-page' }, h('h1', null, 'Account'));
  root.append(page);

  const err = (e: unknown) => toast((e as Error).message, 'error', 5000);

  // ── accessibility & display (per browser, shared by all profiles)
  const prefs = getPrefs();
  const opt = (key: keyof Prefs, label: string, hint: string) => {
    const box = h('input', { type: 'checkbox', checked: prefs[key] }) as HTMLInputElement;
    box.onchange = () => setPref(key, box.checked);
    return h('label', { class: 'pref-row' }, box, h('span', null, h('b', null, label), h('span', { class: 'muted small' }, hint)));
  };
  const accessibility = h('div', { class: 'card-panel stack' },
    h('h3', null, 'Accessibility & display'),
    opt('largeUi', 'Larger text and buttons', 'Scales up the Library, Decks, Play and Account pages and dialogs.'),
    opt('highContrast', 'High contrast', 'Brighter text, stronger borders and focus outlines.'),
    opt('reduceMotion', 'Reduce motion', 'Turns off animations and sliding effects.'),
    opt('hoverPreview', 'Enlarged card on hover', 'Shows a big copy of a card at the side of the screen when you hover it in the Library or Deck Builder.'),
    opt('confirmDeletes', 'Ask before deleting one card or deck', 'Bulk deletes (Delete all, Delete selected) always ask.'),
    h('p', { class: 'muted small' }, 'In a game: ⚙ Settings has the card size slider. Keyboard: D draw, N next phase, T trigger check, Ctrl+Z undo. Library: S select, Ctrl+A select all, Delete removes selected, / search. Tab moves between cards; Enter opens or adds them.'),
  );

  // ── profile
  const nameIn = h('input', { class: 'input', value: p.name, maxlength: 40 }) as HTMLInputElement;
  page.append(
    h('div', { class: 'card-panel stack' },
      h('h3', null, 'Profile'),
      h('p', { class: 'muted' }, 'Your profile, library and decks are saved in this browser on this device. Use a backup to move them to another device or browser.'),
      h('label', null, 'Name (shown to opponents)'),
      h('div', { class: 'row' },
        nameIn,
        h('button', { class: 'btn', onclick: () => { try { renameProfile(nameIn.value); toast('Saved', 'ok'); } catch (e) { err(e); } } }, 'Save'),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => signOut() }, '⇄ Switch profile / sign out'),
      ),
    ),
  );

  // ── password
  const oldPw = h('input', { class: 'input', type: 'password', placeholder: 'Current password', autocomplete: 'current-password' }) as HTMLInputElement;
  const newPw = h('input', { class: 'input', type: 'password', placeholder: 'New password (blank = no password)', autocomplete: 'new-password' }) as HTMLInputElement;
  const newPw2 = h('input', { class: 'input', type: 'password', placeholder: 'Confirm new password', autocomplete: 'new-password' }) as HTMLInputElement;
  page.append(
    h('div', { class: 'card-panel stack' },
      h('h3', null, hasPassword(p) ? 'Change password' : 'Add a password'),
      h('p', { class: 'muted small' }, 'This keeps other people who use this browser out of your profile. It does not encrypt your data.'),
      hasPassword(p) ? oldPw : '',
      newPw,
      newPw2,
      h('button', {
        class: 'btn',
        onclick: async () => {
          if (newPw.value !== newPw2.value) return toast('Passwords do not match', 'warn');
          try {
            await changePassword(oldPw.value, newPw.value);
            toast(newPw.value ? 'Password saved' : 'Password removed', 'ok');
            root.innerHTML = '';
            renderAccount(root);
          } catch (e) {
            err(e);
          }
        },
      }, 'Save password'),
    ),
  );

  // ── card translation (per browser)
  const tset = getTranslateSettings();
  const keyIn = h('input', { class: 'input', type: 'password', placeholder: getApiKey() ? 'Key saved (enter a new one to replace it)' : 'sk-ant-…', autocomplete: 'off' }) as HTMLInputElement;
  const modelSel = h('select', { class: 'input' }, TRANSLATE_MODELS.map((m) => h('option', { value: m.id }, m.label))) as HTMLSelectElement;
  modelSel.value = tset.model;
  modelSel.onchange = () => setTranslateSettings({ model: modelSel.value as TranslateModel });
  const autoBox = h('input', { type: 'checkbox', checked: tset.auto }) as HTMLInputElement;
  autoBox.onchange = () => setTranslateSettings({ auto: autoBox.checked });
  const keyStatus = h('span', { class: 'muted small' });
  const clearBtn = h('button', { class: 'btn sm' }) as HTMLButtonElement;
  const refreshTr = () => {
    keyStatus.textContent = getApiKey() ? '✓ API key saved in this browser' : 'No API key saved';
    clearBtn.textContent = `Clear saved translations (${translationCount()})`;
    clearBtn.disabled = !translationCount();
  };
  clearBtn.onclick = () => (clearTranslations(), refreshTr(), toast('Saved translations cleared', 'ok'));
  refreshTr();
  const translation = h('div', { class: 'card-panel stack' },
    h('h3', null, 'Card translation'),
    h('p', { class: 'muted' }, 'Hover a card that isn’t in English and an English translation of its name, traits and abilities appears under the enlarged card: in games, in the Library and Deck Builder, and in look/search windows. Each card is translated once and saved in this browser.'),
    h('p', { class: 'muted small' }, 'This uses Claude through your own Anthropic API key (create one at console.anthropic.com). When a card is translated, its image is sent to Anthropic and the request is billed to your API account. The key is kept only in this browser and is sent only to Anthropic.'),
    h('label', null, 'Anthropic API key'),
    h('div', { class: 'row' },
      keyIn,
      h('button', {
        class: 'btn primary',
        onclick: () => {
          if (!keyIn.value.trim()) return toast('Paste your API key first', 'warn');
          setApiKey(keyIn.value);
          keyIn.value = '';
          keyIn.placeholder = 'Key saved (enter a new one to replace it)';
          refreshTr();
          toast('API key saved', 'ok');
        },
      }, 'Save key'),
      h('button', {
        class: 'btn danger',
        onclick: () => {
          setApiKey('');
          keyIn.placeholder = 'sk-ant-…';
          refreshTr();
          toast('API key removed', 'ok');
        },
      }, 'Remove'),
    ),
    keyStatus,
    h('label', null, 'Model'),
    modelSel,
    h('label', { class: 'pref-row' }, autoBox, h('span', null, h('b', null, 'Translate automatically on hover'), h('span', { class: 'muted small' }, 'Off: a “Translate this card” button appears instead, so nothing is sent until you click it.'))),
    h('div', { class: 'row' }, clearBtn),
  );

  // ── backup
  const progress = h('div', { class: 'muted' });
  page.append(accessibility, translation);
  page.append(
    h('div', { class: 'card-panel stack' },
      h('h3', null, 'Backup & move to another device'),
      h('p', { class: 'muted' }, 'Export downloads a .zip with every card image and deck in this profile. Import it here, or on another device, to restore everything. Clearing your browser data deletes your profile, so keep a backup.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn primary',
          onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.disabled = true;
            try {
              const blob = await exportBackup(p.name, (m) => (progress.textContent = m));
              const a = h('a', { href: URL.createObjectURL(blob), download: `weiss-mat-${p.name.replace(/[^\w-]+/g, '_')}-backup.zip` });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
              progress.textContent = 'Backup downloaded.';
            } catch (x) {
              progress.textContent = '';
              err(x);
            }
            b.disabled = false;
          },
        }, '⬇ Export backup'),
        h('button', {
          class: 'btn',
          onclick: async () => {
            const f = (await pickFiles('.zip,application/zip', false))[0];
            if (!f) return;
            try {
              const r = await importBackup(f, (m) => (progress.textContent = m));
              progress.textContent = `Imported ${r.cards} cards and ${r.decks} decks.`;
            } catch (x) {
              progress.textContent = '';
              err(x);
            }
          },
        }, '⬆ Import backup'),
      ),
      progress,
    ),
  );

  // ── danger
  page.append(
    h('div', { class: 'card-panel stack' },
      h('h3', null, 'Delete profile'),
      h('p', { class: 'muted small' }, 'Permanently removes this profile and its library, decks and saved game from this browser.'),
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!(await confirmDialog(`Delete the profile "${p.name}" and everything in it? This cannot be undone. Export a backup first if you might want it later.`, 'Delete'))) return;
          const typed = await promptDialog(`Type ${p.name} to confirm`, '', 'Delete forever');
          if (typed?.trim() !== p.name) return typed !== null && toast('Name did not match. Nothing was deleted.', 'warn');
          await deleteCurrentProfile();
          toast('Profile deleted', 'ok');
        },
      }, '🗑 Delete this profile'),
    ),
  );
}
