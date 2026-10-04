import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../state/WorkspaceContext'
import { useAIJobs } from '../../state/AIJobsContext'
import { createProject, projectNames, projectPath, sameProject } from '../../lib/projects'
import { openIssues, STATUS } from '../../lib/model'
import Icon from '../Icon'
import { Modal, Button } from '../UI'
import { exportBackup } from '../../lib/files'
import { testAIConnection } from '../../lib/aiTranslation'
import { pruneUIState, readUIState, recordModelCheck, togglePin, visitProject, type UIState } from '../../lib/uiState'
import { acquireRun, isRunActive } from '../../lib/runLease'
import { projectGlossaryProgress } from '../../lib/projectGlossary'

export default function AppLayout() {
  const { state, read, run, busy, stale, notify } = useWorkspace(), jobs = useAIJobs()
  const location = useLocation(), navigate = useNavigate()
  const project = useMatch('/projects/:project/*')?.params.project ?? ''
  const projects = projectNames(state), base = project ? projectPath(project) : ''
  const section = project ? location.pathname.slice(base.length) : location.pathname
  const [menuOpen, setMenuOpen] = useState(false), [query, setQuery] = useState(''), [projectSearch, setProjectSearch] = useState(''), [showAll, setShowAll] = useState(false)
  const [creating, setCreating] = useState(false), [newProject, setNewProject] = useState(''), [quickAction, setQuickAction] = useState<'document' | 'subtitle' | 'term' | null>(null), [quickProject, setQuickProject] = useState('')
  const [ui, setUI] = useState<UIState>(readUIState), [checking, setChecking] = useState(false)
  const search = useRef<HTMLInputElement>(null), menuButton = useRef<HTMLButtonElement>(null), main = useRef<HTMLElement>(null), sidebar = useRef<HTMLElement>(null)
  const previousLocation = useRef(location.key), menuWasOpen = useRef(false)
  menuWasOpen.current = menuOpen

  useEffect(() => {
    const update = () => setUI(readUIState())
    window.addEventListener('ian-ui-state', update); window.addEventListener('storage', update)
    return () => { window.removeEventListener('ian-ui-state', update); window.removeEventListener('storage', update) }
  }, [])
  useEffect(() => { pruneUIState(state) }, [state])
  useEffect(() => { if (project) visitProject(project) }, [project])
  useEffect(() => {
    if (previousLocation.current !== location.key) {
      previousLocation.current = location.key
      if (menuWasOpen.current) { setMenuOpen(false); requestAnimationFrame(() => main.current?.focus()) }
    }
  }, [location.key])
  useEffect(() => { if (!menuOpen) return; const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; requestAnimationFrame(() => sidebar.current?.querySelector<HTMLElement>('.sidebar-close')?.focus()); return () => { document.body.style.overflow = old } }, [menuOpen])
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); search.current?.focus() }
      if (event.key === 'Escape' && menuWasOpen.current) { setMenuOpen(false); menuButton.current?.focus() }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])
  const trapMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!menuOpen || event.key !== 'Tab') return
    const elements = [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? [])].filter(el => el.offsetParent !== null)
    if (!elements.length) return
    const first = elements[0], last = elements.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const pageTitle = section.startsWith('/review') ? '번역 검수' : section.startsWith('/evaluation') ? '블라인드 평가' : section.startsWith('/documents') ? '원고·자막' : section === '/glossary' ? '프로젝트 용어집' : section === '/models' ? '모델 연결' : section === '/settings' ? '데이터 관리' : section === '/help' ? '사용 가이드' : '작업 공간'
  const switchProject = (name: string, select: HTMLSelectElement) => {
    const suffix = section.startsWith('/review/') || section.startsWith('/documents/') ? 'documents'
      : section.startsWith('/evaluation/') || section.startsWith('/evaluations/') ? 'evaluations'
      : ['/documents', '/glossary', '/models', '/evaluations'].includes(section) ? section.slice(1) : ''
    navigate(name ? projectPath(name, suffix) : '/')
    select.value = project // A blocked navigation must leave the visible selection unchanged.
  }
  const submitSearch = (e: FormEvent) => { e.preventDefault(); navigate(`${base}/documents?q=${encodeURIComponent(query.trim())}`) }
  const create = async (event: FormEvent, action?: 'document' | 'subtitle' | 'term') => {
    event.preventDefault()
    const name = newProject.trim()
    if (!name) return
    if (await run(s => { createProject(s, name) }, '프로젝트를 만들었습니다.')) {
      setCreating(false); setQuickAction(null); setNewProject('')
      navigate(action === 'subtitle' ? `${projectPath(name, 'documents/new')}?type=subtitle` : projectPath(name, action === 'document' ? 'documents/new' : action === 'term' ? 'glossary' : ''))
    }
  }
  const goQuick = (action: 'document' | 'subtitle' | 'term') => {
    if (project) navigate(action === 'subtitle' ? `${projectPath(project, 'documents/new')}?type=subtitle` : action === 'document' ? projectPath(project, 'documents/new') : `${projectPath(project, 'glossary')}`)
    else { setQuickProject(''); setQuickAction(action) }
  }
  const checkModel = async () => {
    const config = state.aiProjects?.find(c => sameProject(c.project, project))
    if (!config || config.provider !== 'local') return
    let release: () => void
    try { release = acquireRun('model-global') } catch (error) { notify(error instanceof Error ? error.message : '모델을 사용 중입니다.', 'error'); return }
    setChecking(true)
    try {
      await testAIConnection({ provider: 'local', model: config.model }, '')
      const current = read().aiProjects?.find(c => sameProject(c.project, project))
      if (current?.provider === 'local' && current.model === config.model) recordModelCheck(project, { model: config.model, at: new Date().toISOString(), ok: true })
      notify('선택한 로컬 모델의 연결을 확인했습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : '모델 연결을 확인하지 못했습니다.'
      const current = read().aiProjects?.find(c => sameProject(c.project, project))
      if (current?.provider === 'local' && current.model === config.model) recordModelCheck(project, { model: config.model, at: new Date().toISOString(), ok: false, error: message.slice(0, 200) })
      notify(message, 'error')
    } finally { release(); setChecking(false) }
  }
  const projectDocs = project ? state.translations.filter(d => sameProject(d.domain, project)) : []
  const inReview = projectDocs.filter(d => d.status === 'IN_REVIEW').length
  const issueDocs = projectDocs.filter(d => openIssues(d).length > 0).length
  const ownTerms = state.glossary.filter(t => sameProject(t.project, project))
  const pendingTerms = ownTerms.filter(t => t.reviewStatus === 'draft').length + (state.termSuggestions ?? []).filter(s => s.status === 'pending' && sameProject(s.project, project)).length
  const evaluations = state.evaluations.filter(e => sameProject(e.project, project)).length
  const recentDocs = project ? (ui.recentDocs[project.normalize('NFKC').trim().toLowerCase()] ?? []).flatMap(item => { const doc = projectDocs.find(d => d.id === item.id); return doc ? [{ doc, segmentId: doc.segments.some(s => s.id === item.segmentId) ? item.segmentId : doc.segments[0].id }] : [] }).slice(0, 3) : []
  const pinned = ui.pinned.filter(name => projects.some(p => sameProject(p, name)))
  const recent = ui.recentProjects.filter(name => projects.some(p => sameProject(p, name)) && !pinned.some(p => sameProject(p, name)))
  const matching = projects.filter(name => name.toLowerCase().includes(projectSearch.toLowerCase()))
  const visibleProjects = projectSearch ? [...new Set([project, ...matching].filter(Boolean))] : showAll || projects.length <= 5 ? projects : [...new Set([project, ...pinned, ...recent].filter(Boolean))]
  const modelConfig = state.aiProjects?.find(c => sameProject(c.project, project))
  const check = project ? ui.modelChecks[project.normalize('NFKC').trim().toLowerCase()] : undefined
  const validCheck = modelConfig?.provider === 'local' && check?.model === modelConfig.model ? check : undefined
  const liveJob = state.translations.find(d => d.aiRun?.status === 'running' && isRunActive(d.aiRun.id))
  const jobDoc = jobs.job?.stage === 'glossary' ? undefined : state.translations.find(d => d.id === jobs.job?.docId) ?? liveJob ?? state.translations.find(d => d.aiRun && ['paused', 'failed', 'running'].includes(d.aiRun.status))
  const glossaryJob = (state.glossaryRuns ?? []).find(r => sameProject(r.project, jobs.job?.project ?? '')) ?? (state.glossaryRuns ?? []).find(r => ['running', 'paused', 'failed'].includes(r.status))
  const glossaryProgress = glossaryJob ? projectGlossaryProgress(state, glossaryJob.project) : null
  const glossaryActiveElsewhere = glossaryJob ? isRunActive(`glossary:${glossaryJob.project.normalize('NFKC').trim().toLowerCase()}`) : false
  const taskActive = !!jobs.job && !['completed', 'paused', 'failed'].includes(jobs.job.phase)
  const phases = { preparing: '원문 확인 중', extract: '용어 후보 추출 중', verify: '용어 검증 중', translation: '번역 생성 중', validation: '번역 검증 중', saving: '결과 저장 중', stopping: '중지 중', completed: '완료', paused: '일시 중지', failed: '오류' }
  const canCheck = !checking && !isRunActive('model-global') && !taskActive && !!modelConfig && modelConfig.provider === 'local'
  const collapsed = ui.collapsed && !menuOpen
  const nav = (to: string, title: string, icon: 'grid' | 'file' | 'book' | 'spark' | 'compare' | 'settings' | 'help', count?: number) => <NavLink end to={to} title={title} aria-label={title} className={() => `nav-link ${location.pathname + location.search === to ? 'is-active' : ''}`}><Icon name={icon} size={19} /><span className="sidebar-content-text">{title}</span>{count !== undefined && <span className="nav-count sidebar-content-text">{count}</span>}</NavLink>

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    {menuOpen && <button className="sidebar-overlay" aria-label="메뉴 닫기" onClick={() => { setMenuOpen(false); menuButton.current?.focus() }} />}
    <aside ref={sidebar} onKeyDown={trapMenu} className={`sidebar ${menuOpen ? 'is-open' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-top"><Link to="/" className="brand" aria-label="Ian 작업 공간"><span className="brand-mark">i<span>.</span></span><span className="brand-word sidebar-content-text">ian<span>TRANSLATION STUDIO</span></span></Link><button className="icon-button sidebar-collapse" title={collapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} onClick={() => { if (menuOpen) { setMenuOpen(false); menuButton.current?.focus() } else { const value = readUIState(); value.collapsed = !value.collapsed; try { localStorage.setItem('ian-review-ui-v1', JSON.stringify(value)) } catch { /* optional */ } setUI(value) } }}><Icon name="menu" size={18} /></button><button className="icon-button sidebar-close" aria-label="메뉴 닫기" onClick={() => { setMenuOpen(false); menuButton.current?.focus() }}><Icon name="close" size={18}/></button></div>
      <div className="sidebar-fixed sidebar-content-text"><div className="sidebar-switch-row"><input aria-label="프로젝트 이름 검색" placeholder="프로젝트 검색" value={projectSearch} onChange={e => setProjectSearch(e.target.value)} /><button className="icon-button" title="새 프로젝트" aria-label="새 프로젝트" onClick={() => setCreating(true)}><Icon name="plus" size={17}/></button></div><label className="sr-only" htmlFor="project-switch">프로젝트 전환</label><select id="project-switch" className="project-switch-select" value={project} onChange={e => switchProject(e.target.value, e.currentTarget)}><option value="">전체 작업 공간</option>{visibleProjects.map(name => <option key={name} value={name}>{pinned.some(p => sameProject(p, name)) ? '★ ' : ''}{name}</option>)}</select>{!projectSearch && projects.length > visibleProjects.length && <button className="text-link" onClick={() => setShowAll(!showAll)}>{showAll ? '최근·고정만 보기' : `전체 ${projects.length}개 보기`}</button>}{project && <button className="text-link" onClick={() => togglePin(project)}>{pinned.some(p => sameProject(p, project)) ? '★ 고정 해제' : '☆ 이 프로젝트 고정'}</button>}<div className="sidebar-quick"><button onClick={() => goQuick('document')}>원고·자막 추가</button><button onClick={() => goQuick('term')}>용어집 만들기</button></div><Link className="sidebar-subtitle-link" to={project ? `${projectPath(project, 'documents/new')}?type=subtitle` : '/'} onClick={e => { if (!project) { e.preventDefault(); goQuick('subtitle') } }}>자막 파일 추가</Link></div>
      <div className="sidebar-scroll"><div className="nav-label sidebar-content-text">{project ? '현재 프로젝트' : '전체 작업 공간'}</div><nav aria-label="주요 메뉴" className="nav">{nav('/', '전체 프로젝트', 'grid')}{project && <>{nav(projectPath(project), '프로젝트 홈', 'grid')}{nav(projectPath(project, 'documents'), '원고·자막', 'file', projectDocs.length)}{nav(`${projectPath(project, 'documents')}?status=IN_REVIEW`, '검수 중', 'file', inReview)}{nav(`${projectPath(project, 'documents')}?issues=1`, '미처리 이슈 문서', 'file', issueDocs)}{nav(projectPath(project, 'glossary'), '프로젝트 용어집', 'book', ownTerms.length)}{nav(`${projectPath(project, 'glossary')}?review=1`, '이전 용어 검증', 'book', pendingTerms)}{nav(projectPath(project, 'evaluations'), 'A/B 평가', 'compare', evaluations)}</>}</nav>
        {project && <div className="sidebar-recent sidebar-content-text"><div className="nav-label">최근 열었던 문서</div>{recentDocs.length ? recentDocs.map(({doc,segmentId},i) => <Link key={doc.id} title={doc.title} to={`${projectPath(project, `review/${doc.id}`)}?segment=${segmentId}`}><strong>{i===0 ? '이어서 검수 · ' : ''}{doc.title}</strong><small>{STATUS[doc.status]}</small></Link>) : <p>열었던 문서가 없습니다.</p>}</div>}
        {(jobDoc || glossaryJob) && <div className="sidebar-task sidebar-content-text"><div className="nav-label">번역·용어집 작업</div>{jobDoc?.aiRun ? <div className="sidebar-task-card"><strong>{jobDoc.domain} · {jobDoc.title}</strong><span>{jobs.job?.docId === jobDoc.id ? phases[jobs.job.phase] : jobDoc.aiRun.status === 'running' ? isRunActive(jobDoc.aiRun.id) ? '다른 탭에서 실행 중' : '중단 상태 확인 필요' : jobDoc.aiRun.status === 'failed' ? '오류 · 재개 가능' : '일시 중지 · 재개 가능'}</span><small>{jobs.job?.docId === jobDoc.id && jobs.job.stage === 'glossary' ? '용어집 저장 ' + jobs.job.done + '/' + jobs.job.total + '묶음' : '번역 저장 ' + jobDoc.aiRun.completed + '/' + jobDoc.aiRun.total + '구간'}</small>{(jobs.job?.docId === jobDoc.id ? jobs.job.error : jobDoc.aiRun.error) && <small>{jobs.job?.error ?? jobDoc.aiRun.error}</small>}<div className="sidebar-task-actions"><Link to={projectPath(jobDoc.domain, `review/${jobDoc.id}`)}>{jobDoc.aiRun.status === 'completed' ? '검수 열기' : '작업 열기'}</Link>{jobs.job?.docId === jobDoc.id && taskActive ? <button disabled={jobs.job.phase === 'stopping'} onClick={jobs.pause}>일시 중지</button> : jobDoc.aiRun.pendingIds.length && !taskActive && !isRunActive(jobDoc.aiRun.id) ? <button onClick={() => void jobs.startTranslation(jobDoc.id, 'resume')}>재개</button> : null}</div></div> : glossaryJob && <div className="sidebar-task-card"><strong>{glossaryJob.project} · 작품 용어집</strong><span>{jobs.job?.stage === 'glossary' && sameProject(jobs.job.project, glossaryJob.project) ? phases[jobs.job.phase] : glossaryProgress?.ready ? '완료' : glossaryJob.status === 'running' ? glossaryActiveElsewhere ? '다른 탭에서 실행 중' : '중단 상태 확인 필요' : glossaryJob.status === 'failed' ? '오류 · 재개 가능' : '일시 중지 · 재개 가능'}</span><small>저장 완료 {glossaryProgress?.completed ?? 0}/{glossaryProgress?.total ?? 0}묶음</small>{glossaryJob.error && <small>{glossaryJob.error}</small>}<div className="sidebar-task-actions"><Link to={projectPath(glossaryJob.project, 'glossary')}>{glossaryProgress?.ready ? '용어집 열기' : '작업 열기'}</Link>{jobs.job?.stage === 'glossary' && taskActive ? <button disabled={jobs.job.phase === 'stopping'} onClick={jobs.pause}>일시 중지</button> : !taskActive && !glossaryProgress?.ready && !glossaryActiveElsewhere ? <button onClick={() => void jobs.startGlossary(glossaryJob.project)}>재개</button> : null}</div></div>}</div>}
      </div>
      <div className="sidebar-bottom"><div className="sidebar-model sidebar-content-text"><strong>{project ? '로컬 Ollama' : '전체 작업 공간'}</strong>{project && <><span>{modelConfig?.provider === 'local' ? modelConfig.model : '모델 미설정 · 선택 필요'}</span><small>{!modelConfig || modelConfig.provider !== 'local' ? '로컬 모델을 선택해 주세요.' : checking ? '연결 확인 중' : !validCheck ? '연결 미확인' : `${validCheck.ok ? '마지막 연결 확인 성공' : '연결 실패'} · ${new Date(validCheck.at).toLocaleString('ko-KR')}`}</small><div><Link to={projectPath(project, 'models')}>모델 설정</Link>{modelConfig?.provider === 'local' && <button disabled={!canCheck} onClick={() => void checkModel()}>다시 확인</button>}</div></>}</div><nav className="nav" aria-label="관리 메뉴">{nav('/settings', '데이터 관리', 'settings')}{nav('/help', '사용 가이드', 'help')}</nav><button className="sidebar-backup sidebar-content-text" onClick={() => { exportBackup(state); notify('전체 작업 공간 JSON 다운로드를 요청했습니다.') }}><Icon name="download" size={17}/>전체 백업 · JSON</button><div className="sidebar-version sidebar-content-text">IAN REVIEW <span>LOCAL</span></div></div>
    </aside>
    <div className={`main-shell ${collapsed ? 'main-shell--sidebar-collapsed' : ''}`} inert={menuOpen}><header className="topbar"><div className="topbar-left"><button ref={menuButton} className="icon-button mobile-menu" aria-label="메뉴 열기" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><Link className="breadcrumb-root" to="/">전체 프로젝트</Link>{project && <><span className="breadcrumb-slash">/</span><Link className="breadcrumb-root" to={projectPath(project)}>{project}</Link></>}<span className="breadcrumb-slash">/</span><strong>{pageTitle}</strong></div><div className="topbar-right"><form className="global-search" onSubmit={submitSearch}><Icon name="search" size={16} /><input ref={search} aria-label={project ? '프로젝트 문서 검색' : '전체 문서 검색'} placeholder="문서 검색" value={query} onChange={e => setQuery(e.target.value)} maxLength={200} /><kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd></form><button className="icon-button backup-shortcut" title="전체 JSON 백업" aria-label="전체 JSON 백업" onClick={() => exportBackup(state)}><Icon name="download" size={19} /></button></div></header>
      {stale && <div className="stale-banner" role="alert"><Icon name="alert" size={18} /><span>다른 탭에서 변경되었습니다. 현재 입력을 복사한 뒤 새로고침해 주세요.</span><button onClick={() => { if (window.confirm('저장하지 않은 입력은 사라집니다. 필요한 내용을 복사했나요?')) window.location.reload() }}>새로고침</button></div>}
      <main ref={main} id="main-content" className="page-container" tabIndex={-1}><Outlet /></main><footer className="app-footer"><span><span className="local-dot" />{busy ? '변경 내용 저장 중…' : '로컬 작업 공간'}</span><span>모델이 만든 기준 문서로 일관된 번역.</span></footer></div>
    {creating && <Modal title="새 프로젝트" onClose={() => setCreating(false)}><form className="modal-form" onSubmit={e => void create(e)}><label className="field">프로젝트 이름<input autoFocus required maxLength={80} value={newProject} onChange={e => setNewProject(e.target.value)} placeholder="예: 별빛 서약" /></label><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setCreating(false)}>취소</Button><Button type="submit" disabled={busy || !newProject.trim()}>프로젝트 만들기</Button></div></form></Modal>}
    {quickAction && <Modal title={quickAction === 'term' ? '용어집을 만들 프로젝트 선택' : quickAction === 'subtitle' ? '자막을 추가할 프로젝트 선택' : '원고를 추가할 프로젝트 선택'} onClose={() => setQuickAction(null)}><div className="modal-form"><label className="field">기존 프로젝트<select value={quickProject} onChange={e => setQuickProject(e.target.value)}><option value="">프로젝트 선택</option>{projects.map(name => <option key={name} value={name}>{name}</option>)}</select></label><Button disabled={!quickProject} onClick={() => { const destination = quickAction === 'subtitle' ? `${projectPath(quickProject, 'documents/new')}?type=subtitle` : quickAction === 'document' ? projectPath(quickProject, 'documents/new') : `${projectPath(quickProject, 'glossary')}`; setQuickAction(null); navigate(destination) }}>선택한 프로젝트에 추가</Button><form onSubmit={e => void create(e, quickAction)}><label className="field">새 프로젝트 만들기<input required maxLength={80} value={newProject} onChange={e => setNewProject(e.target.value)} placeholder="새 작품 이름" /></label><Button type="submit" disabled={busy || !newProject.trim()}>만들고 추가하기</Button></form></div></Modal>}
  </div>
}
