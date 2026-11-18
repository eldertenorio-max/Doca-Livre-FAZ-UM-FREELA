// Envia periodicamente ao Doca Livre Control Center o "retrato" dos usuários deste sistema
// (quantos há, quem está bloqueado, quem saiu), sem o Control Center ler o banco do sistema.
//
// Arquivo AUTOSSUFICIENTE: não importa nada do app (nem de control-center.mjs) e não exige editar
// server.js. Ao ser importado ele se auto-inicia (agenda os ciclos). Carregar no contêiner com:
//   NODE_OPTIONS=--import=data:text/javascript,import('file:///app/cc-usuarios.mjs').catch(()=>{})
// (caminho ABSOLUTO em file://: de dentro de uma URL data: o import relativo './cc-usuarios.mjs'
// falha com ERR_UNSUPPORTED_RESOLVE_REQUEST, e o .catch esconderia o motivo).
//
// Variáveis (sem as três primeiras o módulo é um no-op total: nada agendado, nada consultado):
//   DOCA_CC_URL             ex.: https://doca-livre-control-center.onrender.com/api
//   DOCA_CC_SYSTEM_SLUG     ex.: mao-de-obra
//   DOCA_CC_WEBHOOK_SECRET  segredo (HMAC) combinado com o Control Center, mínimo 16 caracteres
//   DOCA_CC_SNAPSHOT_MIN    (opcional) minutos entre ciclos; padrão 10, mínimo 2
//   PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT/PGSSL  as mesmas do app (abre o próprio pg.Pool, max 1)
//
// Garantias: nunca lança erro para fora nem afeta o app; só SELECT (em transação somente leitura),
// só as colunas necessárias, no máximo 2000 usuários; um ciclo por vez; envio sequencial; o log
// traz só contagens (nenhum dado de usuário, nenhum segredo).
//
// O que sai por usuário (user.updated): external_id, name, email, username, role_code, created_at
// e, só se estiver bloqueado, status = "blocked". Nada além disso (sem hash de senha, token,
// telefone, documento, endereço, currículo, foto).
import { createHash, createHmac } from 'node:crypto'

const PAPEIS = new Set(['super', 'admin', 'empresa', 'profissional'])
const LIMITE_USUARIOS = 2000
const CAMPOS_PERMITIDOS = ['external_id', 'name', 'email', 'username', 'role_code', 'created_at', 'status']

// Fonte dos usuários: contas do app (mao_contas), que são as que entram no sistema (rotasAuth.mjs).
// O nome vem só do campo `nome` do perfil profissional ou de `nomeFantasia`/`razaoSocial` do perfil
// de empresa (extraídos no banco; o resto do perfil, com CPF, telefone, endereço etc., nunca sai de lá).
// As colunas de status dos perfis só indicam "bloqueado". O hash de senha mora em mao_credenciais,
// que nem é consultada.
export const SQL_USUARIOS = `
select c.id, c.usuario, c.email, c.role, c.ativo, c.created_at,
       p.nome as prof_nome, p.status as prof_status,
       e.fantasia as emp_fantasia, e.razao as emp_razao, e.status as emp_status
from mao_contas c
left join lateral (
  select nullif(pr.payload->>'nome', '') as nome, pr.status
  from mao_profissionais pr where pr.user_id = c.id order by pr.updated_at desc, pr.id desc limit 1
) p on true
left join lateral (
  select nullif(em.payload->>'nomeFantasia', '') as fantasia, nullif(em.payload->>'razaoSocial', '') as razao, em.status
  from mao_empresas em where em.user_id = c.id order by em.updated_at desc, em.id desc limit 1
) e on true
order by c.created_at desc, c.id desc
limit $1`

// ---------- Funções puras (exportadas para teste) ----------

function texto(valor, max) {
  if (valor === null || valor === undefined) return undefined
  const s = String(valor).trim()
  return s ? s.slice(0, max) : undefined
}

