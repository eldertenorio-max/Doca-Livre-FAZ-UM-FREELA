// Testes do retrato de usuários enviado ao Control Center. Rodar: node --test cc-usuarios.test.mjs
// (não vai para a imagem Docker: o Dockerfile copia só os arquivos listados)
// Não toca em banco real: a fonte dos usuários é uma função falsa injetada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash, createHmac } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const ARQUIVO = path.join(aqui, 'cc-usuarios.mjs')
const SEGREDO = 'segredo-de-teste-com-mais-de-16-caracteres'
const VARS = ['DOCA_CC_URL', 'DOCA_CC_SYSTEM_SLUG', 'DOCA_CC_WEBHOOK_SECRET', 'DOCA_CC_SNAPSHOT_MIN']
let contador = 0

/** Importa uma instância NOVA do módulo (ele lê as variáveis na hora do import). */
async function carregar(env = {}) {
  for (const k of VARS) delete process.env[k]
  Object.assign(process.env, env)
  const mod = await import(`${pathToFileURL(ARQUIVO).href}?t=${++contador}`)
  for (const k of VARS) delete process.env[k]
  return mod
}

// Instância sem variáveis (desligada): serve para as funções puras e para a fábrica.
const mod = await carregar()

async function novoCC(cfg = {}) {
  const config = { status: 201, atrasoMs: 0, ...cfg }
  const recebidos = []
  const vistas = new Set()
  let emVoo = 0
  let maxEmVoo = 0
  const srv = http.createServer((req, res) => {
    const partes = []
    req.on('data', (p) => partes.push(p))
    req.on('end', async () => {
      emVoo++
      maxEmVoo = Math.max(maxEmVoo, emVoo)
      const bruto = Buffer.concat(partes).toString('utf8')
      let corpo = null
      try {
        corpo = JSON.parse(bruto)
      } catch {
        /* corpo inválido: o teste vê */
      }
      const n = recebidos.length
      recebidos.push({ metodo: req.method, url: req.url, headers: req.headers, bruto, corpo, t: Date.now() })
      const atraso = typeof config.atrasoMs === 'function' ? config.atrasoMs(n, corpo) : config.atrasoMs
      if (atraso) await new Promise((r) => setTimeout(r, atraso))
      const codigo = typeof config.status === 'function' ? config.status(n, corpo) : config.status
      const chave = req.headers['x-doca-idempotency-key']
      const duplicado = codigo < 300 && vistas.has(chave)
      if (codigo < 300) vistas.add(chave)
      emVoo--
      res.writeHead(codigo, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: codigo < 300, duplicate: duplicado }))
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  return {
    config,
    recebidos,
    porta: srv.address().port,
    maxEmVoo: () => maxEmVoo,
    fechar: () =>
      new Promise((r) => {
        srv.closeAllConnections?.()
        srv.close(r)
      }),
  }
}

const BALDE = '2026111810' // hora fixa nos testes: sem instabilidade na virada da hora

/** Cria um enviador apontado para o CC falso, com a fonte de usuários injetada e a hora fixa. */
function criar(cc, consultar, extra = {}) {
  const logs = []
  const r = mod.criarRetratoUsuarios({
    base: `http://127.0.0.1:${cc.porta}/api`,
    slug: 'freela',
    segredo: SEGREDO,
    consultar,
    balde: () => BALDE,
    pausaMs: 5,
    timeoutPrimeiraMs: 2000,
    timeoutDemaisMs: 2000,
    log: { info: (m) => logs.push(m), erro: (m) => logs.push(m) },
    ...extra,
  })
  return { r, logs }
}

const linha = (id, extra = {}) => ({
  id: String(id),
  usuario: `usuario${id}`,
  email: `usuario${id}@exemplo.com`,
  role: 'profissional',
  ativo: true,
  created_at: new Date('2026-01-02T03:04:05Z'),
  prof_nome: `Pessoa ${id}`,
  ...extra,
})

const esperar = async (cond, ms = 4000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 15))
  }
  return cond()
}

function assinaturaConfere(r) {
  const ts = r.headers['x-doca-timestamp']
  const esperada = createHmac('sha256', SEGREDO).update(`${ts}.${r.bruto}`, 'utf8').digest('hex')
  return esperada === r.headers['x-doca-signature'] && Math.abs(Date.now() / 1000 - Number(ts)) < 60
}

function rodarFilho(args, env, ms = 20_000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const ambiente = { ...process.env, ...env }
    for (const k of VARS) if (!(k in env)) delete ambiente[k]
    const filho = spawn(process.execPath, args, { env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    filho.stdout.on('data', (d) => (out += d))
    filho.stderr.on('data', (d) => (err += d))
    const limite = setTimeout(() => filho.kill(), ms)
    filho.on('exit', (codigo) => {
      clearTimeout(limite)
      resolve({ codigo, out, err, ms: Date.now() - t0 })
    })
  })
}

// ---------- Funções puras ----------

test('papel: super, admin, empresa e profissional; qualquer outro valor vira profissional', () => {
  assert.equal(mod.mapearPapel('super'), 'super')
  assert.equal(mod.mapearPapel(' ADMIN '), 'admin')
  assert.equal(mod.mapearPapel('empresa'), 'empresa')
  assert.equal(mod.mapearPapel('profissional'), 'profissional')
  assert.equal(mod.mapearPapel('gestor'), 'profissional')
  assert.equal(mod.mapearPapel(null), 'profissional')
  assert.equal(mod.mapearPapel(undefined), 'profissional')
})

