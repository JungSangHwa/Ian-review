// Reproduce the story workflow through the production storage adapter.
require('fake-indexeddb/auto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { initializeWorkspace, loadWorkspace, commitWorkspace } = require('../src/lib/database.ts');
const { terminologyPatches, isTerminologyIssue } = require('../src/lib/terminology.ts');
const { applyTerminologyPatches, translationPrompt } = require('../src/lib/translationFlow.ts');
const { parseSubtitles, serializeSubtitles } = require('../src/lib/subtitles.ts');
const { SUBTITLE_SOURCE, DEMO_WORK } = require('../src/lib/literaryDemo.ts');
const { makeCSV, backupText } = require('../src/lib/files.ts');
const out = path.resolve(__dirname, '../public/examples');
const records = path.resolve(__dirname, '../../docs/validation');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const termIssues = doc => doc.issues.filter(i => i.status === 'open' && isTerminologyIssue(i)).length;
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const log = fs.readFileSync(path.join(records, 'test-run.log'), 'utf8');
  const tests = Object.fromEntries(['tests', 'pass', 'fail'].map(key => [key, Number(log.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1])]));
  assert.ok(tests.tests > 0 && tests.pass === tests.tests && tests.fail === 0);
  const { state: before } = await initializeWorkspace();
  assert.equal(before.translations.length, 3);
  assert.equal(before.glossary.length, 8);
  assert.deepEqual(await loadWorkspace(), before);
  const plans = before.translations.map(d => ({ id: d.id, patches: terminologyPatches(d, before.glossary) }));
  const after = await commitWorkspace(before.revision, draft => {
    for (const p of plans) applyTerminologyPatches(draft, p.id, p.patches);
  });
  assert.deepEqual(await loadWorkspace(), after);
  const rows = before.translations.flatMap(doc => {
    const revised = after.translations.find(d => d.id === doc.id);
    assert.equal(termIssues(revised), 0);
    return doc.segments.map((s, index) => {
      const next = revised.segments[index];
      assert.equal(next.sourceText, s.sourceText);
      assert.equal(next.originalTargetText, s.originalTargetText);
      assert.deepEqual(next.cue, s.cue);
      return { document: doc.title, segment: index + 1, source: s.sourceText, before: s.targetText, after: next.targetText, changed: s.targetText !== next.targetText, timing: s.cue?.timing };
    });
  });
  assert.equal(rows.length, 20);
  assert.equal(rows.filter(r => r.changed).length, 18);
  const subBefore = before.translations.find(d => d.subtitle);
  const subAfter = after.translations.find(d => d.subtitle);
  const exported = serializeSubtitles(subAfter);
  assert.deepEqual(parseSubtitles(exported, 'srt').pairs.map(p => p.cue), subBefore.segments.map(s => s.cue));
  const put = (name, text) => fs.writeFileSync(path.join(out, name), text);
  put('subtitle-source.srt', SUBTITLE_SOURCE);
  put('subtitle-before.srt', serializeSubtitles(subBefore));
  put('subtitle-after.srt', exported);
  put('novel-before.csv', makeCSV([['source', 'target'], ...before.translations.filter(d => !d.subtitle).flatMap(d => d.segments.map(s => [s.sourceText, s.targetText]))]));
  put('story-glossary.csv', makeCSV([['source','target','project','source_language','target_language','category','aliases','variants','note','severity'], ...before.glossary.map(t => [t.source,t.target,t.project,t.sourceLang,t.targetLang,t.category,(t.aliases??[]).join('|'),(t.variants??[]).join('|'),t.note,t.severity])]));
  put('workspace-before.json', backupText(before));
  put('workspace-after.json', backupText(after));
  put('translation-request.txt', translationPrompt(before.translations[0], before.glossary));
  const result = { generatedAt: new Date().toISOString(), work: DEMO_WORK, author: 'ChatGPT', automatedTests: tests, documents: 3, segments: rows.length, glossary: 8, correctedSegments: rows.filter(r => r.changed).length, terminologyIssuesBefore: before.translations.reduce((n,d) => n + termIssues(d), 0), terminologyIssuesAfter: 0, sourceAndTimingPreserved: true, storage: 'Production adapter with fake-indexeddb; not a real browser', browserUi: 'Unavailable: supervised preview infrastructure', model: 'Authored synthetic translations; no external translation model API', rows };
  const json = JSON.stringify(result, null, 2) + '\n';
  put('results.json', json);
  fs.writeFileSync(path.join(records, 'literary-results.json'), json);
  const table = rows.map(r => `<tr><td>${escape(r.document)}<br>구간 ${r.segment}${r.timing ? '<br>' + escape(r.timing) : ''}</td><td>${escape(r.source)}</td><td>${escape(r.before)}</td><td>${escape(r.after)}</td><td>${r.changed ? '표기 통일' : '유지'}</td></tr>`).join('');
  put('report.html', `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>별빛 서약 · 용어집 적용 검증</title><link rel="icon" href="/favicon.svg"><style>@font-face{font-family:Pretendard;src:url('/fonts/PretendardVariable.woff2') format('woff2');font-style:normal;font-weight:45 920;font-display:swap}body{margin:0;background:#f5f5fa;color:#27213e;font:16px/1.7 Pretendard,sans-serif}main{max-width:1180px;margin:auto;padding:32px 24px}h1{line-height:1.3}section{background:white;border:1px solid #dedbe9;border-radius:14px;padding:24px;margin:24px 0}a{color:#684fb0}nav{display:flex;gap:20px;flex-wrap:wrap}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:900px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #dedbe9;font-size:14px;white-space:pre-line}th{background:#f0edf8}.stats{font-size:20px;font-weight:650}.note{color:#625974}</style></head><body><main><a href="/">← 작품 작업 공간</a><h1>같은 인물, 같은 세계, 같은 번역.</h1><p>웹소설 2회차와 자막 8구간에 작품 용어집을 적용한 검증 결과입니다. 원문과 번역 초안은 모두 ChatGPT가 작성했으며, 서로 다른 표기를 의도적으로 넣었습니다.</p><section><h2>검증 결과</h2><p class="stats">${tests.pass}/${tests.tests} 자동 검사 통과 · 20구간 중 18구간 표기 통일</p><p>작품 용어 8개로 인물명·지명·호칭·설정어·반복 표현을 검사했습니다. 미처리 용어 이슈는 ${result.terminologyIssuesBefore}건에서 0건이 되었고, 원문과 자막 시간은 유지됐습니다. 수정 후 실제 앱 저장 함수로 저장하고 다시 읽어 같은 결과임을 확인했습니다.</p><p class="note">이는 선언한 용어 표기 규칙의 검증이며 번역 정확도나 모델 성능 점수가 아닙니다. 이 예제는 작성된 번역 초안에 작품 용어집을 적용한 기록입니다. 현재 로컬 실행판의 모델 번역은 Ollama를 사용하며 이 예제 결과에 실제 Ollama 호출은 포함되지 않습니다. 예제 저장 검증에는 Node.js의 메모리 IndexedDB 대역을 사용했습니다. 현재 UI의 브라우저 회귀 결과는 docs/TEST_REPORT.md에서 별도로 확인하세요.</p></section><section><h2>직접 넣어 볼 파일</h2><nav><a href="novel-before.csv" download>웹소설 초안 CSV</a><a href="story-glossary.csv" download>작품 용어집 CSV</a><a href="subtitle-source.srt" download>원문 자막</a><a href="subtitle-before.srt" download>번역 자막 · 수정 전</a><a href="subtitle-after.srt" download>번역 자막 · 표기 통일 후</a><a href="results.json" download>검증 결과 JSON</a></nav><p>작품 이름을 ‘별빛 서약’으로 지정하고 파일을 가져오면 같은 용어집이 적용됩니다. 앱의 기본 예제도 바로 사용할 수 있습니다.</p><details><summary>전체 작업 공간 예제</summary><p>아래 백업을 복원하면 현재 작업 공간 전체가 교체됩니다. 기존 작업을 먼저 백업하세요.</p><nav><a href="workspace-before.json" download>수정 전 백업</a><a href="workspace-after.json" download>수정 후 백업</a></nav></details></section><section><h2>20구간의 수정 전후</h2><div class="scroll"><table><thead><tr><th>회차·구간</th><th>원문</th><th>번역 초안</th><th>용어집 적용 후</th><th>처리</th></tr></thead><tbody>${table}</tbody></table></div></section><p class="note">생성 시각: ${escape(result.generatedAt)}</p></main></body></html>`);
  console.log(JSON.stringify({ exported: out, tests, segments: rows.length, corrected: 18, terminologyIssuesBefore: result.terminologyIssuesBefore, terminologyIssuesAfter: 0, sourceAndTimingPreserved: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
