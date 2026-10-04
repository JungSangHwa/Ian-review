import { Link, useNavigate } from 'react-router-dom'
import { Button, PageHeading } from '../components/UI'
import Icon from '../components/Icon'
import { useWorkspace } from '../state/WorkspaceContext'
import { DEMO_WORK, hasLiteraryExamples, loadLiteraryExamples } from '../lib/literaryDemo'
import { projectPath } from '../lib/projects'
export default function HelpPage() {
  const { state, run, busy } = useWorkspace(), navigate = useNavigate()
  return <div className="stack-lg help-page"><PageHeading eyebrow="STORY GLOSSARY GUIDE" title="회차가 바뀌어도, 같은 기준으로." description="웹소설과 자막의 인물명·호칭·설정어를 작품 용어집으로 관리하고, 자동 번역의 표기 혼용을 찾아 보강합니다." />
    <div className="help-steps">{[
      { n: '01', title: '원고 등록 · 모델 설정', icon: 'book' as const, text: '프로젝트를 만들고 TXT·CSV 원고 또는 SRT·VTT 자막을 등록하세요. 프로젝트에서 사용할 로컬 Ollama 모델을 저장합니다.' },
      { n: '02', title: '모델이 용어집 생성·검증', icon: 'file' as const, text: '프로젝트 용어집에서 모델이 원문 전체의 용어·별칭·호칭·맥락을 생성하고 검증합니다. 애매한 용어도 모델이 결정하며 기준 문서에 자동 저장합니다.' },
      { n: '03', title: '기준 문서로 번역 · 재검증', icon: 'edit' as const, text: '원고·자막 화면에서 모델 번역을 시작하세요. 모든 묶음에 같은 기준 문서를 전달하고, 모델이 번역을 재검증한 뒤 저장합니다. 결과는 TXT·CSV·SRT·VTT로 내보낼 수 있습니다.' },
    ].map(s => <section className="panel help-step" key={s.n}><div><span>{s.n}</span><Icon name={s.icon} size={24}/></div><h2>{s.title}</h2><p>{s.text}</p></section>)}</div>
    <section className="panel help-article"><h2>용어집을 번역 전후에 사용하기</h2><p>예를 들어 Serin의 기준 번역을 ‘세린’, 피할 표기를 ‘셀린·세린느’로 등록합니다. 원문에 Serin 또는 등록한 별칭이 있는 구간에서 기준 번역 누락과 다른 표기를 검사합니다. 한 구간에 세린과 셀린이 함께 있어도 혼용을 찾습니다.</p><p>작품 이름을 비우면 모든 작품에 쓰는 공통 용어가 됩니다. 같은 원어에 작품별 기준이 있으면 작품 기준을 우선합니다. 용어집을 수정하면 진행 중인 회차를 다시 검사합니다. 완료된 문서는 ‘검수 다시 열기’ 후 새 기준을 적용하세요.</p><p>관계와 호칭 메모는 모델 번역과 재검증에 함께 전달됩니다. 모델이 원문 맥락으로 표현을 결정하되 근거가 부족한 관계나 설정을 만들어 내지 않도록 요청합니다. 규칙 검사는 등록된 표기만 비교하며 의미·문맥 판단은 모델 재검증에서 수행합니다.</p></section>
    <section className="panel help-article"><h2>작품 모델을 연결하고 번역하기</h2><p>‘모델 연결’에서 작품을 선택하고 로컬 Ollama 모델을 설정하세요. 설치된 모델을 불러오거나 ID를 직접 입력할 수 있습니다. 연결 확인과 작품별 문체 메모 저장 후 원고·자막 검수 화면에서 번역을 시작하세요.</p><p>모델은 번역 전에 프로젝트 원문 전체의 용어집을 생성·검증합니다. 검증한 용어는 승인 대기 없이 기준 문서에 저장하고, 기존 기준과 다른 표기는 자동으로 통일합니다. 번역 중 새로 확인한 용어도 재검증 후 다음 묶음에 반영합니다. 이전 백업의 용어 초안과 충돌 제안은 모델이 다시 검증합니다. 새 원고를 추가하면 남은 범위를 처리하며, 페이지를 옮겨도 사이드바에서 작업 단계와 저장 진행률을 확인하고 일시 중지할 수 있습니다.</p></section>
    <section className="panel help-article"><h2>파일과 자막 시간 보존</h2><p>파일은 UTF-8로 준비하세요. TXT는 빈 줄 또는 한 줄 기준으로 문단을 나눕니다. CSV의 첫 행에는 <code>source,target</code> 열이 필요하며 번역이 아직 없는 셀은 비워 둘 수 있습니다. 원고·자막은 파일당 2MB, 문서당 500구간까지 등록할 수 있습니다.</p><p>SRT·VTT는 원문 파일의 시간과 구간 식별자, 줄바꿈을 보관합니다. 번역 자막도 넣을 때는 구간 수와 시간이 원문과 같아야 합니다. 검수 화면에서 같은 형식으로 내보내며, 빈 번역이나 자막 구조를 깨는 빈 줄이 있으면 먼저 수정을 안내합니다.</p><p>용어집 CSV는 <code>source,target</code> 외에 <code>project,source_language,target_language,category,aliases,variants,note,severity</code>를 지원합니다. 별칭과 피할 표기를 여러 개 적을 때는 <code>|</code>로 구분합니다. 앱에서 내보낸 용어집을 양식으로 사용하세요.</p></section>
    <section className="panel help-article"><h2>별빛 서약 예제로 확인하기</h2><p>웹소설 2회차(12문단), 자막 8구간, 작품 용어 8개 예제를 추가할 수 있습니다. 서로 다른 표기를 의도적으로 넣어 회차·자막에 같은 기준이 적용되는지 살펴볼 수 있습니다. 기존 작업은 유지하며 예제는 브라우저별로 한 번 추가합니다.</p><div className="inline-actions">{hasLiteraryExamples(state)?<Link className="button button--secondary" to={projectPath(DEMO_WORK)}>예제 작업 공간 열기</Link>:<Button variant="secondary" disabled={busy} onClick={async()=>{if(await run(loadLiteraryExamples,'웹소설·자막 예제를 추가했습니다.'))navigate(projectPath(DEMO_WORK))}}>예제 추가하고 열기</Button>}<a className="text-link" href="/examples/report.html" target="_blank" rel="noreferrer">수정 전후와 검증 결과 보기 ↗</a></div></section>
    <section className="panel help-article"><h2>문맥 확인과 저장</h2><p>표기를 통일해도 번역의 의미와 자연스러움이 보장되지는 않습니다. 숫자·변수·공백 검사와 수동 이슈를 함께 활용하세요. 모델 재검증 결과에 미처리 규칙 이슈가 없으면 해당 구간은 자동으로 확인 완료됩니다. 직접 수정한 구간은 다시 모델 번역하거나 확인할 수 있습니다. 수정 이력에서 이전 번역을 확인·복원할 수 있습니다.</p><p>직접 입력한 번역문은 ‘변경 저장’ 또는 Ctrl/⌘ + S로 저장하세요. 문서는 현재 브라우저·프로필·사이트 주소에 저장되며 기기 간 동기화는 제공하지 않습니다. 작업 후 전체 JSON 백업을 받고 다른 기기에서 복원하세요. JSON 복원은 현재 작업 공간 전체를 교체합니다.</p><div className="inline-actions"><Link className="button button--primary" to="/">프로젝트 선택</Link><Link className="button button--secondary" to="/settings">백업 관리</Link></div></section>
  </div>
}
