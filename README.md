# Weiss Online

A browser-based digital playmat for **Weiss Schwarz**. Upload your deck as card images, open a room, and play against a friend online.

The mat does **not** enforce rules or script card effects. It assumes both players know the game and their own cards. It gives you the zones, the card movement, and one-click helpers for the things you do constantly: draw, look at the top X, trigger check, damage, refresh, level up, pay stock, encore, markers and so on.

## Features

### Playmat
- All zones: Deck, Hand, Waiting Room, Clock (7 slots), Level, Stock, Memory, Climax Zone, a **Resolution Zone** for each player, and 5 stage slots (3 center, 2 back).
- Card states: **stand / rest / reverse**, face-down cards, **markers** under characters, power modifiers and free-text notes.
- **Hover menus** on every zone and card, with an **X counter** (−/+, mouse wheel, or number keys) for "up to X" effects:
  - **Deck:** draw 1 or X · look at top X · search deck · reveal top · trigger check · **brainstorm X** (flips to Resolution and logs the climax count) · top X / bottom card / bottom X → Resolution · top X → Waiting Room / Stock / Clock / Memory / Level / bottom · take X damage · shuffle · refresh
  - **Hand:** play to any stage slot · climax · resolution (events and counters) · clock & draw 2 · reveal · mulligan
  - **Stage card:** stand / rest / reverse · front / side / direct attack (rests the card and does the trigger check) · power ± · **soul ± · level ±** · notes · encore (3, X or free) · markers from deck top · move or swap slots · send anywhere
  - **Resolution:** single card or all → Stock / Waiting Room / Clock / Hand / deck bottom / stage
  - **Stock:** pay 1, 2, 3 or X · top → hand · bottom → Waiting Room · look
  - **Clock:** level up (picker for the first 7) · heal 1 or X
  - **Waiting Room:** view and search · top → hand · refresh
- **Look / search viewer:** select cards (click order is kept), send them anywhere (including **as markers under a character**), drag to reorder, then choose where the rest go (top, bottom, Waiting Room, stock, clock, shuffle). Optionally reveal them to your opponent.
- **Damage helper:** flips cards one at a time into the Resolution Zone and stops automatically at a card tagged as a climax. Then one click sends them to the Waiting Room (cancelled) or to the Clock.
- **Drag & drop** everywhere. Shift+drop on a character adds a marker; Shift+drop on the deck puts the card on the bottom.
- Undo (Ctrl+Z), game log, chat, phase/turn tracker, coin flip, d6, and a solo autosave you can resume or end from the Play page.
- **Cards size themselves to fill the window.** Your opponent's side is drawn slightly smaller so yours can be bigger. Turn controls and both Resolution Zones sit in a column on the left. ⚙ → Card size goes above 100% if you want even bigger cards (the board then scrolls).
- The sidebar shows a large copy of whatever card you hover.

### Online play
- Peer-to-peer over WebRTC using [PeerJS](https://peerjs.com/). The host gets a 6-character room code and an invite link (`?room=CODE`).
- No game server to run. Card images are sent directly to your opponent when you connect.
- Hidden information stays hidden: your deck, hand and stock are sent only as card backs unless you reveal them.
- You can act on your opponent's cards and deal damage to them. Their client applies the change and logs it:
  - **Their characters:** stand / rest / reverse, power ±, soul ±, level ±, add a note (e.g. "doesn't stand next turn"), move to another of their slots, or send to hand / Waiting Room / Stock / Clock / Memory / deck top or bottom.
  - **Their stock:** send the top or bottom card to the Waiting Room.
  - **Their deck:** look at the top X. Only you see the cards; their owner doesn't. Then send any of them to their Waiting Room, Clock, Stock or deck bottom.
- Deck shuffles give every card a new id, so the network data never reveals deck order.

### Library & deck builder
- **Upload individual card images** or **import a full deck as a `.zip` of 50 images**. A warning appears if a zip has more or fewer than 50 cards.
- All cards go into one **card library** shared across your decks, with duplicate images detected automatically.
- **Deck builder:** click a library card to add a copy, Shift+click to add 4, right-click to remove one, Shift+right-click to remove all. **＋1 each shown** adds every card matching the search. **Clear deck** empties a deck; **Delete all decks** removes every deck. Shows a live count against 50, the climax count (max 8), and copies of each name (max 4).
- Hover any card in the Library or Deck Builder to see it enlarged at the side of the screen.
- **Bulk actions in the Library:** ☑ Select (or Ctrl/Shift+click) to pick cards, Shift+click for a range, Ctrl+A for everything shown. Then delete, mark as climax / not climax, or add them to a deck (1–4 copies each). **Clean up…** deletes cards not in any deck, everything matching the current filter, or the whole library. Large deletes ask you to type DELETE.
- Sort by name or upload date, and filter to cards not in any deck.
- **Folders:** a folder list beside the Library. A `.zip` import goes into a folder named after the zip. Create, rename and delete folders, and drag cards (or a whole selection) onto a folder, or use **📁 Move to folder…**. Images uploaded while a folder is open go into it. Deleting a folder can keep its cards (they move to Unfiled) or delete them too. The Deck Builder can filter its library by folder.
- Landscape images are tagged as **climax** automatically; you can toggle this per card.
- Export any deck back out as a `.zip`.

### Accessibility
- **Account → Accessibility & display:** larger text and buttons, high contrast, reduce motion (on by default if your system asks for it), turn the hover preview on or off, and skip the confirmation for single deletes.
- Everything works from the keyboard: Tab moves between cards, Enter opens or adds a card, and focus is always outlined. Shortcuts: in a game **D** draw, **N** next phase, **T** trigger check, **Ctrl+Z** undo. In the Library **S** select, **Ctrl+A** select all, **Delete** removes the selection, **/** searches.

### Profiles (no server needed)
- On first visit you create a **profile**: a name and an optional password. Several people can share one browser, and each profile has its **own library, decks, last-used deck and solo autosave**.
- Choose **Keep me signed in** to skip the sign-in screen next time on that device.
- Everything is stored in the browser (IndexedDB plus localStorage). Nothing is uploaded.
- The password is hashed with PBKDF2 and stops other people on the same browser from opening your profile. It does **not** encrypt your data.
- **Account → Export backup** downloads a `.zip` of every card image and deck in the profile. Import it on another device or browser (or choose **Create from backup** on the sign-in screen) to move your data. Clearing browser data deletes profiles, so keep a backup.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Deploying (GitHub Pages)

Every push to `main` builds and deploys via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Under **Settings → Pages**, set the source to **GitHub Actions**.

### Connection troubleshooting
PeerJS uses public STUN servers, which works for most home networks. Players on very strict networks (some campus or corporate networks, or mobile carriers) may need a TURN relay. Add one as the `VITE_ICE_SERVERS` secret or env var:

```
[{"urls":"turn:your.turn.server:3478","username":"user","credential":"pass"}]
```

## Tech
Vite + TypeScript with no framework. [PeerJS](https://peerjs.com/) for networking, [fflate](https://github.com/101arrowz/fflate) for zip files. No backend: the site is fully static.

## Disclaimer
This is an unofficial fan-made tool and is not affiliated with Bushiroad. No card images are included; players upload their own.
