import './style.css';
import { currentProfile, onProfileChange, restoreSession } from './store';
import { h } from './util/dom';
import { navigate, onNavigate, register, setContentRoot, type Screen } from './ui/router';
import { renderLibrary } from './ui/library';
import { renderDecks } from './ui/decks';
import { renderAccount } from './ui/account';
import { renderLogin } from './ui/login';
import { renderPlay, setStartGame } from './ui/play';
import { clearUrlCache } from './ui/cardview';
import { mountGame } from './game/screen';
import { installMenus } from './game/menu';
import { applyPrefs } from './util/prefs';

const app = document.getElementById('app')!;

register('play', renderPlay);
register('library', renderLibrary);
register('decks', renderDecks);
register('account', renderAccount);

const navBtns = new Map<Screen, HTMLButtonElement>();
const userBadge = h('button', { class: 'user-badge', onclick: () => navigate('account') });
const content = h('div', { class: 'content' });

function shell() {
  const nav = h('nav', { class: 'nav' });
  for (const [s, label] of [
    ['play', '▶ Play'],
    ['library', '🗂 Library'],
    ['decks', '🃏 Decks'],
    ['account', '👤 Account'],
  ] as [Screen, string][]) {
    const b = h('button', { class: 'nav-btn', onclick: () => navigate(s) }, label) as HTMLButtonElement;
    navBtns.set(s, b);
    nav.append(b);
  }
  return h(
    'div',
    { class: 'shell' },
    h('header', { class: 'app-head' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }), 'Weiss Online'), nav, h('div', { class: 'spacer' }), userBadge),
    content,
  );
}

function updateUserBadge() {
  const p = currentProfile();
  userBadge.textContent = p ? `👤 ${p.name}` : '';
  userBadge.title = 'Profile saved in this browser. Click to manage it or switch profiles';
}

onNavigate((s) => navBtns.forEach((b, k) => b.classList.toggle('active', k === s)));

let leaveGame: (() => void) | null = null;
function showShell(screen: Screen = 'play') {
  if (!currentProfile()) return renderLogin(app);
  app.innerHTML = '';
  app.append(shell());
  setContentRoot(content);
  updateUserBadge();
  navigate(screen);
}

setStartGame((game) => {
  leaveGame?.();
  leaveGame = mountGame(app, game, () => {
    leaveGame?.();
    leaveGame = null;
    showShell('play');
  });
});

let shownProfile: string | null = null;
onProfileChange(() => {
  const id = currentProfile()?.id ?? null;
  if (id === shownProfile) {
    updateUserBadge();
    return;
  }
  shownProfile = id;
  clearUrlCache();
  leaveGame?.();
  leaveGame = null;
  showShell('play');
});

applyPrefs();
// Card translation was removed; clear anything it saved.
for (const k of ['wom-anthropic-key', 'wom-translations', 'wom-translations-free', 'wom-translate']) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
}
installMenus();
restoreSession();
shownProfile = currentProfile()?.id ?? null;
showShell('play');
