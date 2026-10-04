const {test}=require('node:test');const assert=require('node:assert/strict');
const {emptyWorkspace,uid}=require('../src/lib/model.ts');
const {validateWorkspace}=require('../src/lib/validation.ts');
const {createDocument}=require('../src/lib/actions.ts');
const {saveAIConfig,projectAIConfig,setAPIKey,getAPIKey,prepareAIBatch,parseAIBatchResult,applyAIBatch,startAITranslation,processAITranslation,approveAITerm,resolveAITermSuggestion}=require('../src/lib/aiTranslation.ts');
const {backupText}=require('../src/lib/files.ts');
const {applyTerminologyPatches,parseTranslationResult}=require('../src/lib/translationFlow.ts');
const {terminologyPatches}=require('../src/lib/terminology.ts');
const workerModule=import('../../worker/index.mjs');
function sample({secondLength=2200}={}){
 const state=emptyWorkspace();state.glossary.push({id:uid(),source:'Serin',target:'세린',sourceLang:'en',targetLang:'ko',severity:'warning',project:'별빛 서약',category:'character',variants:['셀린'],note:'기사단장'});
 const id=createDocument(state,{title:'01화',domain:'별빛 서약',sourceLang:'en',targetLang:'ko',contentType:'novel',pairs:[{source:'Serin arrived at Moonspire.',target:''},{source:'Serin returned to Moonspire from Silver Harbor. '+'The lamps were lit. '.repeat(Math.ceil(secondLength/20)),target:''}]});
 saveAIConfig(state,{project:'별빛 서약',provider:'openrouter',model:'example/model',instructions:'고풍스러운 어조',batchChars:2000});return{state,id};
}
function responseFor(batch,{badEvidence=false}={}){
 const segments=batch.segments.map(s=>({id:s.id,target:s.source.includes('Moonspire')?'셀린은 월광첨탑에 도착했다.':'셀린은 은빛 항구에서 돌아왔다.'}));
 const terms=[];for(const s of batch.segments){if(s.source.includes('Moonspire'))terms.push({source:'Moonspire',target:'월광첨탑',category:'place',aliases:[],note:'기사단이 지키는 탑.',evidence:{segmentId:s.id,quote:badEvidence?'Moon' : 'Moonspire'}});if(s.source.includes('Silver Harbor'))terms.push({source:'Silver Harbor',target:'은빛 항구',category:'place',aliases:[],note:'항구 이름.',evidence:{segmentId:s.id,quote:'Silver Harbor'}})}
 return JSON.stringify({segments,terms});
}
test('model settings are per project and API keys never enter workspace or backups',()=>{
 const {state}=sample();const secret='sk-test-secret-not-for-storage';setAPIKey('openrouter',secret);assert.equal(getAPIKey('openrouter'),secret);
 assert.equal(projectAIConfig(state,'별빛 서약').model,'example/model');assert.equal(projectAIConfig(state,'다른 작품'),undefined);
 assert.equal(backupText(state).includes(secret),false);assert.equal(JSON.stringify(state).includes('apiKey'),false);
 assert.throws(()=>saveAIConfig(state,{project:'별빛 서약',provider:'openrouter',model:' x',instructions:'',batchChars:4000,apiKey:secret}),/모델 ID/);assert.equal(JSON.stringify(validateWorkspace(state)).includes(secret),false);setAPIKey('openrouter','');
});
test('local model settings survive workspace validation without a key',()=>{
 const {state}=sample();saveAIConfig(state,{project:'별빛 서약',provider:'local',model:'qwen3:8b',instructions:'문체 유지',batchChars:2000});
 const restored=validateWorkspace(state);assert.equal(projectAIConfig(restored,'별빛 서약').provider,'local');assert.equal(projectAIConfig(restored,'별빛 서약').model,'qwen3:8b');
 assert.equal(backupText(restored).includes('apiKey'),false);
});
test('model response terms have exact source evidence and invalid suggestions fail closed',()=>{
 const {state,id}=sample(),doc=state.translations.find(d=>d.id===id);startAITranslation(state,id,'empty');const batch=prepareAIBatch(state,id);
 assert.throws(()=>parseAIBatchResult(responseFor(batch,{badEvidence:true}),batch),/원문에서 확인/);
 assert.equal(doc.aiRun.completed,0);assert.equal(doc.aiRun.pendingIds.length,2);
});
test('translation saves before the next batch and newly extracted canon becomes next-batch context',async()=>{
 let {state,id}=sample();startAITranslation(state,id,'empty');let calls=0;
 const commit=async recipe=>{const draft=structuredClone(state);recipe(draft);state=validateWorkspace(draft);return true};
 await processAITranslation({docId:id,read:()=>state,commit,apiKey:'sk-test-translation-key',signal:new AbortController().signal,transport:async batch=>{calls++;if(calls===2)assert.match(batch.prompt,/월광첨탑/);return responseFor(batch)}});
 const doc=state.translations.find(d=>d.id===id);assert.equal(calls,2);assert.equal(doc.aiRun.status,'completed');assert.equal(doc.aiRun.completed,2);assert.equal(doc.segments[0].targetText,'세린은 월광첨탑에 도착했다.');assert.equal(doc.segments[1].targetText,'세린은 월광첨탑에 도착했다.');
 const extracted=state.glossary.find(t=>t.source==='Moonspire');assert.equal(extracted.project,'별빛 서약');assert.equal(extracted.reviewStatus,'approved');assert.equal(extracted.target,'월광첨탑');assert.equal(state.glossary.some(t=>t.source==='Silver Harbor'),true);assert.equal(backupText(state).includes('sk-test-translation-key'),false);
});
test('request cancellation pauses with the unsent segments saved for resume',async()=>{
 let {state,id}=sample();startAITranslation(state,id,'empty');const controller=new AbortController();let calls=0;
 const commit=async recipe=>{const draft=structuredClone(state);recipe(draft);state=validateWorkspace(draft);return true};
 await processAITranslation({docId:id,read:()=>state,commit,apiKey:'sk-test-key',signal:controller.signal,transport:async batch=>{calls++;controller.abort();return responseFor(batch)}});
 const doc=state.translations.find(d=>d.id===id);assert.equal(doc.aiRun.status,'paused');assert.equal(doc.aiRun.completed,0);assert.equal(doc.aiRun.pendingIds.length,2);assert.equal(calls,1);
});
test('edited glossary or source rejects a stale batch without writing translated text',()=>{
 const {state,id}=sample();startAITranslation(state,id,'empty');const batch=prepareAIBatch(state,id);const text=responseFor(batch);state.glossary[0].target='다른 번역';const doc=state.translations.find(d=>d.id===id);
 assert.throws(()=>applyAIBatch(state,batch,text),/용어집이 바뀌었습니다/);assert.equal(doc.segments[0].targetText,'');
});
test('verified terms keep canon and resolve conflicting spellings automatically',()=>{
 const {state,id}=sample();startAITranslation(state,id,'empty');const batch=prepareAIBatch(state,id);const payload=JSON.parse(responseFor(batch));payload.segments[0].target='셀린은 월광첨탑에 도착했다.';payload.terms.push({source:'Serin',target:'세린느',category:'character',aliases:[],note:'새 문맥',evidence:{segmentId:batch.segments[0].id,quote:'Serin'}});applyAIBatch(state,batch,JSON.stringify(payload));
 const known=state.glossary.find(t=>t.source==='Serin');assert.equal(state.termSuggestions.length,1);assert.equal(state.termSuggestions[0].status,'dismissed');assert.equal(state.translations.find(d=>d.id===id).segments[0].targetText,'세린은 월광첨탑에 도착했다.');known.reviewStatus='draft';approveAITerm(state,known.id);assert.equal(known.reviewStatus,'approved');
 assert(known.variants.includes('세린느'));assert.equal(state.termSuggestions[0].status,'dismissed');assert.equal(known.target,'세린');
 const next={...structuredClone(state.termSuggestions[0]),id:uid(),target:'세리나',status:'pending'};state.termSuggestions.push(next);resolveAITermSuggestion(state,next.id,true);assert.equal(state.glossary.find(t=>t.id===known.id).target,'세리나');assert(state.glossary.find(t=>t.id===known.id).variants.includes('세린'));validateWorkspace(state);
});
test('all supported providers use pinned endpoints and never place the key in request bodies',async()=>{const {providerRequest}=await workerModule;
 const providers={openai:'https://api.openai.com/v1/chat/completions',gemini:'https://generativelanguage.googleapis.com/v1beta/models/example-model:generateContent',anthropic:'https://api.anthropic.com/v1/messages',deepseek:'https://api.deepseek.com/chat/completions',openrouter:'https://openrouter.ai/api/v1/chat/completions'};
 for(const [provider,url] of Object.entries(providers)){const req=providerRequest({provider,model:provider==='openrouter'?'vendor/model':'example-model',apiKey:'sk-test-provider-secret',system:'Translate to JSON.',prompt:'source sentence'});assert.equal(req.url,url);assert.equal(JSON.stringify(req.body).includes('sk-test-provider-secret'),false);assert.equal(JSON.stringify(req.headers).includes('sk-test-provider-secret'),true);if(provider==='deepseek'){assert.equal(req.body.max_tokens,16384);assert.equal(req.body.max_completion_tokens,undefined)}if(provider==='openai')assert.equal(req.body.max_completion_tokens,16384)}
 assert.throws(()=>providerRequest({provider:'custom',model:'x',apiKey:'sk-test-1234',system:'x',prompt:'x'}),/제공사/);
});
test('provider response parsers reject truncation and recognize completed generations',async()=>{const {providerText}=await workerModule;
 assert.equal(providerText('openai',{choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}),'{"ok":true}');
 assert.equal(providerText('gemini',{candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}),'{}');
 assert.equal(providerText('anthropic',{stop_reason:'end_turn',content:[{type:'text',text:'{}'}]}),'{}');
 assert.throws(()=>providerText('deepseek',{choices:[{finish_reason:'length',message:{content:'{'}}]}),/완결/);
});
test('model catalogs are provider-scoped, text-capable, sanitized, and use pinned model endpoints',async()=>{const {modelListRequest,supportedModels}=await workerModule;
 const endpoints={openai:'https://api.openai.com/v1/models',gemini:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',anthropic:'https://api.anthropic.com/v1/models?limit=1000',deepseek:'https://api.deepseek.com/models',openrouter:'https://openrouter.ai/api/v1/models'};
 for(const [provider,url] of Object.entries(endpoints)){const req=modelListRequest(provider,'sk-test-model-list-key');assert.equal(req.url,url);assert.equal(JSON.stringify(req.headers).includes('sk-test-model-list-key'),true)}
 assert.deepEqual(supportedModels('gemini',{models:[{name:'models/gemini-flash',displayName:'Gemini Flash',supportedGenerationMethods:['generateContent']},{name:'models/embedding-1',supportedGenerationMethods:['embedContent']}]}),[{id:'gemini-flash',label:'Gemini Flash'}]);
 assert.deepEqual(supportedModels('openai',{data:[{id:'gpt-5',name:'GPT 5'},{id:'text-embedding-3-large',name:'embedding'},{id:'gpt-audio',name:'audio'}]}),[{id:'gpt-5',label:'GPT 5'}]);
 assert.deepEqual(supportedModels('openrouter',{data:[{id:'vendor/text-model',name:'Text model',architecture:{output_modalities:['text']}},{id:'vendor/image-model',architecture:{output_modalities:['image']}}]}),[{id:'vendor/text-model',label:'Text model'}]);
 assert.throws(()=>modelListRequest('https://attacker.test','sk-test-model-list-key'),/제공사/);
});
test('same-origin model list and connection checks return no credentials or upstream error text',async()=>{const {createWorker}=await workerModule;let urls=[];
 const worker=createWorker({},async(url,init)=>{urls.push(url);if(url.endsWith('/models'))return Response.json({data:[{id:'gpt-5',name:'GPT 5'},{id:'text-embedding-3-large'}]});return Response.json({choices:[{finish_reason:'stop',message:{content:'{"status":"PONG"}'}}]});});
 const headers={Origin:'https://site.test','Content-Type':'application/json','X-Ian-Request':'model'};
 const models=await worker.fetch(new Request('https://site.test/api/models',{method:'POST',headers,body:JSON.stringify({provider:'openai',apiKey:'sk-test-secret-models'})}));assert.equal(models.status,200);assert.deepEqual((await models.json()).models,[{id:'gpt-5',label:'GPT 5'}]);
 const tested=await worker.fetch(new Request('https://site.test/api/model/test',{method:'POST',headers,body:JSON.stringify({provider:'openai',model:'gpt-5',apiKey:'sk-test-secret-models'})}));assert.equal(tested.status,200);assert.deepEqual(await tested.json(),{ok:true});assert.equal(urls.length,2);assert.equal(urls[0],'https://api.openai.com/v1/models');
 const denied=await worker.fetch(new Request('https://site.test/api/models',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify({provider:'openai',apiKey:'sk-test-secret-models'})}));assert.equal(denied.status,403);assert.equal(urls.length,2);
});
test('worker serves app assets, blocks cross-origin key relay, and keeps provider errors generic',async()=>{const {createWorker}=await workerModule;
 let called=0;const worker=createWorker({'/index.html':{type:'text/html',text:'<main>Ian</main>'},'/models':{type:'text/html',text:'<main>models</main>'}},async()=>{called++;return Response.json({error:'UPSTREAM secret and original source phrase'},{status:401})});
 assert.equal((await worker.fetch(new Request('https://site.test/'))).status,200);assert.equal((await worker.fetch(new Request('https://site.test/models'))).status,200);assert.equal((await worker.fetch(new Request('https://site.test/home'))).status,200);assert.equal((await worker.fetch(new Request('https://site.test/evaluation/one'))).status,200);
 for(const route of ['/projects/QA.v1','/projects/%EB%B3%84%EB%B9%9B%20%EC%84%9C%EC%95%BD/documents/new','/projects/QA.v1/glossary','/projects/QA.v1/evaluation/one'])assert.equal((await worker.fetch(new Request('https://site.test'+route))).status,200,route);
 assert.equal((await worker.fetch(new Request('https://site.test/not-a-route'))).status,404);assert.equal((await worker.fetch(new Request('https://site.test/projects/QA.v1/source.js'))).status,404);
 const bad=await worker.fetch(new Request('https://site.test/api/model',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json','X-Ian-Request':'model'},body:'{}'}));assert.equal(bad.status,403);assert.equal(called,0);
 const denied=await worker.fetch(new Request('https://site.test/api/model',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json','X-Ian-Request':'model'},body:JSON.stringify({provider:'openai',model:'model-id',apiKey:'sk-test-provider-secret',system:'Translate.',prompt:'sensitive source sentence'})}));const error=await denied.json();assert.equal(denied.status,401);assert.equal(error.error.includes('secret'),false);assert.equal(error.error.includes('sensitive'),false);
});
test('worker serves self-hosted font bytes without UTF-8 corruption',async()=>{const {createWorker}=await workerModule;
 const bytes=Buffer.from([0x77,0x4f,0x46,0x32,0x00,0xff,0x81]);const worker=createWorker({'/fonts/PretendardVariable.woff2':{type:'font/woff2',base64:bytes.toString('base64')}});
 const response=await worker.fetch(new Request('https://site.test/fonts/PretendardVariable.woff2'));
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'font/woff2');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
test('fake upstream checks API errors and provider timeout without persisting credentials',async()=>{const {callProvider}=await workerModule;
 await assert.rejects(callProvider({provider:'openai',model:'model-id',apiKey:'sk-test-provider-secret',system:'Translate.',prompt:'sentence'},async()=>Response.json({error:'sk-test-provider-secret sentence'},{status:429})),/한도/);
 await assert.rejects(callProvider({provider:'openai',model:'model-id',apiKey:'sk-test-provider-secret',system:'Translate.',prompt:'sentence'},async(_url,options)=>{assert.equal(options.redirect,'error');throw new Error('socket secret');}),/연결하지 못했습니다/);
});
