// Ability and skill tables shared by the code tables and the compendium views.

export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type Ability = (typeof ABILITIES)[number];
export const ABBR: Record<Ability, string> = {
  strength: 'STR', dexterity: 'DEX', constitution: 'CON', intelligence: 'INT', wisdom: 'WIS', charisma: 'CHA',
};

export function parseAbility(s: string): Ability | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^\d$/.test(t)) return ABILITIES[+t] ?? null; // numeric index in character files
  // Full names or exact three-letter abbreviations only ("Intimidation" is not Intelligence).
  return ABILITIES.find((a) => a === t || (t.length === 3 && a.slice(0, 3) === t)) ?? null;
}

/** Skills in alphabetical order, which is also the order character files number them (100 + index). */
export const SKILLS: [string, Ability][] = [
  ['Acrobatics', 'dexterity'], ['Animal Handling', 'wisdom'], ['Arcana', 'intelligence'],
  ['Athletics', 'strength'], ['Deception', 'charisma'], ['History', 'intelligence'],
  ['Insight', 'wisdom'], ['Intimidation', 'charisma'], ['Investigation', 'intelligence'],
  ['Medicine', 'wisdom'], ['Nature', 'intelligence'], ['Perception', 'wisdom'],
  ['Performance', 'charisma'], ['Persuasion', 'charisma'], ['Religion', 'intelligence'],
  ['Sleight of Hand', 'dexterity'], ['Stealth', 'dexterity'], ['Survival', 'wisdom'],
];
export const isSkill = (s: string) => SKILLS.some(([n]) => n.toLowerCase() === s.trim().toLowerCase());
export const canonicalSkill = (s: string) => SKILLS.find(([n]) => n.toLowerCase() === s.trim().toLowerCase())?.[0];
