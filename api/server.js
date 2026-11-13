import http from 'node:http'
import https from 'node:https'
import { timingSafeEqual } from 'node:crypto'
import { pool } from './migrar.mjs'
import { atenderArquivo } from './arquivos.mjs'
import { pareceJwt, tokenDoPedido } from './auth.mjs'
import {
  adminCriarEmpresa,
  adminRedefinirSenha,
  contaDoPedido,
  criarConta,
  ehGestao,
  entrar,
  existe,
  redefinirSenha,
  sessaoAtual,
  trocarSenha,
} from './rotasAuth.mjs'
import { enviarCodigoEmail } from './server-functions/enviarCodigoEmail.mjs'
import { notificarCadastro } from './server-functions/notificarCadastro.mjs'
import { analisarDocumentoCadastro } from './server-functions/analisarDocumentoCadastro.mjs'
import { lerCurriculo } from './server-functions/lerCurriculo.mjs'
import { instalarCapturaGlobal, observarResposta } from './control-center.mjs'

const port = Number(process.env.PORT || 8080)

const tabelas = [
  'mao_usuarios',
  'mao_email_codigos',
  'mao_permissoes',
  'mao_hierarquia_niveis',
  'mao_org_nos',
  'mao_grupos_hierarquia',
  'mao_grupos_hierarquia_membros',
  'mao_app_state',
  'mao_contas',
  'mao_profissionais',
  'mao_empresas',
  'mao_documentos',
  'mao_registros',
]
const copiaPermitida = new Set(tabelas)
// Nomes das telas/áreas nos avisos do Control Center (ação que falhou).
const rotulos = {
  mao_usuarios: 'Usuários',
  mao_email_codigos: 'Códigos de e-mail',
  mao_permissoes: 'Permissões',
  mao_hierarquia_niveis: 'Hierarquia (níveis)',
  mao_org_nos: 'Hierarquia (estrutura)',
  mao_grupos_hierarquia: 'Grupos de hierarquia',
  mao_grupos_hierarquia_membros: 'Membros dos grupos',
  mao_app_state: 'Estado do app',
  mao_contas: 'Contas',
  mao_profissionais: 'Profissionais',
  mao_empresas: 'Empresas',
  mao_documentos: 'Documentos',
  mao_registros: 'Registros',
}
instalarCapturaGlobal()

function lerCorpo(req, limite = 10_000_000) {
  return new Promise((resolve, reject) => {
    const partes = []
    let total = 0
    req.on('data', (parte) => {
      total += parte.length
      if (total > limite) {
        reject(new Error('Corpo muito grande'))
        req.destroy()
        return
      }
      partes.push(parte)
    })
    req.on('end', () => {
      try {
        const str = Buffer.concat(partes).toString('utf8')
        resolve(str ? JSON.parse(str) : {})
      } catch (erro) {
        reject(erro)
      }
    })
    req.on('error', reject)
  })
}

function segredoConfere(esperado, recebido) {
  const certo = String(esperado || '')
  const valor = String(recebido || '')
  if (!certo || valor.length !== certo.length) return false
  return timingSafeEqual(Buffer.from(valor), Buffer.from(certo))
}

function cors(origemPedido) {
  return {
    'access-control-allow-origin': origemPedido || '*',
    'access-control-allow-headers':
      'authorization, apikey, content-type, prefer, range, accept, accept-profile, content-profile, x-client-info, x-upsert, cache-control',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-expose-headers': 'content-range, content-location, location, preference-applied',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function responder(req, res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json', ...cors(req.headers.origin) })
  res.end(JSON.stringify(corpo))
}

/** Só os campos esperados (antes o corpo inteiro ia para a função, inclusive um `env` forjado). */
function campos(corpo, nomes) {
  const out = {}
  for (const nome of nomes) if (corpo && corpo[nome] !== undefined) out[nome] = corpo[nome]
  return out
}

/** Resposta sem o `status` interno. */
function semStatus(resultado) {
  const { status: _status, ...resto } = resultado
  return resto
}

