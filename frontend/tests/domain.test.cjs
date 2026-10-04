const { test } = require('node:test'); const assert = require('node:assert/strict');
const { emptyWorkspace, emptyRatings, canFinalize, canSubmit, uid, now } = require('../src/lib/model.ts');
const { createDocument, editSegment, decideIssue, markReviewed, finalizeDocument, addManualIssue, saveEvaluation } = require('../src/lib/actions.ts');
const { analyzeDocument, inspectSegment } = require('../src/lib/rules.ts');
const { parseCSV, importPairs, splitText, makeCSV, csvCell, safeName, backupText } = require('../src/lib/files.ts');
const { parseBackup, validateWorkspace } = require('../src/lib/validation.ts');
const { loadExamples } = require('../src/lib/demo.ts');
const create = (source='Hello world.', target='안녕하세요.') => { const state=emptyWorkspace(); createDocument(state,{title:'검수 테스트',domain:'',sourceLang:'en',targetLang:'ko',pairs:[{source,target}]});return {state,doc:state.translations[0],seg:state.translations[0].segments[0]}; };
test('blank target creates a blocking missing-translation issue',()=>{const {doc}=create('Hello.',''); assert.equal(doc.issues[0].severity,'error'); assert.match(canFinalize(doc),/빈 번역문/);});
test('normal translation has no manufactured quality score or issue',()=>{assert.equal(create().doc.issues.length,0);});
test('numeric mismatch is a warning, not an automatic rewrite',()=>{const {doc}=create('Invite 10 people.','5명을 초대하세요.'); assert.equal(doc.issues[0].type,'숫자 확인'); assert.equal(doc.issues[0].suggestedTargetText,undefined);});
test('numeric thousands separators and fullwidth digits normalize',()=>{assert.equal(create('1,000 items, version ２.','1000개, 버전 2.').doc.issues.length,0);});
test('repeated numeric tokens are compared with multiplicity',()=>{assert.equal(create('10 and 10.','10과 11.').doc.issues[0].type,'숫자 확인');});
test('missing placeholder is an error',()=>{assert.equal(create('Hello {name}', '안녕하세요').doc.issues[0].type,'변수 확인');});
test('template and printf placeholders remain intact',()=>{const {doc}=create('Hello {{name}}, ${amount} %s', '안녕하세요 {{name}}, ${amount} %s');assert.equal(doc.issues.length,0);});
test('spaces provide a whole-segment correction',()=>{const {doc}=create('Hello.','  안녕  하세요. ');assert.equal(doc.issues[0].suggestedTargetText,'안녕 하세요.');});
test('glossary rules are scoped to the language pair',()=>{const {state,doc,seg}=create('Your workspace.','작업 공간.'); state.glossary.push({id:uid(),source:'workspace',target:'워크스페이스',sourceLang:'en',targetLang:'ko',severity:'warning'});analyzeDocument(doc,state.glossary);assert.equal(doc.issues[0].type,'용어 일관성');assert.equal(inspectSegment(seg,{sourceLang:'de',targetLang:'ko'},state.glossary).length,0);});
test('English glossary uses boundaries, Korean allows suffixes',()=>{const {state,doc,seg}=create('A workspace.','워크스페이스를 엽니다.');state.glossary.push({id:uid(),source:'work',target:'작업',sourceLang:'en',targetLang:'ko',severity:'warning'});assert.equal(inspectSegment(seg,doc,state.glossary).length,0);state.glossary[0].source='workspace';state.glossary[0].target='워크스페이스';assert.equal(inspectSegment(seg,doc,state.glossary).length,0);});
test('recheck preserves dismissal only for same revision',()=>{const {state,doc,seg}=create('10 items','5개');decideIssue(state,doc.id,doc.issues[0].id,'dismiss');analyzeDocument(doc,[]);assert.equal(doc.issues.filter(i=>i.status==='open').length,0);editSegment(state,doc.id,seg.id,1,'6개');assert.equal(doc.issues.filter(i=>i.status==='open').length,1);});
test('glossary severity changes produce a new issue',()=>{const {state,doc}=create('workspace','작업공간');state.glossary.push({id:uid(),source:'workspace',target:'워크스페이스',sourceLang:'en',targetLang:'ko',severity:'warning'});analyzeDocument(doc,state.glossary);state.glossary[0].severity='error';analyzeDocument(doc,state.glossary);assert.equal(doc.issues.find(i=>i.status==='open').severity,'error');});
test('segment edit increments revision, stores history, revokes reviewed',()=>{const {state,doc,seg}=create();markReviewed(state,doc.id,seg.id,true);editSegment(state,doc.id,seg.id,1,'반갑습니다.');assert.equal(seg.revision,2);assert.equal(seg.reviewed,false);assert.equal(seg.history[0].text,'안녕하세요.');});
test('unchanged save does not create extra revision',()=>{const {state,doc,seg}=create();editSegment(state,doc.id,seg.id,1,seg.targetText);assert.equal(seg.revision,1);assert.equal(seg.history.length,0);});
test('stale edit rejected without touching text',()=>{const {state,doc,seg}=create();assert.throws(()=>editSegment(state,doc.id,seg.id,9,'실패'),/버전/);assert.equal(seg.targetText,'안녕하세요.');});
test('stale manual suggestion cannot overwrite a newer revision',()=>{const {state,doc,seg}=create();addManualIssue(state,doc.id,seg.id,{type:'문체',severity:'warning',reason:'더 자연스럽게',suggestedTargetText:'제안'});const issue=doc.issues[0];editSegment(state,doc.id,seg.id,1,'새로운 수정');assert.throws(()=>decideIssue(state,doc.id,issue.id,'apply'),/이전 버전/);assert.equal(seg.targetText,'새로운 수정');});
test('applying suggestion closes obsolete checks and persists applied history',()=>{const {state,doc,seg}=create('Hello','안녕  하세요');const id=doc.issues[0].id;decideIssue(state,doc.id,id,'apply');assert.equal(seg.targetText,'안녕 하세요');assert.equal(doc.issues.find(i=>i.id===id).status,'applied');assert.equal(doc.issues.filter(i=>i.status==='open').length,0);});
test('finalization requires reviewed paragraphs and no open issues',()=>{const {state,doc,seg}=create();assert.throws(()=>finalizeDocument(state,doc.id),/모든 문단/);markReviewed(state,doc.id,seg.id,true);finalizeDocument(state,doc.id);assert.equal(doc.status,'FINALIZED');assert.throws(()=>editSegment(state,doc.id,seg.id,1,'x'),/완료된/);});
test('empty segment cannot be reviewed',()=>{const {state,doc,seg}=create('hi','');assert.throws(()=>markReviewed(state,doc.id,seg.id,true),/빈 번역문/);});
test('history is bounded to 30 previous versions',()=>{const {state,doc,seg}=create();for(let i=0;i<40;i++)editSegment(state,doc.id,seg.id,seg.revision,`번역 ${i}`);assert.equal(seg.history.length,30);assert.equal(seg.revision,41);});
test('CSV handles BOM, CRLF, quotes, commas and embedded newlines',()=>{const csv='\uFEFFsource,target\r\n"Hello, \"\"world\"\"","안녕\n세상"\r\n';const pairs=importPairs(csv);assert.deepEqual(pairs,[{source:'Hello, "world"',target:'안녕\n세상'}]);});
test('CSV rejects unclosed quotes and ragged rows',()=>{assert.throws(()=>parseCSV('"bad'),/큰따옴표/);assert.throws(()=>importPairs('source,target\nhello,world,extra'),/열 개수/);});
test('CSV requires headers and nonempty sources',()=>{assert.throws(()=>importPairs('hello,world'),/열 이름/);assert.throws(()=>importPairs('source,target\n,번역'),/원문/);});
test('CSV import accepts blank targets and reordered extra columns',()=>{assert.deepEqual(importPairs('id,target,source\nx,,Hi'),[{source:'Hi',target:''}]);});
test('CSV neutralizes formula-like cells including whitespace prefix',()=>{for(const s of ['=SUM(A1)','+10','-1','@test','  =bad','\tvalue'])assert.ok(csvCell(s).startsWith('"\''));assert.equal(csvCell('normal'),'"normal"');});
test('CSV quoting round trips ordinary punctuation',()=>{const raw=makeCSV([['source','target'],['one, two','say "hi"']]);assert.equal(importPairs(raw)[0].target,'say "hi"');});
test('paragraph and line splitting are explicit',()=>{assert.deepEqual(splitText('a\nb\n\nc','paragraph'),['a\nb','c']);assert.deepEqual(splitText('a\nb\n\nc','line'),['a','b','c']);});
test('filenames cannot inject paths or control characters',()=>{assert.equal(safeName('../a:b\\c?.txt'),'.._a_b_c_.txt');});
test('JSON backup round trip preserves exact data',()=>{const {state}=create('source',' =exact\n문장');assert.deepEqual(parseBackup(backupText(state)),state);});
test('bad JSON and unsupported versions fail before restore',()=>{assert.throws(()=>parseBackup('{bad'),/JSON/);assert.throws(()=>parseBackup('{"version":99,"format":"ian-review-workspace"}'),/지원하지/);});
test('schema catches duplicate IDs and broken segment references',()=>{const {state,doc}=create();state.translations.push(structuredClone(doc));assert.throws(()=>validateWorkspace(state),/중복 ID/);state.translations.pop();doc.issues.push({id:uid(),segmentId:'missing'});assert.throws(()=>validateWorkspace(state),/segmentId/);});
test('schema rejects invalid dates and finalized-but-unreviewed data',()=>{const {state,doc}=create();doc.createdAt='bad';assert.throws(()=>validateWorkspace(state),/createdAt/);doc.createdAt=now();doc.status='FINALIZED';assert.throws(()=>validateWorkspace(state),/완료 문서/);});
test('evaluation requires all six ratings and an explicit preference',()=>{const e={ratings:[emptyRatings(),emptyRatings()],preference:''};assert.match(canSubmit(e),/6개/);e.ratings=[{accuracy:5,fluency:4,terminology:5},{accuracy:3,fluency:4,terminology:3}];assert.match(canSubmit(e),/선호도/);e.preference='tie';assert.equal(canSubmit(e),null);});
test('submitted evaluation is immutable',()=>{const state=emptyWorkspace();const id=uid();state.evaluations.push({id,title:'test',sourceText:'source',sourceLang:'en',targetLang:'ko',candidates:[{label:'a',text:'a'},{label:'b',text:'b'}],ratings:[emptyRatings(),emptyRatings()],preference:'',comment:'',reviewer:'',status:'DRAFT',createdAt:now(),updatedAt:now()});const patch={ratings:[{accuracy:4,fluency:4,terminology:4},{accuracy:3,fluency:3,terminology:3}],preference:'A',comment:'A 선호',reviewer:'테스터'};saveEvaluation(state,id,patch,true);assert.equal(state.evaluations[0].status,'SUBMITTED');assert.throws(()=>saveEvaluation(state,id,patch,false),/이미 제출/);validateWorkspace(state);});
test('examples are explicit, labeled, valid and cannot duplicate',()=>{const state=emptyWorkspace();loadExamples(state);assert.equal(state.translations.length,3);assert.ok(state.translations.every(d=>d.isDemo));assert.equal(state.evaluations.length,1);validateWorkspace(state);assert.throws(()=>loadExamples(state),/이미 등록/);});


