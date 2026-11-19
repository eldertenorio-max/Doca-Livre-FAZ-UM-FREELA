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

import { assinarToken, lerToken } from './auth.mjs'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres'
// Segredo do token de sessão só destes testes (auth.mjs lê na hora de assinar/conferir).
process.env.JWT_SECRET = 'segredo-jwt-de-teste-com-mais-de-32-caracteres'
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
  for (const k of ['DOCA_CC_URL', 'DOCA_CC_WEBHOOK_SECRET', 'DOCA_CC_SYSTEM_SLUG', 'DOCA_CC_SYSTEM_NAME', 'DOCA_CC_HEARTBEAT_SEC']) delete process.env[k]
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

// ---------- Presença (session.heartbeat) ----------

/** Token assinado com o segredo de teste e claims à escolha (ex.: já vencido). */
function tokenAssinado(claims) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const cab = b({ alg: 'HS256', typ: 'JWT' })
  const carga = b(claims)
  const ass = createHmac('sha256', process.env.JWT_SECRET).update(`${cab}.${carga}`).digest('base64url')
  return `${cab}.${carga}.${ass}`
}

/** fetch falso: registra os envios e responde conforme `modo.atual` ('ok', 'falha', 'pendurar'). */
function fetchFalso() {
  const envios = []
  const modo = { atual: 'ok' }
  const fn = async (url, init) => {
    envios.push({ url, init })
    if (modo.atual === 'pendurar') return new Promise(() => {})
    if (modo.atual === 'falha') return { ok: false, status: 503, text: async () => '' }
    return { ok: true, status: 201, text: async () => '{"duplicate":false}' }
  }
  return { fn, envios, modo }
}

const pedidoDe = (sub, extra = {}) => ({ method: 'GET', url: '/rest/v1/mao_vagas?select=*', sessao: sub ? { sub } : null, ...extra })

test('presença: pedido com sessão válida envia session.heartbeat assinado, só com o external_id; anônimo, token falso/vencido, 4xx e saúde não enviam', async () => {
  const cc = await servidorFalso()
  const m = await carregar({ DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'mao-de-obra' })
  assert.equal(m.presencaAtiva, true)
  const app = http.createServer((req, res) => {
    m.observarResposta(req, res)
    if (req.url.startsWith('/404')) { res.writeHead(404); return res.end() }
    res.writeHead(200); res.end('[]')
  })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  const p = app.address().port
  const ana = assinarToken({ id: 'user_ana123', role: 'profissional' }).token
  const bia = assinarToken({ id: 'user_bia456', role: 'empresa' }).token
  const com = (t) => ({ headers: { authorization: `Bearer ${t}` } })

  // Três pedidos seguidos da Ana: um só envio (limite por usuário).
  for (let i = 0; i < 3; i++) assert.equal(await pedir(p, '/rest/v1/mao_vagas?select=*', com(ana)), 200)
  // Nada disto pode enviar:
  await pedir(p, '/rest/v1/mao_vagas') // anônimo
  await pedir(p, '/rest/v1/mao_vagas', { headers: { authorization: 'Bearer chave-publica-nao-jwt' } })
  await pedir(p, '/rest/v1/mao_vagas', com(jwtDe({ sub: 'user_bia456', exp: 9999999999 }))) // assinatura falsa
  await pedir(p, '/rest/v1/mao_vagas', com(tokenAssinado({ role: 'web', sub: 'user_bia456', iat: 1, exp: Math.floor(Date.now() / 1000) - 10 }))) // vencido
  await pedir(p, '/404', com(bia)) // não atendido (4xx)
  await pedir(p, '/saude', com(bia)) // rota de saúde
  await pedir(p, '/', com(bia))

  assert.ok(await esperar(() => cc.recebidos.length >= 1))
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(cc.recebidos.length, 1, 'só o primeiro pedido atendido da Ana deve virar presença')
  const r = cc.recebidos[0]
  assert.equal(r.url, '/api/webhooks/mao-de-obra')
  assert.ok(assinaturaConfere(r), 'assinatura/horário inválidos')
  const corpo = JSON.parse(r.bruto)
  assert.equal(r.headers['x-doca-idempotency-key'], corpo.idempotency_key)
  assert.match(corpo.idempotency_key, /^hb:mao-de-obra:user_ana123:\d{13}$/)
  assert.equal(corpo.event_type, 'session.heartbeat')
  assert.equal(corpo.system_slug, 'mao-de-obra')
  assert.ok(!Number.isNaN(Date.parse(corpo.occurred_at)))
  assert.deepEqual(corpo.payload, { external_id: 'user_ana123' })
  assert.deepEqual(Object.keys(corpo).sort(), ['event_type', 'idempotency_key', 'occurred_at', 'payload', 'system_slug'])
  assert.ok(!r.bruto.includes(ana), 'o token nunca vai ao painel')

  // Outro usuário, pedido atendido: envia o dele (o limite é por usuário).
  await pedir(p, '/rest/v1/mao_vagas', com(bia))
  assert.ok(await esperar(() => cc.recebidos.length === 2))
  assert.deepEqual(JSON.parse(cc.recebidos[1].bruto).payload, { external_id: 'user_bia456' })
  app.close(); await cc.fechar()
})

