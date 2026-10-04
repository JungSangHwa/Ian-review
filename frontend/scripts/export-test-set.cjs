// Run after npm test. Produces synthetic fixtures and a report using the actual
// application actions/database adapter with a memory-only IndexedDB test double.
require('fake-indexeddb/auto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadTestSet, inspectTestCorpus } = require('../src/lib/testSet.ts');
const { TEST_CASES, TEST_GROUPS, TEST_EVALUATIONS, TEST_TITLE_PREFIX, TEST_SET_ID } = require('../src/lib/testCorpus.ts');
const { loadWorkspace, commitWorkspace } = require('../src/lib/database.ts');
const { editSegment, markReviewed, finalizeDocument, decideIssue, saveEvaluation } = require('../src/lib/actions.ts');
const { backupText, makeCSV } = require('../src/lib/files.ts');
const out = path.resolve(__dirname, '../public/validation');
const records = path.resolve(__dirname, '../../docs/validation');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const log = fs.readFileSync(path.join(records, 'test-run.log'), 'utf8');
  const counts = Object.fromEntries(['tests', 'pass', 'fail'].map(key => [key, Number(log.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1])]));
  assert.ok(counts.tests > 0 && counts.pass === counts.tests && counts.fail === 0, 'A passing test run is required before exporting the report');
  const baseline = JSON.parse(fs.readFileSync(path.join(records, 'baseline.json'), 'utf8'));
  const cases = inspectTestCorpus();
  assert.ok(cases.every(c => c.passed));
  let state = await loadWorkspace();
  state = await commitWorkspace(state.revision, loadTestSet);
  assert.deepEqual(await loadWorkspace(), state);
  fs.writeFileSync(path.join(out, 'ian-test-workspace.json'), backupText(state));
  state = await commitWorkspace(state.revision, draft => {
    for (const group of TEST_GROUPS) {
      const doc = draft.translations.find(d => d.title === TEST_TITLE_PREFIX + group.title);
      TEST_CASES.filter(c => c.group === group.id).forEach((item, index) => {
        const seg = doc.segments[index];
        if (item.manualReason) decideIssue(draft, doc.id, doc.issues.find(i => i.origin === 'manual' && i.segmentId === seg.id).id, 'apply');
        else if (seg.targetText !== item.reference) editSegment(draft, doc.id, seg.id, seg.revision, item.reference);
        if (item.intentionalDifference) for (const issue of doc.issues.filter(i => i.segmentId === seg.id && i.status === 'open')) decideIssue(draft, doc.id, issue.id, 'dismiss');
        markReviewed(draft, doc.id, seg.id, true);
      });
      finalizeDocument(draft, doc.id);
    }
    for (const e of draft.evaluations) {
      const item = TEST_EVALUATIONS.find(c => TEST_TITLE_PREFIX + c.title === e.title);
      const referenceIndex = e.candidates.findIndex(c => c.label === 'ChatGPT 기준 번역');
      saveEvaluation(draft, e.id, {
        ratings: e.candidates.map((_, i) => i === referenceIndex ? { accuracy: 5, fluency: 5, terminology: 5 } : { accuracy: 1, fluency: 2, terminology: 2 }),
        preference: referenceIndex === 0 ? 'A' : 'B',
        comment: item.reason + ' 점수는 제출 흐름 확인용 합성 값입니다. ChatGPT가 양쪽 후보를 작성하고 자체 판정했으며 독립 평가가 아닙니다.',
        reviewer: 'ChatGPT 자체 검증',
      }, true);
    }
  });
  assert.deepEqual(await loadWorkspace(), state);
  assert.ok(state.translations.every(d => d.status === 'FINALIZED'));
  assert.ok(state.evaluations.every(e => e.status === 'SUBMITTED'));
  fs.writeFileSync(path.join(out, 'ian-verified-workspace.json'), backupText(state));
  const exportCases = TEST_CASES.map(item => ({ ...item, sourceLang: TEST_GROUPS.find(g => g.id === item.group).sourceLang, targetLang: TEST_GROUPS.find(g => g.id === item.group).targetLang }));
  fs.writeFileSync(path.join(out, 'test-cases.json'), JSON.stringify({ id: TEST_SET_ID, authoredBy: 'ChatGPT', cases: exportCases, evaluations: TEST_EVALUATIONS }, null, 2) + '\n');
  for (const group of TEST_GROUPS) fs.writeFileSync(path.join(out, `${group.id}.csv`), makeCSV([['source', 'target'], ...TEST_CASES.filter(c => c.group === group.id).map(c => [c.source, c.target])]));
  const sourceHash = crypto.createHash('sha256').update(['rules.ts', 'actions.ts', 'database.ts', 'testCorpus.ts', 'testSet.ts'].map(name => fs.readFileSync(path.resolve(__dirname, '../src/lib', name))).join('\n')).digest('hex');
  const result = { generatedAt: new Date().toISOString(), testSetId: TEST_SET_ID, codeSha256: sourceHash, automatedTests: counts, baselinePassed: baseline.rows.filter(c => c.passed).length, corpusPassed: cases.filter(c => c.passed).length, corpusTotal: cases.length, storageScenarios: 21, storageEnvironment: 'Node.js + fake-indexeddb; production database adapter and actions; not a real browser', browserUiValidation: 'unavailable: supervised preview infrastructure is unavailable', manualSemanticIssues: 4, intentionalUnitConversionWarnings: 1, completedDocuments: state.translations.length, submittedEvaluations: state.evaluations.length, evaluationDisclaimer: 'Both candidates authored by ChatGPT. Illustrative scores test submission flow only; not independent model benchmarking.', cases };
  const json = JSON.stringify(result, null, 2) + '\n';
  fs.writeFileSync(path.join(out, 'results.json'), json);
  fs.writeFileSync(path.join(records, 'results.json'), json);
  const failedBefore = baseline.rows.filter(c => !c.passed);
  const bodyRows = cases.map(row => { const item = TEST_CASES.find(c => c.id === row.id); return `<tr><th scope="row">${row.id}</th><td>${escape(item.purpose)}${item.manualReason ? '<br><strong>수동 의미 검수 대상</strong>' : ''}</td><td>${escape(row.expected.join(', ') || '없음')}</td><td>${escape(row.actual.join(', ') || '없음')}</td><td>일치</td></tr>`; }).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ian 번역 테스트 검증 결과</title><link rel="icon" href="/favicon.svg"><style>
  *{box-sizing:border-box}@font-face{font-family:Pretendard;src:url('/fonts/PretendardVariable.woff2') format('woff2');font-style:normal;font-weight:45 920;font-display:swap}body{margin:0;background:#f5f7fb;color:#182236;font:16px/1.7 Pretendard,sans-serif}main{max-width:1080px;margin:auto;padding:40px 24px}h1{font-size:32px;line-height:1.35}h2{font-size:22px;margin-top:32px}a{color:#5641a6;text-underline-offset:3px}section{background:white;border:1px solid #dfe4ee;border-radius:14px;padding:24px;margin:20px 0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.stat{padding:18px;background:#ece9fa;border-radius:10px}.stat strong{display:block;font-size:28px}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:640px}th,td{text-align:left;border-bottom:1px solid #e1e5eb;padding:12px;font-size:14px;vertical-align:top}thead{background:#eef0f6}.note{border-left:4px solid #a26300;padding:12px 18px;background:#fff7e8}.downloads{display:flex;flex-wrap:wrap;gap:12px 24px}.fine{font-size:14px;color:#536176}@media(max-width:650px){main{padding:22px 14px}.stats{grid-template-columns:1fr}section{padding:18px}h1{font-size:26px}}
  </style></head><body><main><a href="/settings#validation">← 데이터가 들어 있는 앱 열기</a><h1>Ian 번역 테스트 검증 결과</h1><p>ChatGPT가 기준 번역·의도적 오류 후보·검수 사유를 작성한 합성 테스트입니다. 실제 번역 모델 API 호출이나 서로 다른 모델의 성능 비교는 수행하지 않았습니다.</p>
  <div class="stats"><div class="stat"><strong>${counts.pass}/${counts.tests}</strong>자동 검사 통과</div><div class="stat"><strong>${cases.length}/${cases.length}</strong>문장별 규칙 기대 결과 일치</div><div class="stat"><strong>4개 + 4개</strong>검수 완료 문서 + 제출 완료 평가</div></div>
  <section><h2>발견하고 수정한 문제</h2><p>수정 전에는 ${baseline.rows.length}문장 중 ${baseline.rows.filter(c => c.passed).length}문장이 기대값과 일치했습니다. 다음 ${failedBefore.length}개 사례의 탐지 누락을 재현하고 두 검사 로직을 고쳤습니다.</p><ul><li>음수 부호 누락: -5 → 5, -2 → 2를 숫자 차이로 탐지합니다. 유니코드 −와 날짜·범위의 하이픈도 구분합니다.</li><li>형식 지정 변수 변경: %02d → %02s, %0.2f → %0.2s를 변수 오류로 탐지합니다. %%는 리터럴 퍼센트로 처리합니다.</li></ul></section>
  <section><h2>검증한 작업 흐름</h2><p>문서 4개·36문단, A/B 평가 4개, 용어 4개를 실제 앱의 저장 함수로 입력한 뒤 다시 읽어 같은 데이터인지 확인했습니다. 수정 이력, 확인 상태 해제, 중복 입력 방지, 동시 저장 충돌, 실패 시 롤백, JSON 백업·복원과 복구 사본, 검수 완료 조건, A/B 점수 제출과 제출 후 수정 차단을 검사했습니다.</p><p class="note">저장 검증은 Node.js와 메모리 기반 IndexedDB 대역(fake-indexeddb)에서 실행했습니다. 실제 브라우저의 새로고침·다운로드·클릭·화면 배치는 미리보기 인프라 문제로 검증하지 못했습니다. 36/36은 선언한 규칙 결과와의 일치율이며 번역 정확도가 아닙니다.</p></section>
  <section><h2>사람의 검수가 필요한 부분</h2><p>의미가 뒤집히거나 조건이 빠진 문장 4개(M01–M04)는 자동 규칙으로 탐지하지 못합니다. ChatGPT가 수동 이슈와 문단 전체 수정안을 등록하고 적용했습니다. 20°C → 68°F처럼 올바른 단위 환산도 숫자 경고가 나므로 의도된 차이로 무시 처리했습니다.</p><p>A/B 후보는 모두 ChatGPT가 작성했습니다. 완료본의 점수는 제출 흐름을 검증하는 합성 값이며 독립 평가나 객관적인 품질 점수가 아닙니다.</p></section>
  <section><h2>테스트 파일</h2><p>일반 회귀 테스트 세트입니다. 작품 예제와 별도로 데이터 관리에서 선택해 추가할 수 있습니다. <a href="/settings#validation">앱의 데이터 관리</a>에서 내용을 확인할 수 있습니다. 아래 JSON을 ‘백업에서 복원’으로 불러오면 현재 작업 공간 전체가 교체되므로 먼저 백업하세요.</p><div class="downloads"><a href="ian-test-workspace.json" download>검수 전 작업 공간 JSON</a><a href="ian-verified-workspace.json" download>검수·평가 완료 작업 공간 JSON</a><a href="test-cases.json" download>원문·번역·정답·기대값 JSON</a><a href="clean.csv" download>정상·경계 CSV</a><a href="errors.csv" download>의도적 오류 CSV</a><a href="meaning.csv" download>의미 오류 CSV</a><a href="reverse.csv" download>한→영 CSV</a><a href="results.json" download>검증 결과 JSON</a></div></section>
  <section><h2>36문장 검사 결과</h2><div class="scroll"><table><thead><tr><th>ID</th><th>검증 항목</th><th>기대 규칙</th><th>실제 규칙</th><th>결과</th></tr></thead><tbody>${bodyRows}</tbody></table></div></section>
  <p class="fine">검증 생성 시각: ${escape(result.generatedAt)} · 자동 검사 ${counts.pass}개, 실패 ${counts.fail}개 · ${TEST_SET_ID}</p></main></body></html>`;
  fs.writeFileSync(path.join(out, 'report.html'), html);
  const md = `# Ian 테스트 검증 결과\n\n- 작성·번역·자체 검수: ChatGPT\n- 자동 검사: ${counts.pass}/${counts.tests} 통과\n- 코퍼스: 수정 전 32/36 → 수정 후 36/36 규칙 기대값 일치\n- 구성: 4문서, 36문단, A/B 평가 4개, 용어 4개\n- 수정: 음수 부호 탐지, 폭·정밀도 지정 printf 변수 탐지\n- 의미 오류 4건: 규칙으로 탐지되지 않음. 수동 이슈·수정안 등록 및 적용\n- 올바른 단위 환산 1건: 숫자 경고 발생, 의도된 차이로 무시\n- 저장 검증: 실제 앱 저장 어댑터 + fake-indexeddb 메모리 대역, 21개 시나리오\n- 실제 브라우저 UI 검증: 미수행(미리보기 인프라 불가)\n- A/B 후보는 모두 ChatGPT가 작성. 완료본 점수는 흐름 검증용 합성 값이며 독립 모델 비교가 아님.\n\n일반 회귀 테스트 세트는 데이터 관리에서 선택해 추가합니다. 기본으로 추가되는 웹소설·자막 예제와 구분됩니다. JSON 복원은 현재 작업 공간 전체를 교체합니다.\n\n상세 결과: frontend/public/validation/report.html, results.json\n원본 사례: frontend/src/lib/testCorpus.ts\n재현: frontend에서 npm test > ../docs/validation/test-run.log 2>&1 성공 후 npm run test:export\n`;
  fs.writeFileSync(path.join(records, 'REPORT_KO.md'), md);
  console.log(JSON.stringify({ exported: out, tests: counts, corpus: `${cases.length}/${cases.length}`, completedDocuments: state.translations.length, submittedEvaluations: state.evaluations.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
