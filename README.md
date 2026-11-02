# Hearthsheet

An independent, open-source 5e character manager for Windows (Electron + TypeScript + React).
It reads and writes the compendium and character XML files used by the popular community
compendium ecosystem, so you can use compendium files you already own and carry characters
across. It ships with no game content apart from an optional small SRD 5.1 sample (CC-BY-4.0,
attribution in the app's Settings → About and in the sample file).

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
  (subclass choice, optional features, ASI or feat, HP average/roll/manual), remove levels,
  duplicate, import and export XML.
- **Sheet:** ability scores, saves, skills, AC, HP with damage/heal/temp, hit dice, initiative,
  passives, attacks, conditions, exhaustion, death saves, short/long rests, class resources,
  spells with slots (including multiclass and pact slots), inventory with equip/attune/quantity/
  coins/weight/containers, custom items, notes, and a raw XML view.
- **Custom ability scores and skills:** add ability scores (e.g. Sanity, Honor) with their own
  modifier and saving throw; add skills; choose which ability any skill uses, standard or custom
  (e.g. Intimidation with Strength); set proficiency or expertise per skill and add an extra bonus.
- **Appearance:** light, dark or system mode; pick the primary (button) color, the text color and
  the secondary text color, with a readability warning for low-contrast choices; a built-in
  OpenDyslexic font (SIL Open Font License); text size from 80% to 140%.
- **Trackers:** custom counters on the Abilities & Skills page (luck points, ki, arrows, charges, …)
  with a maximum that can be a number or a formula (`PROF`, `1+CHA`, `LVL`, `2*PROF`) and that
  refill on a short rest, a long rest, or only by hand.
- **Class features:** add features from the class's own list (any level, any option), write your
  own with optional modifiers (e.g. `ac +1`, `speed +10`, `stealth +2`), edit any feature's name,
  text and modifiers, remove features, and restore missing ones. Feats can be added, edited and
  removed the same way.
- **Creatures:** pets, familiars, summons, mounts, hirelings and wild shapes under the character.
  Start from a compendium monster or a blank stat block; edit every field, traits, actions,
  bonus actions, reactions and legendary actions; track hit points and temporary hit points; roll
  checks, saves, attacks and damage. Attack formulas can use the owner's numbers (`SPELL+PROF`,
  `1d8+3+SPELL`) for summons that scale. A long rest heals creatures.
- **Dice:** `2d6+3`, `1d20+5 adv`, `4d6kh3`, `d%`; every number on the sheet can be clicked to
  roll, and compendium formulas with placeholders (`%0`, `SPELL`, `PROF`, …) are resolved.

## Architecture

| Layer | Path | Notes |
| --- | --- | --- |
| XML | `src/xml/xml.ts` | Tolerant, lossless parser/serializer. Keeps unknown elements, attributes, comments, CDATA and order. Recovers from bare `&`, HTML entities, stray `<`, mismatched and unclosed tags, and reports warnings. Parses a 15 MB compendium in about 0.3 s. |
| Model | `src/model/` | `compendium.ts`: typed views over compendium entries (also accepts the compiled shapes inside character files). `character.ts`: the character document in the real export format. `codes.ts`: numeric codes used in character files. |
| Rules | `src/rules/` | Pure functions: derived sheet, multiclass slots, level-up, dice. |
| Store | `src/store/db.ts` | IndexedDB. Compendium files are stored as their original text. |
| UI | `src/ui/` | React. |

## File compatibility

The formats were worked out from the community XSD and build tools, thousands of real
compendium source files, a real 15 MB compiled compendium, and two real character exports from
the iOS app (character `<version>38</version>`). The relevant facts, all verified against those files:

**Compendium files** (`<compendium version="5">`)
- Classes split across several files (base class in one, subclasses in others) are merged by
  name, appending their `<autolevel>` elements; spells with the same name merge their `<classes>`
  lists. Other duplicate names replace the earlier entry, with a note.