test('payload do usuário: campos pedidos, ativo com status "offline", nome com alternativas', () => {
  assert.deepEqual(mod.montarPayloadUsuario(linha(1)), {
    external_id: '1',
    name: 'Pessoa 1',
    role_code: 'profissional',
    email: 'usuario1@exemplo.com',
    username: 'usuario1',
    created_at: '2026-01-02T03:04:05.000Z',
    status: 'offline',
  })
  // empresa: nome fantasia, depois razão social
  assert.equal(mod.montarPayloadUsuario(linha(2, { role: 'empresa', prof_nome: null, emp_fantasia: 'Loja X', emp_razao: 'Loja X Ltda' })).name, 'Loja X')
  assert.equal(mod.montarPayloadUsuario(linha(3, { role: 'empresa', prof_nome: null, emp_razao: 'Loja Y Ltda' })).name, 'Loja Y Ltda')
  // sem nome de perfil: usuário, depois e-mail, depois id
  assert.equal(mod.montarPayloadUsuario(linha(4, { prof_nome: null })).name, 'usuario4')
  assert.equal(mod.montarPayloadUsuario(linha(5, { prof_nome: null, usuario: null })).name, 'usuario5@exemplo.com')
  assert.equal(mod.montarPayloadUsuario({ id: '6', role: 'admin', ativo: true }).name, '6')
  // username: sem usuário usa o começo do e-mail
  assert.equal(mod.montarPayloadUsuario(linha(7, { usuario: null })).username, 'usuario7')
  // sem id não há o que enviar
  assert.equal(mod.montarPayloadUsuario({ email: 'a@b.com' }), null)
  assert.equal(mod.montarPayloadUsuario(null), null)
})

test('inativo ou perfil bloqueado vira "blocked"; ativo (inclusive pendente e recusado) vira "offline"', () => {
  assert.equal(mod.montarPayloadUsuario(linha(1, { ativo: false })).status, 'blocked')
  assert.equal(mod.montarPayloadUsuario(linha(2, { prof_status: 'bloqueado' })).status, 'blocked')
  assert.equal(mod.montarPayloadUsuario(linha(3, { role: 'empresa', emp_status: 'bloqueada' })).status, 'blocked')
  for (const s of ['pendente', 'aprovado', 'recusado']) {
    assert.equal(mod.montarPayloadUsuario(linha(4, { prof_status: s })).status, 'offline', s)
  }
  assert.equal(mod.montarPayloadUsuario(linha(5, { emp_status: 'aprovada' })).status, 'offline')
})

test('status só pode ser "blocked" ou "offline": nunca "online" nem "never"', () => {
  const variacoes = [
    {},
    { ativo: false },
    { ativo: null },
    { ativo: undefined },
    { prof_status: 'bloqueado' },
    { prof_status: 'aprovado', emp_status: 'aprovada' },
    { role: 'admin' },
    { role: 'estranho' },
  ]
  for (const v of variacoes) {
    const st = mod.montarPayloadUsuario(linha(1, v)).status
    assert.ok(st === 'blocked' || st === 'offline', JSON.stringify(v))
  }
})

test('hash do payload muda entre bloqueado e ativo (o desbloqueio vira um evento diferente)', () => {
  const bloqueado = mod.montarPayloadUsuario(linha(1, { ativo: false }))
  const ativo = mod.montarPayloadUsuario(linha(1, { ativo: true }))
  assert.notEqual(mod.hashPayload(bloqueado), mod.hashPayload(ativo))
  assert.notEqual(mod.chaveIdempotencia('freela', '1', bloqueado, BALDE), mod.chaveIdempotencia('freela', '1', ativo, BALDE))
})

test('campos sensíveis NUNCA entram no payload, mesmo que a linha os traga', () => {
  const sentinelas = {
    senha_hash: 'scrypt$16384$8$1$SEGREDO-HASH',
    token: 'tok-SEGREDO-123',
    verify_token: 'vt-SEGREDO',
    telefone: '11999990000',
    cpf: '123.456.789-09',
    rg: '12.345.678-9',
    endereco: { rua: 'Rua SEGREDO', cep: '01001000' },
    curriculo: 'texto SEGREDO do currículo',
    foto: 'data:image/png;base64,SEGREDO',
    pix: 'pix-SEGREDO',
    banco: 'banco-SEGREDO',
    payload: { cpf: '000', telefone: '111' },
    aceites: { x: 1 },
    nivel_hierarquia: 'super',
    superior_usuario: 'fulano',
  }
  const payload = mod.montarPayloadUsuario(linha(1, sentinelas))
  for (const k of Object.keys(payload)) assert.ok(mod.CAMPOS_PERMITIDOS.includes(k), `campo inesperado: ${k}`)
  const texto = JSON.stringify(payload)
  assert.equal(texto.includes('SEGREDO'), false)
  assert.equal(texto.includes('11999990000'), false)
  assert.equal(texto.includes('123.456.789'), false)
})

test('a consulta é um único SELECT, sem colunas sensíveis e sem escrita', () => {
  const sql = mod.SQL_USUARIOS
  assert.match(sql, /^\s*select\b/i)
  assert.match(sql, /\blimit\s+\$1\b/i)
  assert.equal(sql.includes(';'), false)
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|create|grant|copy)\b/i)
  assert.doesNotMatch(sql, /senha|hash|token|telefone|cpf|\brg\b|endereco|curriculo|foto|pix|banco|mao_credenciais|mao_email_codigos/i)
  // do perfil só sai o nome (e o status); nunca o payload inteiro
  assert.doesNotMatch(sql, /\bpayload\s*(,|\bfrom\b|\bas\b)/i)
  assert.equal(mod.LIMITE_USUARIOS, 2000)
})

