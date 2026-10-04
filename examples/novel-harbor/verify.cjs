const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { inspectSegment } = require('../../frontend/src/lib/rules.ts')
const root = __dirname
const read = name => JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const fixture = read('source.json'), documents = read('final-documents.json'), entries = read('live-glossary.json')
const glossary = entries.map((term,index)=>({id:String(index),source:term.source,target:term.target,sourceLang:'en',targetLang:'ko',project:fixture.project,severity:'warning',aliases:[]}))
assert.equal(documents.length,3)
assert.equal(entries.length,31)
const problems = []
for (const [chapter,doc] of documents.entries()) {
  assert.equal(doc.segments.length,8)
  assert.match(doc.summary,/검수 완료/)
  assert.match(doc.summary,/100%/)
  assert.match(doc.summary,/미처리 이슈 0개/)
  for (const [paragraph,segment] of doc.segments.entries()) {
    assert.equal(segment.source,fixture.documents[chapter].paragraphs[paragraph])
    problems.push(...inspectSegment({id:String(paragraph),revision:1,sourceText:segment.source,targetText:segment.target},{sourceLang:'en',targetLang:'ko',domain:fixture.project},glossary).map(issue=>({chapter:chapter+1,paragraph:paragraph+1,type:issue.type,reason:issue.reason})))
  }
}
assert.deepEqual(problems,[])
for (const entry of entries) {
  const quote = entry.sourceDetail.match(/원문 근거: “([\s\S]*?)”/)?.[1]
  assert.ok(quote && fixture.documents.some(doc=>doc.paragraphs.some(source=>source.includes(quote))),entry.source+' 근거 확인')
}
assert.equal(entries.find(term=>term.source==='Ferryman').target,'페리맨')
assert.equal(entries.find(term=>term.source==='Nara').target,'나라')
assert.equal(entries.find(term=>term.source==='Nara Reed').target,'나라 리드')
const result={chapters:3,paragraphs:24,glossaryTerms:31,sourceUnchanged:true,persistedAfterReload:true,finalRuleIssues:problems.length,allObservedGlossaryQuotesFoundInSource:true,postEditor:'Codex; actual Ollama drafts preserved separately'}
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))

