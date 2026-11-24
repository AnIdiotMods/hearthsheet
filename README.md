# Hearthsheet

An independent, open-source 5e character manager for **Windows, macOS, Linux, Android and iOS**,
built with [Tauri 2](https://tauri.app) (TypeScript + React front end, a small Rust shell). It uses
each system's own web view, so there is no bundled browser: the Windows installer is a few MB.
It reads and writes the compendium and character XML files used by the popular community
compendium ecosystem, so you can use compendium files you already own and carry characters
across. It ships with no game content apart from an optional small SRD 5.1 sample (CC-BY-4.0,
attribution in the app's Settings → About and in the sample file).

Every platform runs the same code and the same interface; on phones the layout adapts (bottom tab
bar, full-screen windows, list and detail on separate pages) while keeping the desktop look. Files
are opened and saved with each system's own file dialogs, and the system Back button or gesture
closes windows and screens.

## Install

Download the latest builds from the [`builds` branch](https://github.com/AnIdiotMods/hearthsheet/tree/builds).

| Platform | Package | Notes |
| --- | --- | --- |
| Windows 10/11 | `Hearthsheet_0.4.0_x64-setup.exe` | Installs for the current user. Uses the Edge WebView2 runtime (built into Windows 11; downloaded if missing). |
| macOS 11+ | `.dmg` (universal: Apple silicon and Intel) | Built by GitHub Actions on macOS. |
| Linux | `.AppImage`, `.deb`, `.rpm` | AppImage runs anywhere; `.deb` for Debian/Ubuntu, `.rpm` for Fedora/openSUSE. |
| Android 7+ | `.apk` (sideload) or `.aab` (Play Store) | Allow installing from your browser or file manager when asked. |
| iOS / iPadOS 15+ | TestFlight / App Store | Needs an Apple Developer account; built by GitHub Actions. |

Unsigned builds trigger "unknown publisher" warnings. See [docs/SIGNING.md](docs/SIGNING.md) for
how to sign releases (it needs credentials only you can obtain; the release workflow uses them
automatically once they are added as repository secrets).

## Build from source

- Requirements: Node 22+, Rust (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  for your system (WebKitGTK on Linux, Xcode on macOS, Android SDK + NDK for Android).
- `npm install`
- `npm run app:dev`: the desktop app with live reload. `npm run dev` runs it in a browser.
- `npm run app:build`: installers for the system you are on (`src-tauri/target/release/bundle/`).
- `npm run app:build:windows-from-linux`: the Windows installer from Linux (needs `cargo-xwin`, `nsis`, `lld`, `llvm`).
- `npm run android:build`, `npm run ios:build` (iOS on macOS only).
- `npm test`: unit tests (plus `tests/local/` when the local test files are present).
- **All platforms at once:** push a tag such as `v0.4.0`; `.github/workflows/release.yml` builds
  Windows, macOS, Linux, Android (and iOS when enabled) and attaches them to a draft release.

Data is stored locally on each device (the app's own storage). Export characters and compendiums to
back them up or move them between devices; the files are the same on every platform.

## Features (v0.4)

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
- **Appearance:** light, dark or system mode; rounded or sharp corners; pick the primary (button)
  color, the text color and the secondary text color, with a readability warning for low-contrast
  choices; a built-in OpenDyslexic font (SIL Open Font License) or your own imported fonts; text size
  from 80% to 140%.
- **Trackers:** custom counters on the Abilities & Skills page (luck points, ki, arrows, charges, …)
  with a maximum that can be a number or a formula (`PROF`, `1+CHA`, `LVL`, `2*PROF`) and that
  refill on a short rest, a long rest, or only by hand.
- **Class options:** Eldritch Invocations, Pact Boons, Metamagic, Fighting Styles, Battle Master
  maneuvers, Arcane Shots, Runes, Elemental Disciplines, Artificer infusions and similar lists
  (including homebrew ones) are offered whenever the class grants them, at level up, at character
  creation and from the Features tab, with prerequisites checked. Expertise lets you pick the skills.
- **Prepared and known spells:** each casting class shows how many spells it can have prepared (or
  known) and how many it has, plus cantrips: from the class text's formula in 2014 files
  (e.g. Wisdom modifier + Cleric level), otherwise the standard SRD 5.1/5.2 tables, or a limit you
  set yourself.
- **Class features:** add features from the class's own list (any level, any option), write your
  own with optional modifiers (e.g. `ac +1`, `speed +10`, `stealth +2`), edit any feature's name,
  text and modifiers, remove features, and restore missing ones. Feats can be added, edited and
  removed the same way.
- **Creatures:** pets, familiars, summons, mounts, hirelings and wild shapes under the character.
  Start from a compendium monster or a blank stat block; edit every field, traits, actions,
  bonus actions, reactions and legendary actions; track hit points and temporary hit points; roll
  checks, saves, attacks and damage. Attack formulas can use the owner's numbers (`SPELL+PROF`,
  `1d8+3+SPELL`) for summons that scale. A long rest heals creatures.
- **Built-in class rules:** most compendium files describe class features in text only, so the sheet
  applies the official rules itself when a feature carries no modifiers of its own: resources (Rage,
  Bardic Inspiration, Channel Divinity, Wild Shape, Second Wind, Action Surge, Indomitable, superiority
  dice, Ki, Lay on Hands, Divine Sense, Arcane Recovery, Mystic Arcanum, Flash of Genius, Stroke of Luck),
  Fast Movement and Unarmored Movement, Aura of Protection, Diamond Soul, Slippery Mind, Draconic
  Resilience, Dwarven Toughness, Primal Champion, Martial Arts (Dexterity and the Martial Arts die),
  the Alert, Mobile, Observant and Tough feats, and Eldritch Knight / Arcane Trickster spell slots.
- **Choices the files don't record:** pick-one subclass features (Hunter's Prey, Totem Spirit), racial
  ability increases (Variant Human, Half-Elf, Custom Lineage), racial feats, skills and cantrips, skill
  picks inside features (College of Lore), the Draconic Sorcerer's dragon ancestor, and Tasha's optional
  class features (offered, never added automatically). Oath, domain and similar subclass spells are added
  as always prepared and do not count against the prepared limit. Option lists say how many you can
  know (invocations, metamagic, maneuvers, infusions, …) and open whenever you know fewer.
- **Limits you can go past:** an Ability Score Improvement stops at 20, and Constitution increases
  raise earlier levels' hit points too. Going past a limit (a score above 20, more spells prepared or
  known than allowed, spells above the level you can cast, extra options, skills or attunements) asks
  first; if you go ahead, the character shows a red “too high” tag on its card and sheet, listing why.
- **Movement:** click Speed to set your own walking speed, a bonus, and fly, swim, climb and burrow
  speeds (or “same as walking”), plus hover.
- **Spells:** the picker shows spell levels and, by default, only levels you can cast; cantrip damage
  shows the die for your level; the wizard's list is labelled as a spellbook.
- **Sources:** unofficial options, subclasses, races and picker entries (playtest, Plane Shift,
  social-media, third-party, homebrew) are tagged. Two different entries
  with the same name in one file (e.g. a race printed in two books) are both kept, the second named
  after its source. Two printings of one subclass merged into a class become “Subclass (version 2)”.
- **Creator:** make classes, subclasses, races, spells, feats, backgrounds, items and creatures. Start
  from a preset framework (e.g. martial class, full or half caster, damage cantrip, healing spell,
  magic item, beast companion), from scratch, or from a copy of an existing entry; edit with a form,
  check the preview, or edit the XML directly. Everything is saved in the compendium file “My
  homebrew”, so it appears in character creation, level-ups and every picker, and can be exported.
  Subclasses can be made for your own classes or for any class in your compendiums.
- **Custom content on the sheet:** create a custom spell, item or creature straight from the Spells,
  Inventory and Creatures tabs (optionally also kept in My homebrew).
- **Hand edits:** spellcasting ability, save DC and attack bonuses, spells known or prepared, and cantrips
  known per class (any class can also be marked as a spellcaster); Armor Class and Initiative can be set
  by hand or given a bonus; the character's XML can be edited directly (with a warning first, and checked
  before it is applied).
- **Fonts:** import your own fonts (TTF, OTF, WOFF, WOFF2) in Settings → Appearance.
- **Dice:** `2d6+3`, `1d20+5 adv`, `4d6kh3`, `d%`; every number on the sheet can be clicked to
  roll, and compendium formulas with placeholders (`%0`, `SPELL`, `PROF`, …) are resolved.

## Architecture

| Layer | Path | Notes |
| --- | --- | --- |
| XML | `src/xml/xml.ts` | Tolerant, lossless parser/serializer. Keeps unknown elements, attributes, comments, CDATA and order. Recovers from bare `&`, HTML entities, stray `<`, mismatched and unclosed tags, and reports warnings. Parses a 15 MB compendium in about 0.3 s. |
| Model | `src/model/` | `compendium.ts`: typed views over compendium entries (also accepts the compiled shapes inside character files). `character.ts`: the character document in the real export format. `codes.ts`: numeric codes used in character files. |
| Rules | `src/rules/` | Pure functions: derived sheet, multiclass slots, level-up, dice. |
| Store | `src/store/db.ts` | IndexedDB. Compendium files are stored as their original text. |
| UI | `src/ui/` | React. One interface for every platform; `styles.css` adapts it to phones. `dialogs.tsx`: in-app confirmations (the same on every platform). `back.ts`: system Back button support. |
| Platform | `src/platform.ts` | The only platform-specific code: native file dialogs and file access in the app (Tauri dialog and fs plugins), file inputs and downloads in a browser. |
| Native shell | `src-tauri/` | Tauri 2: opens the window and provides the dialog and fs plugins, with permissions limited to files the user picks (`capabilities/default.json`). `gen/android` is the Android project. |

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
- Class option lists come either as optional class features named `Family: Option` (listed only
  at the level they first appear, e.g. Metamagic at 3) or as `<feat>` entries named
  `Family: Option` with a `<prerequisite>` (e.g. `Invocation: Agonizing Blast`). Both are offered
  whenever a feature the character has names the family (`Eldritch Invocations`,
  `Additional Invocation`, `Battle Master: Maneuvers`), or describes it near the start of its text
  when no feature is named after it. `Metamagic Options` (Tasha's) is merged into `Metamagic`.
  Chosen option feats are stored as character-level `<feat>` elements.
- 2024-rules files prefix feature names with their level (`Level 3: Warlock Subclass`,
  `Level 3: Healing Light (Celestial Patron)`); the prefix is ignored when matching features,
  subclasses and option lists. Current community files also write class options as level-0
  `<spell>` entries whose `<classes>` names the granting feature (`Eldritch Invocations`); these
  are offered as options (never as spells), with the prerequisite read from the text.
- Subclass features are matched to their subclass by name prefix (`Thief: Fast Hands`), suffix
  (`Improved Critical (Champion)`), or short suffix (`Rite of the Dawn (Ghostslayer)` for
  *Order of the Ghostslayer*), including UA subclasses that introduce themselves
  (`The Celestial (UA): The Celestial`).
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
- Hand edits are stored as `<adjustments>` (Armor Class, Initiative) and, on a class, `<spellDcBonus>`,
  `<spellAttackBonus>`, `<preparedMax>`, `<cantripsMax>` and `<customCasting>`; the spellcasting ability
  uses the standard `<spellAbility>` element.
- Movement settings are stored as a `<movement>` element and always-prepared subclass spells carry
  `<grantedBy>`; a chosen dragon ancestor is written into the feature's text and a `<choice>` element.
  Same caveat.
- Custom trackers are stored as `<tracker>` elements (`<name>`, `<max>`, `<value>`, `<reset>`), also a
  Hearthsheet extension with the same caveat.

To check any of these, export a character containing the feature in question and compare it with
Hearthsheet's export of the same character; `tests/local/characters.test.ts` shows how such a file
becomes a golden test.
