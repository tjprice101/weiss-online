import { createProfile, hasPassword, listProfiles, signIn, type Profile } from '../store';
import { importBackup } from '../store/backup';
import { clear, h, toast } from '../util/dom';
import { pickFiles } from './uploads';
import { refresh } from './router';

/** Full-page profile picker shown when nobody is signed in on this browser. */
export function renderLogin(root: HTMLElement) {
  const profiles = listProfiles();
  const remember = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const rememberRow = h('label', { class: 'check' }, remember, ' Keep me signed in on this device');
  const body = h('div', { class: 'stack' });

  const page = h(
    'div',
    { class: 'login-page' },
    h('div', { class: 'login-box card-panel' },
      h('div', { class: 'brand login-brand' }, h('span', { class: 'logo' }), 'Weiss Online Mat'),
      h('p', { class: 'muted' }, 'Profiles live in this browser. Each one has its own card library, decks and saved game. Nothing is uploaded anywhere.'),
      body,
    ),
  );
  clear(root);
  root.append(page);

  const showPicker = () => {
    clear(body);
    if (!profiles.length) return showCreate();
    body.append(h('h3', null, 'Who’s playing?'));
    for (const p of profiles) {
      body.append(
        h('button', { class: 'profile-btn', onclick: () => (hasPassword(p) ? showPassword(p) : go(() => signIn(p.id, '', remember.checked))) },
          h('span', { class: 'avatar' }, p.name.slice(0, 1).toUpperCase()),
          h('span', { class: 'grow' }, p.name),
          hasPassword(p) ? h('span', { class: 'muted', title: 'Password protected' }, '🔒') : '',
        ),
      );
    }
    body.append(rememberRow, h('button', { class: 'btn', onclick: showCreate }, '＋ New profile'));
  };

  const showPassword = (p: Profile) => {
    clear(body);
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password' }) as HTMLInputElement;
    const submit = () => go(() => signIn(p.id, pass.value, remember.checked));
    pass.onkeydown = (e) => e.key === 'Enter' && submit();
    body.append(
      h('h3', null, `Sign in as ${p.name}`),
      pass,
      rememberRow,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: submit }, 'Sign in'), h('button', { class: 'btn', onclick: showPicker }, 'Back')),
    );
    pass.focus();
  };

  const showCreate = () => {
    clear(body);
    const name = h('input', { class: 'input', placeholder: 'Name (shown to opponents)', maxlength: 40, autocomplete: 'username' }) as HTMLInputElement;
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password (optional)', autocomplete: 'new-password' }) as HTMLInputElement;
    const pass2 = h('input', { class: 'input', type: 'password', placeholder: 'Confirm password', autocomplete: 'new-password' }) as HTMLInputElement;
    const create = async (thenImport = false) => {
      if (pass.value !== pass2.value) return toast('Passwords do not match', 'warn');
      let file: File | undefined;
      if (thenImport) {
        file = (await pickFiles('.zip,application/zip', false))[0];
        if (!file) return;
      }
      await go(async () => {
        await createProfile(name.value, pass.value, remember.checked);
        if (file) {
          const t = toast('Restoring backup…', 'info', 120_000);
          try {
            const r = await importBackup(file, (m) => (t.textContent = m));
            toast(`Restored ${r.cards} cards and ${r.decks} decks`, 'ok', 5000);
            refresh();
          } catch (e) {
            toast('Backup import failed: ' + (e as Error).message, 'error', 7000);
          } finally {
            t.remove();
          }
        }
      });
    };
    body.append(
      h('h3', null, profiles.length ? 'New profile' : 'Create your profile'),
      name,
      pass,
      pass2,
      h('p', { class: 'muted small' }, 'The password only stops other people who use this browser from opening your profile. Leave it blank if you don’t share the computer.'),
      rememberRow,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => create() }, 'Create profile'),
        h('button', { class: 'btn', title: 'Create the profile and fill it from a backup .zip exported on another device', onclick: () => create(true) }, '⬆ Create from backup'),
        profiles.length ? h('button', { class: 'btn', onclick: showPicker }, 'Back') : '',
      ),
    );
    name.focus();
  };

  const go = async (fn: () => Promise<unknown>) => {
    body.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error', 5000);
      body.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = false));
    }
  };

  showPicker();
}
