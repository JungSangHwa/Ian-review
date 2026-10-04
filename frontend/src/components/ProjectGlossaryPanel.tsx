import { Link } from 'react-router-dom'
import { useWorkspace } from '../state/WorkspaceContext'
import { useAIJobs } from '../state/AIJobsContext'
import { projectGlossaryProgress, unresolvedProjectTerms } from '../lib/projectGlossary'
import { projectAIConfig } from '../lib/aiTranslation'
import { projectPath, sameProject } from '../lib/projects'
import { isRunActive } from '../lib/runLease'
import { Badge, Button } from './UI'

const phases = { preparing: '원문 확인 중', extract: '용어 추출 중', verify: '용어 기준 검증 중', translation: '기준 문서로 번역 중', validation: '번역 재검증 중', saving: '결과 저장 중', stopping: '일시 중지 중', completed: '완료', paused: '일시 중지', failed: '오류' }

export default function ProjectGlossaryPanel({ project }: { project: string }) {
  const { state, busy } = useWorkspace(), jobs = useAIJobs()
  const progress = projectGlossaryProgress(state, project)
  const config = projectAIConfig(state, project)
  const docs = state.translations.filter(doc => sameProject(doc.domain, project))
  const view = jobs.job && sameProject(jobs.job.project, project) ? jobs.job : null
  const active = !!view && !['completed', 'paused', 'failed'].includes(view.phase)
  const blocked = busy || isRunActive('model-global') || !!(jobs.job && !['completed', 'paused', 'failed'].includes(jobs.job.phase))
  const unresolved = unresolvedProjectTerms(state, project).length
  const error = state.glossaryRuns?.find(run => sameProject(run.project, project))?.error
  const reason = !config || config.provider !== 'local' ? '로컬 모델을 먼저 설정하세요.' : !docs.length ? '원고나 자막을 먼저 등록하세요.' : ''
  return <section className="panel project-glossary-panel" aria-label="모델 용어집 작업">
    <div className="panel-header"><div className="section-title"><h2>모델이 만드는 번역 기준 문서</h2><Badge tone={progress.ready ? 'green' : active ? 'blue' : 'orange'}>{active ? phases[view.phase] : progress.ready ? '번역에 적용 중' : '모델 검증 필요'}</Badge></div></div>
    <p className="muted">프로젝트의 원문 전체에서 모델이 용어·별칭·호칭·맥락을 추출하고 다시 검증합니다. 검증한 기준은 자동 저장되며 모든 번역과 재검증에 같은 문서로 전달됩니다.</p>
    <ol className="model-workflow" aria-label="번역 작업 순서"><li className={!progress.ready ? 'current' : ''}><span>01</span><strong>원문에서 용어 생성</strong></li><li className={active && view.phase === 'verify' ? 'current' : ''}><span>02</span><strong>모델 검증 · 기준 저장</strong></li><li className={progress.ready ? 'current' : ''}><span>03</span><strong>기준 문서로 번역</strong></li></ol>
    <div className="inline-actions"><span role="status">원문 {progress.completed}/{progress.total}묶음 저장{unresolved ? ` · 이전 용어 ${unresolved}개 모델 검증 필요` : ''}</span>
      {active ? <Button variant="secondary" disabled={view.phase === 'stopping'} onClick={jobs.pause}>{view.phase === 'stopping' ? '일시 중지 중…' : '일시 중지'}</Button> : <Button disabled={blocked || !!reason || progress.ready} onClick={() => void jobs.startGlossary(project)}>{progress.ready ? '기준 문서 준비 완료' : progress.completed || progress.status === 'paused' || progress.status === 'failed' ? '남은 용어집 생성·검증' : '모델로 용어집 생성·검증'}</Button>}
      {reason ? <Link className="text-link" to={projectPath(project, !config || config.provider !== 'local' ? 'models' : 'documents/new')}>{reason} →</Link> : <Link className="text-link" to={projectPath(project, 'documents')}>원고·자막에서 번역 시작 →</Link>}
    </div>
    {error && !active && <p className="inline-error" role="alert">{error}</p>}
    <p className="footnote">애매한 새 용어는 모델이 원문 맥락으로 결정하고 근거를 기록합니다. 이미 정한 기준 번역은 유지하며 새 원고를 등록하면 추가된 범위를 검증합니다.</p>
  </section>
}
