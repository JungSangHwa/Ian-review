const { test } = require('node:test')
const assert = require('node:assert/strict')
const { emptyWorkspace, uid } = require('../src/lib/model.ts')
const { createDocument } = require('../src/lib/actions.ts')
const { saveAIConfig, startAITranslation, prepareAIBatch, parseAIBatchResult, applyAIBatch, requestAI, processAITranslation } = require('../src/lib/aiTranslation.ts')
const { processProjectGlossary, projectGlossaryProgress } = require('../src/lib/projectGlossary.ts')
const { glossaryDocument } = require('../src/lib/modelGlossary.ts')
const { validateWorkspace, parseBackup } = require('../src/lib/validation.ts')
const { backupText } = require('../src/lib/files.ts')

function setup(source = 'Mira entered Moonspire.') {
  let state = emptyWorkspace()
  const id = createDocument(state, { title: '01화', domain: 'Alpha', sourceLang: 'en', targetLang: 'ko', pairs: [{ source, target: '' }] })
  saveAIConfig(state, { project: 'Alpha', provider: 'local', model: 'test-model', instructions: '같은 이름과 호칭을 유지합니다.', batchChars: 2000 })
  return { id, read: () => state, commit: async recipe => { const draft = structuredClone(state); recipe(draft); state = validateWorkspace(draft); return true } }
}

test('a real alias cannot justify a canonical name invented outside the source', async () => {
  const db = setup(), state = db.read()
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  const invented = { source: 'Princess Mirabelle', target: '미라', category: 'character', aliases: ['Mira'], note: '', evidence: { segmentId: batch.segments[0].id, quote: 'Mira' } }
  assert.throws(() => parseAIBatchResult(JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '미라가 들어갔다.' }], terms: [invented] }), batch), /기준 원어/)
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    const sample = JSON.parse(prompt).samples[0]
    return JSON.stringify({ terms: [{ ...invented, evidence: { ...invented.evidence, documentId: sample.documentId, segmentId: sample.segmentId } }] })
  } }), /기준 원어/)
  assert.equal(db.read().glossary.length, 0)
})

test('large unrelated glossary notes do not crowd out terms needed by the current source', async () => {
  const db = setup(), state = db.read()
  for (let index = 0; index < 100; index++) state.glossary.push({ id: uid(), project: 'Alpha', source: 'Unrelated ' + index, target: '다른 용어 ' + index, sourceLang: 'en', targetLang: 'ko', severity: 'warning', note: '설정 메모 '.repeat(100) })
  state.glossary.push({ id: uid(), project: 'Alpha', source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', severity: 'warning', note: '미라의 말투를 유지합니다.', aliases: ['MIRA'], variants: ['미라나'] })
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id), entries = JSON.parse(batch.prompt).glossaryDocument.entries
  assert.equal(entries[0].source, 'Mira')
  assert.equal(entries[0].note, '미라의 말투를 유지합니다.')
  assert.deepEqual(entries[0].avoid, ['미라나'])
  assert.ok(Buffer.byteLength(JSON.stringify(entries)) <= 20000)
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    const known = JSON.parse(prompt).existingGlossary
    assert.equal(known[0].source, 'Mira')
    assert.ok(Buffer.byteLength(JSON.stringify(known)) <= 20000)
    return '{"terms":[]}'
  } })
  assert.equal(db.read().glossary.length, 101)
})

test('required glossary notes are never silently trimmed to fit a request', () => {
  const { modelGlossaryContext } = require('../src/lib/modelGlossary.ts')
  const terms = Array.from({ length: 10 }, (_, index) => ({ id: uid(), source: 'Name' + index, target: '인물' + index, sourceLang: 'en', targetLang: 'ko', severity: 'warning', note: '가'.repeat(1000) }))
  const before = structuredClone(terms)
  assert.throws(() => modelGlossaryContext(terms, [terms.map(term => term.source).join(', ')]), /필요한 용어.*한도/)
  assert.deepEqual(terms, before)
})

