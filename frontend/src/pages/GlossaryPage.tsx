import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { projectNames } from '../lib/projects'
import { useWorkspace } from '../state/WorkspaceContext'
import { LANGUAGES, logActivity, SEVERITY, TERM_CATEGORIES, uid, type GlossaryEntry } from '../lib/model'
import { download, makeCSV, readTextFile, safeName } from '../lib/files'
import { glossaryDocument } from '../lib/modelGlossary'
import { glossaryIdentity, parseGlossaryCSV, putGlossaryTerm, refreshGlossaryDocuments } from '../lib/glossary'
import { termKey } from '../lib/terminology'
import ProjectGlossaryPanel from '../components/ProjectGlossaryPanel'
import { Badge, Button, ConfirmDialog, EmptyState, Modal, PageHeading } from '../components/UI'
import Icon from '../components/Icon'

export default function GlossaryPage() {
  const { state, run, busy, notify } = useWorkspace(), [params, setParams] = useSearchParams(), { project: routeProject } = useParams()
  const [query, setQuery] = useState(''), [editing, setEditing] = useState<GlossaryEntry | 'new' | null>(null), [deleting, setDeleting] = useState<GlossaryEntry | null>(null), [incoming, setIncoming] = useState<GlossaryEntry[] | null>(null)
  const project = routeProject || params.get('project') || '*'
  const reviewOnly = !!routeProject && params.get('review') === '1'
  useEffect(() => { if (params.get('action') !== 'new') return; setEditing('new'); const next = new URLSearchParams(params); next.delete('action'); setParams(next, { replace: true }) }, [params, setParams])
  const chooseProject = (name: string) => { const next = new URLSearchParams(params); if (name === '*') next.delete('project'); else next.set('project', name); setParams(next, { replace: true }) }
  const projects = [...new Set([...projectNames(state), ...(params.get('project') ? [params.get('project')!] : [])])]
  const matches = (term: GlossaryEntry) => [term.source, term.target, term.note, ...(term.aliases ?? []), ...(term.variants ?? [])].join(' ').toLowerCase().includes(query.toLowerCase())
  const own = state.glossary.filter(term => project === '*' || (routeProject ? termKey(term.project ?? '') === termKey(project) : !term.project || termKey(term.project) === termKey(project)))
  const terms = own.filter(term => matches(term) && (!reviewOnly || term.reviewStatus === 'draft')).sort((a, b) => a.source.localeCompare(b.source))
  const inherited = routeProject ? state.glossary.filter(term => !term.project && !own.some(entry => entry.sourceLang === term.sourceLang && entry.targetLang === term.targetLang && termKey(entry.source) === termKey(term.source))) : []
  const history = (state.termSuggestions ?? []).filter(item => termKey(item.project) === termKey(project) && item.status !== 'pending').slice(-12).reverse()
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    try { const parsed = parseGlossaryCSV(await readTextFile(file), project === '*' ? '' : project); setIncoming(routeProject ? parsed.map(term => ({ ...term, project: routeProject })) : parsed) } catch (error) { notify(error instanceof Error ? error.message : '용어집을 읽지 못했습니다.', 'error') }
  }
  const exportCSV = () => download(makeCSV([['source', 'target', 'source_language', 'target_language', 'project', 'category', 'aliases', 'variants', 'note', 'severity'], ...own.map(term => [term.source, term.target, term.sourceLang, term.targetLang, term.project ?? '', term.category ?? 'term', (term.aliases ?? []).join('|'), (term.variants ?? []).join('|'), term.note ?? '', term.severity])]), 'ian-story-glossary.csv', 'text/csv;charset=utf-8')
  return <div className="stack-lg">
    <PageHeading eyebrow="PROJECT GLOSSARY" title={routeProject ? routeProject + ' · 번역 기준 문서' : '프로젝트 용어집'} description="모델이 만든 용어와 맥락을 번역의 기준 문서로 사용합니다. 모든 회차와 자막에 같은 기준을 적용합니다.">
      {routeProject && <Button variant="secondary" icon="download" disabled={!own.length && !inherited.length} onClick={() => download(glossaryDocument(state, routeProject), safeName(routeProject) + '-번역기준.md', 'text/markdown;charset=utf-8')}>기준 문서 다운로드</Button>}
    </PageHeading>
    {routeProject && <ProjectGlossaryPanel project={routeProject} />}
    <section className="panel glossary-reference-panel">
      <div className="panel-header"><div className="section-title"><h2>{reviewOnly ? '모델 검증이 필요한 이전 용어' : '프로젝트 기준 용어'}</h2><Badge>{terms.length}개</Badge></div><div className="inline-actions">
        {!routeProject && <select aria-label="작품 용어집 선택" value={project} onChange={event => chooseProject(event.target.value)}><option value="*">모든 프로젝트</option>{projects.map(name => <option key={name} value={name}>{name}</option>)}</select>}
        <label className="search-input"><Icon name="search" size={16} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="용어 검색" placeholder="이름, 별칭, 맥락 검색" /></label>
      </div></div>
      {reviewOnly && <div className="import-note"><span>이전 데이터의 용어는 위 모델 작업으로 검증합니다. 검증이 끝나면 자동으로 기준 문서에 반영됩니다.</span><button className="text-link" onClick={() => { const next = new URLSearchParams(params); next.delete('review'); setParams(next) }}>전체 용어 보기</button></div>}
      {terms.length ? <div className="table-scroll"><table className="glossary-table glossary-reference-table"><thead><tr><th>원어 · 분류</th><th>기준 번역</th><th>피할 표기 · 맥락</th><th>적용 범위</th><th>편집</th></tr></thead><tbody>{terms.map(term => <tr key={term.id}>
        <td data-label="원어 · 분류"><strong>{term.source}</strong><div><Badge>{TERM_CATEGORIES[term.category ?? 'term']}</Badge> <Badge tone={term.reviewStatus === 'draft' ? 'orange' : term.aiOrigin ? 'green' : 'blue'}>{term.reviewStatus === 'draft' ? '모델 검증 필요' : term.aiOrigin ? '모델 생성 · 적용 중' : '등록 기준'}</Badge></div>{!!term.aliases?.length && <small>별칭: {term.aliases.join(', ')}</small>}{term.aiOrigin && <><small>{term.aiOrigin.model}</small><blockquote>원문 근거: “{term.aiOrigin.quote}”</blockquote></>}</td>
        <td data-label="기준 번역"><strong>{term.target}</strong><div><small>{term.sourceLang.toUpperCase()} → {term.targetLang.toUpperCase()}</small></div></td>
        <td data-label="피할 표기 · 맥락"><div className="term-variants">{term.variants?.join(' / ') || '없음'}</div><small>{term.note || '맥락 메모 없음'}</small></td>
        <td data-label="적용 범위">{term.project || '모든 프로젝트 공통'}</td>
        <td data-label="편집"><div className="inline-actions"><button className="icon-button" aria-label={term.source + ' 용어 수정'} onClick={() => setEditing(term)} disabled={busy}><Icon name="edit" size={16} /></button><button className="icon-button" aria-label={term.source + ' 용어 삭제'} onClick={() => setDeleting(term)} disabled={busy}><Icon name="trash" size={16} /></button></div></td>
      </tr>)}</tbody></table></div> : <EmptyState icon="book" title={query ? '검색 결과가 없습니다' : reviewOnly ? '모델 검증 대기 용어가 없습니다' : '아직 생성된 기준 용어가 없습니다'} description={query ? '다른 이름이나 별칭으로 검색하세요.' : reviewOnly ? '전체 용어에서 현재 적용 기준을 확인할 수 있습니다.' : '원고나 자막을 등록하고 모델 용어집 생성을 시작하세요. 번역을 시작할 때도 용어집을 먼저 준비합니다.'} />}
    </section>
    {routeProject && inherited.length > 0 && <section className="panel"><div className="panel-header"><h2>함께 적용하는 공통 기준</h2><Badge>{inherited.length}개</Badge></div><div className="ai-review-terms">{inherited.map(term => <article className="ai-review-term" key={term.id}><strong>{term.source} → {term.target}</strong><span>{term.sourceLang.toUpperCase()} → {term.targetLang.toUpperCase()}</span><p>{term.note || '맥락 메모 없음'}</p></article>)}</div></section>}
    {history.length > 0 && <details className="panel glossary-history"><summary>모델의 표기 결정 기록 · {history.length}건</summary><div className="ai-review-terms">{history.map(item => <article className="ai-term-suggestion" key={item.id}><Badge tone="green">자동 처리 완료</Badge><strong>{item.source} · 기준 “{state.glossary.find(term => term.id === item.termId)?.target ?? item.source}”</strong><p>{item.note || '기존 기준을 유지하고 다른 표기를 통일했습니다.'}</p><blockquote>원문 근거: “{item.origin.quote}”</blockquote></article>)}</div></details>}
    <details className="panel manual-ai-fallback"><summary>용어 직접 편집 · CSV 가져오기/내보내기</summary><p>필요할 때 기준을 직접 수정할 수 있습니다. 모델은 저장된 기준을 이후 번역에 적용합니다.</p><div className="inline-actions"><Button variant="secondary" icon="plus" disabled={busy} onClick={() => setEditing('new')}>용어 추가</Button><label className="button button--secondary">CSV 가져오기<input className="sr-only" type="file" accept=".csv" aria-label="용어집 CSV 가져오기" onChange={upload} disabled={busy} /></label><Button variant="secondary" icon="download" disabled={!own.length} onClick={exportCSV}>CSV 내보내기</Button></div></details>
    {editing && <GlossaryForm entry={editing === 'new' ? undefined : editing} defaultProject={project === '*' ? '' : project} lockedProject={routeProject} onClose={() => setEditing(null)} />}
    {deleting && <ConfirmDialog title="용어를 삭제할까요?" description={'“' + deleting.source + ' → ' + deleting.target + '” 기준을 제거하고 진행 중인 문서를 다시 검사합니다.'} busy={busy} onClose={() => setDeleting(null)} onConfirm={async () => { if (await run(draft => { draft.glossary = draft.glossary.filter(term => term.id !== deleting.id); draft.glossaryRuns = (draft.glossaryRuns ?? []).filter(item => termKey(item.project) !== termKey(deleting.project ?? '')); refreshGlossaryDocuments(draft); logActivity(draft, '“' + deleting.source + '” 용어 삭제') }, '용어를 삭제했습니다.')) setDeleting(null) }} />}
    {incoming && <ConfirmDialog title={'용어 ' + incoming.length + '개를 가져올까요?'} description="같은 프로젝트·언어·원어가 있는 항목은 CSV 내용으로 갱신하고, 나머지는 추가합니다." confirmLabel="용어집 반영" danger={false} busy={busy} onClose={() => setIncoming(null)} onConfirm={async () => { if (await run(draft => { for (const term of incoming) { const previous = draft.glossary.find(entry => glossaryIdentity(entry) === glossaryIdentity(term)); putGlossaryTerm(draft, { ...term, reviewStatus: 'approved', id: previous?.id ?? term.id }, false) } refreshGlossaryDocuments(draft); logActivity(draft, '용어집 CSV ' + incoming.length + '개 반영') }, '용어집을 반영했습니다.')) setIncoming(null) }} />}
  </div>
}
function GlossaryForm({entry,defaultProject,lockedProject,onClose}:{entry?:GlossaryEntry;defaultProject:string;lockedProject?:string;onClose:()=>void}){
  const {run,busy}=useWorkspace()
  const [source,setSource]=useState(entry?.source??''),[target,setTarget]=useState(entry?.target??''),[project,setProject]=useState(entry?.project??defaultProject),[category,setCategory]=useState<NonNullable<GlossaryEntry['category']>>(entry?.category??'character'),[aliases,setAliases]=useState((entry?.aliases??[]).join('\n')),[variants,setVariants]=useState((entry?.variants??[]).join('\n')),[note,setNote]=useState(entry?.note??''),[sourceLang,setSourceLang]=useState(entry?.sourceLang??'en'),[targetLang,setTargetLang]=useState(entry?.targetLang??'ko'),[severity,setSeverity]=useState(entry?.severity??'warning')
  const list=(s:string)=>[...new Set(s.split('\n').map(t=>t.trim()).filter(Boolean))]
  const submit=async(e:FormEvent)=>{e.preventDefault();if(await run(s=>{putGlossaryTerm(s,{id:entry?.id??uid(),source:source.trim(),target:target.trim(),sourceLang,targetLang,severity,project:lockedProject||project.trim(),category,aliases:list(aliases),variants:list(variants),note:note.trim(),reviewStatus:'approved',...(entry?.aiOrigin?{aiOrigin:entry.aiOrigin}:{})});logActivity(s,`“${source} → ${target}” 작품 용어 저장`)},'용어를 저장하고 관련 회차를 다시 검사했습니다.'))onClose()}
  return <Modal title={entry?'작품 용어 수정':'작품 용어 추가'} wide onClose={()=>{if(!busy)onClose()}}><form className="modal-form" onSubmit={submit}>
    <div className="two-cols"><label className="field">적용 작품<input maxLength={80} readOnly={!!lockedProject} value={lockedProject||project} onChange={e=>setProject(e.target.value)} placeholder="비우면 모든 작품에 공통 적용"/></label><label className="field">분류<select value={category} onChange={e=>setCategory(e.target.value as typeof category)}>{Object.entries(TERM_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
    <div className="two-cols"><label className="field">원어 *<input required maxLength={100} value={source} onChange={e=>setSource(e.target.value)} placeholder="Serin"/></label><label className="field">기준 번역 *<input required maxLength={100} value={target} onChange={e=>setTarget(e.target.value)} placeholder="세린"/></label></div>
    <div className="two-cols"><label className="field">원문의 별칭 · 한 줄에 하나<textarea rows={3} value={aliases} onChange={e=>setAliases(e.target.value)} placeholder="Lady Serin"/></label><label className="field">피할 번역 표기 · 한 줄에 하나<textarea rows={3} value={variants} onChange={e=>setVariants(e.target.value)} placeholder={'셀린\n세린느'}/></label></div>
    <label className="field">인물 관계·호칭·문체 메모<textarea rows={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="세린은 기사단장. 부하는 ‘단장님’으로 부르고, 독백에서는 이름을 사용합니다."/></label>
    <div className="two-cols"><label className="field">원문 언어<select value={sourceLang} onChange={e=>setSourceLang(e.target.value as typeof sourceLang)}>{Object.entries(LANGUAGES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="field">번역 언어<select value={targetLang} onChange={e=>setTargetLang(e.target.value as typeof targetLang)}>{Object.entries(LANGUAGES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
    <label className="field">불일치 중요도<select value={severity} onChange={e=>setSeverity(e.target.value as typeof severity)}>{Object.entries(SEVERITY).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy}>기준 번역 저장</Button></div>
  </form></Modal>
}
