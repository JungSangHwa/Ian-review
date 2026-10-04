const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { EventEmitter } = require('node:events')
const localModule = import('../../local-model.mjs')

test('an output limit is not accepted as a completed model response even with valid JSON', async () => {
  const { localChat } = await localModule
  await assert.rejects(localChat({ model: 'qwen3:8b', system: 'Translate', prompt: 'Hello' }, false, async url => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b' }] })
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
    return Response.json({ done: true, done_reason: 'length', message: { content: '{"segments":[],"terms":[]}' } })
  }), /출력 한도/)
})

test('context overflow reports a recoverable request-size error instead of connection failure', async () => {
  const { localChat } = await localModule
  await assert.rejects(localChat({ model: 'qwen3:8b', system: 'Translate', prompt: 'Hello' }, false, async url => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b' }] })
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
    return Response.json({ error: 'input length exceeds maximum context length' }, { status: 400 })
  }), /문맥 한도.*2,000/)
})

test('local models come from the fixed loopback Ollama endpoint', async () => {
  const { localModels } = await localModule
  const models = await localModels(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags')
    assert.equal(options.redirect, 'error')
    return Response.json({ models: [{ name: 'qwen3:8b' }, { name: 'gemma4:cloud' }, { name: 'bad name' }] })
  })
  assert.deepEqual(models, [{ id: 'qwen3:8b', label: 'qwen3:8b' }])
})

test('local translation sends JSON chat without credentials or remote URLs', async () => {
  const { localChat } = await localModule
  const text = await localChat({ model: 'qwen3:8b', system: 'Translate', prompt: 'Hello' }, false, async (url, options) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b' }] })
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
    assert.equal(url, 'http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'qwen3:8b')
    assert.equal(body.format, 'json')
    assert.equal(body.stream, false)
    assert.equal(Object.hasOwn(body, 'think'), false)
    assert.deepEqual(body.options, { temperature: 0, num_ctx: 16384, num_predict: 8192 })
    assert.equal(body.truncate, false)
    assert.equal(body.shift, false)
    assert.deepEqual(body.messages, [{ role: 'system', content: 'Translate' }, { role: 'user', content: 'Hello' }])
    return Response.json({ done: true, message: { content: '{"segments":[],"terms":[]}' } })
  })
  assert.equal(text, '{"segments":[],"terms":[]}')
  await assert.rejects(localChat({ model: 'http://evil.test', system: 'x', prompt: 'x' }), /모델 ID/)
  await assert.rejects(localChat({ model: 'gemma4:cloud', system: 'x', prompt: 'x' }), /모델 ID/)
})

test('local gateway rejects cross-origin requests before calling Ollama', async () => {
  const { handleLocalModel } = await localModule
  const req = Readable.from([JSON.stringify({ provider: 'local' })])
  req.url = '/api/models'; req.method = 'POST'
  req.headers = { origin: 'http://evil.test', 'x-ian-request': 'model', 'content-type': 'application/json' }
  const res = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
  const handled = await handleLocalModel(req, res, 4173, async () => { throw new Error('unexpected upstream request') })
  assert.equal(handled, true)
  assert.equal(res.status, 403)
})

test('local gateway lists installed models without an API key', async () => {
  const { handleLocalModel } = await localModule
  const req = Readable.from([Buffer.from(JSON.stringify({ provider: 'local', apiKey: '' }))])
  req.url = '/api/models'; req.method = 'POST'
  req.headers = { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'x-ian-request': 'model', 'content-type': 'application/json' }
  const res = { writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
  await handleLocalModel(req, res, 4173, async () => Response.json({ models: [{ name: 'qwen3:8b' }] }))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { models: [{ id: 'qwen3:8b', label: 'qwen3:8b' }] })
})

test('closing the client response aborts the pending Ollama chat', async () => {
  const { handleLocalModel } = await localModule
  const req = Readable.from([Buffer.from(JSON.stringify({ provider: 'local', model: 'qwen3:8b', system: 'Translate', prompt: 'Hello' }))])
  req.url = '/api/model'; req.method = 'POST'
  req.headers = { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'x-ian-request': 'model', 'content-type': 'application/json' }
  const res = new EventEmitter()
  res.writeHead = () => {}; res.end = () => {}
  let chatSignal, started
  const chatStarted = new Promise(resolve => { started = resolve })
  const handling = handleLocalModel(req, res, 4173, async (url, options) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b' }] })
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
    chatSignal = options.signal; started()
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  })
  await chatStarted
  res.emit('close')
  assert.equal(await handling, true)
  assert.equal(chatSignal.aborted, true)
})

for (const kind of ['translation', 'glossary', 'legacy']) test('local ' + kind + ' requests constrain Ollama output to the expected IDs and fields', async () => {
  const { localChat } = await localModule
  const payload = kind === 'translation' ? { segments: [{ id: 'segment-a', source: 'Mira returned.' }] } : kind === 'glossary' ? { samples: [{ documentId: 'doc-a', segmentId: 'segment-a', source: 'Mira returned.' }] } : { candidates: [{ id: 'term-a', source: 'Mira' }] }
  await localChat({ model: 'qwen3:8b', system: 'Return the requested JSON.', prompt: JSON.stringify(payload) }, false, async (url, options) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:8b' }] })
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
    const { format, options: generation } = JSON.parse(options.body)
    assert.equal(format.type, 'object')
    assert.equal(format.additionalProperties, false)
    assert.equal(generation.temperature, 0)
    assert.equal(generation.num_ctx, 16384)
    if (kind === 'translation') {
      assert.deepEqual(format.required, ['segments', 'terms'])
      assert.equal(format.properties.segments.maxItems, 1)
      assert.deepEqual(format.properties.segments.items.properties.id.enum, ['segment-a'])
    } else if (kind === 'glossary') {
      assert.deepEqual(format.properties.terms.items.properties.evidence.properties.documentId.enum, ['doc-a'])
      assert.deepEqual(format.properties.terms.items.properties.evidence.properties.segmentId.enum, ['segment-a'])
    } else {
      assert.equal(format.properties.decisions.maxItems, 1)
      assert.deepEqual(format.properties.decisions.items.properties.id.enum, ['term-a'])
    }
    return Response.json({ done: true, message: { content: '{}' } })
  })
})

test('thinking models return direct structured output in both inference and connection tests', async () => {
  const { localChat } = await localModule
  for (const testConnection of [false, true]) {
    await localChat({ model: 'gemma4:12b', system: 'Translate', prompt: 'Hello' }, testConnection, async (url, options) => {
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'gemma4:12b' }] })
      if (url.endsWith('/api/show')) {
        assert.deepEqual(JSON.parse(options.body), { model: 'gemma4:12b' })
        return Response.json({ capabilities: ['completion', 'thinking'] })
      }
      const body = JSON.parse(options.body)
      assert.equal(body.think, false)
      assert.equal(body.options.num_ctx, 16384)
      assert.equal(body.options.num_predict, testConnection ? 32 : 8192)
      assert.equal(body.truncate, false)
      assert.equal(body.shift, false)
      return Response.json({ done: true, message: { content: testConnection ? 'PONG' : '{}' } })
    })
  }
})