function isoOuUndefined(valor) {
  if (valor === null || valor === undefined || valor === '') return undefined
  const d = valor instanceof Date ? valor : new Date(String(valor))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Papel do Control Center para este sistema: super, admin, empresa ou profissional (padrão). */
export function mapearPapel(role) {
  const r = String(role ?? '').trim().toLowerCase()
  return PAPEIS.has(r) ? r : 'profissional'
}

/** Conta desativada, ou perfil (profissional/empresa) bloqueado pela gestão. */
export function estaBloqueado(linha) {
  if (!linha) return false
  if (linha.ativo === false) return true
  return (
    String(linha.prof_status ?? '').toLowerCase() === 'bloqueado' ||
    String(linha.emp_status ?? '').toLowerCase() === 'bloqueada'
  )
}

/**
 * Linha do banco -> payload do user.updated. Só monta os campos permitidos (qualquer outra coluna
 * que venha na linha é ignorada). Ativo: sem `status`. Devolve null se a linha não tem id.
 */
export function montarPayloadUsuario(linha) {
  if (!linha || typeof linha !== 'object') return null
  const id = texto(linha.id, 200)
  if (!id) return null
  const email = texto(linha.email, 254)
  const usuario = texto(linha.usuario, 100)
  const nome =
    texto(linha.prof_nome, 200) ||
    texto(linha.emp_fantasia, 200) ||
    texto(linha.emp_razao, 200) ||
    usuario ||
    email ||
    id
  const username = usuario || (email ? texto(email.split('@')[0], 100) : undefined)
  const payload = { external_id: id, name: nome, role_code: mapearPapel(linha.role) }
  if (email) payload.email = email
  if (username) payload.username = username
  const criado = isoOuUndefined(linha.created_at)
  if (criado) payload.created_at = criado
  if (estaBloqueado(linha)) payload.status = 'blocked'
  return payload
}

/** JSON com as chaves em ordem alfabética (mesmo conteúdo => mesmo texto). */
export function canonizar(objeto) {
  const ordenado = {}
  for (const k of Object.keys(objeto).sort()) if (objeto[k] !== undefined) ordenado[k] = objeto[k]
  return JSON.stringify(ordenado)
}

/** 12 primeiros caracteres do sha1 do payload canônico. */
export function hashPayload(payload) {
  return createHash('sha1').update(canonizar(payload), 'utf8').digest('hex').slice(0, 12)
}

/** snap:{slug}:{id}:{sha1(payload canônico)[:12]} */
export function chaveIdempotencia(slug, id, payload) {
  return `snap:${slug}:${id}:${hashPayload(payload)}`
}

/** HMAC-SHA256 (hex) de "{timestamp}.{corpo bruto}", como o Control Center confere. */
export function assinar(segredo, carimbo, bruto) {
  return createHmac('sha256', segredo).update(`${carimbo}.${bruto}`, 'utf8').digest('hex')
}

/** DOCA_CC_SNAPSHOT_MIN -> minutos: vazio/inválido = 10; menor que 2 = 2; no máximo 1 dia (limite do setTimeout). */
export function lerIntervaloMin(valor) {
  const n = Number(String(valor ?? '').trim())
  if (!String(valor ?? '').trim() || !Number.isFinite(n)) return 10
  return Math.min(1440, Math.max(2, n))
}

// ---------- Fonte padrão: Postgres (só SELECT) ----------

/** Lê os usuários do banco do app. Só SELECT, em transação somente leitura; fecha tudo ao terminar. */
export async function consultarUsuariosPg(limite = LIMITE_USUARIOS) {
  let pool
  try {
    const { default: pg } = await import('pg')
    // Mesma configuração de SSL de migrar.mjs; o pg lê PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT sozinho.
    pool = new pg.Pool({
      ssl: process.env.PGHOST && process.env.PGSSL !== 'off' ? { rejectUnauthorized: false } : undefined,
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 5_000,
      statement_timeout: 20_000,
      query_timeout: 25_000,
      application_name: 'cc-usuarios',
      allowExitOnIdle: true,
    })
    pool.on('error', () => {}) // erro de cliente ocioso nunca pode virar exceção não tratada
    const cliente = await pool.connect()
    let quebrado = false
    try {
      await cliente.query('begin read only')
      const { rows } = await cliente.query({ text: SQL_USUARIOS, values: [limite] })
      return rows
    } finally {
      try {
        await cliente.query('rollback')
      } catch {
        quebrado = true
      }
      cliente.release(quebrado)
    }
  } finally {
    if (pool) await pool.end().catch(() => {})
  }
}

// ---------- Ciclo de envio ----------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function codigoDoErro(erro) {
  // Nunca a mensagem (pode ter dados do banco); só um código curto.
  const c = erro?.code || erro?.cause?.code || erro?.name
  return typeof c === 'string' ? c.slice(0, 40) : 'erro'
}

/**
 * Cria o enviador do retrato de usuários. `opcoes.consultar(limite)` devolve as linhas (injetável nos
 * testes). Nada acontece até chamar `iniciar()` (ou `executarCiclo()` à mão).
 */
