import { useState } from 'react'
import { Link } from 'react-router-dom'
import { projectPath } from '../lib/projects'
import type { Translation } from '../types/translation'
import { useWorkspace } from '../state/WorkspaceContext'
import { useAIJobs } from '../state/AIJobsContext'
import { Badge, Button, Modal } from './UI'
import { AI_PROVIDERS } from '../lib/aiTypes'
import { isRunActive } from '../lib/runLease'
import { projectGlossaryProgress } from '../lib/projectGlossary'

const phaseLabel = { preparing: '용어집 준비', extract: '용어 후보 추출 중', verify: '용어 검증 중', translation: '번역 생성 중', validation: '번역 검증 중', saving: '결과 저장 중', stopping: '중지 중', completed: '완료', paused: '일시 중지', failed: '오류' }
export default function AutoTranslationPanel({ doc, dirty }: { doc: Translation; dirty: boolean }) {
  const { state, busy, notify } = useWorkspace(), jobs = useAIJobs()
  const [selection, setSelection] = useState(false)
  const config = state.aiProjects?.find(c => c.project.normalize('NFKC').trim().toLowerCase() === doc.domain.normalize('NFKC').trim().toLowerCase())
  const run = doc.aiRun, view = jobs.job?.docId === doc.id ? jobs.job : null
  const active = !!view && !['completed', 'paused', 'failed'].includes(view.phase)
  const completed = run?.status === 'completed' && !active
  const otherActive = !!jobs.job && !['completed', 'paused', 'failed'].includes(jobs.job.phase) && jobs.job.docId !== doc.id
  const emptyCount = doc.segments.filter(s => !s.targetText.trim()).length
  const modelPath = projectPath(doc.domain, 'models')
  const glossary = projectGlossaryProgress(state, doc.domain)
  const status = view ? phaseLabel[view.phase] : run?.status === 'running' ? isRunActive(run.id) ? '다른 탭에서 실행 중' : '중단 상태 확인 필요' : run?.status === 'completed' ? '완료' : run?.status === 'failed' ? '오류 · 재개 가능' : run?.status === 'paused' ? '일시 중지 · 재개 가능' : '미실행'
  const canStart = !busy && !dirty && !active && !otherActive && !!config && config.provider === 'local' && doc.status !== 'FINALIZED'
  const resume = async () => {
    if (run?.status === 'running' && isRunActive(run.id)) { notify('다른 탭에서 이 작업이 실행 중입니다.', 'info'); return }
    await jobs.startTranslation(doc.id, 'resume')
  }
  return <section className="panel auto-translation-panel"><div className="auto-translation-head"><div><span className="eyebrow">MODEL TRANSLATION</span><h2>기준 문서로 모델 번역</h2><p>{config ? `${AI_PROVIDERS[config.provider].label} · ${config.model}` : '모델 미설정'} · {status}</p></div><Link className="button button--secondary button--small" to={modelPath}>모델 설정</Link></div>
    {active && view && <p className="model-stage-status" role="status">{phaseLabel[view.phase]} · 저장 {view.done}/{view.total}{view.stage === 'glossary' ? '묶음' : '구간'}</p>}
    {run && <div className="ai-run-progress"><div className="ai-run-stats"><span><strong>{run.completed}</strong> / {run.total}구간 저장</span><span>새 용어 {run.addedTerms}개</span>{run.conflicts > 0 && <span>표기 충돌 {run.conflicts}개 자동 통일</span>}</div>{!completed && <div className="progress" role="progressbar" aria-label="자동 번역 저장 진행률" aria-valuenow={run.total ? Math.round(run.completed / run.total * 100) : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${run.total ? Math.round(run.completed / run.total * 100) : 0}%` }} /></div>}{run.error && <p className="inline-error">{run.error}</p>}</div>}
    {!completed && <p className="muted">프로젝트 용어집 검증: {glossary.completed}/{glossary.total}묶음 · {glossary.ready ? '모델 검증 완료' : '검증 필요'} · 검증한 용어는 자동으로 기준 문서에 반영합니다.</p>}
    {!completed && <p className="ai-translation-description">원문 전체의 용어집 생성·검증이 끝나지 않았으면 남은 묶음을 먼저 처리합니다. 이후 같은 기준 문서로 번역하고 모델이 다시 검증합니다. 번역과 검증 결과는 구간별로 저장하므로 작업을 중단하거나 페이지를 옮겨도 저장된 부분을 확인할 수 있습니다.</p>}
    <div className="inline-actions">{active ? <Button variant="secondary" onClick={jobs.pause} disabled={view?.phase === 'stopping'}>{view?.phase === 'stopping' ? '중지 중…' : '일시 중지'}</Button> : run?.pendingIds.length ? <Button disabled={!canStart} onClick={() => void resume()}>남은 {run.pendingIds.length}구간 재개</Button> : <Button disabled={!canStart} onClick={() => setSelection(true)}>{run?.status === 'completed' ? '다시 번역' : '용어집 기반 모델 번역'}</Button>}
      {emptyCount > 0 && run?.pendingIds.length === 0 && run?.status === 'completed' && <Button variant="secondary" disabled={!canStart} onClick={() => void jobs.startTranslation(doc.id, 'empty')}>빈 번역 {emptyCount}구간 번역</Button>}
      {run && run.status !== 'completed' && <Button variant="ghost" disabled={busy || otherActive || (run.status === 'running' && !active && isRunActive(run.id))} onClick={() => { if (window.confirm('자동 번역 작업을 취소할까요? 이미 저장한 번역문은 유지됩니다.')) void jobs.cancelTranslation(doc.id) }}>작업 취소</Button>}
      {!config && <Link to={modelPath} className="text-link">먼저 이 프로젝트의 로컬 모델을 연결하세요 →</Link>}
      {config?.provider !== undefined && config.provider !== 'local' && <Link to={modelPath} className="text-link">이전 백업의 외부 모델 설정입니다. 로컬 모델을 다시 선택하세요 →</Link>}
    </div>
    {dirty && <p className="muted">입력 중인 번역문을 저장하거나 변경 취소한 뒤 모델 번역을 시작하세요.</p>}{otherActive && <p className="muted">다른 모델 작업이 실행 중입니다. 사이드바에서 진행 상황을 확인하세요.</p>}
    {selection && <Modal title="번역 범위를 고르세요" onClose={() => setSelection(false)}><p className="modal-description">이미 채운 번역은 필요한 때만 전체 재번역을 선택하세요.</p><div className="modal-actions"><Button variant="secondary" onClick={() => setSelection(false)}>취소</Button><Button disabled={!emptyCount} onClick={() => { setSelection(false); void jobs.startTranslation(doc.id, 'empty') }}>빈 번역 {emptyCount}구간만</Button><Button variant="danger" onClick={() => { setSelection(false); void jobs.startTranslation(doc.id, 'all') }}>전체 {doc.segments.length}구간 다시 번역</Button></div><p className="footnote">작품 원문과 용어집은 이 PC의 Ollama로 전달됩니다. 번역과 모델 검증에 묶음마다 두 번 요청합니다.</p></Modal>}
    {run?.status === 'completed' && !run.pendingIds.length && <div className="ai-complete"><Badge tone="green">번역 완료</Badge><span>모델 생성·재검증 결과 저장 · 원문과 자막 시간 보존</span></div>}
  </section>
}