test('second-pass review receives actual numeric, placeholder and canon findings from the draft', async () => {
  const db = setup('Mira has 3 keys for {name}.'), state = db.read(), prior = global.fetch
  state.glossary.push({ id: uid(), project: 'Alpha', source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', severity: 'warning' })
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  let calls = 0
  global.fetch = async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).prompt)
    if (++calls === 2) {
      assert.deepEqual(input.ruleFindings.map(issue => issue.type).sort(), ['변수 확인', '숫자 확인', '용어 일관성'].sort())
      assert.ok(input.ruleFindings.every(issue => issue.segmentId === batch.segments[0].id))
      assert.match(input.ruleFindings.find(issue => issue.type === '숫자 확인').reason, /3.*2/)
      assert.equal(state.translations[0].segments[0].targetText, '')
    }
    return Response.json({ text: JSON.stringify({ segments: [{ id: batch.segments[0].id, target: calls === 1 ? '그녀에게 열쇠 2개가 있다.' : '미라에게 {name}의 열쇠 3개가 있다.' }], terms: [] }) })
  }
  try { applyAIBatch(state, batch, await requestAI(batch, '')); assert.equal(state.translations[0].issues.filter(issue => issue.status === 'open').length, 0) } finally { global.fetch = prior }
})

test('editing canon during glossary inference discards the stale batch and preserves the edit', async () => {
  const db = setup(), state = db.read(), termId = uid()
  state.glossary.push({ id: termId, project: 'Alpha', source: 'Moonspire', target: '월광첨탑', sourceLang: 'en', targetLang: 'ko', severity: 'warning' })
  let calls = 0
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    if (++calls === 2) await db.commit(draft => { draft.glossary.find(term => term.id === termId).target = '달빛 탑' })
    const sample = JSON.parse(prompt).samples[0]
    return JSON.stringify({ terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence: { documentId: sample.documentId, segmentId: sample.segmentId, quote: 'Mira' } }] })
  } }), /용어집 기준이 바뀌었습니다/)
  assert.equal(db.read().glossary.length, 1)
  assert.equal(db.read().glossary[0].target, '달빛 탑')
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').completed, 0)
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').status, 'failed')
})

test('canonical names can use alias quotes when both spellings occur in supplied source', async () => {
  const db = setup('Mira greeted Mirabelle.')
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    const sample = JSON.parse(prompt).samples[0]
    return JSON.stringify({ terms: [{ source: 'Mirabelle', target: '미라벨', category: 'character', aliases: ['Mira'], note: '두 표기 모두 원문에 존재한다.', evidence: { documentId: sample.documentId, segmentId: sample.segmentId, quote: 'Mira' } }] })
  } })
  assert.equal(db.read().glossary[0].source, 'Mirabelle')
  assert.deepEqual(db.read().glossary[0].aliases, ['Mira'])
})

test('project glossary repairs unsupported aliases and wrong evidence before saving either pass', async () => {
  const db = setup(), seen = [], attempts = { extract: 0, verify: 0 }
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, system, prompt) => {
    const phase = system.startsWith('Build') ? 'extract' : 'verify', input = JSON.parse(prompt)
    const sample = input.samples[0], attempt = ++attempts[phase]
    seen.push(phase)
    assert.equal(db.read().glossary.length, 0)
    assert.equal(projectGlossaryProgress(db.read(), 'Alpha').ready, false)
    if (attempt === 2) {
      assert.match(input.responseCorrection.error, phase === 'extract' ? /없는 이름/ : /근거/)
      assert.ok(input.responseCorrection.previousResponse)
    }
    return JSON.stringify({ terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: phase === 'extract' && attempt === 1 ? ['없는 이름'] : [], note: '인물 이름', evidence: { documentId: sample.documentId, segmentId: sample.segmentId, quote: phase === 'verify' && attempt === 1 ? 'Mira invented quote.' : 'Mira' } }] })
  } })
  assert.deepEqual(seen, ['extract', 'extract', 'verify', 'verify'])
  assert.deepEqual(db.read().glossary[0].aliases, [])
  assert.equal(db.read().glossary[0].aiOrigin.quote, 'Mira')
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').ready, true)
})

test('project glossary stops after two failed repairs and never saves unsupported canon', async () => {
  const db = setup()
  let calls = 0
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    calls++
    const sample = JSON.parse(prompt).samples[0]
    return JSON.stringify({ terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence: { documentId: sample.documentId, segmentId: sample.segmentId, quote: 'Unsupported.' } }] })
  } }), /Mira.*근거/)
  assert.equal(calls, 3)
  assert.equal(db.read().glossary.length, 0)
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').status, 'failed')
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').completed, 0)
})

