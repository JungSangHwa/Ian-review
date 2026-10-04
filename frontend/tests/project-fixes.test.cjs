const { test } = require('node:test')
const assert = require('node:assert/strict')
const { emptyWorkspace, uid } = require('../src/lib/model.ts')
const { createDocument } = require('../src/lib/actions.ts')
const { projectNames } = require('../src/lib/projects.ts')
const { validateWorkspace } = require('../src/lib/validation.ts')
const { saveAIConfig } = require('../src/lib/aiTranslation.ts')
const { processProjectGlossary, projectGlossaryProgress } = require('../src/lib/projectGlossary.ts')
const { applicableTerms } = require('../src/lib/terminology.ts')

const create = (state, project, source = 'Mira entered the room.') => createDocument(state, {
  title: '01화', domain: project, sourceLang: 'en', targetLang: 'ko', pairs: [{ source, target: '' }],
})
const config = (state, project) => saveAIConfig(state, { project, provider: 'local', model: 'local-test', instructions: '', batchChars: 2000 })
const storage = initial => {
  let state = validateWorkspace(initial)
  return { read: () => state, commit: async recipe => { const draft = structuredClone(state); recipe(draft); state = validateWorkspace(draft); return true } }
}

test('document creation and legacy restore keep an explicit project after its last document is deleted', () => {
  const state = emptyWorkspace()
  create(state, 'QA.v1')
  assert.deepEqual(state.projects, ['QA.v1'])
  state.translations = []
  assert.deepEqual(projectNames(state), ['QA.v1'])
  const legacy = emptyWorkspace()
  create(legacy, '옛 작품')
  delete legacy.projects
  assert.deepEqual(validateWorkspace(legacy).projects, ['옛 작품'])
})

test('a partial glossary run resumes remaining source and new source requires validation', async () => {
  const state = emptyWorkspace()
  create(state, 'Alpha', 'A'.repeat(5000))
  config(state, 'Alpha')
  const db = storage(state), controller = new AbortController()
  let calls = 0
  const transport = async () => { calls++; return JSON.stringify({ terms: [] }) }
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: controller.signal, transport,
    onProgress: done => { if (done === 1) controller.abort() },
  }), /abort/i)
  assert.deepEqual(projectGlossaryProgress(db.read(), 'Alpha'), { completed: 1, total: 2, ready: false, status: 'paused' })
  calls = 0
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport })
  assert.equal(calls, 2)
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').ready, true)
  const next = structuredClone(db.read()); create(next, 'Alpha', 'New scene.')
  const db2 = storage(next)
  assert.equal(projectGlossaryProgress(db2.read(), 'Alpha').ready, false)
  calls = 0
  await processProjectGlossary({ project: 'Alpha', read: db2.read, commit: db2.commit, apiKey: '', signal: new AbortController().signal, transport })
  assert.equal(projectGlossaryProgress(db2.read(), 'Alpha').ready, true)
  assert.ok(calls > 0)
})

test('shared canon is preserved while model spelling decisions stay in each project', async () => {
  const state = emptyWorkspace()
  create(state, 'Alpha'); create(state, 'Beta')
  config(state, 'Alpha'); config(state, 'Beta')
  const common = { id: uid(), source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', severity: 'warning' }
  state.glossary.push(common)
  const db = storage(state)
  const transport = async (_config, _system, prompt) => {
    const sample = JSON.parse(prompt).samples[0]
    return JSON.stringify({ terms: [{ source: 'Mira', target: '미라나', category: 'character', aliases: [], note: '', evidence: { documentId: sample.documentId, segmentId: sample.segmentId, quote: 'Mira' } }] })
  }
  for (const project of ['Alpha', 'Beta']) await processProjectGlossary({ project, read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport })
  assert.deepEqual(db.read().termSuggestions.map(s => s.project).sort(), ['Alpha', 'Beta'])
  assert.equal(db.read().glossary.find(t => t.id === common.id).target, '미라')
  assert.equal(db.read().glossary.find(t => t.id === common.id).variants, undefined)
  assert(db.read().glossary.filter(t => t.project).every(t => t.variants.includes('미라나')))
  assert(db.read().termSuggestions.every(s => s.status === 'dismissed'))
  const alpha = db.read().translations.find(d => d.domain === 'Alpha')
  const beta = db.read().translations.find(d => d.domain === 'Beta')
  assert.equal(applicableTerms(alpha, db.read().glossary).find(t => t.source === 'Mira').target, '미라')
  assert.equal(applicableTerms(beta, db.read().glossary).find(t => t.source === 'Mira').target, '미라')
  assert.equal(db.read().termSuggestions.find(s => s.project === 'Beta').status, 'dismissed')
})
