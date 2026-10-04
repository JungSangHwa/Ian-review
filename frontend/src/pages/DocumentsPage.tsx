import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useWorkspace } from '../state/WorkspaceContext'
import { logActivity, openIssues, STATUS } from '../lib/model'
import type { Translation } from '../types/translation'
import { Button, ConfirmDialog, EmptyState, PageHeading } from '../components/UI'
import DocumentTable from '../components/DocumentTable'
import Icon from '../components/Icon'
import { termKey } from '../lib/terminology'
import { projectPath } from '../lib/projects'
export default function DocumentsPage() {
  const { state, run, busy } = useWorkspace(), [params, setParams] = useSearchParams()
  const { project: routeProject } = useParams()
  const [sort, setSort] = useState('updated'), [deleting, setDeleting] = useState<Translation | null>(null)
  const query = params.get('q') ?? '', status = params.get('status') ?? '', project = routeProject || params.get('project') || '', onlyIssues = params.get('issues') === '1'
  const newPath = routeProject ? projectPath(routeProject, 'documents/new') : '/documents/new'
  const projectDocs = state.translations.filter(d => !project || termKey(d.domain) === termKey(project))
  const projects = [...new Set(state.translations.map(d=>d.domain).filter(Boolean))]
  const setParam = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: true }) }
  const docs = state.translations.filter(d => (!project || termKey(d.domain) === termKey(project)) && (!status || d.status === status) && (!onlyIssues || openIssues(d).length > 0) && [d.title, d.domain, ...d.segments.flatMap(s => [s.sourceText, s.targetText])].some(t => t.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ko') : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt))
  const remove = async () => { if (!deleting) return; const id = deleting.id, title = deleting.title; if (await run(s => { s.translations = s.translations.filter(d => d.id !== id); logActivity(s, `“${title}” 문서를 삭제했습니다.`) }, '문서를 삭제했습니다.')) setDeleting(null) }
  return <div className="stack-lg"><PageHeading eyebrow="DOCUMENT LIBRARY" title="원고·자막" description="같은 작품의 회차와 에피소드를 묶어 인물명·호칭·설정어를 일관되게 관리하세요."><Link to={newPath} className="button button--primary"><Icon name="plus" size={17} />원고·자막 가져오기</Link></PageHeading><section className="panel"><div className="document-toolbar"><div className="tabs" role="group" aria-label="문서 상태 필터"><button className={!status ? 'active' : ''} onClick={() => setParam('status', '')}>전체 <span>{projectDocs.length}</span></button>{Object.entries(STATUS).map(([key, label]) => <button key={key} className={status === key ? 'active' : ''} onClick={() => setParam('status', key)}>{label}</button>)}</div><div className="toolbar-filters">{!routeProject && <select aria-label="작품 필터" value={project} onChange={e => setParam('project', e.target.value)}><option value="">모든 작품</option>{projects.map(name=><option key={name} value={name}>{name}</option>)}</select>}<label className="search-input"><Icon name="search" size={17} /><input aria-label="문서 검색" placeholder="제목, 원문, 번역문 검색" value={query} maxLength={200} onChange={e => setParam('q', e.target.value)} /></label><select aria-label="문서 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">최근 수정순</option><option value="created">최근 등록순</option><option value="title">이름순</option></select></div></div><div className="list-summary"><span>문서 <strong>{docs.length}</strong>개</span><label className="checkbox-label"><input type="checkbox" checked={onlyIssues} onChange={e => setParam('issues', e.target.checked ? '1' : '')} />미처리 이슈만</label></div>{docs.length ? <DocumentTable documents={docs} onDelete={setDeleting} /> : <EmptyState icon="search" title={projectDocs.length ? '조건에 맞는 문서가 없습니다' : '아직 등록된 문서가 없습니다'} description={projectDocs.length ? '다른 검색어나 상태 필터를 사용해 보세요.' : '새 문서를 만들고 원문과 번역문을 등록해 주세요.'}>{projectDocs.length ? <Button variant="secondary" onClick={() => setParams({})}>필터 초기화</Button> : <Link className="button button--primary" to={newPath}>첫 문서 등록하기</Link>}</EmptyState>}</section>{deleting && <ConfirmDialog title="문서를 삭제할까요?" description={`“${deleting.title}”의 문단, 이슈, 수정 이력이 삭제됩니다. 되돌릴 수 없으므로 필요한 문서는 먼저 백업해 주세요. 이미 생성한 A/B 평가는 유지됩니다.`} busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} />}</div>
}