export function criarRetratoUsuarios(opcoes = {}) {
  const base = String(opcoes.base || '').trim().replace(/\/+$/, '')
  const slug = String(opcoes.slug || '').trim()
  const segredo = String(opcoes.segredo || '').trim()
  const ativo = Boolean(base && slug && segredo.length >= 16)
  const consultar = opcoes.consultar || consultarUsuariosPg
  const limite = opcoes.limite || LIMITE_USUARIOS
  const intervaloMs = opcoes.intervaloMs ?? lerIntervaloMin(opcoes.intervaloMin) * 60_000
  const primeiroAtrasoMs = opcoes.primeiroAtrasoMs ?? (() => 45_000 + Math.floor(Math.random() * 15_000))
  const pausaMs = opcoes.pausaMs ?? 100
  const timeoutPrimeiraMs = opcoes.timeoutPrimeiraMs ?? 70_000
  const timeoutDemaisMs = opcoes.timeoutDemaisMs ?? 15_000
  const falhasMax = opcoes.falhasMax ?? 3
  const log = opcoes.log || {
    info: (m) => console.log(`[cc-usuarios] ${m}`),
    erro: (m) => console.error(`[cc-usuarios] ${m}`),
  }

  let executando = false
  let iniciado = false
  let parado = false
  let timer = null

  // Memória do processo
  const conhecidos = new Set() // ids vistos na última leitura completa
  const pendentesExclusao = new Map() // id -> chave do user.deleted ainda não entregue
  const estado = new Map() // id -> { hash, chave } do último payload
  const usadas = new Set() // chaves já usadas por este processo

  /**
   * Chave estável: igual enquanto o payload não muda. Se o payload VOLTA a um estado anterior
   * (ex.: bloqueou e desbloqueou), a chave pura já foi usada e o Control Center a trataria como
   * repetida (ignoraria o evento); então ganha o sufixo -r1, -r2...
   */
  function chaveDoUsuario(payload) {
    const id = payload.external_id
    const hash = hashPayload(payload)
    const anterior = estado.get(id)
    if (anterior && anterior.hash === hash) return anterior.chave
    let chave = chaveIdempotencia(slug, id, payload)
    if (usadas.has(chave)) {
      let n = 1
      while (usadas.has(`${chave}-r${n}`)) n++
      chave = `${chave}-r${n}`
    }
    if (usadas.size > 50_000) usadas.clear()
    usadas.add(chave)
    estado.set(id, { hash, chave })
    return chave
  }

  function chaveDeExclusao(id) {
    let chave = chaveIdempotencia(slug, id, { external_id: id })
    if (usadas.has(chave)) {
      let n = 1
      while (usadas.has(`${chave}-r${n}`)) n++
      chave = `${chave}-r${n}`
    }
    usadas.add(chave)
    return chave
  }

  /** Uma tentativa de envio. Nunca lança; devolve { ok, novo, motivo }. */
  async function enviar(item, limiteMs) {
    try {
      const corpo = {
        event_type: item.tipo,
        idempotency_key: item.chave,
        occurred_at: new Date().toISOString(),
        system_slug: slug,
        payload: item.payload,
      }
      const bruto = JSON.stringify(corpo)
      const carimbo = String(Math.floor(Date.now() / 1000)) // a cada tentativa: nova assinatura
      const resposta = await fetch(`${base}/webhooks/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-doca-timestamp': carimbo,
          'x-doca-signature': assinar(segredo, carimbo, bruto),
          'x-doca-idempotency-key': item.chave,
        },
        body: bruto,
        signal: AbortSignal.timeout(limiteMs),
      })
      const resp = await resposta.text().catch(() => '')
      if (!resposta.ok) return { ok: false, motivo: `HTTP ${resposta.status}` }
      let novo = false
      try {
        novo = JSON.parse(resp).duplicate === false
      } catch {
        /* resposta sem JSON: só não conta como "novo" */
      }
      return { ok: true, novo }
    } catch (e) {
      const nome = e?.name
      return { ok: false, motivo: nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo esgotado' : 'sem conexão' }
    }
  }

  /** Um ciclo: lê os usuários, envia um user.updated por usuário e user.deleted para os que sumiram. */
  async function executarCiclo() {
    if (!ativo) return { ignorado: true, motivo: 'desligado' }
    if (executando) return { ignorado: true, motivo: 'em-andamento' }
    executando = true
    const r = { total: 0, enviados: 0, novos: 0, excluidos: 0, falhas: 0, interrompido: false, erro: null }
    try {
      let linhas
      try {
        linhas = await consultar(limite)
      } catch (e) {
        r.erro = 'consulta'
        log.erro(`Retrato de usuários: não foi possível ler os usuários (${codigoDoErro(e)})`)
        return r
      }
      if (!Array.isArray(linhas)) {
        r.erro = 'consulta'
        return r
      }

      const itens = []
      const vistos = new Set()
      for (const linha of linhas) {
        let payload = null
        try {
          payload = montarPayloadUsuario(linha)
        } catch {
          payload = null
        }
        if (!payload || vistos.has(payload.external_id)) continue
        vistos.add(payload.external_id)
        itens.push({ tipo: 'user.updated', payload, chave: chaveDoUsuario(payload) })
      }
      r.total = itens.length

      // Quem sumiu desde o ciclo anterior. Lista cheia (truncada em `limite`) ou vazia não prova
      // exclusão: nesses casos não se apaga ninguém.
      const truncada = linhas.length >= limite
      const vaziaSuspeita = vistos.size === 0 && conhecidos.size > 0
      for (const id of vistos) pendentesExclusao.delete(id)
      if (!truncada && !vaziaSuspeita) {
        for (const id of [...conhecidos]) {
          if (vistos.has(id)) continue
          conhecidos.delete(id)
          estado.delete(id)
          pendentesExclusao.set(id, chaveDeExclusao(id))
        }
      } else if (truncada) {
        r.truncada = true
      }
      for (const id of vistos) conhecidos.add(id)

      const exclusoes = [...pendentesExclusao].map(([id, chave]) => ({
        tipo: 'user.deleted',
        payload: { external_id: id },
        chave,
      }))

      const todos = [...itens, ...exclusoes]
      let seguidas = 0
      let algumaOk = false
      let ultimoMotivo = ''
      for (let i = 0; i < todos.length; i++) {
        if (i > 0 && pausaMs > 0) await dormir(pausaMs)
        const item = todos[i]
        // O Control Center pode estar acordando (plano gratuito): tempo longo até a 1ª resposta.
        const res = await enviar(item, algumaOk ? timeoutDemaisMs : timeoutPrimeiraMs)
        if (res.ok) {
          seguidas = 0
          algumaOk = true
          if (item.tipo === 'user.deleted') {
            pendentesExclusao.delete(item.payload.external_id)
            r.excluidos++
          } else {
            r.enviados++
            if (res.novo) r.novos++
          }
        } else {
          r.falhas++
          seguidas++
          ultimoMotivo = res.motivo
          if (seguidas >= falhasMax) {
            r.interrompido = true
            break
          }
        }
      }

      const partes = [`${r.enviados} enviados`]
      if (r.novos) partes.push(`${r.novos} novos`)
      if (r.excluidos) partes.push(`${r.excluidos} removidos`)
      if (r.truncada) partes.push('lista no limite: remoções ignoradas')
      if (r.interrompido) {
        log.erro(`Retrato de usuários interrompido após ${falhasMax} falhas seguidas (${ultimoMotivo}): ${partes.join(', ')}`)
      } else if (r.falhas) {
        log.erro(`Retrato de usuários: ${partes.join(', ')}, ${r.falhas} falhas (${ultimoMotivo})`)
      } else {
        log.info(`Retrato de usuários: ${partes.join(', ')}`)
      }
    } catch (e) {
      r.erro = 'interno'
      try {
        log.erro(`Retrato de usuários: erro inesperado (${codigoDoErro(e)})`)
      } catch {
        /* nunca propagar */
      }
    } finally {
      executando = false
    }
    return r
  }

  function agendar(ms) {
    if (parado) return
    timer = setTimeout(async () => {
      try {
        await executarCiclo()
      } catch {
        /* nunca propagar */
      }
      agendar(intervaloMs) // o próximo só é marcado quando este termina: nunca há dois ciclos juntos
    }, ms)
    timer.unref?.() // não impede o processo de encerrar
  }

  function iniciar() {
    if (!ativo || iniciado) return
    iniciado = true
    parado = false
    agendar(typeof primeiroAtrasoMs === 'function' ? primeiroAtrasoMs() : primeiroAtrasoMs)
  }

  function parar() {
    parado = true
    iniciado = false
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { ativo, executarCiclo, iniciar, parar, estado: () => ({ ativo, iniciado, executando }) }
}

// ---------- Auto-início ao importar (via --import) ----------

export const retrato = criarRetratoUsuarios({
  base: process.env.DOCA_CC_URL,
  slug: process.env.DOCA_CC_SYSTEM_SLUG,
  segredo: process.env.DOCA_CC_WEBHOOK_SECRET,
  intervaloMin: process.env.DOCA_CC_SNAPSHOT_MIN,
})
export const retratoAtivo = retrato.ativo
export { CAMPOS_PERMITIDOS, LIMITE_USUARIOS }

try {
  retrato.iniciar()
} catch {
  /* iniciar nunca pode atrapalhar o app */
}
