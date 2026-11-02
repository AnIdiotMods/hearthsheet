# Player audit: every official class, levels 1 to 20

**Build tested:** latest build (commit `d5ae5e0`). The interface was driven in Chromium, plus a smoke test of the Electron app shell that the Windows `.exe` runs.
**Compendium:** the uploaded `Complete.xml` (15.5 MB).
**Content used:** official Wizards of the Coast books only (PHB, DMG, XGE, SCAG, TCE, EGW, MOT, GGR). Unearthed Arcana, Plane Shift, Twitter, Livestream, third-party and homebrew content was not chosen.
**Scope:** documentation only. Nothing was fixed in this pass. See [Status after the fixes](#status-after-the-fixes-v020) at the end for what version 0.2.0 changed.

## How it was tested

One character per class, created through the New Character dialog with the standard array (main stat first), skills and level-1 choices. Each character was then levelled 1 → 20 through the Level Up dialog:

- **Choices made:** an official subclass, the options the class grants, Ability Score Improvements into the main stat, Expertise picks, and average HP.
- **Logged at every level:** what each dialog offered, and the sheet afterwards (HP, AC, speed, proficiency, saves, skills, attacks, spell slots, cantrips, prepared/known limits, resources and features).
- **Checked against:** the 2014 rules.
- **Also tried by hand:** character creation for different races, spell picking and casting, export and re-import, and the Electron shell with this compendium.

| Class | Race / background | Subclass | Reached 20 |
| --- | --- | --- | --- |
| Barbarian | Half-Orc / Outlander | Path of the Berserker | yes |
| Bard | Half-Elf / Entertainer | College of Lore | yes |
| Cleric | Hill Dwarf / Acolyte | Life Domain | yes |
| Druid | Wood Elf / Hermit | Circle of the Moon | yes |
| Fighter | Variant Human / Soldier | Battle Master | yes |
| Monk | Human / Hermit | Way of the Four Elements | yes |
| Paladin | Dragonborn / Noble | Oath of Devotion | yes |
| Ranger | Wood Elf / Outlander | Hunter | yes |
| Rogue | Lightfoot Halfling / Criminal | Arcane Trickster | yes |
| Sorcerer | Tiefling / Sage | Draconic Bloodline | yes |
| Warlock | Tiefling / Charlatan | The Fiend | yes |
| Wizard | High Elf / Sage | School of Evocation | yes |
| Artificer | Rock Gnome / Guild Artisan | Artillerist | yes |

No crashes, error messages or console errors occurred in any run. Every character reached level 20, and export and re-import worked.

**Why many issues happen:** apart from Sorcery Points, this compendium encodes no game mechanics for the official classes. It has no modifiers, no resource counters and no special markers; the class features are description text only. Hearthsheet has almost no built-in class rules, so any rule that isn't in the data is missing from the sheet. Each issue below is tagged:

- **App**: the app gets it wrong whatever the data says.
- **App + data**: the file doesn't encode it, and the app has no built-in fallback.

---

## Critical (wrong numbers or impossible choices)

1. **Ability scores go above 20 through Ability Score Improvements** (App, every class). The cap of 20 is applied to the base score before the racial bonus is added. Level-20 results include Strength 22 (Barbarian, Paladin), Charisma 22 (Bard, Sorcerer, Warlock), Dexterity 22 (Ranger, Rogue), Intelligence 22 (Artificer), and Wisdom/Intelligence/Dexterity 21 (Cleric, Druid, Wizard, Monk). Modifiers, saves, attacks, spell DCs and prepared counts are inflated as a result.
2. **Raising Constitution doesn't increase hit points retroactively** (App, every class). A Constitution increase from an Ability Score Improvement only affects later levels. The HP maximum was short by 11–18 at the levels where Constitution rose (e.g. Barbarian 16: 150 instead of 165; Cleric 19: 160 instead of 178).
3. **Beast Master (Player's Handbook) can't be chosen** (App). It's missing from the Ranger's subclass dropdown, and its features appear for every Ranger as a "Beast Master" option list at levels 3, 7, 11 and 15.
4. **Subclasses where you pick one option get every option** (App). Choosing the subclass grants all of its choices at once:
   - Hunter: Colossus Slayer, Giant Killer and Horde Breaker all at level 3, and likewise every option at 7, 11 and 15.
   - Totem Warrior: all five totem spirits at 3 and every beast aspect at 6.
5. **Two same-named subclasses are merged** (App). The official (Tasha's) Artillerist and a playtest Artillerist share a name, so picking it grants both: two introductions, Eldritch Cannon *and* the playtest Arcane Turret, and duplicate Artillerist Spells.
6. **Same-named races replace each other** (App). The file has two entries named "Goblin" and two named "Orc" (from different books), plus duplicate items and monsters. Each later copy silently replaces the earlier one, so some official versions can't be picked. The only notice is a line in "import notes" saying "replaces the copy from Complete.xml".
7. **Arcane Trickster has no spellcasting** (App + data). It gets no spell slots, no spellcasting box and no cantrip or spell counts at any level. The compendium has no slot table for Rogue subclass casting, and the app has no built-in table for one-third casters.
8. **Monk unarmed strike ignores Martial Arts** (App). It always uses Strength and does a flat 1 + Strength damage (2 at every level). It should use Dexterity and the Martial Arts die: at level 20, +7 and 2 damage instead of +11 and 1d10+5.

## High (rules the sheet doesn't apply)

9. **Speed bonuses ignored** (App + data). Barbarian Fast Movement (+10 ft at 5) and Monk Unarmored Movement (+10 to +30 ft) never change speed, which stays 30 ft at every level.
10. **Saving-throw features ignored** (App + data):
    - Paladin Aura of Protection (Charisma bonus to all saves, level 6).
    - Monk Diamond Soul (proficient in all saves, level 14).
    - Rogue Slippery Mind (Wisdom saves, level 15).
11. **AC and HP features ignored** (App + data):
    - Draconic Resilience: unarmored AC stays 10 + Dexterity, not 13 + Dexterity, and the +1 HP per Sorcerer level is missing.
    - Hill Dwarf's Dwarven Toughness (+1 HP per level) is missing.
    - Primal Champion (+4 Strength and Constitution at level 20) isn't applied.
12. **Almost no class resources are tracked** (App + data). The Resources panel is empty for every class except the Sorcerer. Missing:
    - Rage
    - Bardic Inspiration
    - Channel Divinity
    - Wild Shape
    - Second Wind, Action Surge, superiority dice and Indomitable
    - Ki
    - Lay on Hands and Divine Sense
    - Arcane Recovery
    - Flash of Genius
13. **Sorcery Points shown at level 1** (data). The compendium's counter gives 1 point at level 1, and Sorcerers get none until level 2. The app shows the data as is.
14. **Option lists aren't prompted when more are gained** (App + data). The app has no built-in count of how many options each class should know. Where the compendium has no "Additional …" feature, later picks aren't prompted; the list sits collapsed under "Other class options":
    - Warlock invocations at levels 5, 7, 9, 12, 15 and 18.
    - Artificer infusions at levels 6, 10, 14 and 18.

    No list ever says how many to choose, or how many you should know.
15. **Racial choices are missing** (App + data):
    - Variant Human gets no +1/+1 ability choice, no feat and no extra skill (and starts with no racial bonuses at all).
    - Half-Elf gets only +2 Charisma, with no +1/+1 choice.
    - The High Elf's bonus wizard cantrip isn't offered.
16. **Choices inside features aren't offered** (App + data):
    - College of Lore's 3 bonus skill proficiencies.
    - The Draconic Sorcerer's dragon ancestor (damage type).
    - Circle of the Land's terrain, so no circle spells.
    - Mystic Arcanum spells.
    - Spell Mastery and Signature Spells.
    - Magical Secrets (you can only uncheck the class filter in the spell picker).

## Medium (confusing or misleading for a player)

17. **Official, playtest and homebrew content is mixed together with no source shown** (App):
    - Subclass dropdowns list Unearthed Arcana, Plane Shift, Twitter, Livestream and homebrew entries alongside official ones; the Cleric list has 30 domains.
    - Option lists include playtest duplicates, e.g. "Ambush" and "Ambush (UA)", and even "Close Quarters Shooter (UA) (UA)".
    - The class list includes the Unearthed Arcana classes and Blood Hunter.
    - There's no way to filter by source or hide unofficial content.
18. **Homebrew option leaks into every Fighter** (App). "Firearm Properties" from the homebrew Gunslinger shows as a general Fighter option at level 3.
19. **Tasha's optional class features are added automatically**, and alongside the features they replace (App + data). Affected features:
    - Primal Knowledge and Instinctive Pounce
    - Magical Inspiration
    - Harness Divine Power
    - Cantrip Versatility
    - Wild Companion
    - Martial Versatility
    - Dedicated Weapon and Ki-Fueled Attack
    - Steady Aim
    - Primal Awareness, together with Primeval Awareness
    - Deft Explorer, offered as a list beside Natural Explorer

    These are optional in the rules and should be the player's choice.
20. **Spell picker ignores your level** (App). A level-1 Cleric is offered, can add and can prepare 9th-level spells such as Mass Heal. The picker list doesn't show spell levels, and the problem only appears when "Cast" reports no slots.
21. **Subclass spells aren't handled** (App + data). Domain, oath and other subclass spells are neither added nor treated as always prepared. Added by hand, they count against the prepared limit.
22. **No Wizard spellbook** (App). There's no separate spellbook to prepare from; every spell added counts as a candidate for preparing.
23. **Cantrip damage doesn't scale** (App). Spells like Sacred Flame show both the 1d8 and 2d8 buttons at level 1, not the single correct die for your level.
24. **Placeholder features fill the feature list** (App + data). Entries like "Path Feature", "Divine Domain feature", "Martial Archetype feature", "Bard College feature" and "Ranger Archetype feature" appear as features with no content of their own.

## Low

25. **No starting equipment or starting gold step** (App). Characters start with nothing, so AC and attacks start at their unarmed values (e.g. Cleric AC 9, Paladin AC 10).
26. **The prepared or known limit is only a warning** (by design?). Going over shows red ("Prepared 2 / 1") but nothing stops it. That's fine for house rules, but worth confirming as intended.
27. **Feat names run together with their list label** on the Features tab, e.g. "Armor of ShadowsEldritch Invocations". The tag needs spacing.

## What worked well

- **Proficiency and level-ups:** proficiency bonus and Ability Score Improvement levels were correct for every class, including the Fighter's extra ASIs at 6 and 14 and the Rogue's at 10.
- **Spellcasting numbers:** spell slots, cantrips known, spell save DC and attack bonus were correct at every level. This covers full casters, half casters (Paladin and Ranger), the Artificer's half-caster progression starting at level 1, and Warlock pact slots.
- **Prepared and known limits:** matched the rules for every class except the Arcane Trickster (see 7).
- **Option lists:** offered and pickable at the right levels where the class grants them: Fighting Styles, Battle Master maneuvers (3/7/10/15), Metamagic (3/10/17), Elemental Disciplines (3/6/11/17), Pact Boon (3), and Eldritch Invocations and Infusions at their first level.
- **Other rules applied correctly:** Expertise (Rogue 1 and 6, Bard 3 and 10); Jack of All Trades on skills and initiative; Unarmored Defense for Barbarian and Monk; racial speeds and skills; Wood Elf 35 ft.
- **Subclasses:** the subclass dropdown appears at the right level for every class (Cleric, Sorcerer and Warlock 1; Druid and Wizard 2; others 3) with the right heading.
- **Robustness:** no crashes, errors or freezes in about 260 level-ups. The 15 MB compendium imports in about 1.2 s in the Electron shell. Characters survive export and re-import.

---

## Status after the fixes (v0.2.0)

Version 0.2.0 addresses the issues above. The same 13 characters were built again, level 1 to 20, through the interface (see "How it was verified" below).

| # | Issue | Status |
| --- | --- | --- |
| 1 | Scores above 20 through ASIs | **Fixed.** The cap applies to the final score (race, feats and features included, magic items not). Going past 20 asks first; if you go ahead, the character is tagged "too high". |
| 2 | Constitution not retroactive | **Fixed** at level-up and when editing the base score: every earlier level gains or loses the difference. |
| 3 | Beast Master missing | **Fixed.** |
| 4 | Pick-one subclass features all granted | **Fixed.** Hunter's Prey, Defensive Tactics, Multiattack, Superior Hunter's Defense and the Totem Warrior animals are a "choose 1" list. |
| 5 | Same-named subclasses merged | **Fixed.** The second printing becomes "Artillerist (version 2)" (also Alchemist and Battle Smith). |
| 6 | Same-named races replace each other | **Fixed.** Both are kept; the second is named after its book, e.g. "Goblin (Guildmasters' Guide to Ravnica)". Exact copies are dropped. |
| 7 | Arcane Trickster has no spellcasting | **Fixed** with a built-in one-third-caster table (also Eldritch Knight). |
| 8 | Monk unarmed strike | **Fixed.** Dexterity and the Martial Arts die (2014 and 2024 tables). Monk weapons use Dexterity too. |
| 9 | Speed bonuses | **Fixed.** Fast Movement, Unarmored Movement and the Mobile feat. Speed can also be edited by hand (click Speed). |
| 10 | Saving-throw features | **Fixed.** Aura of Protection, Diamond Soul and Slippery Mind. |
| 11 | AC and HP features | **Fixed.** Draconic Resilience (AC and HP), Dwarven Toughness, Primal Champion, plus the Tough feat. |
| 12 | Class resources | **Fixed.** Built-in counters for every resource listed, used only when the file has none. Large pools (Lay on Hands, Ki) use a number field. |
| 13 | Sorcery Points at level 1 | **Fixed.** The counter appears with Font of Magic at 2nd level. |
| 14 | Option counts | **Fixed.** Lists show "you can know N" and "choose N", and open whenever fewer are known than allowed (invocations, metamagic, maneuvers, infusions, elemental disciplines, arcane shots, runes, pact boon, fighting styles). |
| 15 | Racial choices | **Fixed.** Variant Human (+1/+1, skill, feat), Half-Elf (+1/+1 not Charisma, two skills), Custom Lineage (+2, feat), High Elf cantrip. |
| 16 | Choices inside features | **Partly fixed.** College of Lore skills (and any "N skills of your choice" text) and the dragon ancestor are offered. Mystic Arcanum spells can be added without a warning (the picker allows 6th–9th level once you have Mystic Arcanum). **Not fixed:** Circle of the Land terrain spells, Spell Mastery and Signature Spells, Magical Secrets (still done by unticking the class filter in the picker); the file has no data for these choices. |
| 17 | Unofficial content mixed in | **Fixed.** Settings → "Official content only" hides playtest, Plane Shift, Twitter/livestream, third-party and homebrew entries and the Blood Hunter class. Unofficial options, subclasses, races and picker entries are tagged. |
| 18 | Homebrew option in every Fighter | **Fixed** by the filter above (it comes from a homebrew file). |
| 19 | Tasha's optional features added automatically | **Fixed.** They are offered unticked under "Optional class features", with what they replace. |
| 20 | Spell picker ignores your level | **Fixed.** The picker shows spell levels and only castable levels by default; adding a higher spell asks first and tags the spell and the character. |
| 21 | Subclass spells | **Fixed** where the feature has a spell table (Oath Spells, Artillerist Spells, …): added as always prepared, outside the limit. The Life Domain in this file has no table, so its spells are still added by hand. |
| 22 | No Wizard spellbook | **Fixed.** The wizard's list is labelled as the spellbook; you tick the prepared ones. |
| 23 | Cantrip damage | **Fixed.** Shows the die for your level (1d8, 2d8 at 5, …); leveled spells show the base roll, with higher levels in the tooltip. |
| 24 | Placeholder features | **Fixed.** Hidden from the level-up list, the Features tab and "Restore missing". |
| 25 | No starting equipment or gold | **Partly fixed.** Character creation can roll the class's starting gold. Starting equipment is not offered (the file stores it as text only). |
| 26 | Limits only warn | **Changed as requested.** Every limit asks before you go past it, and a red "too high" tag on the character card and sheet lists what is over. |
| 27 | Feat tag spacing | **Fixed.** |

### How it was verified

- **Automated tests:** 117 tests pass. They include tests with small made-up compendium files, and tests that run against the uploaded `Complete.xml`.
- **Through the interface:** all 13 characters were rebuilt from level 1 to 20 in the browser build, with no errors. Each one used the same subclass and the standard array, and picked whatever "choose N" the dialogs asked for. The script turned down every "goes past the usual limit" warning: all 19 Ability Score Improvements that would have passed 20 stopped at 20 instead.
- **Checked against the 2014 rules:** proficiency, HP (including retroactive Constitution, Dwarven Toughness and Draconic Resilience), speed, slots, cantrips and prepared or known limits all matched.
- **Results:**
  - The finished characters show no "too high" tag.
  - Resources match the expected list for every class. At 20th level, Rage and Wild Shape show as unlimited.
- **A bug found and fixed in this run:** the Fighting Style feature was counted twice. This asked Fighters, Paladins and Rangers for a second style and then tagged them "too high". Those three classes were rebuilt after the fix and came out clean.
