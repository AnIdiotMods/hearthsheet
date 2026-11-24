// One player's session with Hearthsheet, written once and carried out on every system by a driver
// for that system (WebDriver on Windows and Linux, the accessibility layer on macOS, Android and iOS).
// The steps use only what a player sees: button and field names, list entries and the system's own
// file dialogs.
//
// Step kinds:
//   tap     press the button, tab, link or list entry with this name (entry: a list entry or card whose
//           spoken name continues after this, such as "Fireball, Level 3"; below: the one under this
//           field, not the field itself)
//   fill    type into the field with this name (clearing it first)
//   choose  pick an entry from the dropdown with this name
//   tick    tick the checkbox with this name
//   see     wait until this text is on screen (seconds: how long to wait)
//   shot    take a screenshot
//   pick    answer the system's Open dialog with a file
//   save    answer the system's Save dialog (or share sheet) with a file name
//   restart close the app and open it again
//   value   (where the driver can read the page) check a number shown on the sheet
export const COMPENDIUM = 'Complete_1.xml';
export const EXPORT_NAME = 'Thorin Oakenshield.xml';

export const steps = [
  // First launch, then import the compendium through the system's file picker.
  { shot: '01-first-launch' },
  { tap: 'Compendium' },
  { tap: 'Import XML…' },
  { pick: COMPENDIUM },
  { see: COMPENDIUM, seconds: 180 },
  { shot: '02-compendium-imported' },

  // Look a spell up, as players do mid-game.
  { fill: 'Search spells', text: 'Fireball' },
  { tap: 'Fireball', entry: true, below: 'Search spells' },
  { see: 'A bright streak flashes', seconds: 10 },
  { shot: '03-compendium-fireball' },

  // Make a Hill Dwarf Life Cleric.
  { tap: 'Characters' },
  { tap: 'New character' },
  { fill: 'Name', text: 'Thorin' },
  { choose: 'Race', option: 'Dwarf (Hill)' },
  { choose: 'Class', option: 'Cleric' },
  { choose: 'Background', option: 'Acolyte' },
  { choose: 'WIS score', option: '15' },
  { choose: 'CON score', option: '14' },
  { choose: 'STR score', option: '13' },
  { choose: 'CHA score', option: '12' },
  { tick: 'History' },
  { tick: 'Medicine' },
  { choose: 'Divine Domain', option: 'Life Domain' },
  { shot: '04-new-character' },
  { tap: 'Create' },
  { see: 'Dwarf (Hill) · Cleric 1 (Life Domain) · Acolyte' },
  { value: 'Hit points', is: '12 / 12' },
  { value: 'Armor class', is: '10' },
  { value: 'Speed', is: '25 ft' },
  { value: 'Passive Perception', is: '13' },
  { shot: '05-sheet-level-1' },

  // Buy and wear armour.
  { tap: 'Inventory' },
  { tap: 'Add items…' },
  { fill: 'Search', text: 'Chain Mail' },
  { tap: 'Add Chain Mail' },
  { fill: 'Search', text: 'Shield' },
  { tap: 'Add Shield' },
  { fill: 'Search', text: 'Mace' },
  { tap: 'Add Mace' },
  { tap: 'Close' },
  { tick: 'Chain Mail equipped' },
  { tick: 'Shield equipped' },
  { value: 'Armor class', is: '18' },
  { shot: '06-inventory' },

  // Choose spells, prepare some, and cast one.
  { tap: 'Spells' },
  { see: 'Cure Wounds' },
  { tap: 'Add Cleric spells…' },
  { fill: 'Search', text: 'Guidance' },
  { tap: 'Add Guidance' },
  { fill: 'Search', text: 'Sacred Flame' },
  { tap: 'Add Sacred Flame' },
  { fill: 'Search', text: 'Healing Word' },
  { tap: 'Add Healing Word' },
  { fill: 'Search', text: 'Guiding Bolt' },
  { tap: 'Add Guiding Bolt' },
  { tap: 'Close' },
  { tick: 'Healing Word prepared' },
  { tick: 'Guiding Bolt prepared' },
  { tap: 'Cast Healing Word' },
  { value: 'Spell save DC', is: '13' },
  { value: '1st-level slots used', is: '1 of 2' },
  { shot: '07-spells' },

  // A fight: take 7 damage, then heal 3.
  { fill: 'Hit points to add or remove', text: '7' },
  { tap: 'Damage' },
  { value: 'Hit points', is: '5 / 12' },
  { fill: 'Hit points to add or remove', text: '3' },
  { tap: 'Heal' },
  { value: 'Hit points', is: '8 / 12' },
  { shot: '08-after-fight' },

  // Rest, then reach level 3.
  { tap: 'Long rest' },
  { see: 'Long rest: hit points, spell slots and resources restored.' },
  { value: 'Hit points', is: '12 / 12' },
  { value: '1st-level slots used', is: '0 of 2' },
  { tap: 'Level up' },
  { tap: 'Apply' },
  { see: 'Dwarf (Hill) · Cleric 2 (Life Domain) · Acolyte' },
  { tap: 'Level up' },
  { tap: 'Apply' },
  { see: 'Dwarf (Hill) · Cleric 3 (Life Domain) · Acolyte' },
  { value: 'Hit points', is: '30 / 30' },
  { see: 'Spiritual Weapon' },
  { shot: '09-level-3' },

  // Give the character a full name and keep notes (typing spaces between words).
  { fill: 'Character name', text: 'Thorin Oakenshield' },
  { tap: 'Notes' },
  { tap: 'Add note' },
  { fill: 'Note title', text: 'Session 1' },
  { fill: 'Session 1 text', text: 'Owes Gundren 10 gp. Met Sildar on the road.' },
  { shot: '10-notes' },

  // Roll some dice.
  { tap: 'Dice' },
  { tap: '1d20' },
  { see: '1d20 = ' },
  { shot: '11-dice' },

  // Dark mode with sharp corners.
  { tap: 'Settings' },
  { tap: 'Dark' },
  { tap: 'Sharp' },
  { shot: '12-settings-dark' },

  // Export the character through the system's save dialog.
  { tap: 'Characters' },
  { see: 'Dwarf (Hill) · Cleric 3' },
  { tap: 'Export Thorin Oakenshield' },
  { save: EXPORT_NAME },
  { see: `Saved ${EXPORT_NAME}`, seconds: 20 },
  { shot: '13-exported' },

  // Close the app and open it again: everything should still be there.
  { restart: true },
  { see: 'Thorin Oakenshield', seconds: 60 },
  { tap: 'Thorin Oakenshield', entry: true },
  { see: 'Dwarf (Hill) · Cleric 3 (Life Domain) · Acolyte' },
  { value: 'Hit points', is: '30 / 30' },
  { value: 'Armor class', is: '18' },
  { shot: '14-after-restart' },
];
