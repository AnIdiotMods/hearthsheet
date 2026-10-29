# Hearthsheet

An independent, open-source 5e character manager for Windows (Electron + TypeScript + React).
It reads and writes the community compendium XML format, so you can use compendium files you
already own. It ships with no game content apart from an optional small SRD 5.1 sample
(CC-BY-4.0, attribution in the app's Settings → About and in the sample file).

## Run it

- **Windows:** run `release/Hearthsheet 0.1.0.exe` (portable, no install), or unzip
  `release/Hearthsheet-0.1.0-win.zip` and run `Hearthsheet.exe`. The build is unsigned, so
  Windows SmartScreen will warn on first launch ("More info" → "Run anyway").
- **From source:** `npm install`, then `npm run build && npm run electron`. `npm run dev` runs it
  in a browser. `npm run dist:win` rebuilds the Windows packages (works from Linux too).
- **Tests:** `npm test`.

Data is stored locally (IndexedDB in the app profile). Export characters and compendiums to back them up.

## Features (v0.1)

- **Compendium:** import any number of XML files, enable or disable each file, browse and search
  races, classes, backgrounds, feats, spells, items and monsters, and export the merged library.
- **Characters:** create (standard array, point buy, 4d6 or manual), level up and multiclass
  (subclass, optional features, ASI or feat, HP average/roll/manual), remove levels, duplicate,
  import and export XML.
- **Sheet:** ability scores, saves, skills (proficiency/expertise), AC, HP with damage/heal/temp,
  hit dice, initiative, passives, attacks, conditions, exhaustion, death saves, short/long rests,
  class resources, spells with slots (including multiclass and pact slots), inventory with
  equip/attune/quantity/currency/weight, custom items, notes, and a raw XML view.
- **Dice:** `2d6+3`, `1d20+5 adv`, `4d6kh3`, `d%`; every number on the sheet can be clicked to roll.

## Architecture

| Layer | Path | Notes |
| --- | --- | --- |
| XML | `src/xml/xml.ts` | Tolerant, lossless parser/serializer. Keeps unknown elements, attributes, comments, CDATA and order. Recovers from bare `&`, HTML entities, stray `<`, mismatched and unclosed tags, and reports warnings. |
| Model | `src/model/` | Typed *views* over the preserved XML. A character **is** its XML document, so export re-emits everything it was imported with. |
| Rules | `src/rules/` | Pure functions: derived sheet, multiclass slots, level-up, dice. |
| Store | `src/store/db.ts` | IndexedDB. Compendium files are stored as their original text. |
| UI | `src/ui/` | React. |

## Compatibility status — read this

There were **no real export files to test against**, so compatibility is as follows:

**Tested** (`tests/`, 32 tests):
- Byte-identical round-trip of well-formed files, and semantic round-trip of malformed ones.
- Unknown elements are preserved through edits.
- Duplicate merging, and derived stats for sample characters against hand-calculated values.

**Based on the publicly documented compendium format but not checked against real files:**
- Element names (`<autolevel>`, `<slots>` with cantrips first, `<modifier category=…>`, item type
  codes, and so on).

**Provisional — the character file layout.** This was designed without seeing a real character
export. All character element names live in `CHARACTER_TAGS` in `src/model/character.ts`, so they
can be corrected in one place. Until that is checked, characters exported from this app may not
import into the other app, and imported characters may show partial sheets (although their
unknown data is preserved).

**Assumptions to confirm:**
1. When merging, a later file replaces an earlier entry with the same kind and name (case-insensitive).
2. Subclasses are inferred from optional features named "Family: Subclass" or with a `<subclass>` child.
3. Racial `<ability>` bonuses are used, and "ability score" modifiers on the same race are not added twice.
4. Caster type (full, half, third, pact) is inferred from the shape of the slot table.
5. Stored `hpMax` is the full maximum, and "hp" bonus modifiers are added on top.
6. Multiclass armor and weapon proficiencies are not reduced to the multiclass subset (a warning is shown).

To close these gaps, add real compendium and character exports, plus screenshots of the
official sheets, under `tests/fixtures/` and turn them into golden tests.