test('canônico e hash do payload: a ordem das chaves não importa; sha1[:12]', () => {
  const a = { external_id: '9', name: 'Ana', role_code: 'profissional' }
  const b = { role_code: 'profissional', name: 'Ana', external_id: '9' }
  assert.equal(mod.canonizar(a), mod.canonizar(b))
  assert.equal(mod.hashPayload(a), mod.hashPayload(b))
  assert.equal(mod.hashPayload(a), createHash('sha1').update('{"external_id":"9","name":"Ana","role_code":"profissional"}').digest('hex').slice(0, 12))
  assert.notEqual(mod.hashPayload(a), mod.hashPayload({ ...a, name: 'Ana Maria' }))
})

test('balde por hora em UTC (AAAAMMDDHH): zeros à esquerda e virada de hora, dia e ano', () => {
  assert.equal(mod.baldeHoraUtc(new Date('2026-11-18T22:03:53Z')), '2026111822')
  assert.equal(mod.baldeHoraUtc(new Date('2026-01-02T03:04:05Z')), '2026010203')
  assert.equal(mod.baldeHoraUtc(new Date('2026-11-18T22:59:59.999Z')), '2026111822')
  assert.equal(mod.baldeHoraUtc(new Date('2026-11-18T23:00:00.000Z')), '2026111823')
  assert.equal(mod.baldeHoraUtc(new Date('2026-12-31T23:59:59.999Z')), '2026123123')
  assert.equal(mod.baldeHoraUtc(new Date('2027-01-01T00:00:00.000Z')), '2027010100')
  // é UTC, não a hora local: -03:00 às 21h local = 00h UTC do dia seguinte
  assert.equal(mod.baldeHoraUtc(new Date('2026-11-18T21:00:00-03:00')), '2026111900')
  assert.match(mod.baldeHoraUtc(), /^\d{10}$/)
})

test('chave de idempotência: snap:slug:id:sha1[:12][-rN]:AAAAMMDDHH e, na remoção, snap:slug:id:deleted[-rN]:AAAAMMDDHH', () => {
  const a = { external_id: '9', name: 'Ana', role_code: 'profissional', status: 'offline' }
  const hash = mod.hashPayload(a)
  assert.equal(mod.chaveIdempotencia('freela', '9', a, '2026111810'), `snap:freela:9:${hash}:2026111810`)
  assert.equal(mod.chaveIdempotencia('freela', '9', a, '2026111810', 2), `snap:freela:9:${hash}-r2:2026111810`)
  assert.equal(mod.chaveExclusao('freela', '9', '2026111810'), 'snap:freela:9:deleted:2026111810')
  assert.equal(mod.chaveExclusao('freela', '9', '2026111810', 1), 'snap:freela:9:deleted-r1:2026111810')
  assert.match(mod.chaveIdempotencia('freela', '9', a), /^snap:freela:9:[0-9a-f]{12}:\d{10}$/, 'sem balde informado usa a hora UTC atual')
  assert.notEqual(mod.chaveIdempotencia('freela', '9', a, '2026111810'), mod.chaveIdempotencia('freela', '9', a, '2026111811'))
})

test('intervalo: padrão 10 minutos, mínimo 2, nunca passa de 1 dia', () => {
  assert.equal(mod.lerIntervaloMin(undefined), 10)
  assert.equal(mod.lerIntervaloMin(''), 10)
  assert.equal(mod.lerIntervaloMin('abc'), 10)
  assert.equal(mod.lerIntervaloMin('5'), 5)
  assert.equal(mod.lerIntervaloMin('1'), 2)
  assert.equal(mod.lerIntervaloMin('0'), 2)
  assert.equal(mod.lerIntervaloMin('-3'), 2)
  assert.equal(mod.lerIntervaloMin('999999'), 1440)
})

// ---------- Envio ao Control Center ----------

test('envia user.updated assinado (HMAC) no formato do Control Center, um por vez e com pausa entre eventos', async () => {
  const cc = await novoCC()
  try {
    const { r, logs } = criar(cc, async () => [linha(1), linha(2, { role: 'admin' }), linha(3)], { pausaMs: 100 })
    const res = await r.executarCiclo()
    assert.equal(res.enviados, 3)
    assert.equal(res.novos, 3)
    assert.equal(res.interrompido, false)
    assert.equal(cc.recebidos.length, 3)
    for (const rec of cc.recebidos) {
      assert.equal(rec.metodo, 'POST')
      assert.equal(rec.url, '/api/webhooks/freela')
      assert.equal(rec.headers['content-type'], 'application/json')
      assert.ok(assinaturaConfere(rec), 'assinatura HMAC confere e o horário é recente')
      assert.match(rec.headers['x-doca-timestamp'], /^\d{10}$/)
      assert.deepEqual(Object.keys(rec.corpo).sort(), ['event_type', 'idempotency_key', 'occurred_at', 'payload', 'system_slug'])
      assert.equal(rec.corpo.event_type, 'user.updated')
      assert.equal(rec.corpo.system_slug, 'freela')
      assert.equal(rec.corpo.idempotency_key, rec.headers['x-doca-idempotency-key'])
      assert.match(rec.corpo.idempotency_key, /^snap:freela:\d+:[0-9a-f]{12}:2026111810$/)
      assert.equal(rec.corpo.payload.status, 'offline')
      assert.equal(new Date(rec.corpo.occurred_at).toISOString(), rec.corpo.occurred_at)
    }
    assert.deepEqual(cc.recebidos.map((x) => x.corpo.payload.external_id), ['1', '2', '3'])
    assert.equal(cc.recebidos[1].corpo.payload.role_code, 'admin')
    assert.equal(cc.maxEmVoo(), 1, 'envio sequencial')
    for (let i = 1; i < cc.recebidos.length; i++) {
      assert.ok(cc.recebidos[i].t - cc.recebidos[i - 1].t >= 90, 'pausa de ~100 ms entre eventos')
    }
    // log: só contagens, sem dados de ninguém nem segredo
    assert.deepEqual(logs, ['Retrato de usuários: 3 enviados, 3 novos'])
  } finally {
    await cc.fechar()
  }
})