async function colunasDaTabela(tabela) {
  const res = await pool.query(
    `select column_name, data_type, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [tabela],
  )
  return res.rows
}

function valorPg(tipo, anulavel, valor) {
  const texto = tipo === 'text' || tipo === 'character varying' || tipo === 'character'
  if (valor === '') {
    if (tipo === 'boolean') return false
    if (!texto)
      return anulavel === 'NO' &&
        (tipo === 'integer' || tipo === 'bigint' || tipo === 'smallint' || tipo === 'numeric')
        ? 0
        : null
  }
  if (valor !== null && (tipo === 'jsonb' || tipo === 'json')) {
    if (typeof valor === 'string') {
      try {
        JSON.parse(valor)
        return valor
      } catch {
        return JSON.stringify(valor)
      }
    }
    return JSON.stringify(valor)
  }
  return valor
}

async function gravarTabela(tabela, linhas, conflito) {
  const colunas = await colunasDaTabela(tabela)
  const nomes = new Set(colunas.map((c) => c.column_name))
  const tipos = new Map(colunas.map((c) => [c.column_name, c.data_type]))
  const nulos = new Map(colunas.map((c) => [c.column_name, c.is_nullable]))
  const chaves = (Array.isArray(conflito) ? conflito : ['id']).filter((nome) => nomes.has(nome))
  if (!chaves.length) throw new Error('sem_chave')
  let gravadas = 0
  for (const linha of linhas) {
    if (!chaves.every((nome) => linha[nome] !== undefined && linha[nome] !== null)) continue
    const pares = Object.entries(linha).filter(
      ([nome, valor]) => nomes.has(nome) && valor !== undefined,
    )
    const campos = pares.map(([nome]) => `"${nome}"`)
    const valores = pares.map(([, valor], i) =>
      valorPg(tipos.get(pares[i][0]), nulos.get(pares[i][0]), valor),
    )
    const marcas = pares.map((_, i) => `$${i + 1}`)
    const atualizaveis = pares.filter(([nome]) => !chaves.includes(nome))
    const acao = atualizaveis.length
      ? `do update set ${atualizaveis.map(([nome]) => `"${nome}" = excluded."${nome}"`).join(', ')}`
      : 'do nothing'
    await pool.query(
      `insert into "${tabela}" (${campos.join(', ')}) values (${marcas.join(', ')})
       on conflict (${chaves.map((nome) => `"${nome}"`).join(', ')}) ${acao}`,
      valores,
    )
    gravadas += 1
  }
  return gravadas
}

async function contagens() {
  const out = {}
  for (const tabela of tabelas) {
    try {
      const res = await pool.query(`select count(*)::int as n from ${tabela}`)
      out[tabela] = res.rows[0].n
    } catch {
      out[tabela] = -1
    }
  }
  return out
}

/**
 * Registra no log um pedido recusado pelo banco: método, tabela, status, código e mensagem do
 * PostgREST. Fica de fora o "details" (traz os valores da linha) e qualquer dado enviado.
 * Sem isso, um cadastro recusado não deixava rastro nenhum no servidor.
 */
function registrarRecusa(req, alvo, up, res) {
  const partes = []
  let total = 0
  up.on('data', (p) => {
    if (total < 4000) partes.push(p)
    total += p.length
  })
  up.on('end', () => {
    let codigo = ''
    let mensagem = ''
    try {
      const j = JSON.parse(Buffer.concat(partes).toString('utf8'))
      codigo = j.code || ''
      mensagem = j.message || ''
    } catch {
      /* corpo não é JSON */
    }
    const quem = pareceJwt(tokenDoPedido(req)) ? 'com sessão' : 'sem sessão'
    console.error(
      `[rest] ${req.method} ${alvo.pathname} ${up.statusCode} ${quem} ${codigo} ${String(mensagem).slice(0, 200)}`.trim(),
    )
    // Erro do servidor de dados: a mensagem segue para o aviso do Control Center.
    if ((up.statusCode || 0) >= 500 && res) res.erroDetalhe = `${codigo} ${String(mensagem).slice(0, 200)}`.trim()
  })
}

function encaminhar(req, res, base, caminho) {
  const alvo = new URL(caminho, base)
  const lib = alvo.protocol === 'https:' ? https : http
  const headers = { ...req.headers, host: alvo.host }
  // O supabase-js manda a chave pública como "Bearer" quando não há sessão; o PostgREST
  // recusaria por não ser um JWT. O token de sessão (JWT) segue para as regras do banco.
  if (!pareceJwt(tokenDoPedido(req))) delete headers.authorization
  const pre = lib.request(alvo, { method: req.method, headers }, (up) => {
    const saida = { ...up.headers, ...cors(req.headers.origin) }
    res.writeHead(up.statusCode || 502, saida)
    if ((up.statusCode || 502) >= 400) registrarRecusa(req, alvo, up, res)
    up.pipe(res)
  })
  pre.on('error', () => {
    res.erroDetalhe = 'O serviço de dados (PostgREST) não respondeu'
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, erro: 'Falha ao encaminhar PostgREST' }))
  })
  req.pipe(pre)
}

/** Rotas JSON: lê o corpo, chama a função e devolve sem o status interno. */
async function rotaJson(req, res, limite, executar, falha) {
  try {
    const corpo = req.method === 'GET' ? {} : await lerCorpo(req, limite)
    const resultado = await executar(corpo)
    const status = resultado.status || (resultado.ok ? 200 : 503)
    if (!resultado.ok) console.error(`[rota] ${req.method} ${req.url?.split('?')[0]} ${status} ${String(resultado.erro || '').slice(0, 160)}`)
    if (!resultado.ok && status >= 500) res.erroDetalhe = String(resultado.erro || '').slice(0, 300)
    responder(req, res, status, semStatus(resultado))
  } catch (erro) {
    console.error('[rota]', req.url, erro?.message || erro)
    responder(req, res, 400, { ok: false, erro: falha })
  }
}

const server = http.createServer(async (req, res) => {
  observarResposta(req, res, rotulos)
  const url = new URL(req.url || '/', 'http://local')
  const caminho = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(req.headers.origin))
    res.end()
    return
  }

  // 1. Health check (contagens só para quem tem o token de importação)
  if (caminho === '/saude' || caminho === '/') {
    if (process.env.MIGRACAO_ERRO) {
      responder(req, res, 500, { ok: false, erro: String(process.env.MIGRACAO_ERRO).slice(0, 300) })
      return
    }
    try {
      await pool.query('select 1')
      let rest = false
      try {
        const prova = await fetch('http://127.0.0.1:3001/', { signal: AbortSignal.timeout(3000) })
        rest = prova.status < 500
      } catch {
        rest = false
      }
      const detalhes = segredoConfere(process.env.IMPORT_TOKEN, req.headers['x-importar'])
      responder(req, res, 200, {
        ok: true,
        sistema: 'fazumfreela',
        rest,
        ...(detalhes ? { contagens: await contagens() } : {}),
      })
    } catch (erro) {
      responder(req, res, 500, { ok: false, erro: erro instanceof Error ? erro.message : 'Falha no banco' })
    }
    return
  }

  // 2. Cópia de tabelas
  if (caminho === '/copiar' && req.method === 'POST') {
    if (!segredoConfere(process.env.IMPORT_TOKEN, req.headers['x-importar'])) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, erro: 'Não encontrado' }))
      return
    }
    try {
      const corpo = await lerCorpo(req)
      const tabela = String(corpo.tabela || '')
      if (!copiaPermitida.has(tabela) || !Array.isArray(corpo.linhas)) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, erro: 'Tabela inválida' }))
        return
      }
      const gravadas = await gravarTabela(tabela, corpo.linhas, corpo.conflito)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, tabela, gravadas }))
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'Falha ao gravar'
      res.erroDetalhe = mensagem
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, erro: mensagem }))
    }
    return
  }

  // 3. Chave da API. O download de link assinado passa sem chave: o token do link protege
  //    (<img> e nova aba não mandam cabeçalho).
  const linkAssinado =
    caminho.startsWith('/storage/v1/object/sign/') && (req.method === 'GET' || req.method === 'HEAD')
  if (
    process.env.ANON_KEY &&
    !linkAssinado &&
    !segredoConfere(process.env.ANON_KEY, req.headers.apikey || url.searchParams.get('apikey'))
  ) {
    responder(req, res, 401, { message: 'Chave inválida' })
    return
  }

  // 4. Autenticação
  if (caminho === '/api/auth/entrar' && req.method === 'POST') {
    await rotaJson(req, res, 4000, (c) => entrar(campos(c, ['identificador', 'senha'])), 'Não foi possível entrar.')
    return
  }
  if (caminho === '/api/auth/sessao' && req.method === 'GET') {
    await rotaJson(req, res, 0, () => sessaoAtual(req), 'Sessão expirada. Entre de novo.')
    return
  }
  if (caminho === '/api/auth/existe' && req.method === 'POST') {
    await rotaJson(req, res, 4000, (c) => existe(campos(c, ['email', 'usuario'])), 'Não foi possível consultar.')
    return
  }
  if (caminho === '/api/auth/criar-conta' && req.method === 'POST') {
    await rotaJson(
      req,
      res,
      4000,
      (c) => criarConta(campos(c, ['verify_token', 'usuario', 'senha'])),
      'Não foi possível criar a conta.',
    )
    return
  }
  if (caminho === '/api/auth/trocar-senha' && req.method === 'POST') {
    await rotaJson(
      req,
      res,
      4000,
      (c) => trocarSenha(req, campos(c, ['senhaAtual', 'novaSenha'])),
      'Não foi possível trocar a senha.',
    )
    return
  }
  if (caminho === '/api/auth/redefinir-senha' && req.method === 'POST') {
    await rotaJson(
      req,
      res,
      4000,
      (c) => redefinirSenha(campos(c, ['verify_token', 'novaSenha'])),
      'Não foi possível trocar a senha.',
    )
    return
  }
  if (caminho === '/api/auth/admin/criar-empresa' && req.method === 'POST') {
    await rotaJson(
      req,
      res,
      20000,
      (c) => adminCriarEmpresa(req, campos(c, ['usuario', 'email', 'orgTipo', 'orgPaiId', 'empresa'])),
      'Não foi possível cadastrar a empresa.',
    )
    return
  }
  if (caminho === '/api/auth/admin/redefinir-senha' && req.method === 'POST') {
    await rotaJson(
      req,
      res,
      4000,
      (c) => adminRedefinirSenha(req, campos(c, ['contaId'])),
      'Não foi possível redefinir a senha.',
    )
    return
  }

  // 5. Funções do portal
  if (caminho === '/functions/v1/enviar-codigo' || caminho === '/api/portal/enviar-codigo') {
    await rotaJson(
      req,
      res,
      8000,
      async (c) => {
        const r = await enviarCodigoEmail(
          campos(c, ['acao', 'email', 'identificador', 'codigo', 'finalidade', 'portalRole']),
        )
        // Nada além do necessário volta ao navegador.
        return r.ok
          ? {
              ok: true,
              status: 200,
              ...(r.email ? { email: r.email } : {}),
              ...(r.verify_token ? { verify_token: r.verify_token } : {}),
              ...(r.portalRole ? { portalRole: r.portalRole } : {}),
            }
          : r
      },
      'Falha ao processar código',
    )
    return
  }

  if (caminho === '/functions/v1/notificar-cadastro' || caminho === '/api/portal/notificar-cadastro') {
    // Só o admin avisa aprovação/recusa (antes qualquer um mandava e-mail em nome da empresa).
    const quem = await contaDoPedido(req)
    if (!quem || !ehGestao(quem.role)) {
      responder(req, res, 403, { ok: false, erro: 'Sem permissão.' })
      return
    }
    await rotaJson(
      req,
      res,
      8000,
      (c) => notificarCadastro(campos(c, ['email', 'nome', 'tipo', 'decisao', 'motivo'])),
      'Falha ao notificar cadastro',
    )
    return
  }

  if (caminho === '/functions/v1/analisar-documento' || caminho === '/api/cadastro/analisar-documento') {
    if (!(await contaDoPedido(req))) {
      responder(req, res, 401, { ok: false, erro: 'Entre na sua conta para enviar documentos.' })
      return
    }
    await rotaJson(
      req,
      res,
      8_000_000,
      (c) => analisarDocumentoCadastro(campos(c, ['nome', 'arquivos', 'contexto', 'tipo', 'cnpj', 'cidade', 'cpf'])),
      'Falha ao analisar documento',
    )
    return
  }

  if (caminho === '/api/cadastro/ler-curriculo') {
    if (!(await contaDoPedido(req))) {
      responder(req, res, 401, { ok: false, erro: 'Entre na sua conta para ler o currículo.' })
      return
    }
    await rotaJson(
      req,
      res,
      3_500_000,
      (c) => lerCurriculo(campos(c, ['texto', 'imagem', 'cargos'])),
      'Falha ao ler currículo',
    )
    return
  }

  // 6. REST (PostgREST)
  if (caminho.startsWith('/rest/v1')) {
    const resto = caminho.slice('/rest/v1'.length) || '/'
    encaminhar(req, res, 'http://127.0.0.1:3001', `${resto}${url.search}`)
    return
  }

  // 7. Storage (Azure Blob)
  if (caminho.startsWith('/storage/v1')) {
    const corsArquivo = cors(req.headers.origin)
    const writeHeadOriginal = res.writeHead.bind(res)
    res.writeHead = (status, ...resto) => {
      if (status >= 400) {
        const quem = pareceJwt(tokenDoPedido(req)) ? 'com sessão' : 'sem sessão'
        console.error(`[storage] ${req.method} ${caminho.split('/').slice(0, 6).join('/')} ${status} ${quem}`)
      }
      const ultimo = resto[resto.length - 1]
      if (ultimo && typeof ultimo === 'object' && !Array.isArray(ultimo)) {
        resto[resto.length - 1] = { ...corsArquivo, ...ultimo }
      } else {
        resto.push(corsArquivo)
      }
      return writeHeadOriginal(status, ...resto)
    }
    try {
      await atenderArquivo(req, res, caminho)
    } catch (e) {
      console.error('[storage error]', e)
      res.erroDetalhe = e instanceof Error ? e.message : 'Falha no arquivo'
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'Falha no arquivo' }))
    }
    return
  }

  responder(req, res, 404, { ok: false, erro: 'Não encontrado' })
})

server.on('upgrade', (req, socket) => {
  socket.destroy()
})

server.listen(port, '0.0.0.0', () => {
  console.log(`fazumfreela-api escutando na porta ${port}`)
})
