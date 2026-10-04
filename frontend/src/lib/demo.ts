import { createDocument, addManualIssue } from './actions'
import { analyzeDocument } from './rules'
import { uid, now, emptyRatings, logActivity, type Workspace, type Evaluation } from './model'
export function loadExamples(state: Workspace) {
  if (state.translations.some(d => d.isDemo) || state.evaluations.some(e => e.isDemo)) throw new Error('예제가 이미 등록되어 있습니다. 문서 목록에서 “예제” 표시를 확인해 주세요.')
  const terms = [['workspace', '워크스페이스'], ['subscription', '구독'], ['support team', '지원 팀']]
  for (const [source, target] of terms) if (!state.glossary.some(t => t.source.toLowerCase() === source && t.sourceLang === 'en' && t.targetLang === 'ko')) state.glossary.push({ id: uid(), source, target, sourceLang: 'en', targetLang: 'ko', severity: 'warning' })
  const first = createDocument(state, { title: '새로운 시작을 위한 온보딩 가이드', domain: '프로덕트 · UX 라이팅', sourceLang: 'en', targetLang: 'ko', pairs: [
    { source: 'Welcome to your new workspace.', target: '새로운 워크스페이스에 오신 것을 환영합니다.' },
    { source: 'Invite up to 10 teammates and get started in minutes.', target: '최대 5명의 팀원을 초대하고 몇 분 안에 시작하세요.' },
    { source: 'Your subscription includes 100 GB of storage.', target: '구독에는 100GB의 저장 공간이 포함됩니다.' },
    { source: 'Need help? Contact our support team.', target: '도움이 필요하신가요?  지원 팀에 문의하세요.' },
    { source: 'Your data stays private. We never share it without permission.', target: '사용자의 데이터는 비공개로 유지됩니다. 허락 없이 공유하지 않습니다.' },
  ] })
  const doc = state.translations.find(d => d.id === first)!
  doc.isDemo = true; doc.segments[0].reviewed = true; doc.segments[2].reviewed = true
  addManualIssue(state, first, doc.segments[1].id, { type: '의미 정확성', severity: 'error', reason: '예제 검수자 메모: 초대 가능한 팀원 수는 5명이 아니라 10명입니다. 숫자를 바로잡고 안내 문체를 정리해 주세요.', suggestedTargetText: '최대 10명의 팀원을 초대하고 몇 분 안에 시작할 수 있습니다.' })
  const second = createDocument(state, { title: '가을 업데이트 릴리스 노트', domain: '프로덕트 · 릴리스 노트', sourceLang: 'en', targetLang: 'ko', pairs: [
    { source: 'A simpler way to manage your projects.', target: '프로젝트를 더 간편하게 관리하는 방법.' },
    { source: 'Search across every workspace in one place.', target: '한곳에서 모든 작업 공간을 검색하세요.' },
    { source: 'Available to all subscribers from September 30.', target: '9월 30일부터 모든 구독자가 이용할 수 있습니다.' },
  ] })
  const doc2 = state.translations.find(d => d.id === second)!; doc2.isDemo = true; doc2.segments[0].reviewed = true
  const third = createDocument(state, { title: '고객 지원 이메일 템플릿', domain: '고객 경험 · 이메일', sourceLang: 'en', targetLang: 'ko', pairs: [
    { source: 'Thank you for reaching out to us.', target: '문의해 주셔서 감사합니다.' },
    { source: 'We have received your request and will get back to you shortly.', target: '요청을 접수했습니다. 확인 후 빠르게 답변드리겠습니다.' },
    { source: 'Have a wonderful day!', target: '좋은 하루 보내세요!' },
  ] })
  const doc3 = state.translations.find(d => d.id === third)!; doc3.isDemo = true; doc3.status = 'FINALIZED'; doc3.segments.forEach(s => { s.reviewed = true })
  const evaluation: Evaluation = { id: uid(), project: doc.domain, title: '브랜드 슬로건 · 자연스러움 비교', sourceText: 'Make room for your next big idea.', sourceLang: 'en', targetLang: 'ko', candidates: [{ label: '번역 초안', text: '다음 큰 아이디어를 위한 방을 만드세요.' }, { label: '검수 수정본', text: '새로운 아이디어가 자랄 공간을 마련하세요.' }], ratings: [emptyRatings(), emptyRatings()], preference: '', comment: '', reviewer: '', status: 'DRAFT', createdAt: now(), updatedAt: now(), isDemo: true }
  if (crypto.getRandomValues(new Uint8Array(1))[0] % 2) evaluation.candidates.reverse()
  state.evaluations.push(evaluation)
  for (const d of state.translations.filter(d => d.isDemo && d.status !== 'FINALIZED')) analyzeDocument(d, state.glossary)
  logActivity(state, '검수 문서 3개와 블라인드 평가 1개의 예제를 불러왔습니다.')
}
