import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { projectNames, projectPath, sameProject } from '../lib/projects'
import { useWorkspace } from '../state/WorkspaceContext'
import { createDocument, type NewDocument } from '../lib/actions'
import { LANGUAGES, LIMITS } from '../lib/model'
import type { Language, Translation } from '../types/translation'
import { importPairs, readTextFile, splitText } from '../lib/files'
import { parseSubtitles, parseTiming } from '../lib/subtitles'
import { Badge, Button, PageHeading, UnsavedGuard } from '../components/UI'
import Icon from '../components/Icon'
export default function NewDocumentPage() {
  const { state, run, notify, busy } = useWorkspace(), navigate = useNavigate(), [params] = useSearchParams(), { project: routeProject } = useParams()
  const [title, setTitle] = useState(''), [domain, setDomain] = useState(routeProject ?? params.get('project') ?? ''), [kind, setKind] = useState<'novel' | 'subtitle'>(params.get('type') === 'subtitle' ? 'subtitle' : 'novel')
  const [sourceLang, setSourceLang] = useState<Language>('en'), [targetLang, setTargetLang] = useState<Language>('ko')
  const [source, setSource] = useState(''), [target, setTarget] = useState(''), [mode, setMode] = useState<'paragraph' | 'line'>('paragraph')
  const [imported, setImported] = useState<{ name: string; pairs: NewDocument['pairs'] } | null>(null), [subtitle, setSubtitle] = useState<Translation['subtitle']>()
  const [error, setError] = useState(''), [created, setCreated] = useState(false), [reading, setReading] = useState(false)
  const sourceParts = useMemo(() => splitText(source, mode), [source, mode]), targetParts = useMemo(() => splitText(target, mode), [target, mode])
  const mismatch = !imported && targetParts.length > 0 && sourceParts.length !== targetParts.length
  const pairs = imported?.pairs ?? sourceParts.map((s, i) => ({ source: s, target: targetParts[i] ?? '' }))
  const projects = projectNames(state)
  const glossaryPath = routeProject ? projectPath(routeProject, 'glossary') : domain.trim() && projects.some(name => sameProject(name, domain)) ? projectPath(domain.trim(), 'glossary') : `/glossary${domain.trim() ? `?project=${encodeURIComponent(domain.trim())}` : ''}`
  const reset = () => { setImported(null); setSubtitle(undefined); setSource(''); setTarget('') }
  const upload = async (event: ChangeEvent<HTMLInputElement>, side: 'source' | 'target' | 'csv') => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    setReading(true)
    try {
      const text = await readTextFile(file, 2 * 1024 * 1024), ext = file.name.split('.').pop()?.toLowerCase()
      if (side === 'csv') { setImported({ name: file.name, pairs: importPairs(text) }); setSubtitle(undefined) }
      else if (ext === 'srt' || ext === 'vtt') {
        const parsed = parseSubtitles(text, ext)
        if (side === 'source') { setImported({ name: file.name, pairs: parsed.pairs }); setSubtitle(parsed.subtitle); setKind('subtitle') }
        else {
          if (!imported || !subtitle) throw new Error('원문 자막을 먼저 가져와 주세요.')
          if (parsed.pairs.length !== imported.pairs.length || parsed.pairs.some((p, i) => { const a = parseTiming(p.cue.timing, ext), b = parseTiming(imported.pairs[i].cue!.timing, subtitle.format); return a.start !== b.start || a.end !== b.end })) throw new Error('원문과 번역 자막의 구간 수 또는 시간이 다릅니다. 같은 시간표를 사용해 주세요.')
          setImported({ ...imported, pairs: imported.pairs.map((p, i) => ({ ...p, target: parsed.pairs[i].source })) })
        }
      } else if (side === 'source') { reset(); setSource(text) }
      else if (imported) {
        const parts = splitText(text, mode)
        if (parts.length !== imported.pairs.length) throw new Error('번역문의 문단 수가 원문 구간 수와 다릅니다. 같은 수의 문단이나 번역 자막 파일을 넣어 주세요.')
        setImported({ ...imported, pairs: imported.pairs.map((p, i) => ({ ...p, target: parts[i] })) })
      } else setTarget(text)
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 120))
      setError('')
    } catch (e) { notify(e instanceof Error ? e.message : '파일을 읽지 못했습니다.', 'error') }
    finally { setReading(false) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (mismatch || !pairs.length) { setError(mismatch ? '원문과 번역문의 문단 수를 맞춰 주세요.' : '원문을 입력하거나 파일을 가져와 주세요.'); return }
    if (kind === 'subtitle' && !subtitle) { setError('자막은 SRT 또는 VTT 원문 파일을 가져와 주세요. 시간 정보가 없는 텍스트는 웹소설 형식으로 등록할 수 있습니다.'); return }
    let id = ''
    const destination = routeProject ?? domain.trim()
    if (await run(s => { id = createDocument(s, { title, domain: destination, sourceLang, targetLang, pairs, contentType: kind, subtitle }) }, '작품 용어집으로 번역의 표기를 검사했습니다.')) { flushSync(() => setCreated(true)); navigate(projectPath(destination, `review/${id}`)) }
  }
  return <form className="stack-lg" onSubmit={submit}><UnsavedGuard dirty={!created && !!(title || domain !== (routeProject ?? params.get('project') ?? '') || source || target || imported)} />
    <PageHeading eyebrow="MANUSCRIPT & SUBTITLES" title="원고·자막 가져오기" description="원문만 등록하거나 기존 자동 번역문을 함께 넣으세요. 같은 작품의 회차·에피소드에는 같은 용어집을 적용합니다."><Link className="button button--secondary" to={routeProject ? projectPath(routeProject, 'documents') : '/documents'}>취소</Link></PageHeading>
    <section className="panel form-panel"><div className="section-step"><span>01</span><h2>작품과 회차</h2></div><div className="form-grid">
      <label className="field">작품 이름<input required readOnly={!!routeProject} maxLength={80} list="project-options" value={routeProject ?? domain} onChange={e => setDomain(e.target.value)} placeholder="예: 별빛 서약" /><small>같은 작품 이름을 쓰면 회차마다 같은 용어집을 적용합니다.</small><datalist id="project-options">{projects.map(p => <option key={p} value={p} />)}</datalist></label>
      <label className="field">회차 / 파일 제목<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 02화 · 달의 성문" /></label>
      <label className="field">콘텐츠 형식<select value={kind} onChange={e => { setKind(e.target.value as typeof kind); reset() }}><option value="novel">웹소설 · 문단 단위</option><option value="subtitle">자막 · 시간 구간 단위</option></select></label>
      <div className="language-fields"><label className="field">원문 언어<select value={sourceLang} onChange={e => setSourceLang(e.target.value as Language)}>{Object.entries(LANGUAGES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><Icon name="arrow" size={16}/><label className="field">번역 언어<select value={targetLang} onChange={e => setTargetLang(e.target.value as Language)}>{Object.entries(LANGUAGES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    </div><Link className="text-link" to={glossaryPath}>이 작품의 인물명·호칭 먼저 정리하기 →</Link></section>
    <section className="panel form-panel"><div className="form-section-heading"><div className="section-step"><span>02</span><h2>원문과 번역 초안</h2></div><label className="button button--secondary button--small">CSV 가져오기<input className="sr-only" type="file" accept=".csv" aria-label="CSV 가져오기" disabled={busy || reading || kind === 'subtitle'} onChange={e => upload(e, 'csv')}/></label></div>
    <div className="import-note"><Icon name="book" size={18}/><span>{kind === 'subtitle' ? 'SRT·VTT의 시간, 구간 식별자, 줄바꿈을 보존합니다. 수정 후 같은 자막 형식으로 내보낼 수 있습니다.' : 'UTF-8 TXT 또는 CSV를 가져오거나 문단을 붙여 넣으세요.'} 파일당 2MB · 최대 {LIMITS.segments}개 구간.</span></div>
    {imported && <div className="file-loaded"><strong>{imported.name}</strong><Badge>{pairs.length}개 구간</Badge><button type="button" className="text-link" onClick={reset}>불러오기 취소</button></div>}
    <div className="text-pair">{(['source','target'] as const).map(side => <div key={side}><div className="editor-label"><label htmlFor={`${side}-text`}>{side === 'source' ? '원문' : '번역 초안 (선택)'}</label><label className="text-link">파일 불러오기<input className="sr-only" type="file" accept=".txt,.srt,.vtt" aria-label={`${side === 'source' ? '원문' : '번역문'} 파일 불러오기`} disabled={reading || busy} onChange={e => upload(e,side)}/></label></div><textarea id={`${side}-text`} className="import-textarea" maxLength={1000000} disabled={!!imported} value={imported ? pairs.map(p => p[side]).join('\n\n') : side === 'source' ? source : target} onChange={e => side === 'source' ? setSource(e.target.value) : setTarget(e.target.value)} placeholder={side === 'source' ? '원고를 문단별로 붙여 넣으세요. 자막은 파일로 가져오세요.' : '기존 자동 번역문이 있다면 같은 순서로 넣으세요. 원문만 등록해도 됩니다.'}/></div>)}</div>
    {!imported && <div className="segmentation"><label>문단 구분<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="paragraph">빈 줄 기준</option><option value="line">한 줄씩</option></select></label><span>원문 {sourceParts.length}개 · 번역 {targetParts.length}개</span></div>}
    {pairs.some(pair=>pair.source.length>12000)&&<div className="inline-error" role="status">12,000자를 넘는 구간은 등록·수동 검수할 수 있지만 모델 자동 번역은 할 수 없습니다. 웹소설은 원문을 더 짧은 문단으로 나눠 등록하세요. 자막 구간은 시간 보존을 위해 자동 분할하지 않습니다.</div>}
    <p className="footnote">원문만 등록했다면 검수 화면에서 작품 모델로 번역하고 새 용어를 추출할 수 있습니다. 모델은 데이터 관리에서 작품별로 연결합니다.</p>
    </section>{error && <div className="inline-error" role="alert">{error}</div>}<div className="form-footer"><span>원문과 자막 시간은 보존됩니다.</span><Button type="submit" disabled={busy || reading || mismatch} icon="arrow">저장하고 용어 확인</Button></div>
  </form>
}
