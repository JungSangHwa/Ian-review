const { test } = require('node:test')
const assert = require('node:assert/strict')
const { emptyWorkspace } = require('../src/lib/model.ts')
const { createDocument } = require('../src/lib/actions.ts')
const { validateWorkspace } = require('../src/lib/validation.ts')
const { saveAIConfig, startAITranslation, prepareAIBatch, requestAI } = require('../src/lib/aiTranslation.ts')
const { processProjectGlossary } = require('../src/lib/projectGlossary.ts')

function setup() {
  let state = emptyWorkspace()
  const id = createDocument(state, { title: '01화', domain: '별빛 서약', sourceLang: 'en', targetLang: 'ko', contentType: 'novel', pairs: [{ source: 'Serin entered Moonspire.', target: '' }] })
  createDocument(state, { title: '다른 작품', domain: '푸른 바다', sourceLang: 'en', targetLang: 'ko', contentType: 'novel', pairs: [{ source: 'Captain reached Seaport.', target: '' }] })
  saveAIConfig(state, { project: '별빛 서약', provider: 'local', model: 'qwen3:8b', instructions: '고유명사를 통일합니다.', batchChars: 2000 })
  return { get state() { return state }, id, commit: async recipe => { const draft = structuredClone(state); recipe(draft); state = validateWorkspace(draft); return true } }
}

test('project corpus becomes a model checked glossary used by later translation', async () => {
  const workspace = setup()
  let calls = 0
  const result = await processProjectGlossary({ project: '별빛 서약', read: () => workspace.state, commit: workspace.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, system, prompt) => {
    calls++
    const context = JSON.parse(prompt)
    assert.equal(context.project, '별빛 서약')
    assert.equal(context.samples.length, 1)
    assert.equal(context.samples[0].documentId, workspace.id)
    if (!system.startsWith('Build')) assert.equal(context.candidates[0].source, 'Moonspire')
    return JSON.stringify({ terms: [{ source: 'Moonspire', target: '월광첨탑', category: 'place', aliases: [], note: '성채', evidence: { documentId: workspace.id, segmentId: workspace.state.translations.find(d=>d.id===workspace.id).segments[0].id, quote: 'Moonspire' } }] })
  } })
  assert.equal(calls, 2)
  assert.equal(result.added, 1)
  assert.equal(workspace.state.glossary[0].project, '별빛 서약')
  assert.equal(workspace.state.glossary[0].reviewStatus, 'approved')
  startAITranslation(workspace.state, workspace.id, 'empty')
  assert.match(prepareAIBatch(workspace.state, workspace.id).prompt, /월광첨탑/)
})

test('unsupported project glossary evidence is never stored', async () => {
  const workspace = setup()
  await assert.rejects(processProjectGlossary({ project: '별빛 서약', read: () => workspace.state, commit: workspace.commit, apiKey: '', signal: new AbortController().signal, transport: async () => JSON.stringify({ terms: [{ source: 'Invented', target: '발명', category: 'place', aliases: [], note: '', evidence: { documentId: workspace.id, segmentId: workspace.state.translations.find(d=>d.id===workspace.id).segments[0].id, quote: 'not in source' } }] }) }), /원문에서 확인되지 않는/)
  assert.equal(workspace.state.glossary.length, 0)
})

test('second model can reject a plausible glossary candidate', async () => {
  const workspace = setup()
  let calls = 0
  const result = await processProjectGlossary({ project: '별빛 서약', read: () => workspace.state, commit: workspace.commit, apiKey: '', signal: new AbortController().signal, transport: async () => {
    calls++
    if (calls === 2) return JSON.stringify({ terms: [] })
    return JSON.stringify({ terms: [{ source: 'Moonspire', target: '월광첨탑', category: 'place', aliases: [], note: '', evidence: { documentId: workspace.id, segmentId: workspace.state.translations.find(d=>d.id===workspace.id).segments[0].id, quote: 'Moonspire' } }] })
  } })
  assert.equal(result.added, 0)
  assert.equal(workspace.state.glossary.length, 0)
})

test('new project terms inform later source batches', async () => {
  let state = emptyWorkspace()
  const id = createDocument(state, { title: '긴 원고', domain: '별빛 서약', sourceLang: 'en', targetLang: 'ko', contentType: 'novel', pairs: [{ source: 'Moonspire '.repeat(500), target: '' }] })
  saveAIConfig(state, { project: '별빛 서약', provider: 'local', model: 'qwen3:8b', instructions: '', batchChars: 2000 })
  let calls = 0
  const result = await processProjectGlossary({ project: '별빛 서약', read: () => state, commit: async recipe => { const draft = structuredClone(state); recipe(draft); state = validateWorkspace(draft); return true }, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    calls++
    const context = JSON.parse(prompt)
    if (calls === 3) assert.equal(context.existingGlossary[0].target, '월광첨탑')
    if (calls > 2) return JSON.stringify({ terms: [] })
    return JSON.stringify({ terms: [{ source: 'Moonspire', target: '월광첨탑', category: 'place', aliases: [], note: '', evidence: { documentId: id, segmentId: state.translations[0].segments[0].id, quote: 'Moonspire' } }] })
  } })
  assert.equal(result.batches, 2)
  assert.equal(result.added, 1)
  assert.equal(calls, 4)
})

test('translation is checked by a second model call before it is returned', async () => {
  const workspace = setup()
  startAITranslation(workspace.state, workspace.id, 'empty')
  const batch = prepareAIBatch(workspace.state, workspace.id)
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async (_url, options) => {
    calls++
    const body = JSON.parse(options.body)
    if (calls === 2) { assert.match(body.system, /second-pass reviewer/); assert.match(body.prompt, /초벌 번역/) }
    return Response.json({ text: JSON.stringify({ segments: [{ id: batch.segments[0].id, target: calls === 1 ? '초벌 번역' : '검증한 번역' }], terms: [] }) })
  }
  try {
    const result = JSON.parse(await requestAI(batch, ''))
    assert.equal(calls, 2)
    assert.equal(result.segments[0].target, '검증한 번역')
  } finally { global.fetch = originalFetch }
})
