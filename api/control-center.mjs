// Avisa o Doca Livre Control Center quando uma funcionalidade deste sistema falha:
// resposta 5xx (inclui as do PostgREST), serviço de dados parado ou erro fatal do servidor.
// Também conta ao painel quem está USANDO o sistema agora (session.heartbeat; ver "Presença" abaixo).
//
// Variáveis (sem elas o aviso fica DESLIGADO e nada muda no sistema):
//   DOCA_CC_URL             ex.: https://doca-livre-control-center.onrender.com/api
//   DOCA_CC_SYSTEM_SLUG     ex.: oferta-carga
//   DOCA_CC_WEBHOOK_SECRET  segredo (HMAC) combinado com o Control Center, mínimo 16 caracteres
//   DOCA_CC_SYSTEM_NAME     (opcional) nome para as mensagens
//   DOCA_CC_HEARTBEAT_SEC   (opcional) presença: no máximo 1 envio por usuário a cada N segundos;
//                           padrão 60 (entre 10 e 3600); 0 desliga só a presença (os avisos continuam)
//
// Garantias: nunca atrasa nem derruba uma resposta (envio em segundo plano, com limite de tempo,
// sem lançar erro); agrupa repetições; no máximo 20 avisos por minuto; não envia o corpo dos pedidos,
// só a mensagem de erro, a rota e quem estava usando.
import { createHmac, randomUUID } from 'node:crypto'
import { lerToken, tokenDoPedido } from './auth.mjs'

const base = String(process.env.DOCA_CC_URL || '').trim().replace(/\/+$/, '')
const segredo = String(process.env.DOCA_CC_WEBHOOK_SECRET || '').trim()
const slug = String(process.env.DOCA_CC_SYSTEM_SLUG || '').trim()
const nomeSistema = String(process.env.DOCA_CC_SYSTEM_NAME || slug || 'sistema').trim()

export const avisosAtivos = Boolean(base && slug && segredo.length >= 16)

const ultimoPorChave = new Map()
let enviosRecentes = []
let ultimoLogDeFalha = 0

function liberado(chave) {
  const agora = Date.now()
  enviosRecentes = enviosRecentes.filter((t) => agora - t < 60_000)
  if (enviosRecentes.length >= 20) return false
  const ultimo = ultimoPorChave.get(chave)
  if (ultimo && agora - ultimo < 30_000) return false
  ultimoPorChave.set(chave, agora)
  enviosRecentes.push(agora)
  if (ultimoPorChave.size > 500) {
    for (const [k, t] of ultimoPorChave) if (agora - t > 120_000) ultimoPorChave.delete(k)
  }
  return true
}

function logarFalha(motivo) {
  const agora = Date.now()
  if (agora - ultimoLogDeFalha < 60_000) return
  ultimoLogDeFalha = agora
  console.error(`[control-center] aviso não enviado: ${motivo}`)
}

