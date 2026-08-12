# Brew Library

A personal coffee brewing recipe library. No build step, no dependencies, no account —
three files and your recipes in the browser's `localStorage`.

## Running it

Double-click `index.html`, or drag it into a browser tab. That's it.

If you'd rather serve it over HTTP (recommended if you want to open it on your phone
over the local network):

```bash
python3 .claude/serve.py
```

Then open <http://localhost:4173>.

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

Everything is stored under the `brewlibrary.v1` key in `localStorage`, on this device
and this browser only. The `⋮` menu has **Export** (JSON backup), **Import**, and
**Reset** (back to the starter data). Export before resetting or importing — both
overwrite what's there.

## Files

- `index.html` — shell and markup
- `styles.css` — all styling, including dark mode (follows your OS setting)
- `app.js` — data model, rendering, and every interaction
- `.claude/serve.py` — optional local static server
