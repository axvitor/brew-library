# Brew Library

A personal coffee brewing recipe library. No build step, no bundler — plain HTML/CSS/JS,
with Google sign-in and your recipes synced in real time across every device via Firebase.

## Running it

Because it now signs you in with Google, it needs to be served over `http://` or
`https://` — opening `index.html` directly (`file://`) won't work for sign-in.

Locally:

```bash
python3 .claude/serve.py
```

Then open <http://localhost:4173>.

Deployed, it's a static site — see **Hosting** below.

## Access — invite-only

There's no public sign-up. Only Google accounts whose email is in the Firestore
`config/allowlist` document can get past the sign-in screen — everyone else sees
"Not on the list." Add or remove people directly in the Firebase console
(Firestore Database → Data → `config/allowlist` → edit the `emails` array), no code
changes needed. Each person's recipes live in their own private Firestore document
(`libraries/{their-uid}`) — nobody can read or write anyone else's, enforced by the
rules in `firestore.rules`.

The one exception: the account matching `OWNER_EMAIL` in `app.js` starts with the
101-recipe starter library baked into the app; everyone else invited starts blank
(with the same reusable grinders/methods/styles, just no coffees or recipes of
their own).

## Firebase setup (one-time)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. **Build → Authentication → Sign-in method** → enable **Google**
3. **Build → Firestore Database** → create it (production mode)
4. **Firestore Database → Rules** → paste in `firestore.rules` → Publish
5. **Firestore Database → Data** → create a `config` collection → document ID
   `allowlist` → field `emails` (array) → add the lowercase email of everyone allowed in
6. **Project settings → Your apps → `</>`** → register a web app → copy the
   `firebaseConfig` object into `firebase-init.js`
7. **Authentication → Settings → Authorized domains** → add whatever domain you deploy
   to (e.g. `your-username.github.io`) — `localhost` is already included by default

## How it's organised

Four **reusable entities** live independently of the recipes that reference them:

| Entity | Seeded with |
| --- | --- |
| Coffee | three example coffees — edit or delete them |
| Grinder | KINGrinder, Starseeker, Timemore C2 |
| Brewing method | V60, Origami, AeroPress, Timemore B75, Moka Pot, Espresso, Espresso — DEX basket, Espresso — 3Bomber (18g basket), Filtro Oster |
| Recipe style | James Hoffmann, Tetsu Kasuya (Sweet / Acid / Strength), Espresso |

Manage all four under **Library** in the header, or add one inline with the `+` button
next to any selector in the recipe form. A recipe stores only the *id* of each entity,
so renaming a coffee or grinder updates it everywhere at once.

A saved recipe holds: coffee, grinder, grind size, method, style, dose, water,
temperature, brew time, the pouring steps, personal notes and a rating.

## Pouring steps follow the recipe style

Pouring steps aren't stored per recipe — they're always attached to the recipe
**style**, computed on the fly from that style's formula and scaled to the recipe's
dose, water and method. Change the dose or water later and the steps rescale
automatically; there's nothing to keep in sync by hand.

- **James Hoffmann** (Ultimate V60) — bloom at 2× dose, swirl flat, pour steadily to
  60% of total by 1:15, the remaining 40% gently by 1:45, stir clockwise then
  anti-clockwise, drawdown. Selecting the AeroPress method swaps in his Ultimate
  AeroPress technique instead (pour all, seal, swirl at 2:00, press from 2:30).
- **Tetsu Kasuya — Sweet** — 4:6 method with a smaller first pour (5/12 : 7/12 of the
  first 40%).
- **Tetsu Kasuya — Acid** — 4:6 with a larger first pour (7/12 : 5/12).
- **Tetsu Kasuya — Strength** — balanced first 40%, remaining 60% split into three
  pours.
- **Espresso** — a pressure shot, not a pour: dialled in by dose, grind and shot time,
  so it deliberately has no pour schedule. Every recipe on an espresso method uses
  this style.

Styles you add yourself have no formula, so their recipes get a manual step editor
instead — write the pour schedule by hand for those.

## Your data

Signed-in users' libraries live in Firestore and sync in real time — add a recipe on
your phone, it appears on your desktop within a second or two, no refresh needed. The
`⋮` menu still has **Export** (JSON backup), **Import**, and **Reset** (back to your
starting library) for local backups. Export before resetting or importing — both
overwrite what's there.

## Files

- `index.html` — shell and markup
- `styles.css` — all styling, including dark mode (follows your OS setting)
- `app.js` — data model, rendering, auth-gated boot, and every interaction
- `firebase-init.js` — Firebase config + the `window.Brew` bridge (auth, Firestore reads/writes)
- `firestore.rules` — security rules to paste into the Firebase console
- `.claude/serve.py` — local static server (required now, since sign-in needs http/https)