test('o que sai do sistema não contém campo sensível (corpo bruto inteiro)', async () => {
  const cc = await novoCC()
  try {
    const sujas = [
      linha(1, { senha_hash: 'scrypt$HASH-SECRETO', token: 'TOKEN-SECRETO', telefone: '11988887777', cpf: '111.222.333-44', foto: 'FOTO-SECRETA', endereco: 'RUA-SECRETA', payload: { curriculo: 'CV-SECRETO' } }),
    ]
    const { r } = criar(cc, async () => sujas)
    await r.executarCiclo()
    assert.equal(cc.recebidos.length, 1)
    const bruto = cc.recebidos[0].bruto
    for (const proibido of ['SECRETO', 'SECRETA', '11988887777', '111.222.333-44', 'scrypt$']) {
      assert.equal(bruto.includes(proibido), false, proibido)
    }
    for (const k of Object.keys(cc.recebidos[0].corpo.payload)) assert.ok(mod.CAMPOS_PERMITIDOS.includes(k), k)
  } finally {
    await cc.fechar()
  }
})

test('inativo vai com status "blocked"; ativo vai com "offline" (nunca "online" nem "never")', async () => {
  const cc = await novoCC()
  try {
    const { r } = criar(cc, async () => [linha(1), linha(2, { ativo: false }), linha(3, { prof_status: 'bloqueado' })])
    await r.executarCiclo()
    const porId = Object.fromEntries(cc.recebidos.map((x) => [x.corpo.payload.external_id, x.corpo.payload]))
    assert.equal(porId['1'].status, 'offline')
    assert.equal(porId['2'].status, 'blocked')
    assert.equal(porId['3'].status, 'blocked')
    for (const rec of cc.recebidos) assert.ok(['blocked', 'offline'].includes(rec.corpo.payload.status))
  } finally {
    await cc.fechar()
  }
})

test('quem sumiu desde o ciclo anterior recebe user.deleted (uma vez só)', async () => {
  const cc = await novoCC()
  try {
    let lista = [linha(1), linha(2), linha(3)]
    const { r, logs } = criar(cc, async () => lista)
    await r.executarCiclo()
    assert.equal(cc.recebidos.filter((x) => x.corpo.event_type === 'user.deleted').length, 0, 'primeiro ciclo não apaga ninguém')
    lista = [linha(1), linha(3)]
    const antes = cc.recebidos.length
    const res = await r.executarCiclo()
    const novos = cc.recebidos.slice(antes)
    const apagados = novos.filter((x) => x.corpo.event_type === 'user.deleted')
    assert.equal(apagados.length, 1)
    assert.deepEqual(apagados[0].corpo.payload, { external_id: '2' })
    assert.ok(assinaturaConfere(apagados[0]))
    assert.equal(apagados[0].corpo.idempotency_key, 'snap:freela:2:deleted:2026111810')
    assert.equal(res.excluidos, 1)
    assert.match(logs.at(-1), /1 removidos/)
    // ciclo seguinte: já foi, não repete
    const antes2 = cc.recebidos.length
    await r.executarCiclo()
    assert.equal(cc.recebidos.slice(antes2).filter((x) => x.corpo.event_type === 'user.deleted').length, 0)
  } finally {
    await cc.fechar()
  }
})

test('user.deleted que falhou na entrega é repetido no ciclo seguinte (mesma chave)', async () => {
  const cc = await novoCC({ status: (n, corpo) => (corpo?.event_type === 'user.deleted' && n < 5 ? 500 : 201) })
  try {
    let lista = [linha(1), linha(2)]
    const { r } = criar(cc, async () => lista)
    await r.executarCiclo() // 2 eventos
    lista = [linha(1)]
    await r.executarCiclo() // 1 update + 1 delete que falha (500)
    const tentativa1 = cc.recebidos.filter((x) => x.corpo.event_type === 'user.deleted')
    assert.equal(tentativa1.length, 1)
    cc.config.status = 201
    const res = await r.executarCiclo()
    const todas = cc.recebidos.filter((x) => x.corpo.event_type === 'user.deleted')
    assert.equal(todas.length, 2)
    assert.equal(todas[1].corpo.idempotency_key, todas[0].corpo.idempotency_key, 'mesma hora: mesma chave')
    assert.equal(res.excluidos, 1)
  } finally {
    await cc.fechar()
  }
})