test('cancelling a glossary repair keeps the batch unprocessed', async () => {
  const db = setup(), controller = new AbortController()
  let calls = 0
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: controller.signal, transport: async () => {
    if (++calls === 2) controller.abort()
    return 'not JSON'
  } }), /abort/i)
  assert.equal(calls, 2)
  assert.equal(db.read().glossary.length, 0)
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').status, 'paused')
})

test('glossary repair identifies the unique quote location without accepting mismatched IDs', async () => {
  const db = setup()
  let calls = 0
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    const input = JSON.parse(prompt), sample = input.samples[0]
    if (++calls === 2) {
      assert.match(input.responseCorrection.error, new RegExp(sample.documentId))
      assert.match(input.responseCorrection.error, new RegExp(sample.segmentId))
      assert.equal(db.read().glossary.length, 0)
    }
    return JSON.stringify({ terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence: { documentId: sample.documentId, segmentId: calls === 1 ? 'wrong-segment' : sample.segmentId, quote: 'Mira' } }] })
  } })
  assert.equal(calls, 3)
  assert.equal(db.read().glossary[0].aiOrigin.segmentId, db.read().translations[0].segments[0].id)
})

test('legacy drafts and conflicts are decided by the model and survive backup round trip', async () => {
  const db = setup(), state = db.read(), doc = state.translations[0]
  const origin = { provider: 'local', model: 'old-model', documentId: doc.id, segmentId: doc.segments[0].id, quote: 'Mira', createdAt: new Date().toISOString() }
  const term = { id: uid(), source: 'Mira', target: '미라나', sourceLang: 'en', targetLang: 'ko', project: 'Alpha', severity: 'warning', reviewStatus: 'draft', aiOrigin: origin }
  state.glossary.push(term)
  state.termSuggestions = [{ id: uid(), termId: term.id, project: 'Alpha', source: 'Mira', target: '미라', note: '다른 표기', origin, status: 'pending' }]
  let decisions = 0
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, system, prompt) => {
    if (system.startsWith('Resolve')) {
      decisions++
      const candidate = JSON.parse(prompt).candidates[0]
      assert.equal(candidate.contexts[0].source, doc.segments[0].sourceText)
      assert.equal(candidate.fixed, false)
      return JSON.stringify({ decisions: [{ id: candidate.id, target: '미라', note: '등장인물 이름을 미라로 통일합니다.' }] })
    }
    return JSON.stringify({ terms: [] })
  } })
  assert.equal(decisions, 1)
  assert.equal(db.read().glossary[0].reviewStatus, 'approved')
  assert.equal(db.read().glossary[0].target, '미라')
  assert.deepEqual(db.read().glossary[0].variants, ['미라나'])
  assert.equal(db.read().termSuggestions[0].status, 'accepted')
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').ready, true)
  assert.deepEqual(parseBackup(backupText(db.read())), db.read())
  assert.match(glossaryDocument(db.read(), 'Alpha'), /Mira → 미라/)
})

test('missing legacy model decisions fail without changing canon or declaring readiness', async () => {
  const db = setup()
  db.read().glossary.push({ id: uid(), source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', project: 'Alpha', severity: 'warning', reviewStatus: 'draft' })
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async () => JSON.stringify({ decisions: [] }) }), /누락/)
  assert.equal(db.read().glossary[0].reviewStatus, 'draft')
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').ready, false)
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').status, 'failed')
})

test('cancelling legacy verification preserves pending terms', async () => {
  const db = setup(), controller = new AbortController()
  const term = { id: uid(), source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', project: 'Alpha', severity: 'warning', reviewStatus: 'draft' }
  db.read().glossary.push(term)
  await assert.rejects(processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: controller.signal, transport: async () => { controller.abort(); return JSON.stringify({ decisions: [{ id: term.id, target: '미라나', note: '' }] }) } }), /abort/i)
  assert.equal(db.read().glossary[0].target, '미라')
  assert.equal(db.read().glossary[0].reviewStatus, 'draft')
  assert.equal(projectGlossaryProgress(db.read(), 'Alpha').status, 'paused')
})

