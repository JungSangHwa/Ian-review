import { useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { projectPath, sameProject } from '../lib/projects'
import { useWorkspace } from '../state/WorkspaceContext'
import { emptyRatings, LANGUAGES, LIMITS, logActivity, now, uid, type Candidate } from '../lib/model'
import type { Language } from '../types/translation'
import { Badge, Button, PageHeading, UnsavedGuard } from '../components/UI'
import Icon from '../components/Icon'
export default function NewEvaluationPage() {
  const { state, run, busy } = useWorkspace(), [params] = useSearchParams(), navigate = useNavigate(), { project } = useParams()
  const doc = state.translations.find(d => d.id === params.get('translation') && (!project || sameProject(d.domain, project)))
  const [initial] = useState(() => ({ title: doc ? `${doc.title} · 전후 비교`.slice(0, 120) : '', source: doc?.segments.map(s => s.sourceText).join('\n\n') ?? '', sourceLang: doc?.sourceLang ?? 'en', targetLang: doc?.targetLang ?? 'ko', first: doc?.segments.map(s => s.originalTargetText).join('\n\n') ?? '', second: doc?.segments.map(s => s.targetText).join('\n\n') ?? '', firstLabel: doc ? '검수 전 번역' : '', secondLabel: doc ? '검수 후 번역' : '' }))
  const [title, setTitle] = useState(initial.title), [source, setSource] = useState(initial.source)
  const [sourceLang, setSourceLang] = useState<Language>(initial.sourceLang), [targetLang, setTargetLang] = useState<Language>(initial.targetLang)
  const [first, setFirst] = useState(initial.first), [second, setSecond] = useState(initial.second)
  const [firstLabel, setFirstLabel] = useState(initial.firstLabel), [secondLabel, setSecondLabel] = useState(initial.secondLabel), [created, setCreated] = useState(false), [error, setError] = useState('')
  const dirty = !created && (title !== initial.title || source !== initial.source || sourceLang !== initial.sourceLang || targetLang !== initial.targetLang || first !== initial.first || second !== initial.second || firstLabel !== initial.firstLabel || secondLabel !== initial.secondLabel)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (![title, source, first, second, firstLabel, secondLabel].every(v => v.trim())) { setError('제목, 원문, 두 후보의 이름과 번역문을 모두 입력해 주세요.'); return }
    if (firstLabel.trim().toLowerCase() === secondLabel.trim().toLowerCase()) { setError('결과를 구별할 수 있도록 후보 이름을 다르게 입력해 주세요.'); return }
    const id = uid()
    const candidates: [Candidate, Candidate] = [{ label: firstLabel.trim(), text: first.trim() }, { label: secondLabel.trim(), text: second.trim() }]
    if (crypto.getRandomValues(new Uint8Array(1))[0] % 2) candidates.reverse()
    const ok = await run(s => {
      if (s.evaluations.length >= LIMITS.evaluations) throw new Error(`평가는 최대 ${LIMITS.evaluations}개까지 보관할 수 있습니다.`)
      s.evaluations.unshift({ id, ...(project || doc?.domain ? { project: project || doc?.domain } : {}), title: title.trim(), sourceText: source.trim(), sourceLang, targetLang, candidates, ratings: [emptyRatings(), emptyRatings()], preference: '', comment: '', reviewer: '', status: 'DRAFT', createdAt: now(), updatedAt: now() })
      logActivity(s, `“${title.trim()}” 블라인드 평가를 만들었습니다.`)
    }, 'A/B 순서를 무작위로 배정했습니다. 평가를 시작해 주세요.')
    if (ok) { flushSync(() => setCreated(true)); navigate(project ? projectPath(project, `evaluation/${id}`) : `/evaluation/${id}`) }
  }
  return <form className="stack-lg" onSubmit={submit}><UnsavedGuard dirty={dirty} /><PageHeading eyebrow="NEW EVALUATION" title="새 블라인드 평가" description="같은 원문을 번역한 두 후보를 준비해 주세요. 생성 후 A/B 순서는 고정됩니다."><Link className="button button--secondary" to={project ? projectPath(project, 'evaluations') : '/evaluations'}>취소</Link></PageHeading>
    <section className="panel form-panel"><div className="section-step"><span>01</span><h2>평가 정보와 원문</h2></div>{doc && <div className="import-note"><Icon name="file" size={17} /><span>“{doc.title}”의 번역을 복사했습니다. 이후 원본 문서의 수정·삭제와 관계없이 이 평가에는 생성 시점의 텍스트가 보관됩니다.</span></div>}<div className="form-grid"><label className="field">평가 제목 *<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 브랜드 슬로건 자연스러움 비교" /></label><div className="language-fields"><label className="field">원문 언어<select value={sourceLang} onChange={e => setSourceLang(e.target.value as Language)}>{Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><Icon name="arrow" size={17} /><label className="field">번역 언어<select value={targetLang} onChange={e => setTargetLang(e.target.value as Language)}>{Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div></div><label className="field spaced">원문 *<textarea required value={source} onChange={e => setSource(e.target.value)} rows={5} maxLength={100000} placeholder="두 번역의 공통 원문을 입력하세요." /></label></section>
    <section className="panel form-panel"><div className="section-step"><span>02</span><h2>비교할 번역 후보</h2></div><div className="text-pair">{[{ text: first, setText: setFirst, label: firstLabel, setLabel: setFirstLabel }, { text: second, setText: setSecond, label: secondLabel, setLabel: setSecondLabel }].map((c, index) => <div className="candidate-input" key={index}><div className="candidate-input-heading"><Badge tone={index ? 'blue' : 'purple'}>후보 {index + 1}</Badge><span>생성 후 A/B로 무작위 배정</span></div><label className="field">후보 {index + 1} 이름 *<input required maxLength={80} value={c.label} onChange={e => c.setLabel(e.target.value)} placeholder={index ? '예: 검수 수정본' : '예: 번역 초안'} /></label><label className="field">후보 {index + 1} 번역문 *<textarea required maxLength={100000} value={c.text} onChange={e => c.setText(e.target.value)} rows={10} placeholder="번역문을 입력하세요." /></label></div>)}</div>{first.trim() && first.trim() === second.trim() && <p className="warning-note"><Icon name="alert" size={17} />두 번역문이 같습니다. 동일 문장 비교를 의도한 것인지 확인해 주세요.</p>}</section>
    {error && <div className="inline-error" role="alert">{error}</div>}<div className="form-footer"><span><Icon name="eye" size={16} />후보 이름은 평가 제출 후에 공개됩니다.</span><Button type="submit" icon="compare" disabled={busy}>{busy ? '평가 생성 중…' : '블라인드 평가 시작'}</Button></div>
  </form>
}
