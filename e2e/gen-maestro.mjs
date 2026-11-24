// Turns session.mjs into a Maestro flow for Android or iOS: the same steps, done with taps and the
// on-screen keyboard. Only the system's own file pickers and save sheets differ by platform.
//   node e2e/gen-maestro.mjs android|ios > flow.yaml
import { steps, COMPENDIUM, EXPORT_NAME } from './session.mjs';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) throw new Error('usage: gen-maestro.mjs android|ios');
const APP_ID = 'org.hearthsheet.app';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const q = (s) => JSON.stringify(s);
const exact = (s) => q(esc(s));
// Fields and list entries: Android reads a field as "<label> <placeholder>" and an entry as
// "Fireball, Level 3", so these match the name followed by anything after a non-letter.
const starts = (s) => q(`${esc(s)}(\\W.*)?`);
const out = [];
const add = (yaml) => out.push(yaml);

/** Bring an element into view inside the page or the open window, scrolling down then up. */
const reveal = (re) => {
  add(`- scrollUntilVisible:\n    element:\n      text: ${re}\n    direction: DOWN\n    timeout: 12000\n    visibilityPercentage: 60\n    optional: true`);
  add(`- scrollUntilVisible:\n    element:\n      text: ${re}\n    direction: UP\n    timeout: 6000\n    visibilityPercentage: 60\n    optional: true`);
};

const pickFile = {
  // Android's document picker: open Downloads (where the test copies the file) and choose it.
  android: (name) => [
    `- tapOn:\n    text: "Show roots"\n    optional: true`,
    `- tapOn:\n    text: "Downloads?"\n    optional: true`,
    `- scrollUntilVisible:\n    element:\n      text: ${exact(name)}\n    timeout: 20000`,
    `- tapOn: ${exact(name)}`,
  ],
  // iOS's document picker: Browse → On My iPhone → the file.
  ios: (name) => [
    `- tapOn:\n    text: "Browse"\n    optional: true`,
    `- tapOn:\n    text: "On My iPhone"\n    optional: true`,
    `- tapOn: ${q(`${esc(name.replace(/\.xml$/, ''))}(\\.xml)?`)}`,
    `- tapOn:\n    text: "Open"\n    optional: true`,
  ],
};
const saveFile = {
  // Android's "save as" screen opens with the file name filled in; it goes to Downloads.
  android: () => [
    `- tapOn:\n    text: "Show roots"\n    optional: true`,
    `- tapOn:\n    text: "Downloads?"\n    optional: true`,
    `- tapOn: "(?i)save"`,
  ],
  // iOS: the share sheet's Save to Files → On My iPhone → Save.
  ios: () => [
    `- tapOn: "Save to Files"`,
    `- tapOn:\n    text: "On My iPhone"\n    optional: true`,
    `- tapOn: "Save"`,
    `- tapOn:\n    text: "Replace"\n    optional: true`,
  ],
};

add(`appId: ${APP_ID}\nname: Hearthsheet player session (${platform})\n---`);
add(`- launchApp:\n    clearState: true`);
add(`- extendedWaitUntil:\n    visible: "Characters"\n    timeout: 60000`);
for (const [i, s] of steps.entries()) {
  add(`# step ${i}: ${JSON.stringify(s)}`);
  if (s.shot) add(`- takeScreenshot: out/${s.shot}`);
  else if (s.tap) {
    const t = s.entry ? starts(s.tap) : exact(s.tap);
    reveal(t);
    add(s.below ? `- tapOn:\n    text: ${t}\n    below:\n      text: ${starts(s.below)}` : `- tapOn: ${t}`);
  }
  else if (s.fill) {
    reveal(starts(s.fill));
    add(`- tapOn: ${starts(s.fill)}`);
    add(`- eraseText: 60`);
    add(`- inputText: ${q(s.text)}`);
    if (platform === 'ios' && !out.some((l) => l.includes('keyboard tutorial'))) {
      add(`# dismiss the Simulator's one-time keyboard tutorial if it still shows\n- tapOn:\n    text: "Continue"\n    optional: true`);
    }
    add(platform === 'android' ? `- hideKeyboard` : `- hideKeyboard:\n    optional: true`);
  } else if (s.choose) {
    reveal(starts(s.choose));
    add(`- tapOn: ${starts(s.choose)}`);
    const opt = q(`${esc(s.option)}( \\[.*\\])?`);
    add(`- scrollUntilVisible:\n    element:\n      text: ${opt}\n    timeout: 30000\n    optional: true`);
    add(`- tapOn: ${opt}`);
  } else if (s.tick) { reveal(exact(s.tick)); add(`- tapOn: ${exact(s.tick)}`); }
  else if (s.see) add(`- extendedWaitUntil:\n    visible: ${q(`.*${esc(s.see)}.*`)}\n    timeout: ${(s.seconds ?? 15) * 1000}`);
  else if (s.value) add(`# (${s.value} = ${s.is}: checked from the exported file and screenshots)`);
  else if (s.pick) for (const y of pickFile[platform](COMPENDIUM)) add(y);
  else if (s.save) for (const y of saveFile[platform](EXPORT_NAME)) add(y);
  else if (s.restart) { add(`- stopApp`); add(`- launchApp`); }
  else throw new Error(`unknown step ${JSON.stringify(s)}`);
}
console.log(out.join('\n'));