test('presença: o external_id é exatamente o que o retrato (cc-usuarios.mjs) envia para a mesma conta', async () => {
  const m = await carregar({}) // sem variáveis: importar o cc-usuarios não agenda nada
  const { montarPayloadUsuario } = await import('./cc-usuarios.mjs')
  const ids = ['user_mabc12xyz9', 'emp_lz1k2', '42', ' user_com_espaco ', `user_${'x'.repeat(250)}`]
  for (const id of ids) {
    const claims = lerToken(assinarToken({ id, role: 'profissional' }).token)
    const doRetrato = montarPayloadUsuario({ id, usuario: 'u', email: 'u@x.com', role: 'profissional', ativo: true }).external_id
    assert.equal(m.externalIdDoToken(claims), doRetrato, `id ${JSON.stringify(id).slice(0, 40)}`)
  }
  // id numérico (o retrato faz String(id)) e sem sub
  assert.equal(m.externalIdDoToken({ sub: 7 }), montarPayloadUsuario({ id: 7 }).external_id)
  assert.equal(m.externalIdDoToken({ sub: '   ' }), undefined)
  assert.equal(m.externalIdDoToken(null), undefined)
})

test('presença: no máximo 1 por usuário a cada DOCA_CC_HEARTBEAT_SEC, memória limitada e envios simultâneos limitados', async () => {
  const m = await carregar({})
  let t = 1_700_000_000_000
  const f = fetchFalso()
  const pr = m.criarPresenca({ base: 'http://cc.teste/api/', slug: 'mao-de-obra', segredo: SEGREDO, intervaloSec: '60', agora: () => t, fetch: f.fn, lerSessao: (req) => req.sessao, limiteUsuarios: 3 })
  assert.equal(pr.ativa, true)
  assert.equal(pr.registrar(pedidoDe('a'), 200), true)
  t += 59_999
  assert.equal(pr.registrar(pedidoDe('a'), 200), false, 'antes de 60 s não envia de novo')
  t += 1
  assert.equal(pr.registrar(pedidoDe('a'), 201), true, 'com 60 s envia de novo')
  assert.equal(f.envios.length, 2)
  const env = f.envios[0]
  assert.equal(env.url, 'http://cc.teste/api/webhooks/mao-de-obra')
  const corpo = JSON.parse(env.init.body)
  assert.equal(corpo.idempotency_key, 'hb:mao-de-obra:a:1700000000000')
  assert.equal(JSON.parse(f.envios[1].init.body).idempotency_key, 'hb:mao-de-obra:a:1700000060000', 'chave única por envio')
  assert.equal(env.init.headers['x-doca-idempotency-key'], corpo.idempotency_key)
  const esperada = createHmac('sha256', SEGREDO).update(`${env.init.headers['x-doca-timestamp']}.${env.init.body}`, 'utf8').digest('hex')
  assert.equal(env.init.headers['x-doca-signature'], esperada)
  assert.ok(env.init.signal instanceof AbortSignal, 'tem tempo limite')

  // Memória limitada: com limite 3, o mais antigo ('a') é esquecido.
  for (const u of ['b', 'c', 'd']) assert.equal(pr.registrar(pedidoDe(u), 200), true)
  assert.equal(pr.estado().usuarios, 3)
  assert.equal(pr.registrar(pedidoDe('c'), 200), false, 'c ainda está no mapa')
  assert.equal(pr.registrar(pedidoDe('a'), 200), true, 'a foi esquecido (saiu do mapa)')
  assert.equal(pr.estado().usuarios, 3)

  // Envios simultâneos limitados: com o painel pendurado, o 3º não sai (e não fica marcado).
  const f2 = fetchFalso(); f2.modo.atual = 'pendurar'
  const pr2 = m.criarPresenca({ base: 'http://cc.teste/api', slug: 'mao-de-obra', segredo: SEGREDO, agora: () => t, fetch: f2.fn, lerSessao: (req) => req.sessao, maxSimultaneos: 2 })
  assert.equal(pr2.registrar(pedidoDe('x'), 200), true)
  assert.equal(pr2.registrar(pedidoDe('y'), 200), true)
  assert.equal(pr2.registrar(pedidoDe('z'), 200), false)
  assert.equal(pr2.estado().usuarios, 2)

  // Leitura da variável
  assert.equal(m.lerIntervaloHeartbeat(undefined), 60)
  assert.equal(m.lerIntervaloHeartbeat(''), 60)
  assert.equal(m.lerIntervaloHeartbeat('abc'), 60)
  assert.equal(m.lerIntervaloHeartbeat('-5'), 60)
  assert.equal(m.lerIntervaloHeartbeat('0'), 0)
  assert.equal(m.lerIntervaloHeartbeat('3'), 10)
  assert.equal(m.lerIntervaloHeartbeat(' 90 '), 90)
  assert.equal(m.lerIntervaloHeartbeat('999999'), 3600)
})

