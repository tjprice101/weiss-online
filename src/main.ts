import './style.css';
import { cloudEnabled, currentUser, initAuth, onAuthChange } from './store';
import { h } from './util/dom';
import { navigate, onNavigate, register, refresh, setContentRoot, currentScreen, type Screen } from './ui/router';
import { renderLibrary } from './ui/library';
import { renderDecks } from './ui/decks';
import { renderAccount } from './ui/account';
import { renderPlay, setStartGame } from './ui/play';
import { clearUrlCache } from './ui/cardview';
import { mountGame } from './game/screen';
import { installMenus } from './game/menu';

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
    h('header', { class: 'app-head' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }), 'Weiss Online Mat'), nav, h('div', { class: 'spacer' }), userBadge),
    content,
  );
}

function updateUserBadge() {
  const u = currentUser();
  userBadge.textContent = u ? `☁ ${u.email}` : cloudEnabled ? 'Sign in to sync' : '💾 Saved in this browser';
  userBadge.title = u ? 'Signed in: data saved to your account' : cloudEnabled ? 'Sign in to save your data to the cloud' : 'Data is saved in this browser';
}

onNavigate((s) => navBtns.forEach((b, k) => b.classList.toggle('active', k === s)));

let leaveGame: (() => void) | null = null;
function showShell(screen: Screen = 'play') {
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

onAuthChange(() => {
  clearUrlCache();
  updateUserBadge();
  if (!leaveGame) refresh();
});

installMenus();
initAuth().finally(() => {
  if (!leaveGame) showShell(currentScreen());
});
showShell('play');