test('user.deleted que continua sem entrega na hora seguinte sai com chave nova (o CC processa de novo)', async () => {
  const cc = await novoCC({ status: (n, corpo) => (corpo?.event_type === 'user.deleted' ? 500 : 201) })
  try {
    let hora = '2026111810'
    let lista = [linha(1), linha(2)]
    const { r } = criar(cc, async () => lista, { balde: () => hora })
    await r.executarCiclo()
    lista = [linha(1)]
    await r.executarCiclo() // delete falha
    hora = '2026111811'
    cc.config.status = 201
    const res = await r.executarCiclo()
    const dels = cc.recebidos.filter((x) => x.corpo.event_type === 'user.deleted').map((x) => x.corpo.idempotency_key)
    assert.deepEqual(dels, ['snap:freela:2:deleted:2026111810', 'snap:freela:2:deleted:2026111811'])
    assert.equal(res.excluidos, 1)
  } finally {
    await cc.fechar()
  }
})

test('usuário que volta e some de novo na mesma hora ganha chave de remoção diferente (-r1)', async () => {
  const cc = await novoCC()
  try {
    let lista = [linha(1), linha(2)]
    const { r } = criar(cc, async () => lista)
    await r.executarCiclo()
    lista = [linha(1)]
    await r.executarCiclo() // 2 removido
    lista = [linha(1), linha(2)]
    await r.executarCiclo() // 2 volta
    lista = [linha(1)]
    await r.executarCiclo() // 2 removido de novo
    const dels = cc.recebidos.filter((x) => x.corpo.event_type === 'user.deleted').map((x) => x.corpo.idempotency_key)
    assert.deepEqual(dels, ['snap:freela:2:deleted:2026111810', 'snap:freela:2:deleted-r1:2026111810'])
  } finally {
    await cc.fechar()
  }
})

test('lista vazia ou no limite não prova exclusão: ninguém é apagado', async () => {
  const cc = await novoCC()
  try {
    let lista = [linha(1), linha(2)]
    const { r } = criar(cc, async () => lista, { limite: 3 })
    await r.executarCiclo() // 2 usuários: lista completa
    lista = [linha(1), linha(8), linha(9)] // 3 = o limite: pode estar truncada; o 2 "sumiu", mas não prova nada
    const res = await r.executarCiclo()
    assert.equal(res.truncada, true)
    assert.equal(cc.recebidos.filter((x) => x.corpo.event_type === 'user.deleted').length, 0)

    const cc2 = await novoCC()
    try {
      let l2 = [linha(1), linha(2)]
      const { r: r2 } = criar(cc2, async () => l2)
      await r2.executarCiclo()
      l2 = []
      await r2.executarCiclo()
      assert.equal(cc2.recebidos.filter((x) => x.corpo.event_type === 'user.deleted').length, 0, 'lista vazia não apaga')
    } finally {
      await cc2.fechar()
    }
  } finally {
    await cc.fechar()
  }
})

test('idempotência: mesma chave quando nada muda, outra quando algo muda, e nova quando volta ao estado antigo', async () => {
  const cc = await novoCC()
  try {
    let lista = [linha(1), linha(2)]
    const { r } = criar(cc, async () => lista)
    const chavesDe = (de) => cc.recebidos.slice(de).map((x) => x.corpo.idempotency_key)

    await r.executarCiclo()
    const ciclo1 = chavesDe(0)
    assert.equal(ciclo1.length, 2)

    let marca = cc.recebidos.length
    const res2 = await r.executarCiclo() // nada mudou
    assert.deepEqual(chavesDe(marca), ciclo1, 'mesmas chaves quando nada muda')
    assert.equal(res2.enviados, 2)
    assert.equal(res2.novos, 0, 'o CC já conhecia os eventos (duplicados)')

    marca = cc.recebidos.length
    lista = [linha(1), linha(2, { prof_nome: 'Outro Nome' })] // mudou o usuário 2
    await r.executarCiclo()
    const ciclo3 = chavesDe(marca)
    assert.equal(ciclo3[0], ciclo1[0], 'o usuário 1 não mudou: mesma chave')
    assert.notEqual(ciclo3[1], ciclo1[1], 'o usuário 2 mudou: chave nova')

    // bloqueia e desbloqueia o usuário 1: a chave "pura" do estado original já foi usada
    marca = cc.recebidos.length
    lista = [linha(1, { ativo: false }), linha(2, { prof_nome: 'Outro Nome' })]
    await r.executarCiclo()
    const bloqueado = chavesDe(marca)[0]
    marca = cc.recebidos.length
    lista = [linha(1), linha(2, { prof_nome: 'Outro Nome' })]
    await r.executarCiclo()
    const desbloqueado = chavesDe(marca)[0]
    assert.notEqual(bloqueado, ciclo1[0])
    assert.notEqual(desbloqueado, ciclo1[0], 'voltar ao estado antigo NÃO reaproveita a chave (o CC ignoraria o evento)')
    assert.match(desbloqueado, /^snap:freela:1:[0-9a-f]{12}-r1:2026111810$/)
    marca = cc.recebidos.length
    await r.executarCiclo() // segue desbloqueado: a chave nova continua estável
    assert.equal(chavesDe(marca)[0], desbloqueado)
  } finally {
    await cc.fechar()
  }
})

