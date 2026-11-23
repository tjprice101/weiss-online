import { changePassword, currentProfile, deleteCurrentProfile, hasPassword, renameProfile, signOut } from '../store';
import { exportBackup, importBackup } from '../store/backup';
import { confirmDialog, h, promptDialog, toast } from '../util/dom';
import { pickFiles } from './uploads';

export function renderAccount(root: HTMLElement) {
  const p = currentProfile();
  if (!p) return;
  const page = h('div', { class: 'page narrow-page' }, h('h1', null, 'Account'));
  root.append(page);

  const err = (e: unknown) => toast((e as Error).message, 'error', 5000);

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

  // ── backup
  const progress = h('div', { class: 'muted' });
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
