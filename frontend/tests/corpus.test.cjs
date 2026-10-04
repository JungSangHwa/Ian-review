const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectTestCorpus, buildTestWorkspace, loadTestSet } = require('../src/lib/testSet.ts');
const { TEST_CASES, TEST_GROUPS } = require('../src/lib/testCorpus.ts');
const { emptyWorkspace, uid } = require('../src/lib/model.ts');
const { createDocument } = require('../src/lib/actions.ts');
const { inspectSegment } = require('../src/lib/rules.ts');
const { importPairs, makeCSV } = require('../src/lib/files.ts');
const { validateWorkspace } = require('../src/lib/validation.ts');

for (const row of inspectTestCorpus()) test(`corpus ${row.id}: ${row.purpose}`, () => assert.deepEqual(row.actual, row.expected));

test('test set contains 4 documents, 36 segments, 4 A/B drafts, 18 rule issues and 4 manual semantic issues', () => {
  const state = buildTestWorkspace();
  assert.equal(state.translations.length, 4);
  assert.equal(state.translations.flatMap(d => d.segments).length, 36);
  assert.equal(state.evaluations.length, 4);
  assert.equal(state.translations.flatMap(d => d.issues).filter(i => i.origin === 'rule').length, 18);
  assert.equal(state.translations.flatMap(d => d.issues).filter(i => i.origin === 'manual').length, 4);
  assert.equal(state.glossary.length, 4);
  validateWorkspace(state);
});
test('test-set loading preserves existing work and cannot duplicate', () => {
  const state = emptyWorkspace();
  const id = createDocument(state, { title: '기존 문서', domain: '', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Hello.', target: '안녕하세요.' }] });
  const original = structuredClone(state.translations[0]);
  loadTestSet(state);
  assert.deepEqual(state.translations.find(d => d.id === id), original);
  const loaded = structuredClone(state);
  assert.throws(() => loadTestSet(state), /이미/);
  assert.deepEqual(state, loaded);
});
test('test-set glossary conflicts abort without partially inserting data', () => {
  const state = emptyWorkspace();
  state.glossary.push({ id: uid(), source: 'WORKSPACE', target: '작업 공간', sourceLang: 'en', targetLang: 'ko', severity: 'warning' });
  const before = structuredClone(state);
  assert.throws(() => loadTestSet(state), /기존 용어/);
  assert.deepEqual(state, before);
});
test('all 36 authored source/target pairs survive CSV round trip including blank translations', () => {
  for (const group of TEST_GROUPS) {
    const pairs = TEST_CASES.filter(c => c.group === group.id).map(c => ({ source: c.source, target: c.target }));
    assert.deepEqual(importPairs(makeCSV([['source', 'target'], ...pairs.map(p => [p.source, p.target])])), pairs);
  }
});
function types(source, target) {
  return inspectSegment({ id: uid(), sourceText: source, targetText: target, originalTargetText: target, revision: 1, reviewed: false, history: [] }, { sourceLang: 'en', targetLang: 'ko' }, []).map(i => i.type);
}
test('Unicode minus and ASCII minus are equivalent', () => assert.deepEqual(types('Change: −5.', '변동량: -5.'), []));
test('positive sign is optional without changing numeric value', () => assert.deepEqual(types('Change: +5.', '변동량: 5.'), []));
test('ISO dates and hyphenated ranges do not acquire negative signs', () => {
  assert.deepEqual(types('Date 2026-09-22, range 3-5.', '날짜 2026/09/22, 범위 3~5.'), []);
  assert.deepEqual(types('Standard ISO-9001.', 'ISO 9001 표준.'), []);
});
test('printf literal percentages are not mistaken for variable placeholders', () => {
  assert.deepEqual(types('Literal %%s, value %02d.', '리터럴 %%s, 값 %02d.'), []);
  assert.deepEqual(types('Literal %%s.', '리터럴 퍼센트와 s.'), []);
  assert.ok(types('Literal %% and value %02d.', '리터럴 %% 및 값 %02s.').includes('변수 확인'));
});
