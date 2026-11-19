// Testes do aviso ao Control Center. Rodar: node --test control-center.test.mjs
// (não vai para a imagem Docker: o Dockerfile copia só os arquivos listados)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres'
let contador = 0

async function servidorFalso(codigo = 201) {
  const recebidos = []
  const srv = http.createServer((req, res) => {
    const partes = []
    req.on('data', (p) => partes.push(p))
    req.on('end', () => {
      recebidos.push({ url: req.url, headers: req.headers, bruto: Buffer.concat(partes).toString('utf8') })
      res.writeHead(codigo, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return { srv, recebidos, porta: srv.address().port, fechar: () => new Promise((r) => srv.close(r)) }
}

/** Importa uma instância NOVA do módulo (ele lê as variáveis na hora do import). */
async function carregar(env) {
  for (const k of ['DOCA_CC_URL', 'DOCA_CC_WEBHOOK_SECRET', 'DOCA_CC_SYSTEM_SLUG', 'DOCA_CC_SYSTEM_NAME']) delete process.env[k]
  Object.assign(process.env, env)
  return import(`${pathToFileURL(path.join(aqui, 'control-center.mjs')).href}?t=${++contador}`)
}

const esperar = async (cond, ms = 3000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return cond()
}

function assinaturaConfere(r) {
  const ts = r.headers['x-doca-timestamp']
  const esperada = createHmac('sha256', SEGREDO).update(`${ts}.${r.bruto}`, 'utf8').digest('hex')
  return esperada === r.headers['x-doca-signature'] && Math.abs(Date.now() / 1000 - Number(ts)) < 60
}

function jwtDe(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b(payload)}.assinatura`
}

async function pedir(porta, caminho, { metodo = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    r.on('error', reject)
    r.end()
  })
}

test('sem as variáveis o aviso fica DESLIGADO e nada é enviado nem instalado', async () => {
  const cc = await servidorFalso()
  const antes = process.listenerCount('uncaughtException')
  const m = await carregar({})
  assert.equal(m.avisosAtivos, false)
  await m.reportarErro({ titulo: 'x', mensagem: 'y' })
  m.instalarCapturaGlobal()
  assert.equal(process.listenerCount('uncaughtException'), antes)
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(cc.recebidos.length, 0)
  await cc.fechar()
})

test('envia system.error assinado (HMAC) no formato que o Control Center valida', async () => {
  const cc = await servidorFalso()
  const m = await carregar({ DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'oferta-carga' })
  assert.equal(m.avisosAtivos, true)
  await m.reportarErro({ titulo: 'Falha X', mensagem: 'erro Y', usuario: { id: '7', name: 'Ana', email: 'ana@x.com' }, tela: '/painel', acao: 'Gravar Cargas', detalhes: { status: 500 } })
  assert.ok(await esperar(() => cc.recebidos.length === 1))
  const r = cc.recebidos[0]
  assert.equal(r.url, '/api/webhooks/oferta-carga')
  assert.ok(assinaturaConfere(r), 'assinatura/horário inválidos')
  assert.equal(r.headers['x-doca-idempotency-key'], JSON.parse(r.bruto).idempotency_key)
  const corpo = JSON.parse(r.bruto)
  assert.equal(corpo.event_type, 'system.error')
  assert.deepEqual(corpo.payload, { level: 'error', title: 'Falha X', message: 'erro Y', user: { id: '7', name: 'Ana', email: 'ana@x.com' }, screen: '/painel', action: 'Gravar Cargas', details: { status: 500 } })
  await cc.fechar()
})

test('resposta 5xx vira aviso com usuário (do token), tela (sem querystring), ação em português e a mensagem do erro', async () => {
  const cc = await servidorFalso()
  const m = await carregar({ DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'oferta-carga', DOCA_CC_SYSTEM_NAME: 'Oferta de Carga' })
  const rotulos = { cargas: 'Cargas' }
  const app = http.createServer((req, res) => {
    m.observarResposta(req, res, rotulos)
    if (req.url.startsWith('/rest/v1/cargas')) { res.erroDetalhe = '{"code":"PGRST000","message":"connection refused"}'; res.writeHead(503); return res.end() }
    if (req.url === '/saude') { res.writeHead(500); return res.end() }
    if (req.url === '/404') { res.writeHead(404); return res.end() }
    res.writeHead(200); res.end()
  })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  const p = app.address().port
  const token = jwtDe({ sub: 'u-9', email: 'maria@empresa.com', nome: 'Maria Souza', role: 'web' })
  assert.equal(await pedir(p, '/rest/v1/cargas?select=*&apikey=SEGREDO', { metodo: 'POST', headers: { authorization: `Bearer ${token}`, referer: 'https://ofertadecarga.com.br/painel?token=abc' } }), 503)
  await pedir(p, '/saude'); await pedir(p, '/404'); await pedir(p, '/ok')
  assert.ok(await esperar(() => cc.recebidos.length >= 1))
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(cc.recebidos.length, 1, 'só a 5xx de funcionalidade deve avisar (saúde, 404 e 200 ficam de fora)')
  const ev = JSON.parse(cc.recebidos[0].bruto).payload
  assert.equal(ev.title, 'Falha no servidor Oferta de Carga (HTTP 503)')
  assert.equal(ev.action, 'Gravar Cargas')
  assert.equal(ev.screen, 'https://ofertadecarga.com.br/painel')
  assert.deepEqual(ev.user, { id: 'u-9', name: 'Maria Souza', email: 'maria@empresa.com' })
  assert.match(ev.message, /connection refused/)
  assert.deepEqual(ev.details, { rota: 'POST /rest/v1/cargas', status: 503 })
  assert.ok(!cc.recebidos[0].bruto.includes('SEGREDO') && !cc.recebidos[0].bruto.includes(token), 'nada de querystring/token no aviso')
  app.close(); await cc.fechar()
})

test('o mesmo erro repetido não vira enxurrada (agrupa), mas outra rota avisa', async () => {
  const cc = await servidorFalso()
  const m = await carregar({ DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'oferta-carga' })
  const app = http.createServer((req, res) => { m.observarResposta(req, res); res.writeHead(500); res.end() })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  const p = app.address().port
  for (let i = 0; i < 5; i++) await pedir(p, '/rest/v1/lances')
  await pedir(p, '/rest/v1/rotas')
  assert.ok(await esperar(() => cc.recebidos.length >= 2))
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(cc.recebidos.length, 2)
  app.close(); await cc.fechar()
})

test('Control Center fora do ar: a resposta ao usuário NÃO atrasa nem quebra', async () => {
  const m = await carregar({ DOCA_CC_URL: 'http://127.0.0.1:1/api', DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'oferta-carga' })
  const app = http.createServer((req, res) => { m.observarResposta(req, res); res.writeHead(500); res.end() })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  const t0 = Date.now()
  const status = await pedir(app.address().port, '/rest/v1/cargas')
  assert.equal(status, 500)
  assert.ok(Date.now() - t0 < 500, `demorou ${Date.now() - t0} ms`)
  await assert.doesNotReject(m.reportarErro({ titulo: 'a', mensagem: 'b' }))
  app.close()
})

test('erro fatal: avisa como CRÍTICO e o processo encerra com código 1 (como o Node já fazia)', async () => {
  const cc = await servidorFalso()
  const codigo = `
    import { instalarCapturaGlobal } from ${JSON.stringify(pathToFileURL(path.join(aqui, 'control-center.mjs')).href)}
    instalarCapturaGlobal()
    setTimeout(() => { throw new Error('quebrou de verdade') }, 20)
    setTimeout(() => {}, 20000)
  `
  const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo], {
    env: { ...process.env, DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'oferta-carga', DOCA_CC_SYSTEM_NAME: 'Oferta de Carga' },
    stdio: 'ignore',
  })
  const saiu = await new Promise((r) => filho.on('exit', (c) => r(c)))
  assert.equal(saiu, 1)
  assert.equal(cc.recebidos.length, 1)
  const ev = JSON.parse(cc.recebidos[0].bruto).payload
  assert.equal(ev.level, 'critical')
  assert.match(ev.title, /O servidor Oferta de Carga caiu/)
  assert.match(ev.message, /quebrou de verdade/)
  assert.ok(assinaturaConfere(cc.recebidos[0]))
  await cc.fechar()
})

test('descreverAcao traduz rotas conhecidas', async () => {
  const m = await carregar({})
  assert.equal(m.descreverAcao('PATCH', '/rest/v1/veiculos?id=eq.1', { veiculos: 'Veículos' }), 'Atualizar Veículos')
  assert.equal(m.descreverAcao('POST', '/rest/v1/rpc/calcular_frete'), 'Executar a função calcular_frete')
  assert.equal(m.descreverAcao('POST', '/auth/v1/token'), 'Entrar, cadastrar ou recuperar senha')
  assert.equal(m.descreverAcao('GET', '/storage/v1/object/public/x'), 'Arquivos (envio ou consulta)')
  assert.equal(m.descreverAcao('GET', '/algo/novo?x=1'), 'GET /algo/novo')
})