- Subclass features are recognised in both naming conventions: `Subclass: Feature` and
  `Feature (Subclass)`, introduced by an optional `Family: Subclass` feature. Option families such
  as fighting styles, metamagic and invocations are not mistaken for subclasses.
- Spellcasting granted by a subclass uses `<slots optional="YES">`; those rows apply once the
  subclass casting feature is chosen. Caster type (full, half, third, pact) is inferred from the
  slot table.
- `<special>` markers are honoured: `Fighting Style: …`, `Unarmored Defense: Constitution|Wisdom`,
  `Natural Armor: 13+%2`, `Jack of all Trades`, `Powerful Build`, `Toughness`.
- Modifier categories `bonus`, `ability score`, `ability modifier`, `saving throw`, `skill(s)` in
  any capitalisation, with the documented synonyms (`Armor Class`, `Strength Score`, `wisdom save`,
  `weapon attack`) and placeholder values (`+%8`, `prof`).
- Slot rows with or without the trailing comma, `YES`/`1` booleans, `<roll description= level=>`,
  `<counter>` with `<subclass>`, monster `<attack>Name|+4|1d6+2</attack>` and `<recharge>`.

**Character files** (`<pc version="5"><character>`)
- The real format stores compendium data in a compiled form: features as `<feat>` with a single
  `<text>`; proficiencies as codes (0–5 saving throws, 100–117 skills in alphabetical order);
  racial ability bonuses as `<mod><category>1</category><type>…</type><value>…</value></mod>`;
  item `<type>`, `<damageType>` as 1-based codes and `<weaponProperty>` as a bit mask; spell
  `<school>` as a 1-based code with `<v>/<s>/<m>` flags and `<sclass>` entries; `<hd>` as a code;
  `<level>` omitted at level 1; the whole class progression embedded as `<autolevel>` elements with
  a `<level>` child; `<slots>`/`<slotsCurrent>` per class and combined; coins as items plus `<money>`.
- Hearthsheet reads and writes exactly this shape. Both real exports import, produce the expected
  sheet values (checked by hand), and export semantically identical files after a full
  import → sheet → export cycle through the UI (`tests/local/`, run only when the files are present).

**Still inferred, not verified** (no sample contained them):
- Codes for item types other than light armor, melee weapons and gear; damage types other than
  bludgeoning and slashing; sizes other than Small; equipment slots other than armor (5),
  one-handed (2) and two-handed (3) weapons. All follow the documented ordering, which fits every
  observed value.
- Where the original app stores experience points, temporary hit points, feats taken at level up,
  notes, conditions and resource usage. Hearthsheet writes `<xp>`, `<feat>` and `<note>` elements
  and keeps the rest in its own local storage.
- Data the compiled format has no known home for (item `strength`, `stealth`, `range`, `magic`,
  non-ability modifiers, attunement) is written under its compendium element names, which other
  apps ignore.
- Android exports, other character versions than 38, and Game Master 5e files have not been seen.
- Creatures are stored as `<companion>` elements inside `<character>`, using the compendium
  `<monster>` fields plus `<role>`, `<hpCurrent>`, `<hpTemp>` and `<notes>`. This is a Hearthsheet
  extension; the official apps have no known equivalent and should ignore it, but may drop it if
  the character is re-saved there. Custom class features use the app's own `<feat>` shape and
  carry over normally.
- Custom ability scores, custom skills and per-skill settings are stored as `<customAbility>`,
  `<customSkill>` and `<skillSetting>` elements, with the same caveat.
- Custom trackers are stored as `<tracker>` elements (`<name>`, `<max>`, `<value>`, `<reset>`), also a
  Hearthsheet extension with the same caveat.

To check any of these, export a character containing the feature in question and compare it with
Hearthsheet's export of the same character; `tests/local/characters.test.ts` shows how such a file
becomes a golden test.
