// The short client report (red / yellow / green summary of the long report).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const summary = require('../src/summary');
const pdftext = require('../src/pdftext');

const load = (name) => require(path.join(__dirname, 'fixtures', 'short-report', `${name}.json`));

test('colours come from the result levels and every known parameter has plain words', () => {
  const m = summary.build(load('fitness'), { test: 'MDP Fitness' });
  assert.equal(m.product, 'MDP Fitness');
  assert.deepEqual([m.red.length, m.yellow.length], [6, 17]);
  for (const i of [...m.red, ...m.yellow, ...m.green]) assert.ok(i.what && i.meaning, i.name);
  // Only red and yellow results carry steps.
  assert.ok(m.green.every((i) => !i.tips.length));
  assert.ok(m.red.every((i) => i.tips.length >= 1));
  // Descriptive traits go under "good to know", not in the green list.
  assert.ok(m.insights.some((x) => x.name === 'Muscle Performance'));
  assert.ok(!m.green.some((x) => x.name === 'Sleep Depth'));
});

test('advice follows the diet, the sex and is not repeated', () => {
  const veg = summary.build(load('fitness'));
  const b12 = veg.yellow.find((i) => i.name === 'Vitamin B12');
  assert.match(b12.foods, /paneer/);
  assert.doesNotMatch(b12.foods, /fish|chicken/);
  const c = load('cardiac');
  const nonveg = summary.build(c);
  assert.match(nonveg.yellow.find((i) => i.name === 'Iron').foods, /chicken|meat/);
  // A man's report leaves out nothing for being male; a woman's leaves out prostate.
  const woman = summary.build(load('360'));
  assert.ok(![...woman.red, ...woman.yellow, ...woman.green].some((i) => /Prostate|Testicular/.test(i.name)));
  // Skin: sunscreen is said once, later results get their own next step.
  const skin = summary.build(load('skin'));
  const shown = [...skin.red, ...skin.yellow].flatMap((i) => i.tips);
  assert.equal(shown.filter((t) => /^Use sunscreen/.test(t)).length, 1);
});

test('medicines: only flagged ones are explained, in plain words', () => {
  const m = summary.build(load('cardiac'), { test: 'MDP Cardiac Health' });
  const flagged = m.drugs.filter((d) => d.level);
  assert.deepEqual(flagged.map((d) => d.name).sort(), ['Clopidogrel', 'Isosorbide and Hydralazine (BIDIL)', 'Metformin', 'Propranolol']);
  assert.match(summary.drugMeaning('Slow acetylator. High risk for drug-induced side effects or toxicity.'), /clears this medicine slowly/);
});

test('a case without results is refused', () => {
  assert.throws(() => summary.build({ patient: {}, clinical: null }), /no results/);
});

test('the PDF is short, readable and carries the client and sample ID', () => {
  for (const [name, test, max] of [['fitness', 'MDP Fitness', 5], ['cardiac', 'MDP Cardiac Health', 4], ['360', 'MDP 360 Premium', 5], ['skin', 'MDP Skin Health', 3]]) {
    const c = load(name);
    const pdf = summary.shortReport(c, { test });
    const doc = pdftext.extract(pdf);
    assert.ok(doc.pages.length <= max, `${name}: ${doc.pages.length} pages`);
    const text = doc.pages.map((p) => p.text).join(' ');
    assert.ok(text.includes(c.patient.sampleId), name);
    assert.ok(text.includes(c.patient.name), name);
    assert.ok(!text.includes('?'), `${name} has no lost characters`);
  }
});
