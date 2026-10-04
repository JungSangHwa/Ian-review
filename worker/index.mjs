// Per-request BYOK gateway. No credential persistence, upstream body logging or arbitrary URLs.
const PROVIDERS = ['gemini','anthropic','deepseek','openrouter','openai'];
export class GatewayError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function providerRequest(input) {
  if(!input||typeof input!=='object'||!PROVIDERS.includes(input.provider))throw new GatewayError('지원하는 모델 제공사를 선택해 주세요.');
  const {provider,model,apiKey,system,prompt}=input;
  if(typeof model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]{0,199}$/.test(model))throw new GatewayError('모델 ID가 올바르지 않습니다.');
  if(typeof apiKey!=='string'||apiKey.length<8||apiKey.length>1024||/[^\x21-\x7e]/.test(apiKey))throw new GatewayError('API 키를 확인해 주세요.');
  if(typeof system!=='string'||!system||system.length>10000||typeof prompt!=='string'||!prompt||prompt.length>150000)throw new GatewayError('번역 요청 크기가 올바르지 않습니다.');
  const headers={'Content-Type':'application/json'};
  if(provider==='gemini')return {url:`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,headers:{...headers,'x-goog-api-key':apiKey},body:{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:16384}}};
  if(provider==='anthropic')return {url:'https://api.anthropic.com/v1/messages',headers:{...headers,'x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:{model,max_tokens:16384,system,messages:[{role:'user',content:prompt}]}};
  return {url:provider==='deepseek'?'https://api.deepseek.com/chat/completions':provider==='openai'?'https://api.openai.com/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions',headers:{...headers,Authorization:`Bearer ${apiKey}`},body:{model,messages:[{role:'system',content:system},{role:'user',content:prompt}],stream:false,...(provider==='deepseek'?{max_tokens:16384,response_format:{type:'json_object'}}:provider==='openai'?{max_completion_tokens:16384,response_format:{type:'json_object'}}:{max_completion_tokens:16384})}};
}
export function modelListRequest(provider,apiKey){
  if(!PROVIDERS.includes(provider))throw new GatewayError('지원하는 모델 제공사를 선택해 주세요.');
  if(typeof apiKey!=='string'||apiKey.length<8||apiKey.length>1024||/[^\x21-\x7e]/.test(apiKey))throw new GatewayError('API 키를 확인해 주세요.');
  const headers={Accept:'application/json'};
  if(provider==='gemini')return {url:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',headers:{...headers,'x-goog-api-key':apiKey}};
  if(provider==='anthropic')return {url:'https://api.anthropic.com/v1/models?limit=1000',headers:{...headers,'x-api-key':apiKey,'anthropic-version':'2023-06-01'}};
  return {url:provider==='deepseek'?'https://api.deepseek.com/models':provider==='openrouter'?'https://openrouter.ai/api/v1/models':'https://api.openai.com/v1/models',headers:{...headers,Authorization:`Bearer ${apiKey}`}};
}
export function supportedModels(provider,data){
  let rows=[];
  if(provider==='gemini')rows=(data?.models??[]).filter(m=>(m.supportedGenerationMethods??[]).includes('generateContent')).map(m=>({id:(m.name??'').replace(/^models\//,''),label:m.displayName??m.name}));
  else rows=(data?.data??[]).map(m=>({id:m.id,label:m.name??m.id,modalities:m.architecture?.output_modalities,params:m.supported_parameters}));
  rows=rows.filter(m=>typeof m.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]{0,199}$/.test(m.id));
  if(provider==='openai')rows=rows.filter(m=>/^(gpt-|o1(?:-|$)|o3(?:-|$)|o4(?:-|$))/.test(m.id)&&!/(realtime|audio|search|transcri|speech|tts|embed|moderation|image|deep-research)/i.test(m.id));
  if(provider==='openrouter')rows=rows.filter(m=>!Array.isArray(m.modalities)||m.modalities.includes('text'));
  if(provider==='deepseek')rows=rows.filter(m=>/deepseek/i.test(m.id));
  return [...new Map(rows.map(m=>[m.id,{id:m.id,label:String(m.label).slice(0,200)}])).values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,300);
}
export function providerText(provider,data) {
  let text, complete;
  if(provider==='gemini') { const candidate=data?.candidates?.[0];complete=candidate?.finishReason==='STOP';text=candidate?.content?.parts?.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join(''); }
  else if(provider==='anthropic') {complete=data?.stop_reason==='end_turn';text=data?.content?.filter(p=>p.type==='text').map(p=>p.text).join('');}
  else {const choice=data?.choices?.[0];complete=choice?.finish_reason==='stop';text=choice?.message?.content;}
  if(!complete)throw new GatewayError('모델 응답이 완결되지 않았습니다. 요청 크기를 줄이거나 다른 모델로 다시 시도하세요.',502);
  if(typeof text!=='string'||!text.trim()||text.length>200000)throw new GatewayError('모델이 읽을 수 있는 번역 결과를 반환하지 않았습니다.',502);
  return text;
}
export async function readLimited(stream,maxBytes) {
  if(!stream)throw new GatewayError('요청 내용이 없습니다.');
  const reader=stream.getReader(),chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new GatewayError('요청 또는 응답이 너무 큽니다.',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}
export async function callProvider(input,fetcher=fetch,signal) {
  const request=providerRequest(input),controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  const timer=setTimeout(abort,90000);
  try{
    const response=await fetcher(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body),redirect:'error',signal:controller.signal});
    if(!response.ok){
      // Never echo provider errors: they can contain credentials or source text.
      await response.body?.cancel();
      if(response.status===401||response.status===403)throw new GatewayError('제공사가 API 키 또는 모델 접근 권한을 거부했습니다. 키와 권한을 확인해 주세요.',401);
      if(response.status===402||response.status===429)throw new GatewayError('제공사의 잔액 또는 요청 한도에 도달했습니다. 결제·사용 한도를 확인한 뒤 남은 구간을 재개하세요.',429);
      if(response.status===400||response.status===404||response.status===422)throw new GatewayError('제공사가 모델 ID 또는 요청을 거부했습니다. 텍스트 생성 모델 ID와 요청 크기를 확인해 주세요.',400);
      throw new GatewayError('모델 제공사에 일시적인 오류가 발생했습니다. 잠시 후 남은 구간을 재개하세요.',502);
    }
    const raw=await readLimited(response.body,1000000);let data;try{data=JSON.parse(raw);}catch{throw new GatewayError('제공사가 올바른 응답을 보내지 않았습니다.',502);}
    return providerText(input.provider,data);
  }catch(error){
    if(error instanceof GatewayError)throw error;
    if(controller.signal.aborted)throw new GatewayError('요청이 중단되었거나 90초를 초과했습니다. 요청 크기를 줄이고 남은 구간을 재개하세요.',504);
    throw new GatewayError('모델 제공사와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',502);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function listProviderModels(provider,apiKey,fetcher=fetch,signal){
  const request=modelListRequest(provider,apiKey),controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=setTimeout(abort,30000);
  try{const response=await fetcher(request.url,{headers:request.headers,redirect:'error',signal:controller.signal});if(!response.ok){await response.body?.cancel();if(response.status===401||response.status===403)throw new GatewayError('제공사가 API 키 또는 모델 목록 권한을 거부했습니다.',401);if(response.status===402||response.status===429)throw new GatewayError('제공사의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',429);throw new GatewayError('사용 가능한 모델 목록을 불러오지 못했습니다. 모델 ID를 직접 입력해 주세요.',502);}const raw=await readLimited(response.body,1000000);let data;try{data=JSON.parse(raw);}catch{throw new GatewayError('제공사 모델 목록 형식이 올바르지 않습니다.',502);}const models=supportedModels(provider,data);if(!models.length)throw new GatewayError('이 API 키로 사용할 수 있는 모델이 없습니다. 모델 ID를 직접 입력할 수 있습니다.',404);return models;}
  catch(error){if(error instanceof GatewayError)throw error;if(controller.signal.aborted)throw new GatewayError('모델 목록 요청 시간이 초과되었습니다.',504);throw new GatewayError('모델 목록을 가져오지 못했습니다. 모델 ID를 직접 입력해 주세요.',502);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createWorker(assets={},fetcher=fetch){
  return {async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/api/model'){
      if(request.method!=='POST')return json({error:'POST 요청이 필요합니다.'},405);
      if(request.headers.get('Origin')!==url.origin||request.headers.get('X-Ian-Request')!=='model')return json({error:'이 사이트의 모델 연결 화면에서 요청해 주세요.'},403);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
      try{
        const raw=await readLimited(request.body,600000);let input;try{input=JSON.parse(raw);}catch{throw new GatewayError('JSON 요청을 읽지 못했습니다.');}
        return json({text:await callProvider(input,fetcher,request.signal)});
      }catch(error){return json({error:error instanceof GatewayError?error.message:'모델 요청을 처리하지 못했습니다.'},error instanceof GatewayError?error.status:500);}
    }
    if(url.pathname==='/api/model/test'){
      if(request.method!=='POST')return json({error:'POST 요청이 필요합니다.'},405);
      if(request.headers.get('Origin')!==url.origin||request.headers.get('X-Ian-Request')!=='model')return json({error:'이 사이트의 모델 설정에서 요청해 주세요.'},403);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
      try{
        const raw=await readLimited(request.body,4000);let input;try{input=JSON.parse(raw);}catch{throw new GatewayError('JSON 요청을 읽지 못했습니다.');}
        if(!input||typeof input!=='object'||!PROVIDERS.includes(input.provider)||typeof input.model!=='string'||!/^\S{1,200}$/.test(input.model)||typeof input.apiKey!=='string')throw new GatewayError('제공사·모델 ID·API 키를 확인해 주세요.');
        const answer=await callProvider({...input,system:'You are testing a model connection. Respond exactly with the word PONG.',prompt:'PONG'},fetcher,request.signal);
        if(!/\bpong\b/i.test(answer))throw new GatewayError('응답을 확인하지 못했습니다. 모델 ID와 권한을 확인해 주세요.',502);
        return json({ok:true});
      }catch(error){return json({error:error instanceof GatewayError?error.message:'모델 요청을 처리하지 못했습니다.'},error instanceof GatewayError?error.status:500);}
    }
    if(url.pathname==='/api/models'){
      if(request.method!=='POST')return json({error:'POST 요청이 필요합니다.'},405);
      if(request.headers.get('Origin')!==url.origin||request.headers.get('X-Ian-Request')!=='model')return json({error:'이 사이트의 모델 설정에서 요청해 주세요.'},403);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
      try{const raw=await readLimited(request.body,4000);let input;try{input=JSON.parse(raw);}catch{throw new GatewayError('JSON 요청을 읽지 못했습니다.');}if(!input||typeof input!=='object')throw new GatewayError('모델 목록 요청을 확인해 주세요.');return json({models:await listProviderModels(input.provider,input.apiKey,fetcher,request.signal)});}
      catch(error){return json({error:error instanceof GatewayError?error.message:'모델 목록을 가져오지 못했습니다.'},error instanceof GatewayError?error.status:500);}
    }
    if(url.pathname.startsWith('/api/'))return json({error:'API 경로를 찾지 못했습니다.'},404);
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
    const direct=assets[url.pathname];
    const route=/^\/(?:documents(?:\/new)?|review\/[^/]+|evaluations(?:\/new)?|evaluation\/[^/]+|glossary|settings|models|help|home|projects\/[^/]+(?:\/(?:documents(?:\/new)?|review\/[^/]+|glossary|models|evaluations(?:\/new)?|evaluation\/[^/]+))?)?\/?$/.test(url.pathname);
    const asset=direct??(route?assets['/index.html']:undefined);
    if(!asset)return new Response('Not found',{status:404});
    const body=request.method==='HEAD'?null:asset.base64?Uint8Array.from(atob(asset.base64),char=>char.charCodeAt(0)):asset.text;
    return new Response(body,{headers:{'Content-Type':asset.type,'Cache-Control':url.pathname.startsWith('/assets/')||url.pathname.startsWith('/fonts/')?'public,max-age=31536000,immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}});
  }};
}
export default createWorker(/*SITE_ASSETS*/{});