test('English written cardinals and translated digits compare without a false warning', () => {
 for (const [source, target] of [['sealed for ten years.', '10년간 봉인되었다.'], ['twenty-one keys.', '열쇠 21개.'], ['two hundred and thirty keys.', '열쇠 230개.'], ['two thousand one hundred keys.', '열쇠 2100개.']]) assert.equal(create(source, target).doc.issues.some(issue => issue.type === '숫자 확인'), false, source)
})
test('written numeral mismatches remain warnings', () => { assert.equal(create('sealed for ten years.', '11년간 봉인되었다.').doc.issues.some(issue => issue.type === '숫자 확인'), true) })
test('written numeric tokens retain multiplicity', () => { assert.equal(create('ten keys and ten books.', '열쇠 10개와 책 11권.').doc.issues.some(issue => issue.type === '숫자 확인'), true) })
test('an English indefinite one does not invent a digit in prose', () => { assert.equal(create('One should wait.', '기다려야 한다.').doc.issues.some(issue => issue.type === '숫자 확인'), false) })
test('native Korean quantities compare with English cardinals and digits', () => {
  for (const [source,target] of [['something knocked three times.','무언가 세 번 노크했다.'],['he knocked twice, once with each hand.','그는 두 번 노크했다. 손마다 한 번씩.'],['two iron keys.','철제 열쇠 두 개.'],['twelve years.','열두 해.'],['twenty-one people.','스물한 명.'],['20 books.','스무 권.'],['3 times and 3 keys.','세번과 세개.']]) assert.equal(create(source,target).doc.issues.some(issue=>issue.type==='숫자 확인'),false,source)
})
test('native Korean numeric mismatches and missing duplicates still warn', () => {
  for (const [source,target] of [['three times.','두 번.'],['3 keys and 3 books.','열쇠 세 개와 책 두 권.'],['3 keys and 3 books.','열쇠 세 개.']]) assert.equal(create(source,target).doc.issues.some(issue=>issue.type==='숫자 확인'),true,source)
})
test('Korean numeral-like syllables inside words do not invent quantities', () => {
  assert.equal(create('A customs officer wore a square badge in winter.','세관 직원은 한겨울에 네모난 배지를 달았다.').doc.issues.some(issue=>issue.type==='숫자 확인'),false)
  assert.equal(create('He followed your order in the tropics.','그는 열대 지역에서 네 명령을 따랐다.').doc.issues.some(issue=>issue.type==='숫자 확인'),false)
  assert.equal(create('The third key opened the second lock.','세 번째 열쇠로 두 번째 자물쇠를 열었다.').doc.issues.some(issue=>issue.type==='숫자 확인'),false)
})
test('native Korean quantities work when Korean is the source language', () => {
  const {seg}=create('두 개의 열쇠가 있다.','There are two keys.')
  assert.equal(inspectSegment(seg,{sourceLang:'ko',targetLang:'en'},[]).some(issue=>issue.type==='숫자 확인'),false)
})
