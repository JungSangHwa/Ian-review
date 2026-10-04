const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { TEST_CASES, TEST_GROUPS, TEST_EVALUATIONS, TEST_TITLE_PREFIX } = require('../src/lib/testCorpus.ts');
const { loadTestSet, buildTestWorkspace } = require('../src/lib/testSet.ts');
const { createDocument, editSegment, markReviewed, finalizeDocument, decideIssue, saveEvaluation } = require('../src/lib/actions.ts');
const { backupText, importPairs, makeCSV } = require('../src/lib/files.ts');
const { parseBackup } = require('../src/lib/validation.ts');
const { emptyWorkspace } = require('../src/lib/model.ts');
let db;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  delete require.cache[require.resolve('../src/lib/database.ts')];
  db = require('../src/lib/database.ts');
});
async function seed() { const empty = await db.loadWorkspace(); return db.commitWorkspace(empty.revision, loadTestSet); }

test('actual database adapter commits the corpus and reads the exact stored workspace', async () => {
  const state = await seed();
  assert.equal(state.revision, 1);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('real CSV import and document action persist quoted, multiline and blank target data', async () => {
  const empty = await db.loadWorkspace();
  const pairs = TEST_CASES.filter(c => ['C05', 'E01', 'C06'].includes(c.id)).map(c => ({ source: c.source, target: c.target }));
  const csv = makeCSV([['source', 'target'], ...pairs.map(c => [c.source, c.target])]);
  await db.commitWorkspace(empty.revision, s => createDocument(s, { title: 'CSV 가져오기 검증', domain: '', sourceLang: 'en', targetLang: 'ko', pairs: importPairs(csv) }));
  const stored = await db.loadWorkspace();
  assert.deepEqual(stored.translations[0].segments.map(s => ({ source: s.sourceText, target: s.targetText })), pairs);
});
test('edits preserve source and original translation, persist history and revoke reviewed state', async () => {
  let state = await seed();
  const doc = state.translations.find(d => d.title.endsWith(TEST_GROUPS[0].title));
  const seg = doc.segments[0];
  state = await db.commitWorkspace(state.revision, s => markReviewed(s, doc.id, seg.id, true));
  state = await db.commitWorkspace(state.revision, s => editSegment(s, doc.id, seg.id, 1, '새 워크스페이스에 오신 것을 환영합니다.'));
  const stored = (await db.loadWorkspace()).translations.find(d => d.id === doc.id).segments[0];
  assert.equal(stored.sourceText, seg.sourceText);
  assert.equal(stored.originalTargetText, seg.targetText);
  assert.equal(stored.history[0].text, seg.targetText);
  assert.equal(stored.revision, 2);
  assert.equal(stored.reviewed, false);
});
test('stale paragraph revision aborts the transaction and preserves saved data', async () => {
  const state = await seed(); const doc = state.translations[0], seg = doc.segments[0];
  await assert.rejects(db.commitWorkspace(state.revision, s => editSegment(s, doc.id, seg.id, 99, 'stale')), /버전/);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('two concurrent writers produce one commit and one conflict without overwriting', async () => {
  const state = await seed();
  const results = await Promise.allSettled([
    db.commitWorkspace(state.revision, s => { s.translations[0].title = 'first'; }),
    db.commitWorkspace(state.revision, s => { s.translations[0].title = 'second'; }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.name, 'ConflictError');
  assert.deepEqual(await db.loadWorkspace(), results.find(r => r.status === 'fulfilled').value);
});
test('invalid data mutation is rolled back including the workspace revision', async () => {
  const state = await seed();
  await assert.rejects(db.commitWorkspace(state.revision, s => { s.translations[0].segments[0].revision = -1; }), /revision/);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('duplicate test-set insert is rejected atomically', async () => {
  const state = await seed();
  await assert.rejects(db.commitWorkspace(state.revision, loadTestSet), /이미/);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('JSON backup restores every document, issue, candidate order and history; recovery preserves previous workspace', async () => {
  let state = await seed(); const backup = parseBackup(backupText(state));
  state = await db.commitWorkspace(state.revision, s => { s.translations = []; s.evaluations = []; });
  const beforeRestore = structuredClone(state);
  state = await db.commitWorkspace(state.revision, s => Object.assign(s, backup), true);
  const stored = await db.loadWorkspace();
  assert.deepEqual(stored.translations, backup.translations);
  assert.deepEqual(stored.evaluations, backup.evaluations);
  assert.deepEqual(stored.glossary, backup.glossary);
  assert.equal(state.revision, beforeRestore.revision + 1);
  assert.deepEqual(await db.readRecovery(), beforeRestore);
});
test('malformed backup is rejected before changing stored documents', async () => {
  const state = await seed(); const raw = JSON.parse(backupText(state)); raw.data.translations[0].issues.push({ id: 'bad', segmentId: 'missing' });
  assert.throws(() => parseBackup(JSON.stringify(raw)), /segmentId/);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('all 36 cases can be corrected, reviewed, finalized and read back; manual corrections use app actions', async () => {
  let state = await seed();
  state = await db.commitWorkspace(state.revision, s => {
    for (const group of TEST_GROUPS) {
      const doc = s.translations.find(d => d.title === TEST_TITLE_PREFIX + group.title);
      const cases = TEST_CASES.filter(c => c.group === group.id);
      cases.forEach((c, index) => {
        const seg = doc.segments[index];
        if (c.manualReason) {
          const issue = doc.issues.find(i => i.origin === 'manual' && i.segmentId === seg.id);
          decideIssue(s, doc.id, issue.id, 'apply');
        } else if (seg.targetText !== c.reference) editSegment(s, doc.id, seg.id, seg.revision, c.reference);
        if (c.intentionalDifference) for (const issue of doc.issues.filter(i => i.segmentId === seg.id && i.status === 'open')) decideIssue(s, doc.id, issue.id, 'dismiss');
        markReviewed(s, doc.id, seg.id, true);
      });
      finalizeDocument(s, doc.id);
    }
  });
  assert.ok(state.translations.every(d => d.status === 'FINALIZED'));
  assert.ok(state.translations.every(d => d.issues.every(i => i.status !== 'open')));
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('incomplete A/B submission is rolled back; complete evaluations persist scores and become immutable', async () => {
  let state = await seed();
  const e = state.evaluations[0];
  await assert.rejects(db.commitWorkspace(state.revision, s => saveEvaluation(s, e.id, { ratings: e.ratings, preference: '', comment: '미완성', reviewer: 'ChatGPT' }, true)), /6개/);
  assert.deepEqual(await db.loadWorkspace(), state);
  state = await db.commitWorkspace(state.revision, s => {
    for (const e of s.evaluations) {
      const referenceIndex = e.candidates.findIndex(c => c.label === 'ChatGPT 기준 번역');
      const expected = TEST_EVALUATIONS.find(c => TEST_TITLE_PREFIX + c.title === e.title);
      saveEvaluation(s, e.id, { ratings: e.candidates.map((_, i) => i === referenceIndex ? { accuracy: 5, fluency: 5, terminology: 5 } : { accuracy: 1, fluency: 2, terminology: 2 }), preference: referenceIndex === 0 ? 'A' : 'B', comment: expected.reason + ' ChatGPT 작성·자체 평가이며 독립 모델 비교가 아닙니다.', reviewer: 'ChatGPT 자체 검증' }, true);
    }
  });
  assert.equal(state.evaluations.filter(e => e.status === 'SUBMITTED').length, 4);
  assert.deepEqual(await db.loadWorkspace(), state);
  await assert.rejects(db.commitWorkspace(state.revision, s => saveEvaluation(s, e.id, { ratings: e.ratings, preference: 'tie', comment: '', reviewer: '' }, false)), /이미 제출/);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('replacing workspace uses monotonically increasing revisions rather than imported revision', async () => {
  let state = await seed(); const incoming = buildTestWorkspace(); incoming.revision = 900;
  state = await db.commitWorkspace(state.revision, s => Object.assign(s, incoming), true);
  assert.equal(state.revision, 2);
});
test('blank target blocks finalization and failure preserves state', async () => {
  const state = await seed(); const doc = state.translations.find(d => d.title.endsWith(TEST_GROUPS[1].title));
  await assert.rejects(db.commitWorkspace(state.revision, s => finalizeDocument(s, doc.id)), /빈 번역문/);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('empty workspace can be loaded without sample data or fabricated evaluations', async () => {
  const state = await db.loadWorkspace();
  assert.equal(state.translations.length, 0); assert.equal(state.evaluations.length, 0);
  assert.equal(state.schemaVersion, emptyWorkspace().schemaVersion);
});
test('app initialization installs bundled data before the first screen and saves it', async () => {
  const { state, notice } = await db.initializeWorkspace();
  assert.equal(notice, undefined);
  assert.equal(state.translations.length, 3);
  assert.equal(state.translations.flatMap(d => d.segments).length, 20);
  assert.equal(state.evaluations.length, 0);
  assert.equal(state.glossary.length, 8);
  assert.equal(state.revision, 1);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('previously saved empty workspace receives bundled data on upgrade', async () => {
  await db.loadWorkspace();
  const { state } = await db.initializeWorkspace();
  assert.equal(state.translations.length, 3);
  assert.deepEqual(await db.loadWorkspace(), state);
});
test('initialization appends test data while preserving existing documents', async () => {
  const empty = await db.loadWorkspace();
  const before = await db.commitWorkspace(empty.revision, s => createDocument(s, { title: '사용자 작업', domain: '', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Hello.', target: '안녕하세요.' }] }));
  const { state } = await db.initializeWorkspace();
  assert.equal(state.translations.length, 4);
  assert.deepEqual(state.translations.find(d => d.id === before.translations[0].id), before.translations[0]);
  assert.equal(state.revision, before.revision + 1);
});
test('existing manually loaded test data and edits survive the automatic installation', async () => {
  const blank = await db.loadWorkspace();
  let before = await db.commitWorkspace(blank.revision, require('../src/lib/literaryDemo.ts').loadLiteraryExamples);
  before = await db.commitWorkspace(before.revision, s => { s.translations[0].title = '사용자가 수정한 제목'; });
  const { state } = await db.initializeWorkspace();
  assert.deepEqual(state, before);
  assert.deepEqual((await db.initializeWorkspace()).state, before);
});
test('deleting installed test data does not repopulate it on future startup', async () => {
  let { state } = await db.initializeWorkspace();
  state = await db.commitWorkspace(state.revision, s => { s.translations = []; s.evaluations = []; });
  assert.deepEqual((await db.initializeWorkspace()).state, state);
  assert.equal((await db.loadWorkspace()).translations.length, 0);
});
test('concurrent initialization installs one copy and preserves the A/B assignment', async () => {
  const [first, second] = await Promise.all([db.initializeWorkspace(), db.initializeWorkspace()]);
  assert.deepEqual(first.state, second.state);
  assert.equal(first.state.revision, 1);
  assert.equal((await db.loadWorkspace()).evaluations.length, 0);
});
test('scoped story glossary preserves unrelated custom terminology', async () => {
  const empty = await db.loadWorkspace();
  const before = await db.commitWorkspace(empty.revision, s => { s.glossary.push({ id: 'custom_term', source: 'workspace', target: '작업 공간', sourceLang: 'en', targetLang: 'ko', severity: 'warning' }); });
  const { state, notice } = await db.initializeWorkspace();
  assert.equal(state.translations.length, 3);
  assert.equal(notice, undefined);
  assert.deepEqual(state.glossary.find(t => t.id === 'custom_term'), before.glossary[0]);
  assert.deepEqual(await db.loadWorkspace(), state);
});
