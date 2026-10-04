// Ollama is reached only by the loopback server. The browser never chooses an upstream URL.
const OLLAMA = 'http://127.0.0.1:11434'
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]{0,199}$/
const localName = name => typeof name === 'string' && MODEL_ID.test(name) && !name.includes('://') && !/(?:[:/-]cloud)$/i.test(name)

export function modelOutputFormat(prompt) {
  let input
  try { input = JSON.parse(prompt) } catch { return 'json' }
  const request = input?.request ?? input
  const text = maxLength => ({ type: 'string', minLength: 1, maxLength })
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
  if (Array.isArray(input?.candidates) && input.candidates.length > 0 && input.candidates.length <= 8 && input.candidates.every(item => typeof item?.id === 'string')) {
    return object({ decisions: { type: 'array', minItems: input.candidates.length, maxItems: input.candidates.length, items: object({ id: { type: 'string', enum: input.candidates.map(item => item.id) }, target: text(100), note: { type: 'string', maxLength: 1000 } }) } })
  }
  const segments = request?.segments, samples = request?.samples
  const translation = Array.isArray(segments) && segments.length > 0 && segments.length <= 8 && segments.every(item => typeof item?.id === 'string')
  const glossary = Array.isArray(samples) && samples.length > 0 && samples.length <= 8 && samples.every(item => typeof item?.documentId === 'string' && typeof item?.segmentId === 'string')
  if (!translation && !glossary) return 'json'
  const evidence = object({ ...(glossary ? { documentId: { type: 'string', enum: [...new Set(samples.map(item => item.documentId))] } } : {}), segmentId: { type: 'string', enum: [...new Set((translation ? segments : samples).map(item => translation ? item.id : item.segmentId))] }, quote: text(1000) })
  const term = object({ source: text(100), target: text(100), category: { type: 'string', enum: ['character', 'place', 'title', 'term', 'phrase'] }, aliases: { type: 'array', maxItems: 30, items: text(100) }, note: { type: 'string', maxLength: 1000 }, evidence })
  return object({ ...(translation ? { segments: { type: 'array', minItems: segments.length, maxItems: segments.length, items: object({ id: { type: 'string', enum: segments.map(item => item.id) }, target: text(20000) }) } } : {}), terms: { type: 'array', maxItems: 30, items: term } })
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readRequest(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 600000) throw new Error('요청이 너무 큽니다.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('JSON 요청을 읽지 못했습니다.') }
}

async function ollama(path, options = {}, timeout = 30000, fetcher = fetch, signal) {
  const upstreamSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
  const response = await fetcher(`${OLLAMA}${path}`, { ...options, redirect: 'error', signal: upstreamSignal })
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 404) throw new Error('Ollama에서 모델을 찾지 못했습니다. 먼저 모델을 내려받아 주세요.')
    throw new Error('Ollama가 요청을 처리하지 못했습니다. 모델과 실행 상태를 확인해 주세요.')
  }
  const raw = await response.text()
  if (raw.length > 1000000) throw new Error('Ollama 응답이 너무 큽니다.')
  try { return JSON.parse(raw) }
  catch { throw new Error('Ollama 응답 형식을 읽지 못했습니다.') }
}

export async function localModels(fetcher = fetch, signal) {
  const data = await ollama('/api/tags', {}, 30000, fetcher, signal)
  return (Array.isArray(data.models) ? data.models : [])
    .filter(item => localName(item?.name))
    .slice(0, 300)
    .map(item => ({ id: item.name, label: item.name }))
}

export async function localChat(input, test = false, fetcher = fetch, signal) {
  if (!localName(input?.model)) throw new Error('로컬 모델 ID를 확인해 주세요.')
  if (!test && (typeof input.system !== 'string' || !input.system || input.system.length > 10000 || typeof input.prompt !== 'string' || !input.prompt || input.prompt.length > 150000)) throw new Error('번역 요청 크기를 확인해 주세요.')
  if (!(await localModels(fetcher, signal)).some(model => model.id === input.model)) throw new Error('설치된 로컬 모델을 찾지 못했습니다. Ollama에서 모델을 내려받은 뒤 목록을 다시 불러오세요.')
  const metadata = await ollama('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: input.model }) }, 30000, fetcher, signal)
  const thinking = Array.isArray(metadata.capabilities) && metadata.capabilities.includes('thinking')
  const data = await ollama('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Source, glossary and the second-pass candidate must fit together. The
    // common 4k Ollama default can discard the source while generating a reply.
    body: JSON.stringify({ model: input.model, stream: false, options: { temperature: 0, num_ctx: 16384 }, ...(thinking ? { think: false } : {}), ...(test ? {} : { format: modelOutputFormat(input.prompt) }), messages: test
      ? [{ role: 'user', content: 'Respond with exactly PONG.' }]
      : [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }] })
  }, 300000, fetcher, signal)
  const content = data?.message?.content
  if (data?.done !== true || typeof content !== 'string' || !content.trim() || content.length > 200000) throw new Error('Ollama가 완결된 응답을 반환하지 않았습니다. 요청 크기를 줄이거나 다른 모델을 선택하세요.')
  if (test && !/\bpong\b/i.test(content)) throw new Error('연결은 되었지만 테스트 응답을 확인하지 못했습니다.')
  return content
}

export async function handleLocalModel(req, res, port, fetcher = fetch) {
  const route = (req.url || '').split('?')[0]
  if (!['/api/models', '/api/model', '/api/model/test'].includes(route)) return false
  if (req.method !== 'POST') { reply(res, 405, { error: 'POST 요청이 필요합니다.' }); return true }
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!allowedHosts.includes(req.headers.host) || req.headers.origin !== `http://${req.headers.host}` || req.headers['x-ian-request'] !== 'model' || !req.headers['content-type']?.startsWith('application/json')) {
    reply(res, 403, { error: '로컬 앱의 모델 설정 화면에서 요청해 주세요.' }); return true
  }
  const controller = new AbortController()
  const disconnect = () => controller.abort()
  req.on?.('aborted', disconnect)
  res.on?.('close', disconnect)
  try {
    const input = await readRequest(req)
    controller.signal.throwIfAborted()
    if (input?.provider !== 'local') { reply(res, 400, { error: '로컬 Ollama 모델을 선택해 주세요.' }); return true }
    if (route === '/api/models') reply(res, 200, { models: await localModels(fetcher, controller.signal) })
    else if (route === '/api/model/test') { await localChat(input, true, fetcher, controller.signal); reply(res, 200, { ok: true }) }
    else reply(res, 200, { text: await localChat(input, false, fetcher, controller.signal) })
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) return true
    const message = error instanceof Error && error.message
    reply(res, 502, { error: message && !/fetch failed|abort|timeout/i.test(message) ? message : 'Ollama에 연결할 수 없습니다. Ollama 실행 상태와 127.0.0.1:11434를 확인해 주세요.' })
  } finally {
    req.off?.('aborted', disconnect)
    res.off?.('close', disconnect)
  }
  return true
}
