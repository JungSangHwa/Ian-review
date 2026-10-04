import type { Workspace } from './model'
import { projectNames, sameProject } from './projects'

const KEY = 'ian-review-ui-v1'
export type RecentDocument = { id: string; segmentId: string }
export type ModelCheck = { model: string; at: string; ok: boolean; error?: string }
export type UIState = { pinned: string[]; recentProjects: string[]; recentDocs: Record<string, RecentDocument[]>; collapsed: boolean; modelChecks: Record<string, ModelCheck> }
const empty = (): UIState => ({ pinned: [], recentProjects: [], recentDocs: {}, collapsed: false, modelChecks: {} })
const normalize = (name: string) => name.normalize('NFKC').trim().toLowerCase()

export function readUIState(): UIState {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<UIState>
    const docs: Record<string, RecentDocument[]> = {}
    if (value.recentDocs && typeof value.recentDocs === 'object' && !Array.isArray(value.recentDocs)) {
      for (const [key, items] of Object.entries(value.recentDocs)) {
        if (!Array.isArray(items)) continue
        docs[key] = items.filter((item): item is RecentDocument => !!item && typeof item.id === 'string' && typeof item.segmentId === 'string').slice(0, 3)
      }
    }
    const checks: Record<string, ModelCheck> = {}
    if (value.modelChecks && typeof value.modelChecks === 'object' && !Array.isArray(value.modelChecks)) {
      for (const [key, check] of Object.entries(value.modelChecks)) {
        if (check && typeof check.model === 'string' && typeof check.at === 'string' && typeof check.ok === 'boolean' && !Number.isNaN(Date.parse(check.at))) checks[key] = check
      }
    }
    return {
      pinned: Array.isArray(value.pinned) ? value.pinned.filter(v => typeof v === 'string').slice(0, 3) : [],
      recentProjects: Array.isArray(value.recentProjects) ? value.recentProjects.filter(v => typeof v === 'string').slice(0, 5) : [],
      recentDocs: docs,
      collapsed: value.collapsed === true,
      modelChecks: checks,
    }
  } catch { return empty() }
}
function write(value: UIState) {
  try { localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* UI preferences are optional */ }
  window.dispatchEvent(new Event('ian-ui-state'))
}
export function updateUIState(recipe: (state: UIState) => void) { const value = readUIState(); recipe(value); write(value) }
export function visitProject(project: string) { updateUIState(s => { s.recentProjects = [project, ...s.recentProjects.filter(p => !sameProject(p, project))].slice(0, 5) }) }
export function togglePin(project: string) { updateUIState(s => { s.pinned = s.pinned.some(p => sameProject(p, project)) ? s.pinned.filter(p => !sameProject(p, project)) : [project, ...s.pinned].slice(0, 3) }) }
export function rememberReview(project: string, id: string, segmentId: string) {
  updateUIState(s => { const key = normalize(project); s.recentDocs[key] = [{ id, segmentId }, ...(s.recentDocs[key] ?? []).filter(item => item.id !== id)].slice(0, 3); s.recentProjects = [project, ...s.recentProjects.filter(p => !sameProject(p, project))].slice(0, 5) })
}
export function recordModelCheck(project: string, check: ModelCheck) { updateUIState(s => { s.modelChecks[normalize(project)] = check }) }
export function renameUIProject(oldName: string, newName: string) {
  updateUIState(s => {
    s.pinned = s.pinned.map(p => sameProject(p, oldName) ? newName : p)
    s.recentProjects = s.recentProjects.map(p => sameProject(p, oldName) ? newName : p)
    const oldKey = normalize(oldName), newKey = normalize(newName)
    if (oldKey !== newKey) { if (s.recentDocs[oldKey]) s.recentDocs[newKey] = s.recentDocs[oldKey]; delete s.recentDocs[oldKey]; if (s.modelChecks[oldKey]) s.modelChecks[newKey] = s.modelChecks[oldKey]; delete s.modelChecks[oldKey] }
  })
}
export function deleteUIProject(project: string) {
  updateUIState(s => { s.pinned = s.pinned.filter(p => !sameProject(p, project)); s.recentProjects = s.recentProjects.filter(p => !sameProject(p, project)); delete s.recentDocs[normalize(project)]; delete s.modelChecks[normalize(project)] })
}
export function pruneUIState(workspace: Workspace) {
  const projects = projectNames(workspace)
  const exists = (name: string) => projects.some(project => sameProject(project, name))
  const before = JSON.stringify(readUIState())
  const s = readUIState()
  s.pinned = s.pinned.filter(exists)
  s.recentProjects = s.recentProjects.filter(exists)
  for (const key of Object.keys(s.recentDocs)) {
    const project = projects.find(p => normalize(p) === key)
    if (!project) { delete s.recentDocs[key]; continue }
    s.recentDocs[key] = (Array.isArray(s.recentDocs[key]) ? s.recentDocs[key] : []).filter(item => workspace.translations.some(doc => doc.id === item.id && sameProject(doc.domain, project))).slice(0, 3)
  }
  for (const key of Object.keys(s.modelChecks)) if (!projects.some(p => normalize(p) === key)) delete s.modelChecks[key]
  if (JSON.stringify(s) !== before) write(s)
}
