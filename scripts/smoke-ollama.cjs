// Opt-in real inference check. Uses an isolated in-memory workspace, never the
// browser's saved projects. Start the app first, then run npm run test:ollama.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { emptyWorkspace, uid } = require('../frontend/src/lib/model.ts')
const { createDocument } = require('../frontend/src/lib/actions.ts')
const { saveAIConfig, startAITranslation, processAITranslation } = require('../frontend/src/lib/aiTranslation.ts')
const { processProjectGlossary, projectGlossaryProgress } = require('../frontend/src/lib/projectGlossary.ts')
const { validateWorkspace } = require('../frontend/src/lib/validation.ts')
const originalFetch = global.fetch

async function main() {
  const model = process.argv[2] || 'gemma4:12b', base = 'http://127.0.0.1:4173'
  const started = Date.now(), signal = AbortSignal.timeout(600000)
  let state = emptyWorkspace(), requests = 0
  const read = () => state, commit = async recipe => { const draft = structuredClone(state); recipe(draft); state = validateWorkspace(draft); return true }
  const paragraphs = [
    ['Nara laid three silver keys on the workbench. Jun watched the keys without touching them.', '"Please let me help," Jun said to Nara. "Then hold the lamp steady," Nara told him.'],
    ['Jun brought the three silver keys back to Nara. The lamp was still burning above her workbench.', '"Are all the keys here?" Nara asked Jun. "Yes. I kept them safe," he answered.'],
  ]
  const ids = paragraphs.map((sources, index) => createDocument(state, { title: '실제 추론 점검 ' + (index + 1), domain: '격리 점검', sourceLang: 'en', targetLang: 'ko', pairs: sources.map(source => ({ source, target: '' })) }))
  // Reproduce the former 60k glossary rejection using valid but unrelated notes.
  for (let index = 0; index < 100; index++) state.glossary.push({ id: uid(), project: '격리 점검', source: 'UnrelatedArtifact' + index, target: '별도 유물' + index, sourceLang: 'en', targetLang: 'ko', severity: 'warning', note: '이번 장면에 등장하지 않는 별도 유물이다. '.repeat(30) })
  const originalTerms = structuredClone(state.glossary)
  saveAIConfig(state, { project: '격리 점검', provider: 'local', model, instructions: '지문은 ~다. 준은 나라에게 존댓말, 나라는 준에게 반말을 사용한다. 인물 이름과 물건 명칭을 두 회차에서 동일하게 쓴다.', batchChars: 2000 })
  const versionResponse = await originalFetch('http://127.0.0.1:11434/api/version', { signal })
  assert.equal(versionResponse.ok, true)
  const version = (await versionResponse.json()).version
  global.fetch = (url, options = {}) => {
    if (url === '/api/model') requests++
    return originalFetch(typeof url === 'string' && url.startsWith('/api/') ? base + url : url, { ...options, headers: { ...options.headers, Origin: base } })
  }
  console.log('Real Ollama ' + version + ' · ' + model + ' · 2 chapters / 4 paragraphs')
  await processProjectGlossary({ project: '격리 점검', read, commit, apiKey: '', signal, onPhase: phase => console.log('Glossary: ' + phase) })
  assert.equal(projectGlossaryProgress(state, '격리 점검').ready, true)
  for (const id of ids) {
    startAITranslation(state, id, 'empty')
    await processAITranslation({ docId: id, read, commit, apiKey: '', signal, onPhase: phase => console.log('Translation: ' + phase) })
  }
  const output = path.resolve(__dirname, '../output/maintenance/real-ollama.json')
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(path.join(path.dirname(output), 'real-ollama-state.json'), JSON.stringify(state, null, 2) + '\n')
  for (const [index, id] of ids.entries()) {
    const doc = state.translations.find(document => document.id === id)
    assert.equal(doc.aiRun.status, 'completed')
    assert.deepEqual(doc.segments.map(segment => segment.sourceText), paragraphs[index])
    assert.ok(doc.segments.every(segment => segment.targetText.trim()))
    assert.deepEqual(doc.issues.filter(issue => issue.status === 'open').map(issue => ({ type: issue.type, reason: issue.reason, segmentId: issue.segmentId })), [])
  }
  assert.deepEqual(originalTerms.map(term => state.glossary.find(entry => entry.id === term.id)), originalTerms)
  const overflow = await global.fetch('/api/model', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ian-Request': 'model' }, body: JSON.stringify({ provider: 'local', model, system: 'Return JSON only.', prompt: '문맥 확인 '.repeat(15000) }), signal })
  assert.equal(overflow.status, 502)
  const overflowError = (await overflow.json()).error
  assert.match(overflowError, /문맥 한도/)
  const result = { model, ollamaVersion: version, requests, elapsedSeconds: Math.round((Date.now() - started) / 1000), chapters: ids.map(id => state.translations.find(document => document.id === id)), newTerms: state.glossary.filter(term => !originalTerms.some(original => original.id === term.id)), originalTermsUnchanged: true, overflowRejected: overflowError, semanticQualityCertified: false }
  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n')
  console.log('PASS: source preserved, canon stable, complete responses, zero rule issues, context overflow rejected. ' + output)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { global.fetch = originalFetch })