test('model-checked clean segments are confirmed automatically; rule violations stay open', () => {
  const db = setup('Mira has 3 keys.'), state = db.read()
  startAITranslation(state, db.id, 'empty')
  let batch = prepareAIBatch(state, db.id)
  applyAIBatch(state, batch, JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '미라는 열쇠 2개가 있다.' }], terms: [] }))
  assert.equal(state.translations[0].segments[0].reviewed, false)
  startAITranslation(state, db.id, 'all')
  batch = prepareAIBatch(state, db.id)
  applyAIBatch(state, batch, JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '미라는 열쇠 3개가 있다.' }], terms: [] }))
  assert.equal(state.translations[0].segments[0].reviewed, true)
  assert.equal(state.translations[0].issues.filter(issue => issue.status === 'open').length, 0)
})

test('second pass glossary corrections are used in translation and saved as canon', async () => {
  const db = setup(), state = db.read()
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id), fetchBefore = global.fetch
  let calls = 0
  global.fetch = async (_url, options) => {
    calls++
    const body = JSON.parse(options.body), input = JSON.parse(body.prompt)
    assert.equal((input.request ?? input).glossaryDocument.title, 'Alpha · 번역 기준 문서')
    return Response.json({ text: JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '미라나는 월광첨탑에 들어갔다.' }], terms: [{ source: 'Mira', target: calls === 1 ? '미라나' : '미라', category: 'character', aliases: [], note: '등장인물', evidence: { segmentId: batch.segments[0].id, quote: 'Mira' } }] }) })
  }
  try {
    const result = await requestAI(batch, '')
    applyAIBatch(state, batch, result)
    assert.equal(state.translations[0].segments[0].targetText, '미라는 월광첨탑에 들어갔다.')
    assert.equal(state.glossary[0].target, '미라')
    assert.equal(state.glossary[0].reviewStatus, 'approved')
  } finally { global.fetch = fetchBefore }
})

test('translation progress advances after each successful saved batch', async () => {
  const db = setup('Mira. '.repeat(400)), state = db.read()
  state.translations[0].segments.push({ ...structuredClone(state.translations[0].segments[0]), id: uid(), sourceText: 'Moonspire.', targetText: '', originalTargetText: '' })
  startAITranslation(state, db.id, 'empty')
  const progress = []
  await processAITranslation({ docId: db.id, read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, onProgress: (done, total) => progress.push([done, total]), transport: async batch => JSON.stringify({ segments: batch.segments.map(segment => ({ id: segment.id, target: '미라가 월광첨탑에 들어갔다.' })), terms: [] }) })
  assert.deepEqual(progress, [[1, 2], [2, 2]])
})

test('pending shared suggestions respect an existing project override', async () => {
  const db = setup(), state = db.read(), doc = state.translations[0]
  const common = { id: uid(), source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', severity: 'warning' }
  const own = { ...common, id: uid(), project: 'Alpha', target: '미라나', reviewStatus: 'draft' }
  state.glossary.push(common, own)
  state.termSuggestions = [{ id: uid(), termId: common.id, project: 'Alpha', source: 'Mira', target: '미라', note: '', status: 'pending', origin: { provider: 'local', model: 'old', documentId: doc.id, segmentId: doc.segments[0].id, quote: 'Mira', createdAt: new Date().toISOString() } }]
  await processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, system, prompt) => {
    if (!system.startsWith('Resolve')) return JSON.stringify({ terms: [] })
    const candidates = JSON.parse(prompt).candidates
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].target, '미라나')
    return JSON.stringify({ decisions: [{ id: candidates[0].id, target: '미라나', note: '이 작품의 기준을 유지합니다.' }] })
  } })
  assert.equal(db.read().glossary.length, 2)
  assert.equal(db.read().glossary.find(term => term.id === own.id).reviewStatus, 'approved')
  assert.equal(db.read().termSuggestions[0].termId, own.id)
  assert.equal(db.read().termSuggestions[0].status, 'dismissed')
  assert.equal(db.read().glossary.find(term => term.id === common.id).target, '미라')
})