test('hora na chave: estável dentro da mesma hora, nova na hora seguinte; todas terminam em :AAAAMMDDHH', async () => {
  const cc = await novoCC()
  try {
    let hora = '2026111810'
    const lista = [linha(1), linha(2)]
    const { r } = criar(cc, async () => lista, { balde: () => hora })
    const chavesDe = (de) => cc.recebidos.slice(de).map((x) => x.corpo.idempotency_key)

    await r.executarCiclo()
    const h10 = chavesDe(0)
    for (const k of h10) assert.match(k, /^snap:freela:\d+:[0-9a-f]{12}:2026111810$/)

    let marca = cc.recebidos.length
    const res = await r.executarCiclo() // mesma hora, nada mudou
    assert.deepEqual(chavesDe(marca), h10, 'mesma hora e mesmo dado: mesma chave (o CC ignora a repetida)')
    assert.equal(res.novos, 0)

    hora = '2026111811' // virou a hora, mesmo dado
    marca = cc.recebidos.length
    const res2 = await r.executarCiclo()
    const h11 = chavesDe(marca)
    for (const k of h11) assert.match(k, /^snap:freela:\d+:[0-9a-f]{12}:2026111811$/)
    for (let i = 0; i < h10.length; i++) {
      assert.notEqual(h11[i], h10[i], 'hora seguinte: chave nova mesmo sem mudança de dado')
      assert.equal(h11[i].replace(/:2026111811$/, ''), h10[i].replace(/:2026111810$/, ''), 'só a hora mudou')
    }
    assert.equal(res2.novos, 2, 'o CC processa de novo: divergência reparada em até 1 hora')

    marca = cc.recebidos.length
    await r.executarCiclo() // segue na mesma hora 11
    assert.deepEqual(chavesDe(marca), h11)
  } finally {
    await cc.fechar()
  }
})

test('reinício do processo: na mesma hora repete a chave (sem trabalho a mais); na hora seguinte a chave é nova', async () => {
  const cc = await novoCC()
  try {
    const lista = [linha(1)]
    const antes = criar(cc, async () => lista).r
    await antes.executarCiclo()
    const k0 = cc.recebidos.at(-1).corpo.idempotency_key

    // "reinício": memória nova, mesma hora
    const depoisMesmaHora = criar(cc, async () => lista).r
    await depoisMesmaHora.executarCiclo()
    assert.equal(cc.recebidos.at(-1).corpo.idempotency_key, k0)

    // "reinício" na hora seguinte
    const depoisOutraHora = criar(cc, async () => lista, { balde: () => '2026111811' }).r
    await depoisOutraHora.executarCiclo()
    const k1 = cc.recebidos.at(-1).corpo.idempotency_key
    assert.notEqual(k1, k0)
    assert.match(k1, /:2026111811$/)
  } finally {
    await cc.fechar()
  }
})

test('desbloqueio gera chave diferente do bloqueio (e o payload do desbloqueio traz "offline")', async () => {
  const cc = await novoCC()
  try {
    let lista = [linha(1, { ativo: false })]
    const { r } = criar(cc, async () => lista)
    await r.executarCiclo()
    lista = [linha(1, { ativo: true })]
    await r.executarCiclo()
    const [bloqueio, desbloqueio] = cc.recebidos
    assert.equal(bloqueio.corpo.payload.status, 'blocked')
    assert.equal(desbloqueio.corpo.payload.status, 'offline')
    assert.notEqual(desbloqueio.corpo.idempotency_key, bloqueio.corpo.idempotency_key)
    // mesmo na mesma hora e depois de voltar a bloquear e desbloquear de novo
    lista = [linha(1, { ativo: false })]
    await r.executarCiclo()
    lista = [linha(1, { ativo: true })]
    await r.executarCiclo()
    const chaves = cc.recebidos.map((x) => x.corpo.idempotency_key)
    assert.equal(new Set(chaves).size, 4, 'quatro transições, quatro chaves diferentes')
  } finally {
    await cc.fechar()
  }
})

test('sem balde injetado usa a hora UTC atual (virada de hora durante o teste tolerada)', async () => {
  const cc = await novoCC()
  try {
    const { r } = criar(cc, async () => [linha(1)], { balde: undefined })
    const a = mod.baldeHoraUtc()
    await r.executarCiclo()
    const b = mod.baldeHoraUtc()
    const sufixo = cc.recebidos[0].corpo.idempotency_key.split(':').at(-1)
    assert.ok(sufixo === a || sufixo === b, `${sufixo} deveria ser ${a} (ou ${b})`)
  } finally {
    await cc.fechar()
  }
})

// ---------- Robustez ----------

test('Control Center devolvendo 500: interrompe após 3 falhas seguidas e tenta de novo no ciclo seguinte', async () => {
  const cc = await novoCC({ status: 500 })
  try {
    const { r, logs } = criar(cc, async () => Array.from({ length: 10 }, (_, i) => linha(i + 1)))
    const res = await r.executarCiclo()
    assert.equal(res.interrompido, true)
    assert.equal(res.falhas, 3)
    assert.equal(res.enviados, 0)
    assert.equal(cc.recebidos.length, 3, 'parou depois da 3ª falha seguida')
    assert.match(logs.at(-1), /interrompido após 3 falhas seguidas/)

    cc.config.status = 201
    const res2 = await r.executarCiclo()
    assert.equal(res2.interrompido, false)
    assert.equal(res2.enviados, 10)
    assert.equal(cc.recebidos.length, 13)
  } finally {
    await cc.fechar()
  }
})

test('falhas que não são seguidas não interrompem o ciclo', async () => {
  const cc = await novoCC({ status: (n) => (n % 2 === 0 ? 500 : 201) })
  try {
    const { r } = criar(cc, async () => Array.from({ length: 6 }, (_, i) => linha(i + 1)))
    const res = await r.executarCiclo()
    assert.equal(res.interrompido, false)
    assert.equal(res.falhas, 3)
    assert.equal(res.enviados, 3)
    assert.equal(cc.recebidos.length, 6)
  } finally {
    await cc.fechar()
  }
})

