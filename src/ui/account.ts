import { cloudEnabled, currentUser, displayName, migrateLocalToCloud, supabase } from '../store';
import { h, toast } from '../util/dom';

export function renderAccount(root: HTMLElement) {
  const page = h('div', { class: 'page narrow-page' }, h('h1', null, 'Account'));
  root.append(page);

  if (!cloudEnabled || !supabase) {
    page.append(
      h('div', { class: 'card-panel' },
        h('h3', null, 'Cloud accounts are not set up'),
        h('p', null, 'Right now your library and decks are saved in this browser only (IndexedDB). They stay on this device and are not shared between browsers.'),
        h('p', { class: 'muted' }, 'To turn on accounts and cloud saves, the site owner creates a free Supabase project and adds VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. The steps are in the README.'),
      ),
      nameBox(),
    );
    return;
  }
  const sb = supabase;
  const user = currentUser();

  if (!user) {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' }) as HTMLInputElement;
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password (min 6 chars)', autocomplete: 'current-password' }) as HTMLInputElement;
    const busy = (b: boolean) => page.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = b));
    const run = async (fn: () => Promise<{ error: unknown }>, ok: string) => {
      busy(true);
      const { error } = await fn();
      busy(false);
      if (error) toast((error as Error).message, 'error', 6000);
      else toast(ok, 'ok', 6000);
    };
    const redirect = location.origin + location.pathname;
    page.append(
      h('div', { class: 'card-panel stack' },
        h('h3', null, 'Sign in to save your library and decks to the cloud'),
        h('p', { class: 'muted' }, 'With an account you can use your cards and decks on any device, and browse cards other players have uploaded to the community library.'),
        email,
        pass,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => run(() => sb.auth.signInWithPassword({ email: email.value, password: pass.value }), 'Signed in') }, 'Sign in'),
          h('button', { class: 'btn', onclick: () => run(() => sb.auth.signUp({ email: email.value, password: pass.value, options: { emailRedirectTo: redirect } }), 'Account created. Check your email if confirmation is required.') }, 'Create account'),
          h('button', { class: 'btn', onclick: () => run(() => sb.auth.signInWithOtp({ email: email.value, options: { emailRedirectTo: redirect } }), 'Magic link sent. Check your email.') }, '✉ Email me a magic link'),
        ),
      ),
      nameBox(),
    );
    return;
  }

  const nameIn = h('input', { class: 'input', value: displayName() }) as HTMLInputElement;
  const progress = h('div', { class: 'muted' });
  page.append(
    h('div', { class: 'card-panel stack' },
      h('h3', null, 'Signed in'),
      h('p', null, 'Email: ', h('b', null, user.email ?? '')),
      h('label', null, 'Display name (shown to opponents)'),
      h('div', { class: 'row' },
        nameIn,
        h('button', {
          class: 'btn',
          onclick: async () => {
            const { error } = await sb.auth.updateUser({ data: { display_name: nameIn.value.trim() } });
            localStorage.setItem('wom-name', nameIn.value.trim());
            toast(error ? error.message : 'Saved', error ? 'error' : 'ok');
          },
        }, 'Save'),
      ),
      h('button', { class: 'btn danger', onclick: () => sb.auth.signOut() }, 'Sign out'),
    ),
    h('div', { class: 'card-panel stack' },
      h('h3', null, 'Copy local data to your account'),
      h('p', { class: 'muted' }, 'Uploads every card and deck saved in this browser from before you signed in. Cards you already have in the cloud are skipped.'),
      h('button', {
        class: 'btn primary',
        onclick: async (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          b.disabled = true;
          try {
            const r = await migrateLocalToCloud((m) => (progress.textContent = m));
            progress.textContent = `Done: ${r.cards} cards, ${r.decks} decks copied.`;
          } catch (err) {
            progress.textContent = '';
            toast((err as Error).message, 'error');
          }
          b.disabled = false;
        },
      }, '☁ Copy local library & decks'),
      progress,
    ),
  );
}

function nameBox() {
  const nameIn = h('input', { class: 'input', value: localStorage.getItem('wom-name') ?? '' }) as HTMLInputElement;
  return h('div', { class: 'card-panel stack' },
    h('label', null, 'Display name (shown to opponents)'),
    h('div', { class: 'row' },
      nameIn,
      h('button', { class: 'btn', onclick: () => (localStorage.setItem('wom-name', nameIn.value.trim()), toast('Saved', 'ok')) }, 'Save'),
    ),
  );
}
