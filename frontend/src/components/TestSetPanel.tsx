import { useState } from 'react'
import { Link } from 'react-router-dom'
import { projectPath } from '../lib/projects'
import { useWorkspace } from '../state/WorkspaceContext'
import { hasTestSet, inspectTestCorpus, loadTestSet } from '../lib/testSet'
import { TEST_SET_ID, TEST_TITLE_PREFIX } from '../lib/testCorpus'
import { Badge, Button } from './UI'

export default function TestSetPanel() {
  const { state, run, busy } = useWorkspace()
  const [checks, setChecks] = useState<ReturnType<typeof inspectTestCorpus> | null>(null)
  const loaded = hasTestSet(state)
  const docs = state.translations.filter(doc => doc.domain === TEST_SET_ID)
  const evaluations = state.evaluations.filter(e => e.title.startsWith(TEST_TITLE_PREFIX))
  return <section className="panel setting-card" id="validation" aria-labelledby="test-set-heading">
    <div className="inline-actions"><h2 id="test-set-heading">ChatGPT 번역 테스트 세트</h2><Badge tone="purple">36문장 · A/B 평가 4개</Badge></div>
    <p>영→한·한→영 기준 번역과 의도적으로 오류를 넣은 번역입니다. 숫자·변수·용어 검사와 의미 오류의 수동 검수를 확인할 수 있습니다.</p>
    <p>추가 버튼을 누르면 일반 검증 문서 4개와 평가 4개를 추가합니다. 작품 예제와 기존 수정 내용은 유지됩니다. 두 후보와 기준 번역은 모두 ChatGPT가 작성했습니다.</p>
    <div className="inline-actions">
      <Button icon="plus" disabled={busy || loaded} onClick={async () => { if (await run(loadTestSet, '검증 문서 4개와 A/B 평가 4개를 추가했습니다.')) setChecks(inspectTestCorpus()) }}>{loaded ? '테스트 세트 추가됨' : '테스트 세트 추가'}</Button>
      <Button variant="secondary" onClick={() => setChecks(inspectTestCorpus())}>기준 규칙 검사</Button>
      <a className="button button--secondary" href="/validation/report.html" target="_blank" rel="noreferrer">검증 보고서</a>
    </div>
    {checks && <div className="import-note" role="status"><span>기준 문장 {checks.length}개 중 {checks.filter(c => c.passed).length}개의 규칙 결과가 기대값과 일치합니다. 이 수치는 번역 정확도가 아닙니다. 의미 오류 4건은 수동 검수가 필요하며, 정당한 단위 환산 1건도 숫자 경고가 납니다.</span></div>}
    {checks?.some(c => !c.passed) && <ul>{checks.filter(c => !c.passed).map(c => <li key={c.id}>{c.id} · {c.purpose}: 예상 {c.expected.join(', ') || '없음'} / 실제 {c.actual.join(', ') || '없음'}</li>)}</ul>}
    {loaded && <div><p>현재 저장된 테스트 문서 {docs.length}개 · 평가 {evaluations.length}개</p><ul>{docs.map(doc => <li key={doc.id}><Link to={projectPath(doc.domain, `review/${doc.id}`)}>{doc.title}</Link></li>)}</ul><Link className="text-link" to={projectPath(docs[0]?.domain || 'test-set', 'evaluations')}>A/B 평가 열기</Link></div>}
    <small>기준 규칙 검사는 별도의 원본 테스트 문장을 검사합니다. 사용자가 수정한 문서의 검수 상태는 각 문서에서 확인하세요.</small>
  </section>
}