/** POST assinado (HMAC de "{timestamp}.{corpo}") em {base}/webhooks/{slug}. Rejeita se não for 2xx. */
async function postarAssinado(destino, corpo, limiteMs, fetchFn = globalThis.fetch) {
  const bruto = JSON.stringify(corpo)
  const carimbo = String(Math.floor(Date.now() / 1000)) // a cada tentativa: nova assinatura
  const assinatura = createHmac('sha256', destino.segredo).update(`${carimbo}.${bruto}`, 'utf8').digest('hex')
  const resposta = await fetchFn(`${destino.base}/webhooks/${destino.slug}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-doca-timestamp': carimbo,
      'x-doca-signature': assinatura,
      'x-doca-idempotency-key': corpo.idempotency_key,
    },
    body: bruto,
    signal: AbortSignal.timeout(limiteMs),
  })
  await resposta.text().catch(() => '') // lê a resposta (curta) para liberar a conexão
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
}

function enviarUmaVez(corpo, limiteMs) {
  return postarAssinado({ base, slug, segredo }, corpo, limiteMs)
}

/**
 * Avisa uma falha. Devolve uma promessa que NUNCA rejeita.
 * `aguardar`: usado só no erro fatal (uma tentativa curta; não dá para esperar nova tentativa).
 */
export function reportarErro({ nivel = 'error', titulo, mensagem, usuario, tela, acao, detalhes, chave, aguardar = false }) {
  if (!avisosAtivos) return Promise.resolve()
  try {
    if (!liberado(chave || `${acao || ''}|${titulo || ''}`)) return Promise.resolve()
    const corpo = {
      event_type: 'system.error',
      idempotency_key: `err-${randomUUID()}`,
      occurred_at: new Date().toISOString(),
      system_slug: slug,
      payload: {
        level: nivel,
        title: String(titulo || 'Falha no servidor').slice(0, 160),
        message: String(mensagem || '').slice(0, 400),
        ...(usuario ? { user: usuario } : {}),
        ...(tela ? { screen: String(tela).slice(0, 200) } : {}),
        ...(acao ? { action: String(acao).slice(0, 200) } : {}),
        ...(detalhes ? { details: detalhes } : {}),
      },
    }
    if (aguardar) return enviarUmaVez(corpo, 4000).catch((e) => logarFalha(e?.message || 'erro'))
    // Segundo plano: 1ª tentativa e, se falhar (ex.: Control Center acordando), mais uma 20 s depois.
    enviarUmaVez(corpo, 15_000).catch((e) => {
      logarFalha(e?.message || 'erro')
      const t = setTimeout(() => enviarUmaVez(corpo, 15_000).catch((e2) => logarFalha(e2?.message || 'erro')), 20_000)
      t.unref?.()
    })
  } catch {
    /* avisar nunca pode causar outro erro */
  }
  return Promise.resolve()
}

const verbos = { GET: 'Consultar', HEAD: 'Consultar', POST: 'Gravar', PATCH: 'Atualizar', PUT: 'Atualizar', DELETE: 'Excluir' }

/** "POST /rest/v1/cargas" → "Gravar Cargas". `rotulos` traduz nomes de tabela (opcional). */
export function descreverAcao(metodo, url, rotulos = {}) {
  const verbo = verbos[metodo] || metodo
  const seg = String(url || '').split('?')[0].split('/').filter(Boolean)
  if (seg[0] === 'rest' && seg[1] === 'v1') {
    if (seg[2] === 'rpc') return `Executar a função ${seg[3] || ''}`.trim()
    return `${verbo} ${rotulos[seg[2]] || seg[2] || 'dados'}`
  }
  if (seg[0] === 'auth') return 'Entrar, cadastrar ou recuperar senha'
  if (seg[0] === 'storage') return 'Arquivos (envio ou consulta)'
  if (seg[0] === 'functions') return `Função ${seg[2] || ''}`.trim()
  return `${metodo} ${String(url || '').split('?')[0]}`
}

/** Quem estava usando: lido do token (sem validar; só para identificar no aviso). */
export function usuarioDoPedido(req) {
  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const partes = token.split('.')
    if (partes.length !== 3 || token.length > 4096) return undefined
    const p = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'))
    const id = p.sub || p.user_id || p.uid
    const nome = p.nome || p.name || p.user_metadata?.nome || p.user_metadata?.name
    const email = p.email
    if (!id && !nome && !email) return undefined
    return {
      ...(id ? { id: String(id) } : {}),
      ...(nome ? { name: String(nome) } : {}),
      ...(email ? { email: String(email) } : {}),
    }
  } catch {
    return undefined
  }
}

function telaDoPedido(req) {
  const ref = String(req.headers.referer || req.headers.referrer || '')
  if (!ref) return undefined
  try {
    const u = new URL(ref)
    return `${u.origin}${u.pathname}${u.hash || ''}` // sem querystring (pode ter token)
  } catch {
    return undefined
  }
}

// ---------- Presença ("online agora" no painel) ----------
// Quando um pedido com sessão VÁLIDA (token assinado e no prazo, conferido por lerToken de auth.mjs)
// termina atendido (status 2xx/3xx), envia session.heartbeat com { external_id } e nada mais. O
// external_id é o `sub` do token, que é o id da conta em mao_contas: o MESMO que cc-usuarios.mjs manda
// no retrato. O painel marca o usuário como online e o volta a offline se nada chegar dentro do prazo
// dele (SESSION_HEARTBEAT_TTL_SECONDS); usuário que o painel não conhece é ignorado lá.
// Garantias: roda depois que a resposta já saiu (evento 'finish') e em segundo plano; nunca lança;
// no máximo 1 envio por usuário a cada DOCA_CC_HEARTBEAT_SEC; memória limitada (5000 usuários; sai o
// mais antigo); no máximo 20 envios simultâneos; tempo limite de 5 s; após 3 falhas seguidas, pausa de
// 5 min; pedido sem sessão (ou com token inválido/vencido) não envia nada.

/** DOCA_CC_HEARTBEAT_SEC -> segundos: vazio/inválido = 60; 0 = desligado; senão entre 10 e 3600. */
export function lerIntervaloHeartbeat(valor) {
  const s = String(valor ?? '').trim()
  const n = Number(s)
  if (!s || !Number.isFinite(n) || n < 0) return 60
  if (n === 0) return 0
  return Math.min(3600, Math.max(10, n))
}

/** Mesmo external_id do retrato (cc-usuarios.mjs: texto(id, 200)): o `sub`, sem espaços nas pontas, até 200 caracteres. */
export function externalIdDoToken(claims) {
  if (!claims || typeof claims !== 'object' || claims.sub === null || claims.sub === undefined) return undefined
  const s = String(claims.sub).trim()
  return s ? s.slice(0, 200) : undefined
}

/** Cria o enviador de presença. Tudo injetável nos testes (relógio, fetch, leitura da sessão, log). */
export function criarPresenca(opcoes = {}) {
  const destino = {
    base: String(opcoes.base || '').trim().replace(/\/+$/, ''),
    slug: String(opcoes.slug || '').trim(),
    segredo: String(opcoes.segredo || '').trim(),
  }
  const intervaloMs = lerIntervaloHeartbeat(opcoes.intervaloSec) * 1000
  const ativa = Boolean(destino.base && destino.slug && destino.segredo.length >= 16 && intervaloMs > 0)
  const lerSessao = opcoes.lerSessao || ((req) => lerToken(tokenDoPedido(req)))
  const agora = opcoes.agora || Date.now
  const fetchFn = opcoes.fetch // vazio: o fetch do Node
  const timeoutMs = opcoes.timeoutMs ?? 5000
  const falhasMax = opcoes.falhasMax ?? 3
  const pausaMs = opcoes.pausaMs ?? 5 * 60_000
  const limiteUsuarios = opcoes.limiteUsuarios ?? 5000
  const maxSimultaneos = opcoes.maxSimultaneos ?? 20
  const log = opcoes.log || ((m) => console.error(`[control-center] ${m}`))

  const ultimoEnvio = new Map() // external_id -> quando enviou; ordem de inserção = do mais antigo ao mais novo
  let falhasSeguidas = 0
  let pausadaAte = 0
  let emAndamento = 0

  function falhou(erro) {
    falhasSeguidas++
    if (falhasSeguidas < falhasMax) return
    falhasSeguidas = 0
    pausadaAte = agora() + pausaMs
    const nome = erro?.name
    const motivo = nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo esgotado' : String(erro?.message || 'erro').slice(0, 80)
    try {
      log(`presença pausada por ${Math.round(pausaMs / 1000)} s após ${falhasMax} falhas seguidas (${motivo})`)
    } catch {
      /* log nunca pode causar erro */
    }
  }

  /** Chame quando a resposta terminar. Devolve true se disparou um envio. Nunca lança nem espera. */
  function registrar(req, status) {
    if (!ativa) return false
    try {
      if (!(status >= 200 && status < 400) || req.method === 'OPTIONS') return false
      const url = String(req.url || '').split('?')[0]
      if (url === '/saude' || url === '/') return false
      const t = agora()
      if (t < pausadaAte || emAndamento >= maxSimultaneos) return false
      const id = externalIdDoToken(lerSessao(req))
      if (!id) return false // anônimo, token inválido ou vencido
      const ultimo = ultimoEnvio.get(id)
      if (ultimo !== undefined && t - ultimo < intervaloMs) return false
      ultimoEnvio.delete(id) // reinsere no fim
      ultimoEnvio.set(id, t)
      while (ultimoEnvio.size > limiteUsuarios) ultimoEnvio.delete(ultimoEnvio.keys().next().value)
      const corpo = {
        event_type: 'session.heartbeat',
        idempotency_key: `hb:${destino.slug}:${id}:${t}`,
        occurred_at: new Date(t).toISOString(),
        system_slug: destino.slug,
        payload: { external_id: id },
      }
      emAndamento++
      postarAssinado(destino, corpo, timeoutMs, fetchFn)
        .then(
          () => {
            falhasSeguidas = 0
          },
          falhou,
        )
        .finally(() => {
          emAndamento--
        })
        .catch(() => {})
      return true
    } catch {
      return false
    }
  }

  return {
    ativa,
    registrar,
    estado: () => ({
      ativa,
      usuarios: ultimoEnvio.size,
      falhasSeguidas,
      pausadaAte,
      emAndamento,
      intervaloMs,
      timeoutMs,
      falhasMax,
      pausaMs,
      limiteUsuarios,
    }),
  }
}

export const presenca = criarPresenca({ base, slug, segredo, intervaloSec: process.env.DOCA_CC_HEARTBEAT_SEC })
export const presencaAtiva = presenca.ativa

/**
 * Chame no começo do tratador de pedidos. Quando a resposta termina com 5xx, avisa.
 * `res.erroDetalhe` (texto curto) pode ser preenchido pelo sistema para explicar o erro.
 * A rota de saúde fica de fora: o Control Center já a acompanha.
 * Também registra a presença de quem fez o pedido com sessão válida (ver "Presença").
 */
export function observarResposta(req, res, rotulos = {}) {
  if (!avisosAtivos) return
  res.on('finish', () => {
    presenca.registrar(req, res.statusCode) // nunca lança
    try {
      const status = res.statusCode
      if (status < 500) return
      const url = String(req.url || '').split('?')[0]
      if (url === '/saude' || url === '/') return
      const acao = descreverAcao(req.method, url, rotulos)
      reportarErro({
        titulo: `Falha no servidor ${nomeSistema} (HTTP ${status})`,
        mensagem: res.erroDetalhe ? String(res.erroDetalhe) : `HTTP ${status} em ${req.method} ${url}`,
        usuario: usuarioDoPedido(req),
        tela: telaDoPedido(req),
        acao,
        detalhes: { rota: `${req.method} ${url}`, status },
        chave: `${req.method} ${url.split('/').slice(0, 4).join('/')}|${status}`,
      })
    } catch {
      /* nunca atrapalhar a resposta */
    }
  })
}

/**
 * Erro fatal: avisa e encerra como o Node já faria (o Azure reinicia o contêiner).
 * Só instala se os avisos estiverem ativos, então sem as variáveis o comportamento é o de sempre.
 */
export function instalarCapturaGlobal() {
  if (!avisosAtivos) return
  let encerrando = false
  const fatal = (titulo, erro) => {
    if (encerrando) return
    encerrando = true
    console.error(titulo, erro)
    const mensagem = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)
    Promise.race([
      reportarErro({ nivel: 'critical', titulo, mensagem, acao: 'Execução do servidor', tela: 'Servidor', chave: 'fatal', aguardar: true }),
      new Promise((r) => setTimeout(r, 4500)),
    ]).finally(() => process.exit(1))
  }
  process.on('uncaughtException', (e) => fatal(`O servidor ${nomeSistema} caiu (erro não tratado)`, e))
  process.on('unhandledRejection', (e) => fatal(`O servidor ${nomeSistema} caiu (promessa rejeitada sem tratamento)`, e))
}