test('other episodes provide style context without including unrelated projects', () => {
  const db = setup(), state = db.read()
  const priorId = createDocument(state, { title: '이전 회차', domain: 'Alpha', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Mira came.', target: '미라가 왔다.' }] })
  state.translations.find(doc => doc.id === priorId).segments[0].reviewed = true
  createDocument(state, { title: '다른 작품', domain: 'Beta', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Other.', target: '다른 작품의 문장.' }] })
  startAITranslation(state, db.id, 'empty')
  const input = JSON.parse(prepareAIBatch(state, db.id).prompt)
  assert.match(input.glossaryDocument.narrationRule, /plain literary/)
  assert.deepEqual(input.previousProjectContext, [{ title: '이전 회차', source: 'Mira came.', translation: '미라가 왔다.' }])
  assert.equal(JSON.stringify(input).includes('다른 작품의 문장'), false)
})

for (const invalid of [false, true]) test('project glossary checks every item of model evidence arrays: ' + (invalid ? 'invalid evidence rejected' : 'valid evidence saved'), async () => {
  const db = setup()
  createDocument(db.read(), { title: '02화', domain: 'Alpha', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Mira returned.', target: '' }] })
  const work = processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    const samples = JSON.parse(prompt).samples
    const evidence = samples.map(sample => ({ documentId: sample.documentId, segmentId: sample.segmentId, quote: 'Mira' }))
    if (invalid) evidence[1].quote = 'not in source'
    return JSON.stringify({ terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence }] })
  } })
  if (invalid) {
    await assert.rejects(work, /원문에서 확인되지 않는/)
    assert.equal(db.read().glossary.length, 0)
  } else {
    await work
    assert.equal(db.read().glossary[0].target, '미라')
    assert.equal(db.read().glossary[0].aiOrigin.quote, 'Mira')
  }
})

for (const invalid of [false, true]) test('translation checks every item of model evidence arrays: ' + (invalid ? 'invalid evidence rejected' : 'valid evidence accepted'), () => {
  const db = setup(), state = db.read(), doc = state.translations[0]
  doc.segments.push({ ...structuredClone(doc.segments[0]), id: uid(), sourceText: 'Mira returned.' })
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  const evidence = batch.segments.map(segment => ({ segmentId: segment.id, quote: 'Mira' }))
  if (invalid) evidence[1].quote = 'not in source'
  const response = JSON.stringify({ segments: batch.segments.map(segment => ({ id: segment.id, target: '미라가 왔다.' })), terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence }] })
  if (invalid) assert.throws(() => parseAIBatchResult(response, batch), /원문에서 확인할 수 없는/)
  else assert.equal(parseAIBatchResult(response, batch).terms[0].evidence.quote, 'Mira')
})

test('the model repairs duplicate validator output before any text is saved', async () => {
  const db = setup(), state = db.read(), originalFetch = global.fetch
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  let calls = 0
  global.fetch = async (_url, options) => {
    calls++
    const body = JSON.parse(options.body), prompt = JSON.parse(body.prompt)
    if (calls === 3) {
      assert.deepEqual(prompt.responseCorrection.expectedSegmentIds, batch.segments.map(segment => segment.id))
      assert.equal(state.translations[0].segments[0].targetText, '')
    }
    const row = { id: batch.segments[0].id, target: calls === 3 ? '미라가 돌아왔다.' : '초벌 번역' }
    return Response.json({ text: JSON.stringify({ segments: calls === 2 ? [row, row] : [row], terms: [] }) })
  }
  try {
    const result = await requestAI(batch, '')
    applyAIBatch(state, batch, result)
    assert.equal(calls, 3)
    assert.equal(state.translations[0].segments[0].targetText, '미라가 돌아왔다.')
  } finally { global.fetch = originalFetch }
})

test('invalid model output retries are bounded and preserve the saved translation', async () => {
  const db = setup(), state = db.read(), originalFetch = global.fetch
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  let calls = 0
  global.fetch = async () => { calls++; return Response.json({ text: '{bad json' }) }
  try {
    await assert.rejects(requestAI(batch, ''), /올바른 JSON/)
    assert.equal(calls, 3)
    assert.equal(state.translations[0].segments[0].targetText, '')
    assert.equal(state.translations[0].aiRun.completed, 0)
  } finally { global.fetch = originalFetch }
})

