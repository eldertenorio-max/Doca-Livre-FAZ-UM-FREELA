// Avisa o Doca Livre Control Center quando uma funcionalidade deste sistema falha:
// resposta 5xx (inclui as do PostgREST), serviço de dados parado ou erro fatal do servidor.
//
// Variáveis (sem elas o aviso fica DESLIGADO e nada muda no sistema):
//   DOCA_CC_URL             ex.: https://doca-livre-control-center.onrender.com/api
//   DOCA_CC_SYSTEM_SLUG     ex.: oferta-carga
//   DOCA_CC_WEBHOOK_SECRET  segredo (HMAC) combinado com o Control Center, mínimo 16 caracteres
//   DOCA_CC_SYSTEM_NAME     (opcional) nome para as mensagens
//
// Garantias: nunca atrasa nem derruba uma resposta (envio em segundo plano, com limite de tempo,
// sem lançar erro); agrupa repetições; no máximo 20 avisos por minuto; não envia o corpo dos pedidos,
// só a mensagem de erro, a rota e quem estava usando.
import { createHmac, randomUUID } from 'node:crypto'

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

async function enviarUmaVez(corpo, limiteMs) {
  const bruto = JSON.stringify(corpo)
  const carimbo = String(Math.floor(Date.now() / 1000)) // a cada tentativa: nova assinatura
  const assinatura = createHmac('sha256', segredo).update(`${carimbo}.${bruto}`, 'utf8').digest('hex')
  const resposta = await fetch(`${base}/webhooks/${slug}`, {
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
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
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

/**
 * Chame no começo do tratador de pedidos. Quando a resposta termina com 5xx, avisa.
 * `res.erroDetalhe` (texto curto) pode ser preenchido pelo sistema para explicar o erro.
 * A rota de saúde fica de fora: o Control Center já a acompanha.
 */
export function observarResposta(req, res, rotulos = {}) {
  if (!avisosAtivos) return
  res.on('finish', () => {
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
