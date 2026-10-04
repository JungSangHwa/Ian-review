import { logActivity, LIMITS, type Workspace } from './model'
import { termKey } from './terminology'

export function projectNames(state: Workspace): string[] {
  const names = [...(state.projects ?? []), ...state.translations.map(d => d.domain), ...state.glossary.map(t => t.project ?? ''), ...(state.aiProjects ?? []).map(c => c.project), ...state.evaluations.map(e => e.project ?? ''), ...(state.termSuggestions ?? []).map(s => s.project), ...(state.glossaryRuns ?? []).map(r => r.project)]
  const seen = new Set<string>()
  return names.map(name => name.trim()).filter(name => {
    const key = termKey(name)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const sameProject = (a: string | undefined, b: string | undefined) => !!a && !!b && termKey(a) === termKey(b)
export const projectPath = (project: string, suffix = '') => `/projects/${encodeURIComponent(project)}${suffix ? `/${suffix.replace(/^\//, '')}` : ''}`

/** Persist a project independently of its documents, terms and model settings. */
export function ensureProject(state: Workspace, rawName: string) {
  const name = rawName.trim()
  if (!name || name.length > 80) throw new Error('프로젝트 이름은 1~80자로 입력해 주세요.')
  const existing = projectNames(state).find(value => sameProject(value, name))
  const canonical = existing ?? name
  if (!(state.projects ?? []).some(value => sameProject(value, canonical))) {
    if ((state.projects ?? []).length >= LIMITS.documents) throw new Error('프로젝트는 최대 200개까지 만들 수 있습니다.')
    state.projects = [...(state.projects ?? []), canonical]
  }
  return canonical
}

export function createProject(state: Workspace, rawName: string) {
  const name = rawName.trim()
  if (!name || name.length > 80) throw new Error('프로젝트 이름은 1~80자로 입력해 주세요.')
  if (projectNames(state).some(value => sameProject(value, name))) throw new Error('같은 이름의 프로젝트가 이미 있습니다.')
  if (projectNames(state).length >= LIMITS.documents) throw new Error('프로젝트는 최대 200개까지 만들 수 있습니다.')
  state.projects = [...(state.projects ?? []), name]
  logActivity(state, `“${name}” 프로젝트를 만들었습니다.`)
  return name
}

export function renameProject(state: Workspace, oldName: string, rawName: string) {
  const name = rawName.trim()
  if (!projectNames(state).some(value => sameProject(value, oldName))) throw new Error('프로젝트를 찾을 수 없습니다.')
  if (!name || name.length > 80) throw new Error('프로젝트 이름은 1~80자로 입력해 주세요.')
  if (projectNames(state).some(value => !sameProject(value, oldName) && sameProject(value, name))) throw new Error('같은 이름의 프로젝트가 이미 있습니다.')
  if (state.translations.some(doc => sameProject(doc.domain, oldName) && doc.aiRun?.status === 'running')) throw new Error('진행 중인 모델 번역을 일시 중지한 뒤 이름을 변경해 주세요.')
  state.projects = [...new Set([...(state.projects ?? []).filter(value => !sameProject(value, oldName)), name])]
  for (const doc of state.translations) if (sameProject(doc.domain, oldName)) { doc.domain = name; doc.projectId = termKey(name) }
  for (const term of state.glossary) if (sameProject(term.project, oldName)) term.project = name
  for (const config of state.aiProjects ?? []) if (sameProject(config.project, oldName)) config.project = name
  for (const evaluation of state.evaluations) if (sameProject(evaluation.project, oldName)) evaluation.project = name
  for (const suggestion of state.termSuggestions ?? []) if (sameProject(suggestion.project, oldName)) suggestion.project = name
  for (const run of state.glossaryRuns ?? []) if (sameProject(run.project, oldName)) run.project = name
  logActivity(state, `“${oldName}” 프로젝트 이름을 “${name}”(으)로 변경했습니다.`)
  return name
}

export function deleteProject(state: Workspace, project: string) {
  if (!projectNames(state).some(value => sameProject(value, project))) throw new Error('프로젝트를 찾을 수 없습니다.')
  if (state.translations.some(doc => sameProject(doc.domain, project) && doc.aiRun?.status === 'running')) throw new Error('진행 중인 모델 번역을 일시 중지한 뒤 프로젝트를 삭제해 주세요.')
  state.projects = (state.projects ?? []).filter(value => !sameProject(value, project))
  state.translations = state.translations.filter(doc => !sameProject(doc.domain, project))
  state.glossary = state.glossary.filter(term => !sameProject(term.project, project))
  state.aiProjects = (state.aiProjects ?? []).filter(config => !sameProject(config.project, project))
  state.evaluations = state.evaluations.filter(evaluation => !sameProject(evaluation.project, project))
  state.termSuggestions = (state.termSuggestions ?? []).filter(suggestion => !sameProject(suggestion.project, project))
  state.glossaryRuns = (state.glossaryRuns ?? []).filter(run => !sameProject(run.project, project))
  logActivity(state, `“${project}” 프로젝트와 연결된 자료를 삭제했습니다.`)
}