test('repeated canon does not import model notes or unrelated prior-scene evidence', () => {
  const db = setup('Mira returned.'), state = db.read()
  const canon = { id: uid(), source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', severity: 'warning', project: 'Alpha', note: '기존 인물 기준', reviewStatus: 'approved' }
  state.glossary.push(canon)
  const before = structuredClone(canon)
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  const response = JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '미라가 돌아왔다.' }], terms: [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '원문에 없는 관계', evidence: { segmentId: batch.segments[0].id, quote: 'Mira entered Moonspire.' } }] })
  assert.deepEqual(parseAIBatchResult(response, batch).terms, [])
  applyAIBatch(state, batch, response)
  assert.deepEqual(state.glossary[0], before)
  assert.equal(state.translations[0].segments[0].targetText, '미라가 돌아왔다.')
})


for (const invalid of [false, true]) test('translation reviewer can fill a missed term only with current source evidence: ' + (invalid ? 'reject' : 'accept'), async () => {
  const db = setup(), state = db.read(), prior = global.fetch
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  let calls = 0
  global.fetch = async () => {
    calls++
    return Response.json({ text: JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '미라가 월광첨탑에 들어갔다.' }], terms: calls === 1 ? [] : [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence: { segmentId: batch.segments[0].id, quote: invalid ? 'Mira left.' : 'Mira' } }] }) })
  }
  try {
    if (invalid) { await assert.rejects(requestAI(batch, ''), /원문에서 확인/); assert.equal(state.glossary.length, 0); assert.equal(state.translations[0].segments[0].targetText, '') }
    else { applyAIBatch(state, batch, await requestAI(batch, '')); assert.equal(state.glossary[0].source, 'Mira'); assert.equal(state.glossary[0].reviewStatus, 'approved'); assert.equal(state.translations[0].aiRun.status, 'completed') }
  } finally { global.fetch = prior }
})

for (const invalid of [false, true]) test('glossary reviewer can fill a missed source-backed term: ' + (invalid ? 'reject' : 'accept'), async () => {
  const db = setup()
  let calls = 0
  const work = processProjectGlossary({ project: 'Alpha', read: db.read, commit: db.commit, apiKey: '', signal: new AbortController().signal, transport: async (_config, _system, prompt) => {
    calls++
    const sample = JSON.parse(prompt).samples[0]
    return JSON.stringify({ terms: calls === 1 ? [] : [{ source: 'Mira', target: '미라', category: 'character', aliases: [], note: '', evidence: { documentId: sample.documentId, segmentId: sample.segmentId, quote: invalid ? 'Mira left.' : 'Mira' } }] })
  } })
  if (invalid) { await assert.rejects(work, /원문에서 확인/); assert.equal(db.read().glossary.length, 0) }
  else { await work; assert.equal(db.read().glossary[0].source, 'Mira'); assert.equal(projectGlossaryProgress(db.read(), 'Alpha').ready, true) }
})