test('Control Center fora do ar (porta fechada): nada é lançado, o ciclo termina e não vaza dado no log', async () => {
  const cc = await novoCC()
  const porta = cc.porta
  await cc.fechar()
  const logs = []
  const r = mod.criarRetratoUsuarios({
    base: `http://127.0.0.1:${porta}/api`,
    slug: 'freela',
    segredo: SEGREDO,
    consultar: async () => [linha(1), linha(2), linha(3), linha(4)],
    pausaMs: 1,
    log: { info: (m) => logs.push(m), erro: (m) => logs.push(m) },
  })
  const res = await r.executarCiclo()
  assert.equal(res.interrompido, true)
  assert.equal(res.enviados, 0)
  const todo = logs.join('\n')
  for (const proibido of ['exemplo.com', 'Pessoa', 'usuario1', SEGREDO]) assert.equal(todo.includes(proibido), false, proibido)
  assert.match(todo, /sem conexão/)
})

test('Control Center lento: respeita o limite de tempo, não trava nem lança', async () => {
  const cc = await novoCC({ atrasoMs: 1500 })
  try {
    const { r, logs } = criar(cc, async () => Array.from({ length: 5 }, (_, i) => linha(i + 1)), { timeoutPrimeiraMs: 200, timeoutDemaisMs: 200 })
    const t0 = Date.now()
    const res = await r.executarCiclo()
    assert.ok(Date.now() - t0 < 1400, 'não esperou a resposta lenta')
    assert.equal(res.interrompido, true)
    assert.equal(res.falhas, 3)
    assert.match(logs.at(-1), /tempo esgotado/)
  } finally {
    await cc.fechar()
  }
})

test('Control Center acordando: a 1ª requisição aguarda mais; as seguintes têm limite curto', async () => {
  // 1ª resposta leva 500 ms (cabe no limite longo de 3 s); depois a 3ª leva 600 ms (estoura o curto de 200 ms).
  const cc = await novoCC({ atrasoMs: (n) => (n === 0 ? 500 : n === 2 ? 600 : 0) })
  try {
    const { r } = criar(cc, async () => Array.from({ length: 5 }, (_, i) => linha(i + 1)), { timeoutPrimeiraMs: 3000, timeoutDemaisMs: 200 })
    const res = await r.executarCiclo()
    assert.equal(res.interrompido, false)
    assert.equal(res.falhas, 1, 'só a lenta falhou')
    assert.equal(res.enviados, 4, 'a 1ª (lenta, mas dentro do limite longo) foi aceita')
  } finally {
    await cc.fechar()
  }
})

test('falha ao ler os usuários: nada é lançado, nada é enviado e o erro (que pode ter dados) não vai ao log', async () => {
  const cc = await novoCC()
  try {
    const { r, logs } = criar(cc, async () => {
      const e = new Error('senha=SENHA-NO-ERRO host=banco.interno')
      e.code = 'ECONNREFUSED'
      throw e
    })
    const res = await r.executarCiclo()
    assert.equal(res.erro, 'consulta')
    assert.equal(cc.recebidos.length, 0)
    assert.equal(logs.length, 1)
    assert.match(logs[0], /ECONNREFUSED/)
    assert.equal(logs[0].includes('SENHA-NO-ERRO'), false)
    // e o próximo ciclo funciona normalmente
    const { r: r2 } = criar(cc, async () => [linha(1)])
    assert.equal((await r2.executarCiclo()).enviados, 1)
  } finally {
    await cc.fechar()
  }
})

test('linhas estranhas na fonte não derrubam o ciclo', async () => {
  const cc = await novoCC()
  try {
    const { r } = criar(cc, async () => [null, 42, {}, { id: '' }, linha(1), linha(1), linha(2)])
    const res = await r.executarCiclo()
    assert.equal(res.enviados, 2, 'sem id ignora; id repetido vale uma vez')
  } finally {
    await cc.fechar()
  }
})

// ---------- Desligado ----------

test('sem as variáveis o módulo fica DESLIGADO: nada agendado, nada consultado', async () => {
  let consultas = 0
  const consultar = async () => {
    consultas++
    return []
  }
  const casos = [
    {},
    { base: 'http://x/api', slug: 'freela' }, // falta o segredo
    { base: 'http://x/api', segredo: SEGREDO }, // falta o slug
    { slug: 'freela', segredo: SEGREDO }, // falta a URL
    { base: 'http://x/api', slug: 'freela', segredo: 'curto' }, // segredo curto demais
  ]
  for (const c of casos) {
    const r = mod.criarRetratoUsuarios({ ...c, consultar, primeiroAtrasoMs: 1, intervaloMs: 1 })
    assert.equal(r.ativo, false)
    r.iniciar()
    assert.equal(r.estado().iniciado, false)
    assert.deepEqual(await r.executarCiclo(), { ignorado: true, motivo: 'desligado' })
  }
  await new Promise((res) => setTimeout(res, 40))
  assert.equal(consultas, 0)

  // o módulo importado sem variáveis (como no contêiner sem configuração)
  const m = await carregar({})
  assert.equal(m.retratoAtivo, false)
  assert.equal(m.retrato.estado().iniciado, false)
  assert.equal((await m.retrato.executarCiclo()).ignorado, true)
})