test('presença: valores padrão (60 s, 5 s de tempo limite, 3 falhas, pausa de 5 min, 5000 usuários)', async () => {
  const m = await carregar({ DOCA_CC_URL: 'http://127.0.0.1:1/api', DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'mao-de-obra' })
  const e = m.presenca.estado()
  assert.equal(e.ativa, true)
  assert.equal(e.intervaloMs, 60_000)
  assert.equal(e.timeoutMs, 5000)
  assert.equal(e.falhasMax, 3)
  assert.equal(e.pausaMs, 300_000)
  assert.equal(e.limiteUsuarios, 5000)
  const m2 = await carregar({ DOCA_CC_URL: 'http://127.0.0.1:1/api', DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'mao-de-obra', DOCA_CC_HEARTBEAT_SEC: '120' })
  assert.equal(m2.presenca.estado().intervaloMs, 120_000)
})

test('presença DESLIGADA sem as variáveis ou com DOCA_CC_HEARTBEAT_SEC=0 (os avisos de falha continuam)', async () => {
  const f = fetchFalso()
  const m0 = await carregar({})
  assert.equal(m0.presencaAtiva, false)
  assert.equal(m0.presenca.registrar(pedidoDe('a'), 200), false)
  const semSegredo = m0.criarPresenca({ base: 'http://cc/api', slug: 'mao-de-obra', segredo: 'curto', fetch: f.fn, lerSessao: (req) => req.sessao })
  assert.equal(semSegredo.ativa, false)
  assert.equal(semSegredo.registrar(pedidoDe('a'), 200), false)
  const zero = m0.criarPresenca({ base: 'http://cc/api', slug: 'mao-de-obra', segredo: SEGREDO, intervaloSec: '0', fetch: f.fn, lerSessao: (req) => req.sessao })
  assert.equal(zero.ativa, false)
  assert.equal(zero.registrar(pedidoDe('a'), 200), false)
  assert.equal(f.envios.length, 0)

  const cc = await servidorFalso()
  const m = await carregar({ DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'mao-de-obra', DOCA_CC_HEARTBEAT_SEC: '0' })
  assert.equal(m.avisosAtivos, true)
  assert.equal(m.presencaAtiva, false)
  const app = http.createServer((req, res) => {
    m.observarResposta(req, res)
    res.writeHead(req.url.startsWith('/quebra') ? 500 : 200); res.end()
  })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  const token = assinarToken({ id: 'user_ana123', role: 'profissional' }).token
  await pedir(app.address().port, '/rest/v1/mao_vagas', { headers: { authorization: `Bearer ${token}` } })
  await pedir(app.address().port, '/quebra', { headers: { authorization: `Bearer ${token}` } })
  assert.ok(await esperar(() => cc.recebidos.length >= 1))
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(cc.recebidos.length, 1)
  assert.equal(JSON.parse(cc.recebidos[0].bruto).event_type, 'system.error')
  app.close(); await cc.fechar()
})