test('a verified title keeps its own translation instead of becoming a personal-name variant', () => {
  const { storeModelTerm } = require('../src/lib/modelGlossary.ts')
  const db = setup('Mira, the Ash Warden, returned.'), state = db.read(), doc = state.translations[0]
  const origin = { provider: 'local', model: 'test', documentId: doc.id, segmentId: doc.segments[0].id, quote: 'Mira, the Ash Warden', createdAt: new Date().toISOString() }
  state.glossary.push({ id: uid(), project: 'Alpha', source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', category: 'character', aliases: ['Ash Warden'], severity: 'warning', reviewStatus: 'approved' })
  assert.deepEqual(storeModelTerm(state, doc, { source: 'Ash Warden', target: '재의 수호자', category: 'title', aliases: [], note: '미라의 호칭' }, origin), { added: 1, conflicts: 0 })
  assert.deepEqual(state.glossary.find(term => term.source === 'Mira').aliases, [])
  assert.equal(state.glossary.find(term => term.source === 'Ash Warden').target, '재의 수호자')
  assert.equal(state.termSuggestions?.length ?? 0, 0)
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  applyAIBatch(state, batch, JSON.stringify({ segments: [{ id: batch.segments[0].id, target: '재의 수호자 미라가 돌아왔다.' }], terms: [] }))
  assert.equal(state.translations[0].segments[0].targetText, '재의 수호자 미라가 돌아왔다.')
})

test('separating a shared name alias from a project title preserves other projects', () => {
  const { storeModelTerm } = require('../src/lib/modelGlossary.ts')
  const { applicableTerms } = require('../src/lib/terminology.ts')
  const db = setup(), state = db.read(), doc = state.translations[0]
  const common = { id: uid(), source: 'Mira', target: '미라', sourceLang: 'en', targetLang: 'ko', category: 'character', aliases: ['Ash Warden'], severity: 'warning' }
  state.glossary.push(common)
  storeModelTerm(state, doc, { source: 'Ash Warden', target: '재의 수호자', category: 'title', aliases: [], note: '' }, { provider: 'local', model: 'test', documentId: doc.id, segmentId: doc.segments[0].id, quote: 'Mira', createdAt: new Date().toISOString() })
  assert.deepEqual(state.glossary.find(term => term.id === common.id).aliases, ['Ash Warden'])
  assert.deepEqual(applicableTerms(doc, state.glossary).find(term => term.source === 'Mira').aliases, [])
  assert.deepEqual(applicableTerms({ sourceLang: 'en', targetLang: 'ko', domain: 'Beta' }, state.glossary).find(term => term.source === 'Mira').aliases, ['Ash Warden'])
  validateWorkspace(state)
})

test('incoming same-person aliases cannot hide a distinct canonical title', () => {
  const { storeModelTerm } = require('../src/lib/modelGlossary.ts')
  const db = setup(), state = db.read(), doc = state.translations[0]
  state.glossary.push({ id: uid(), project: 'Alpha', source: 'Ash Warden', target: '재의 수호자', sourceLang: 'en', targetLang: 'ko', category: 'title', aliases: [], severity: 'warning' })
  storeModelTerm(state, doc, { source: 'Mira', target: '미라', category: 'character', aliases: ['Ash Warden'], note: '' }, { provider: 'local', model: 'test', documentId: doc.id, segmentId: doc.segments[0].id, quote: 'Mira', createdAt: new Date().toISOString() })
  assert.deepEqual(state.glossary.find(term => term.source === 'Mira').aliases, [])
  assert.equal(state.glossary.find(term => term.source === 'Ash Warden').target, '재의 수호자')
})


test('model subtitle repair preserves line breaks through both passes before saving', async () => {
  const db = setup('Captain Rowan:\nThe Ash Warden returned.'), state = db.read(), doc = state.translations[0], prior = global.fetch
  doc.contentType = 'subtitle'; doc.subtitle = { format: 'srt' }; doc.segments[0].cue = { identifier: '1', timing: '00:00:01,000 --> 00:00:03,000' }
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  let calls = 0
  global.fetch = async (_url, options) => {
    calls++
    if (calls % 2 === 0) assert.match(JSON.parse(options.body).prompt, /responseCorrection/)
    return Response.json({ text: JSON.stringify({ segments: [{ id: batch.segments[0].id, target: calls % 2 === 0 ? '로완 대장:\n재의 수호자가 돌아왔다.' : '로완 대장: 재의 수호자가 돌아왔다.' }], terms: [] }) })
  }
  try { applyAIBatch(state, batch, await requestAI(batch, '')); assert.equal(calls, 4); assert.equal(state.translations[0].segments[0].targetText, '로완 대장:\n재의 수호자가 돌아왔다.'); assert.equal(state.translations[0].segments[0].reviewed, true); validateWorkspace(state) } finally { global.fetch = prior }
})
test('model subtitle results reject missing tags and injected cue delimiters', () => {
  const db = setup('<i>Mira returned.</i>'), state = db.read()
  state.translations[0].contentType = 'subtitle'
  startAITranslation(state, db.id, 'empty')
  const batch = prepareAIBatch(state, db.id)
  for (const target of ['미라가 돌아왔다.', '<i>미라가 돌아왔다.</i> -->']) assert.throws(() => parseAIBatchResult(JSON.stringify({ segments: [{ id: batch.segments[0].id, target }], terms: [] }), batch), /태그|화살표/)
})
