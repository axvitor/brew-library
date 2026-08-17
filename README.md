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

## Access — open to anyone with a Google account

There's no allowlist and no invite step — anyone who clicks "Continue with Google"
gets in and gets their own private library. Each person's recipes live in their own
Firestore document (`libraries/{their-uid}`); nobody can read or write anyone else's,
enforced by the rules in `firestore.rules`.

The one exception: the account matching `OWNER_EMAIL` in `app.js` starts with the
101-recipe starter library baked into the app; everyone else starts blank (with the
same reusable grinders/methods/styles, just no coffees or recipes of their own).

Since sign-up is open, keep an eye on Firestore usage in the Firebase console
(Usage tab) if you ever share the link widely — the free tier is generous for a
small group, but unbounded sign-ups aren't rate-limited by anything in this app.

## Firebase setup (one-time)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. **Build → Authentication → Sign-in method** → enable **Google**
3. **Build → Firestore Database** → create it (production mode)
4. **Firestore Database → Rules** → paste in `firestore.rules` → Publish
5. **Project settings → Your apps → `</>`** → register a web app → copy the
   `firebaseConfig` object into `firebase-init.js`
6. **Authentication → Settings → Authorized domains** → add whatever domain you deploy
   to (e.g. `your-username.github.io`) — `localhost` is already included by default

## How it's organised

Five **reusable entities** live independently of the recipes that reference them:

| Entity | Seeded with |
| --- | --- |
| Roaster | derived from the coffees already in your library |
| Coffee | three example coffees — edit or delete them |
| Grinder | KINGrinder, Starseeker, Timemore C2 |
| Brewing method | V60, Origami, AeroPress, Timemore B75, Moka Pot, Espresso, Espresso — DEX basket, Espresso — 3Bomber (18g basket), Filtro Oster |
| Recipe style | James Hoffmann, Tetsu Kasuya (Sweet / Acid / Strength), Espresso |

Manage all four under **Library** in the header, or add one inline with the `+` button
next to any selector in the recipe form. A recipe stores only the *id* of each entity,
so renaming a coffee or grinder updates it everywhere at once.

A saved recipe holds: coffee, grinder, grind size, method, style, dose, water,
temperature, brew time, personal notes and a rating. The new-recipe form asks in
that order — roaster, then coffee, method, grinder, style — narrowing from shelf
to cup, and every field starts empty rather than pre-filled.

A coffee's roaster is typed into an autocomplete backed by the roasters already on
record: a matching name reuses that roaster (so one roaster never ends up spelled
three ways), and an unrecognised one creates it. Roasters also carry a location,
editable under **Library → Roasters**.

## Pouring steps follow the recipe style

Pouring steps aren't stored per recipe — they're always attached to the recipe
**style**, computed on the fly from that style's formula and scaled to the recipe's
dose, water and method. Change the dose or water later and the steps rescale
automatically; there's nothing to keep in sync by hand.

- **James Hoffmann** — five equal pours (each a fifth of the total water) at 0:00,
  0:45, 1:10, 1:30 and 1:50, then let it draw down — no stirring needed. Selecting
  the AeroPress method swaps in his Ultimate AeroPress technique instead (pour all,
  seal, swirl at 2:00, press from 2:30).
- **Tetsu Kasuya — Sweet** — 4:6 method with a smaller first pour (5/12 : 7/12 of the
  first 40%).
- **Tetsu Kasuya — Acid** — 4:6 with a larger first pour (7/12 : 5/12).
- **Tetsu Kasuya — Strength** — balanced first 40%, remaining 60% split into three
  pours.
- **Espresso** — a pressure shot, not a pour: dialled in by dose, grind and shot time,
  so it deliberately has no pour schedule. Every recipe on an espresso method uses
  this style.

Styles you add yourself get a **step builder** instead of a formula: add Time +
Instruction pairs, reorder them, and see the whole brew as a timeline before you
save. Those steps then belong to the style, so every recipe using it follows the
same schedule and you only write it once. (Recipes saved before styles could carry
their own steps keep theirs — nothing already stored loses its schedule.)

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
