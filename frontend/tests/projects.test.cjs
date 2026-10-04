const { test } = require('node:test')
const assert = require('node:assert/strict')
const { emptyWorkspace } = require('../src/lib/model.ts')
const { createDocument } = require('../src/lib/actions.ts')
const { createProject, deleteProject, projectNames, projectPath, renameProject, sameProject } = require('../src/lib/projects.ts')
const { validateWorkspace } = require('../src/lib/validation.ts')

test('project index includes empty projects and existing project data without duplicates', () => {
  const state = emptyWorkspace()
  state.projects = ['별빛 서약', '새 작품']
  createDocument(state, { title: '1화', domain: '별빛 서약', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Hello', target: '' }] })
  state.glossary.push({ id: 'term_1', source: 'Moon', target: '달', sourceLang: 'en', targetLang: 'ko', severity: 'warning', project: '새 작품' })
  state.evaluations.push({ id: 'evaluation_1', project: '평가 작품', title: '평가', sourceText: 'Hello', sourceLang: 'en', targetLang: 'ko', candidates: [{ label: '첫째', text: '안녕' }, { label: '둘째', text: '안녕하세요' }], ratings: [{ accuracy: 0, fluency: 0, terminology: 0 }, { accuracy: 0, fluency: 0, terminology: 0 }], preference: '', comment: '', reviewer: '', status: 'DRAFT', createdAt: state.updatedAt, updatedAt: state.updatedAt })
  assert.deepEqual(projectNames(validateWorkspace(state)), ['별빛 서약', '새 작품', '평가 작품'])
  assert.equal(state.translations[0].projectId, '별빛 서약')
  assert.equal(sameProject('  별빛 서약 ', '별빛 서약'), true)
  assert.equal(projectPath('별빛 서약', 'documents/new'), '/projects/%EB%B3%84%EB%B9%9B%20%EC%84%9C%EC%95%BD/documents/new')
})

test('project registry rejects duplicate names and legacy workspaces remain valid', () => {
  const state = emptyWorkspace()
  delete state.projects
  assert.deepEqual(projectNames(validateWorkspace(state)), [])
  state.projects = ['작품', ' 작품 ']
  assert.throws(() => validateWorkspace(state), /중복 프로젝트/)
})

test('renaming and deleting a project update its actual data without touching another project', () => {
  const state = emptyWorkspace()
  createProject(state, 'First Work')
  createProject(state, 'Second Work')
  assert.throws(() => createProject(state, ' first work '), /이미/)
  const firstId = createDocument(state, { title: '1화', domain: 'First Work', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Moon', target: '달' }] })
  const secondId = createDocument(state, { title: '2화', domain: 'Second Work', sourceLang: 'en', targetLang: 'ko', pairs: [{ source: 'Sea', target: '바다' }] })
  state.glossary.push({ id: 'term_1', source: 'Moon', target: '달', sourceLang: 'en', targetLang: 'ko', severity: 'warning', project: 'First Work' })
  state.glossary.push({ id: 'term_global', source: 'Hello', target: '안녕', sourceLang: 'en', targetLang: 'ko', severity: 'warning' })
  state.aiProjects = [{ project: 'First Work', provider: 'local', model: 'qwen3:8b', instructions: '', batchChars: 4000 }]
  state.evaluations.push({ id: 'eval_1', project: 'First Work', title: '비교', sourceText: 'Moon', sourceLang: 'en', targetLang: 'ko', candidates: [{ label: 'A', text: '달' }, { label: 'B', text: '달님' }], ratings: [{ accuracy: 0, fluency: 0, terminology: 0 }, { accuracy: 0, fluency: 0, terminology: 0 }], preference: '', comment: '', reviewer: '', status: 'DRAFT', createdAt: state.updatedAt, updatedAt: state.updatedAt })
  state.termSuggestions = [{ id: 'suggestion_1', termId: 'term_1', project: 'First Work', source: 'Moon', target: '달님', note: '', status: 'pending', origin: { provider: 'local', model: 'qwen3:8b', documentId: firstId, segmentId: state.translations.find(d => d.id === firstId).segments[0].id, quote: 'Moon', createdAt: state.updatedAt } }]
  assert.throws(() => renameProject(state, 'First Work', 'Second Work'), /이미/)
  renameProject(state, 'First Work', 'Renamed Work')
  validateWorkspace(state)
  assert.equal(state.translations.find(d => d.id === firstId).domain, 'Renamed Work')
  assert.equal(state.translations.find(d => d.id === firstId).projectId, 'renamed work')
  assert.equal(state.glossary.find(t => t.id === 'term_1').project, 'Renamed Work')
  assert.equal(state.aiProjects[0].project, 'Renamed Work')
  assert.equal(state.evaluations[0].project, 'Renamed Work')
  assert.equal(state.termSuggestions[0].project, 'Renamed Work')
  deleteProject(state, 'Renamed Work')
  validateWorkspace(state)
  assert.deepEqual(projectNames(state), ['Second Work'])
  assert.deepEqual(state.translations.map(d => d.id), [secondId])
  assert.deepEqual(state.glossary.map(t => t.id), ['term_global'])
  assert.equal(state.aiProjects.length, 0)
  assert.equal(state.evaluations.length, 0)
  assert.equal(state.termSuggestions.length, 0)
})