test('presença: exceção ou Control Center fora do ar nunca chega à resposta nem vira erro solto', async () => {
  let soltos = 0
  const contar = () => { soltos++ }
  process.on('unhandledRejection', contar)
  try {
    const m = await carregar({})
    const base = { base: 'http://cc/api', slug: 'mao-de-obra', segredo: SEGREDO }
    // Leitura da sessão que lança
    const p1 = m.criarPresenca({ ...base, lerSessao: () => { throw new Error('token quebrado') } })
    assert.doesNotThrow(() => assert.equal(p1.registrar(pedidoDe('a'), 200), false))
    // fetch que lança na hora, log que lança, relógio normal
    const p2 = m.criarPresenca({ ...base, falhasMax: 1, lerSessao: (req) => req.sessao, fetch: () => { throw new Error('sem rede') }, log: () => { throw new Error('log quebrado') } })
    assert.doesNotThrow(() => assert.equal(p2.registrar(pedidoDe('a'), 200), true))
    assert.ok(await esperar(() => p2.estado().emAndamento === 0))
    assert.ok(p2.estado().pausadaAte > 0, 'a falha foi contada')
    // Pedido estranho
    const p3 = m.criarPresenca({ ...base, lerSessao: (req) => req.sessao })
    assert.equal(p3.registrar(null, 200), false)
    assert.equal(p3.registrar({}, undefined), false)

    // De ponta a ponta: painel fora do ar, pedido com sessão válida responde na hora.
    const mf = await carregar({ DOCA_CC_URL: 'http://127.0.0.1:1/api', DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SYSTEM_SLUG: 'mao-de-obra' })
    const app = http.createServer((req, res) => { mf.observarResposta(req, res); res.writeHead(200); res.end('ok') })
    await new Promise((r) => app.listen(0, '127.0.0.1', r))
    const token = assinarToken({ id: 'user_ana123', role: 'profissional' }).token
    const t0 = Date.now()
    assert.equal(await pedir(app.address().port, '/rest/v1/mao_vagas', { headers: { authorization: `Bearer ${token}` } }), 200)
    assert.ok(Date.now() - t0 < 500, `demorou ${Date.now() - t0} ms`)
    assert.ok(await esperar(() => mf.presenca.estado().emAndamento === 0))
    assert.equal(mf.presenca.estado().falhasSeguidas, 1)
    app.close()
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(soltos, 0, 'nenhuma promessa rejeitada sem tratamento')
  } finally {
    process.off('unhandledRejection', contar)
  }
})

test('presença: após 3 falhas seguidas pausa 5 min; um sucesso zera a contagem; tempo esgotado conta como falha', async () => {
  const m = await carregar({})
  let t = 1_700_000_000_000
  const f = fetchFalso()
  const logs = []
  const pr = m.criarPresenca({ base: 'http://cc/api', slug: 'mao-de-obra', segredo: SEGREDO, agora: () => t, fetch: f.fn, lerSessao: (req) => req.sessao, log: (msg) => logs.push(msg) })
  const enviar = async (u) => {
    const ok = pr.registrar(pedidoDe(u), 200)
    await esperar(() => pr.estado().emAndamento === 0)
    return ok
  }
  f.modo.atual = 'falha'
  await enviar('u1'); await enviar('u2')
  assert.equal(pr.estado().falhasSeguidas, 2)
  f.modo.atual = 'ok'
  await enviar('u3')
  assert.equal(pr.estado().falhasSeguidas, 0, 'sucesso zera')
  f.modo.atual = 'falha'
  await enviar('u4'); await enviar('u5')
  assert.equal(pr.estado().pausadaAte, 0)
  await enviar('u6')
  assert.equal(pr.estado().pausadaAte, t + 300_000, '3ª falha seguida: pausa de 5 min')
  assert.equal(logs.length, 1)
  assert.match(logs[0], /pausada.*3 falhas seguidas.*HTTP 503/)
  f.modo.atual = 'ok'
  const antes = f.envios.length
  assert.equal(await enviar('u7'), false, 'pausado: não envia')
  t += 299_999
  assert.equal(await enviar('u7'), false)
  assert.equal(f.envios.length, antes, 'nenhuma tentativa durante a pausa')
  t += 1
  assert.equal(await enviar('u7'), true, 'depois da pausa volta a enviar')
  assert.equal(f.envios.length, antes + 1)

  // Painel que aceita a conexão e não responde: o tempo limite encerra e conta como falha.
  const pendurados = []
  const lento = http.createServer((req) => { pendurados.push(req) })
  await new Promise((r) => lento.listen(0, '127.0.0.1', r))
  const logs2 = []
  const pl = m.criarPresenca({ base: `http://127.0.0.1:${lento.address().port}/api`, slug: 'mao-de-obra', segredo: SEGREDO, timeoutMs: 150, falhasMax: 1, lerSessao: (req) => req.sessao, log: (msg) => logs2.push(msg) })
  const t0 = Date.now()
  assert.equal(pl.registrar(pedidoDe('u1'), 200), true)
  assert.ok(await esperar(() => pl.estado().emAndamento === 0, 3000))
  assert.ok(Date.now() - t0 < 2000)
  assert.ok(pl.estado().pausadaAte > 0)
  assert.match(logs2[0], /tempo esgotado/)
  lento.closeAllConnections?.()
  await new Promise((r) => lento.close(r))
})