test('com as variáveis o módulo se auto-inicia ao ser importado e o agendamento não segura o processo', async () => {
  const cc = await novoCC()
  try {
    const m = await carregar({ DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_SYSTEM_SLUG: 'freela', DOCA_CC_WEBHOOK_SECRET: SEGREDO, DOCA_CC_SNAPSHOT_MIN: '1' })
    assert.equal(m.retratoAtivo, true)
    assert.deepEqual(m.retrato.estado(), { ativo: true, iniciado: true, executando: false })
    m.retrato.parar()
    assert.equal(m.retrato.estado().iniciado, false)

    // processo de verdade: importa (iniciando o timer de ~45 s) e encerra logo, sem esperar o ciclo
    const href = pathToFileURL(ARQUIVO).href
    const env = { DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_SYSTEM_SLUG: 'freela', DOCA_CC_WEBHOOK_SECRET: SEGREDO }
    const filho = await rodarFilho(['--input-type=module', '-e', `const m = await import(${JSON.stringify(href)}); console.log(JSON.stringify(m.retrato.estado()))`], env)
    assert.equal(filho.codigo, 0, filho.err)
    assert.deepEqual(JSON.parse(filho.out.trim()), { ativo: true, iniciado: true, executando: false })
    assert.ok(filho.ms < 10_000, `o processo encerrou em ${filho.ms} ms (timer com unref)`)
    assert.equal(cc.recebidos.length, 0, 'o 1º ciclo só acontece ~45 s depois')
  } finally {
    await cc.fechar()
  }
})

test('carregado como no contêiner (NODE_OPTIONS --import=data:...): inofensivo, com ou sem variáveis, e não impede o app de encerrar', async () => {
  const cc = await novoCC()
  try {
    const href = pathToFileURL(ARQUIVO).href
    const wrapper = (alvo) => `--import=data:text/javascript,import('${alvo}').catch(()=>{})`
    const app = ['-e', "console.log('app rodou')"]
    const comVars = { DOCA_CC_URL: `http://127.0.0.1:${cc.porta}/api`, DOCA_CC_SYSTEM_SLUG: 'freela', DOCA_CC_WEBHOOK_SECRET: SEGREDO }

    for (const env of [{}, comVars]) {
      const f = await rodarFilho(app, { ...env, NODE_OPTIONS: wrapper(href) })
      assert.equal(f.codigo, 0, f.err)
      assert.match(f.out, /app rodou/)
      assert.equal(f.err.trim(), '', 'sem erro nem aviso no stderr')
      assert.ok(f.ms < 10_000)
    }
    // arquivo ausente: a falha do import é engolida pelo .catch e o app roda igual
    const ausente = await rodarFilho(app, { ...comVars, NODE_OPTIONS: wrapper(pathToFileURL(path.join(aqui, 'nao-existe.mjs')).href) })
    assert.equal(ausente.codigo, 0, ausente.err)
    assert.match(ausente.out, /app rodou/)
    assert.equal(cc.recebidos.length, 0)
  } finally {
    await cc.fechar()
  }
})

// ---------- Um ciclo por vez ----------

test('ciclo único: chamadas simultâneas não se sobrepõem', async () => {
  const cc = await novoCC()
  try {
    let liberar
    const portao = new Promise((r) => (liberar = r))
    let consultas = 0
    const { r } = criar(cc, async () => {
      consultas++
      await portao
      return [linha(1)]
    })
    const primeiro = r.executarCiclo()
    await esperar(() => r.estado().executando)
    const segundo = await r.executarCiclo()
    assert.deepEqual(segundo, { ignorado: true, motivo: 'em-andamento' })
    liberar()
    const res = await primeiro
    assert.equal(res.enviados, 1)
    assert.equal(consultas, 1)
    assert.equal(r.estado().executando, false)
    assert.equal((await r.executarCiclo()).enviados, 1, 'depois que termina, outro ciclo pode rodar')
    assert.equal(consultas, 2)
  } finally {
    await cc.fechar()
  }
})

test('agendamento: ciclos seguem um após o outro, nunca juntos, e parar() cancela', async () => {
  const cc = await novoCC()
  try {
    let ativos = 0
    let maximo = 0
    let chamadas = 0
    const { r } = criar(
      cc,
      async () => {
        chamadas++
        ativos++
        maximo = Math.max(maximo, ativos)
        await new Promise((res) => setTimeout(res, 60)) // ciclo mais longo que o intervalo
        ativos--
        return [linha(1)]
      },
      { primeiroAtrasoMs: 10, intervaloMs: 10 },
    )
    r.iniciar()
    r.iniciar() // iniciar duas vezes não cria dois agendamentos
    assert.equal(await esperar(() => chamadas >= 3, 5000), true)
    r.parar()
    const parouEm = chamadas
    await new Promise((res) => setTimeout(res, 250))
    assert.equal(maximo, 1, 'nunca dois ciclos ao mesmo tempo')
    assert.ok(chamadas <= parouEm + 1, 'depois de parar() só o ciclo em andamento termina')
  } finally {
    await cc.fechar()
  }
})

test('um ciclo com erro inesperado não impede os seguintes', async () => {
  const cc = await novoCC()
  try {
    let n = 0
    const { r } = criar(
      cc,
      async () => {
        n++
        if (n === 1) throw new TypeError('boom')
        return [linha(1)]
      },
      { primeiroAtrasoMs: 5, intervaloMs: 20 },
    )
    r.iniciar()
    assert.equal(await esperar(() => cc.recebidos.length >= 1, 3000), true)
    r.parar()
  } finally {
    await cc.fechar()
  }
})
