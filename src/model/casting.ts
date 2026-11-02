// Per-class spellcasting settings the player can change: the spellcasting
// ability (the standard <spellAbility> element, as an ability index), and
// Hearthsheet extensions on the <class> element:
//   <spellDcBonus>, <spellAttackBonus>  extra bonuses to the save DC and attack
//   <preparedMax>                       spells known or prepared (see rules/spellcount)
//   <cantripsMax>                       cantrips known
//   <customCasting>1</customCasting>    show the class as a spellcaster even without spell slots

import { ABILITIES, Ability, parseAbility } from './compendium';
import { XElement, childText, setChildText } from '../xml/xml';

export interface CastingSettings {
  ability: Ability | null;
  dcBonus: number;
  attackBonus: number;
  spellsMax: number | null;
  cantripsMax: number | null;
  /** Treat the class as a spellcaster even when it has no spell slots. */
  enabled: boolean;
}

const int = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; };

export function castingSettings(ce: XElement): CastingSettings {
  return {
    ability: parseAbility(childText(ce, 'spellAbility')),
    dcBonus: int(childText(ce, 'spellDcBonus')) ?? 0,
    attackBonus: int(childText(ce, 'spellAttackBonus')) ?? 0,
    spellsMax: int(childText(ce, 'preparedMax')),
    cantripsMax: int(childText(ce, 'cantripsMax')),
    enabled: /^(1|yes|true)$/i.test(childText(ce, 'customCasting')),
  };
}

export function setCastingSettings(ce: XElement, s: CastingSettings) {
  setChildText(ce, 'spellAbility', s.ability ? String(ABILITIES.indexOf(s.ability)) : '');
  setChildText(ce, 'spellDcBonus', s.dcBonus ? String(s.dcBonus) : '');
  setChildText(ce, 'spellAttackBonus', s.attackBonus ? String(s.attackBonus) : '');
  setChildText(ce, 'preparedMax', s.spellsMax === null ? '' : String(Math.max(0, s.spellsMax)));
  setChildText(ce, 'cantripsMax', s.cantripsMax === null ? '' : String(Math.max(0, s.cantripsMax)));
  setChildText(ce, 'customCasting', s.enabled ? '1' : '');
}
