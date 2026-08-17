# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the owner (account matching `OWNER_EMAIL` in `app.js`), who brews pour-over,
AeroPress, Moka, and espresso at home and wants a fast, no-friction recipe reference
while dialling in and brewing coffee. A small circle of friends and family also sign in
with their own Google account and get their own private library — open access, no
allowlist or invite step (see README "Access"). Each signed-in user's data is fully
isolated in Firestore (`libraries/{their-uid}`).

## Product Purpose

A personal coffee brewing recipe library: track coffees, grinders, brewing methods,
and recipe styles, and save recipes (dose, water, temperature, grind, brew time,
notes, rating) that sync in real time across every device via Firebase. Success is a
brewer being able to open the app mid-process and get the exact pour schedule for
their recipe without re-deriving or re-typing it.

## Positioning

Two mechanisms together, neither of which a notes app or spreadsheet gives you:

1. **Style-driven pour schedules** — pouring steps aren't stored per recipe. They're
   computed live from the recipe's *style* formula (James Hoffmann, Tetsu Kasuya
   4:6 Sweet/Acid/Strength, Espresso) and scaled to that recipe's dose, water, and
   method. Change the dose or water later and the steps rescale automatically, with
   nothing to keep in sync by hand. Styles the user adds themselves have no formula,
   so their recipes fall back to a manual step editor.
2. **Reusable entity model** — Coffee, Grinder, Brewing method, and Recipe style are
   four independent entities that recipes reference by id (not by copied value).
   Renaming or editing a coffee or grinder updates every recipe that references it at
   once.

## Operating Context

Used at home around the brewing process itself — looking up or entering a recipe
before/during brewing, checking the computed pour schedule while actively pouring,
and occasionally managing the reusable Library (coffees, grinders, methods, styles)
between brews. Runs as a static site (no build step, no bundler — plain HTML/CSS/JS)
served over http/https (required for Google sign-in; `file://` doesn't work). Data
syncs in real time via Firestore; the `⋮` menu also offers local Export (JSON)/Import/
Reset as a manual backup path.

## Capabilities and Constraints

- No build step or bundler: plain HTML (`index.html`), CSS (`styles.css`), JS
  (`app.js`), plus `firebase-init.js` for the Firebase config and auth/Firestore
  bridge (`window.Brew`).
- Auth is Google sign-in only, open to anyone with a Google account — no allowlist.
  The account matching `OWNER_EMAIL` boots with a starter library of 101 seeded
  recipes; every other account starts blank but shares the same seeded reusable
  grinders/methods/styles.
- Per-user data isolation is enforced by `firestore.rules` (`libraries/{uid}`, a user
  can only read/write their own document).
- Sign-up is open and unbounded/unrate-limited by the app itself — Firestore usage
  should be watched in the Firebase console if the link is ever shared widely.
- Dark mode already exists and follows the OS setting (`styles.css`).
- Four reusable entity types: Coffee, Grinder, Brewing method, Recipe style. A recipe
  references each by id only.
- Built-in style formulas exist only for James Hoffmann, Tetsu Kasuya (Sweet/Acid/
  Strength), and Espresso; user-added styles have no formula and get a manual pour
  step editor instead.

## Brand Commitments

Name: "Brew Library" (see `<title>` in `index.html`: "Brew Library — Coffee Recipes").
No other confirmed identity constraints (no logo, tagline, or color commitments on
record).

## Evidence on Hand

Starter library: 101 seeded recipes for the owner account, plus seed reusable
entities — Coffees (three examples), Grinders (KINGrinder, Starseeker, Timemore C2),
Brewing methods (V60, Origami, AeroPress, Timemore B75, Moka Pot, Espresso, Espresso
— DEX basket, Espresso — 3Bomber 18g basket, Filtro Oster), and Recipe styles (James
Hoffmann; Tetsu Kasuya Sweet/Acid/Strength; Espresso). No external press, testimonials,
or case studies — this is a personal/small-group tool, not a marketed product; future
work must not fabricate any of that.

## Product Principles

1. **The pour schedule is the payoff.** Every recipe view exists to get the brewer to
   a correct, already-scaled pour schedule with minimal friction — that's the moment
   that matters most, especially mid-brew.
2. **Reusable entities stay the source of truth.** Coffee/Grinder/Method/Style data
   lives once and is referenced by id; UI and interactions should never invite
   duplicating that data into a recipe.
3. **Real-time sync is invisible infrastructure.** Cross-device consistency should
   need no user action (no manual "save" or "refresh" ritual); Export/Import/Reset
   exist only as an explicit backup escape hatch, not the primary flow.
4. **Open access, private data.** Anyone with a Google account can join, but design
   and data model must keep each person's library strictly private and never leak or
   blend across accounts.
5. **No-build simplicity is a constraint, not a limitation to design around.** Plain
   HTML/CSS/JS stays deployable as a static site; visual or interaction choices
   should not assume a build step, bundler, or framework becomes available.
</content>
</invoke>
