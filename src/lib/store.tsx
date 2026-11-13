import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cargoCategoria } from '../data/categories'
import { buildContratoFromConfirmacao } from './contratoTemplate'
import {
  atualizarAssinatura,
  cadastroEttInicial,
  criarEncerramento,
  criarPecasIniciais,
  criarRecibo,
  pecasDaContratacao,
} from './dossieTemporario'
import { distanciaKm, matchDemanda } from './matching'
import { diaDoPonto, diasComPresenca, diasEntre, hojeLocal } from './ponto'
import { canAccessSistema, isLocalSuperUser } from './portalPermissoes'
import { nowIso, uid } from './seed'
import { mediaDaAvaliacao, nivelPelaMedia } from './classificacao'
import { semContato } from './curriculo'
import { validarChavePix } from './pix'
import { estadoVazio, loadState, recalcularDerivados, resetState, saveState, STORAGE_KEY } from './storage'
import { chamarApi } from './api'
import { emDemo } from './modo'
import { lerSessao, limparSessao, salvarSessao, tokenAtual } from './sessao'
import { enviarMudancas, fotografarBase, mesclarNuvem, zerarBase } from './sincronizacao'
import {
  atualizarConta,
  contaDaApi,
  excluirContaCloud,
  pullCloudBundle,
  supabaseConfigured,
  upsertDocumentos,
  upsertEmpresa,
  upsertProfissional,
} from './supabaseSync'

type RespostaSessao = { token: string; expira: number; conta: Record<string, unknown>; trocarSenha?: boolean }
import { VERSAO_TERMOS } from './termos'
import type {
  AceiteTermo,
  AppState,
  Avaliacao,
  Candidatura,
  CheckIn,
  Demanda,
  Disponibilidade,
  DocumentoRegistro,
  DocumentoStatus,
  Empresa,
  OrgTipo,
  Pagamento,
  PecaDocumental,
  Profissional,
  User,
  UserRole,
} from './types'
import { podeFicarAbaixo } from './orgHierarquia'

type DocumentoCadastro = {
  tipoId: string
  arquivoNome: string
  observacao: string
  arquivoDados?: string
  versoNome?: string
  versoDados?: string
}

export function avisoAcessoEmpresa(status: Empresa['status']): string | null {
  if (status === 'aprovada') return null
  if (status === 'bloqueada') {
    return 'Esta empresa está bloqueada. O acesso ao painel não está liberado.'
  }
  if (status === 'recusada') {
    return 'O cadastro da empresa foi recusado. Veja o e-mail com o motivo ou fale com o suporte.'
  }
  return 'Sua empresa ainda aguarda aprovação. O login libera quando o administrador validar o cadastro.'
}

export function avisoAcessoProfissional(status: Profissional['status']): string | null {
  if (status === 'aprovado') return null
  if (status === 'bloqueado') {
    return 'Este cadastro está bloqueado. O acesso ao painel não está liberado.'
  }
  if (status === 'recusado') {
    return 'Seu cadastro foi recusado. Veja o e-mail com o motivo ou fale com o suporte.'
  }
  return 'Seu cadastro ainda aguarda aprovação. O login libera quando o administrador validar o colaborador.'
}

function documentosDeCadastro(
  existentes: DocumentoRegistro[],
  donoId: string,
  itens: DocumentoCadastro[] | undefined,
  donoTipo: 'profissional' | 'empresa' = 'profissional',
): DocumentoRegistro[] {
  if (!itens?.length) return existentes
  const tipos = new Set(itens.map((item) => item.tipoId))
  const agora = nowIso()
  const novos: DocumentoRegistro[] = itens.map((item) => ({
    id: uid('doc'),
    tipoId: item.tipoId,
    donoTipo,
    donoId,
    status: 'em_analise',
    arquivoNome: item.arquivoNome,
    arquivoDados: item.arquivoDados,
    enviadoEm: agora,
    observacao: item.observacao,
    meta: {
      origem: 'cadastro',
      ...(item.versoNome ? { versoNome: item.versoNome } : {}),
      ...(item.versoDados ? { versoDados: item.versoDados } : {}),
    },
  }))
  return [
    ...novos,
    ...existentes.filter((doc) => !(doc.donoTipo === donoTipo && doc.donoId === donoId && tipos.has(doc.tipoId))),
  ]
}

/** Coloca os documentos novos no lugar dos de mesmo dono e tipo, sem duplicar. */
function juntarDocumentos(existentes: DocumentoRegistro[], novos: DocumentoRegistro[]): DocumentoRegistro[] {
  if (!novos.length) return existentes
  const chave = (doc: DocumentoRegistro) => `${doc.donoTipo}:${doc.donoId}:${doc.tipoId}`
  const trocados = new Set(novos.map(chave))
  return [...novos, ...existentes.filter((doc) => !trocados.has(chave(doc)) && !novos.some((n) => n.id === doc.id))]
}

type EmpresaCadastro = Omit<
  Empresa,
  | 'id'
  | 'userId'
  | 'status'
  | 'avaliacaoMedia'
  | 'favoritos'
  | 'bloqueados'
  | 'docsOk'
  | 'saldo'
  | 'limitePosPago'
  | 'diasTaxaZero'
  | 'metaTaxaZero'
  | 'diasAgenciados'
  | 'rankingDias'
  | 'economiaTotal'
>

function novaEmpresa(dados: EmpresaCadastro, id: string, userId: string): Empresa {
  return {
    ...dados,
    id,
    userId,
    status: 'pendente',
    avaliacaoMedia: 5,
    favoritos: [],
    bloqueados: [],
    docsOk: true,
    saldo: 0,
    limitePosPago: 3000,
    diasTaxaZero: 0,
    metaTaxaZero: 300,
    diasAgenciados: 0,
    rankingDias: 999,
    economiaTotal: 0,
  }
}

type ProfissionalCadastro = Omit<
  Profissional,
  | 'id'
  | 'userId'
  | 'status'
  | 'nivel'
  | 'avaliacaoMedia'
  | 'taxaComparecimento'
  | 'faltas'
  | 'tempoRespostaMin'
  | 'ganhosMes'
  | 'saldo'
>

function novoProfissional(dados: ProfissionalCadastro, id: string, userId: string): Profissional {
  return {
    ...dados,
    id,
    userId,
    status: 'pendente',
    nivel: 'bronze',
    avaliacaoMedia: 5,
    taxaComparecimento: 100,
    faltas: 0,
    tempoRespostaMin: 10,
    ganhosMes: 0,
    saldo: 0,
  }
}

/** Grava o perfil e os documentos do cadastro; devolve os documentos com o caminho no Storage. */
async function salvarPerfilNaNuvem(
  tipo: 'empresa' | 'profissional',
  perfil: Empresa | Profissional,
  docs: DocumentoRegistro[],
): Promise<{ ok: true; docs: DocumentoRegistro[] } | { ok: false; erro: string }> {
  const salvo = tipo === 'empresa' ? await upsertEmpresa(perfil as Empresa) : await upsertProfissional(perfil as Profissional)
  if (!salvo.ok) return salvo
  if (!docs.length) return { ok: true, docs }
  return upsertDocumentos(docs, { exigirArquivo: true })
}

/** Junta os termos aceitos agora aos aceites que a conta já tinha (mesma regra do aceitarTermos). */
function aceitesComTermos(
  atuais: AceiteTermo[] | undefined,
  termos: AceiteTermo['documento'][] | undefined,
): AceiteTermo[] | undefined {
  if (!termos?.length) return atuais
  const em = nowIso()
  const outros = (atuais ?? []).filter(
    (item) => !(item.versao === VERSAO_TERMOS && termos.includes(item.documento)),
  )
  return [...outros, ...termos.map((documento) => ({ documento, versao: VERSAO_TERMOS, em }))]
}

type PortalLogin = 'empresa' | 'profissional' | 'admin'

export type ResultadoLogin = {
  ok: boolean
  error?: string
  aviso?: boolean
  role?: UserRole
  usuario?: string
  isSuperuser?: boolean
  precisaConfig?: boolean
  precisaPerfil?: boolean
  /** Senha provisória: pedir uma senha forte antes de abrir o portal. */
  trocarSenha?: boolean
}

function portalErrado(user: User, portal: PortalLogin): string | null {
  if (portal === 'empresa' && user.role !== 'empresa') {
    return 'Esta conta não é de Empresa. Use o login de Trabalhador ou Admin.'
  }
  if (portal === 'profissional' && user.role !== 'profissional') {
    return 'Esta conta não é de Trabalhador. Use o login de Empresa ou Admin.'
  }
  if (portal === 'admin' && user.role !== 'admin' && user.role !== 'super') {
    return 'Sem permissão para o Painel Admin.'
  }
  return null
}

/** Avisos de cadastro pendente/recusado/bloqueado e se ainda falta completar o perfil. */
function avaliarPerfil(user: User, portal: PortalLogin, s: AppState): ResultadoLogin {
  const isSuper = user.role === 'super'
  if (!isSuper && user.role !== 'admin') {
    const sistema = portal === 'admin' ? 'admin' : portal
    if (!canAccessSistema(user.usuario || user.email, sistema, user.email, user.role)) {
      return { ok: false, error: 'Acesso bloqueado pelas permissões do portal.' }
    }
  }
  const empresa = user.role === 'empresa' ? s.empresas.find((e) => e.userId === user.id) : undefined
  const profissional = user.role === 'profissional' ? s.profissionais.find((p) => p.userId === user.id) : undefined
  const hasPerfil = user.role === 'empresa' ? Boolean(empresa) : user.role === 'profissional' ? Boolean(profissional) : true
  const aviso = empresa ? avisoAcessoEmpresa(empresa.status) : profissional ? avisoAcessoProfissional(profissional.status) : null
  if (aviso && hasPerfil && user.perfilCompleto !== false) return { ok: false, error: aviso, aviso: true }
  return {
    ok: true,
    role: user.role,
    usuario: user.usuario || user.email,
    isSuperuser: isSuper,
    precisaConfig: isSuper && portal === 'admin',
    precisaPerfil: (user.role === 'empresa' || user.role === 'profissional') && (user.perfilCompleto === false || !hasPerfil),
  }
}

/** Login do modo demonstração (dados fictícios deste navegador). */
function avaliarEntradaDemo(
  user: User,
  portal: PortalLogin,
  s: AppState,
): { contaId?: string; resultado: ResultadoLogin } {
  const gestao = user.role === 'super' || user.role === 'admin'
  if (gestao && portal === 'profissional') {
    return {
      resultado: {
        ok: false,
        error: 'Esta conta não abre o perfil de um colaborador. Entre com o usuário criado no cadastro do profissional.',
      },
    }
  }
  let conta = user
  if (gestao && portal === 'empresa') {
    // Na demonstração o gestor abre a empresa de exemplo.
    const demo =
      s.users.find((u) => u.email === 'empresa@logexpress.com' && u.role === 'empresa') ||
      s.users.find((u) => u.role === 'empresa' && u.ativo)
    if (demo) conta = demo
  } else {
    const falha = portalErrado(user, portal)
    if (falha) return { resultado: { ok: false, error: falha } }
  }
  const resultado = avaliarPerfil(conta, portal, s)
  if (gestao) {
    resultado.isSuperuser = user.role === 'super' || isLocalSuperUser(user.usuario || '')
    resultado.precisaConfig = resultado.isSuperuser && portal === 'admin'
  }
  return { contaId: resultado.ok ? conta.id : undefined, resultado }
}

type StoreApi = {
  state: AppState
  currentUser: User | null
  currentEmpresa: Empresa | null
  currentProfissional: Profissional | null
  login: (email: string, senha: string) => Promise<{ ok: boolean; error?: string; role?: UserRole }>
  loginPortal: (usuarioOuEmail: string, senha: string, portal: PortalLogin) => Promise<ResultadoLogin>
  /** Troca obrigatória (senha provisória) e conclusão do login. */
  concluirTrocaSenha: (senhaAtual: string, novaSenha: string, portal: PortalLogin) => Promise<ResultadoLogin>
  /** Quem está logado troca a própria senha (painel do usuário, aba Conta). */
  trocarMinhaSenha: (senhaAtual: string, novaSenha: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  refreshFromCloud: () => Promise<void>
  excluirUsuario: (userId: string) => Promise<{ ok: boolean; error?: string }>
  /** Admin gera senha provisória para alguém (a pessoa troca no próximo login). */
  adminRedefinirSenha: (userId: string) => Promise<{ ok: true; senha: string } | { ok: false; error: string }>
  /** Gestão cadastra uma empresa já aprovada, no ponto escolhido da hierarquia. */
  adminCriarEmpresa: (dados: {
    usuario: string
    email: string
    orgTipo: OrgTipo
    orgPaiId: string | null
    empresa: Partial<Empresa>
  }) => Promise<
    { ok: true; usuario: string; email: string; senha: string; emailEnviado: boolean } | { ok: false; error: string }
  >
  /** Muda o tipo e a empresa acima (null tira da hierarquia). */
  adminPosicionarEmpresa: (
    empresaId: string,
    posicao: { orgTipo: OrgTipo | null; orgPaiId: string | null },
  ) => Promise<{ ok: boolean; error?: string }>
  /** Tira da hierarquia; quem estava abaixo sobe para o lugar dela (ou para o topo). */
  adminTirarDaHierarquia: (empresaId: string) => Promise<{ ok: boolean; error?: string }>
  resolveEmailByIdentificador: (id: string) => Promise<string | null>
  portalRegisterUser: (data: {
    email: string
    usuario: string
    senha: string
    role: 'empresa' | 'profissional'
    verifyToken: string
  }) => Promise<{ ok: boolean; error?: string }>
  portalResetSenha: (email: string, novaSenha: string, verifyToken: string) => Promise<{ ok: boolean; error?: string }>
  registerEmpresa: (user: Omit<User, 'id' | 'role' | 'ativo' | 'createdAt'>, empresa: Omit<Empresa, 'id' | 'userId' | 'status' | 'avaliacaoMedia' | 'favoritos' | 'bloqueados' | 'docsOk' | 'saldo' | 'limitePosPago' | 'diasTaxaZero' | 'metaTaxaZero' | 'diasAgenciados' | 'rankingDias' | 'economiaTotal'>, documentos?: DocumentoCadastro[], termos?: AceiteTermo['documento'][]) => Promise<{ ok: boolean; error?: string }>
  registerProfissional: (user: Omit<User, 'id' | 'role' | 'ativo' | 'createdAt'>, profissional: Omit<Profissional, 'id' | 'userId' | 'status' | 'nivel' | 'avaliacaoMedia' | 'taxaComparecimento' | 'faltas' | 'tempoRespostaMin' | 'ganhosMes' | 'saldo'>, documentos?: DocumentoCadastro[]) => Promise<{ ok: boolean; error?: string }>
  completeEmpresaPerfil: (empresa: Omit<Empresa, 'id' | 'userId' | 'status' | 'avaliacaoMedia' | 'favoritos' | 'bloqueados' | 'docsOk' | 'saldo' | 'limitePosPago' | 'diasTaxaZero' | 'metaTaxaZero' | 'diasAgenciados' | 'rankingDias' | 'economiaTotal'>, documentos?: DocumentoCadastro[], termos?: AceiteTermo['documento'][]) => Promise<{ ok: boolean; error?: string }>
  completeProfissionalPerfil: (profissional: Omit<Profissional, 'id' | 'userId' | 'status' | 'nivel' | 'avaliacaoMedia' | 'taxaComparecimento' | 'faltas' | 'tempoRespostaMin' | 'ganhosMes' | 'saldo'>, documentos?: DocumentoCadastro[], termos?: AceiteTermo['documento'][]) => Promise<{ ok: boolean; error?: string }>
  createDemanda: (data: Omit<Demanda, 'id' | 'createdAt' | 'status' | 'categoria'>) => Demanda
  publicarVaga: (data: Omit<Demanda, 'id' | 'createdAt' | 'status' | 'categoria'>) => Demanda
  candidatar: (demandaId: string, profissionalId: string) => { ok: boolean; error?: string }
  convidarParaMissao: (input: {
    demandaId?: string | null
    profissionalId: string
    score: number
    distanciaKm: number
    pedido?: Omit<Demanda, 'id' | 'createdAt' | 'status' | 'categoria'>
  }) => { demandaId: string; candidaturaId: string } | null
  updateCandidaturaStatus: (id: string, status: Candidatura['status']) => void
  acceptOferta: (demandaId: string, profissionalId: string) => void
  refuseOferta: (demandaId: string, profissionalId: string) => void
  confirmCandidato: (candidaturaId: string) => void
  assinarContrato: (contratoId: string) => void
  assinarPeca: (pecaId: string, papel: 'ett' | 'tomadora' | 'trabalhador', nome: string) => void
  aceitarTermos: (documentos: AceiteTermo['documento'][]) => void
  marcarEsocial: (pecaId: string) => void
  registrarEncerramento: (input: {
    demandaId: string
    dataEfetiva: string
    motivo: string
    responsavel: string
    observacoes: string
    profissionalId?: string
  }) => void
  atualizarCadastroEtt: (cadastro: AppState['cadastroEtt']) => void
  registrarConsentimento: (
    profissionalId: string,
    campo: 'politica' | 'curriculo' | 'compartilhamento',
    dar?: boolean,
  ) => void
  refuseCandidato: (candidaturaId: string) => void
  doCheckIn: (demandaId: string, profissionalId: string) => void
  doCheckOut: (demandaId: string, profissionalId: string) => void
  addAvaliacao: (data: Omit<Avaliacao, 'id' | 'createdAt'>) => void
  updateDisponibilidade: (profissionalId: string, disp: Disponibilidade) => void
  definirVerTodasVagas: (profissionalId: string, verTodas: boolean) => void
  atualizarPerfilProfissional: (
    profissionalId: string,
    dados: Pick<
      Profissional,
      | 'nome'
      | 'cpf'
      | 'rg'
      | 'nascimento'
      | 'telefone'
      | 'foto'
      | 'resumo'
      | 'escolaridade'
      | 'habilidades'
      | 'profissoes'
      | 'experiencia'
      | 'certificados'
      | 'cnhCategoria'
      | 'cnhValidade'
      | 'disponibilidade'
      | 'endereco'
      | 'raioKm'
      | 'pix'
    >,
  ) => { ok: boolean; error?: string }
  atualizarPix: (
    profissionalId: string,
    pix: string,
  ) => { ok: true; chave: string; rotulo: string } | { ok: false; error: string }
  /** Troca (foto) ou remove (sem foto) a foto de perfil, sem mexer no resto do perfil. */
  atualizarFotoProfissional: (profissionalId: string, foto?: string) => { ok: boolean; error?: string }
  toggleFavorito: (empresaId: string, profissionalId: string) => void
  toggleBloqueado: (empresaId: string, profissionalId: string) => void
  setEmpresaStatus: (id: string, status: Empresa['status'], opts?: { motivoRecusa?: string }) => Promise<{ ok: boolean; error?: string }>
  patchState: (fn: (s: AppState) => AppState) => void
  setProfissionalStatus: (id: string, status: Profissional['status'], opts?: { motivoRecusa?: string }) => Promise<{ ok: boolean; error?: string }>
  enviarDocumento: (data: {
    tipoId: string
    donoTipo: 'profissional' | 'empresa' | 'ett'
    donoId: string
    arquivoNome: string
    arquivoDados?: string
    validade?: string
    meta?: Record<string, string>
  }) => void
  revisarDocumento: (docId: string, status: Extract<DocumentoStatus, 'aprovado' | 'recusado'>, observacao?: string) => void
  finishDemanda: (demandaId: string) => void
  cancelDemanda: (demandaId: string) => void
  resetDemo: () => void
  audit: (action: string, detail: string) => void
}

const StoreContext = createContext<StoreApi | null>(null)

function persist(next: AppState) {
  saveState(next)
  return next
}

const centavos = (valor: number) => Math.round(valor * 100) / 100

/**
 * Encerra a missão e gera os pagamentos.
 *  - O período vai até a data efetiva do encerramento (antes: sempre o período planejado — missão
 *    de 30 dias encerrada no 3º dia pagava 30 diárias).
 *  - Paga os dias com presença registrada (entrada no ponto). Se ninguém usou o ponto nesta
 *    missão, vale o período até a data efetiva (empresa que não usa o ponto do app).
 *  - Comissão em centavos (antes era arredondada para reais inteiros).
 *  - Candidaturas ainda abertas são canceladas: não dá mais para "aprovar" alguém numa missão
 *    encerrada e reabri-la (o que gerava pagamento em dobro).
 */
function finishDemandaState(s: AppState, demandaId: string, dataEfetiva?: string): AppState {
  const demanda = s.demandas.find((d) => d.id === demandaId)
  if (!demanda || demanda.status === 'finalizada' || demanda.status === 'cancelada') return s
  const fimPlanejado = demanda.dataFim || demanda.data
  const fim = dataEfetiva && dataEfetiva >= demanda.data && dataEfetiva < fimPlanejado ? dataEfetiva : fimPlanejado
  const diasPeriodo = diasEntre(demanda.data, fim)
  const confirmados = s.candidaturas.filter((c) => c.demandaId === demandaId && c.status === 'confirmada')
  const usaPonto = s.checkIns.some((c) => c.demandaId === demandaId && c.checkInAt)
  const jaPagos = new Set(s.pagamentos.filter((p) => p.demandaId === demandaId).map((p) => p.profissionalId))
  const agora = nowIso()
  const pagamentos: Pagamento[] = []
  const diasPorProf = new Map<string, number>()
  for (const c of confirmados) {
    if (jaPagos.has(c.profissionalId)) continue
    const dias = usaPonto ? Math.min(diasPeriodo, diasComPresenca(s.checkIns, demandaId, c.profissionalId, fim)) : diasPeriodo
    if (dias <= 0) continue
    const valor = centavos(demanda.valorDiaria * dias)
    diasPorProf.set(c.profissionalId, dias)
    pagamentos.push({
      id: uid('pag'),
      demandaId,
      profissionalId: c.profissionalId,
      empresaId: demanda.empresaId,
      valor,
      comissao: centavos(valor * 0.12),
      status: 'pago' as const,
      createdAt: agora,
    })
  }
  const valorPorProf = new Map(pagamentos.map((p) => [p.profissionalId, p.valor]))
  const empresa = s.empresas.find((e) => e.id === demanda.empresaId)
  const recibos: PecaDocumental[] = []
  if (empresa) {
    for (const pagamento of pagamentos) {
      const profissional = s.profissionais.find((p) => p.id === pagamento.profissionalId)
      if (!profissional) continue
      const recibo = criarRecibo({
        pecas: [...recibos, ...(s.pecas ?? [])],
        demanda,
        empresa,
        profissional,
        valor: pagamento.valor,
        dias: diasPorProf.get(pagamento.profissionalId) ?? diasPeriodo,
        pagoEm: pagamento.createdAt,
      })
      if (recibo) recibos.push(recibo)
    }
  }
  return {
    ...s,
    pecas: [...recibos, ...(s.pecas ?? [])],
    // Encerramento antecipado grava o fim real (a regra dos 180 dias conta o período efetivo).
    demandas: s.demandas.map((d) =>
      d.id === demandaId
        ? { ...d, status: 'finalizada' as const, ...(fim < fimPlanejado ? { dataFim: fim } : {}) }
        : d,
    ),
    candidaturas: s.candidaturas.map((c) =>
      c.demandaId === demandaId && (c.status === 'pendente' || c.status === 'aceita')
        ? { ...c, status: 'cancelada' as const }
        : c,
    ),
    contratos: s.contratos.map((contrato) =>
      contrato.demandaId === demandaId && contrato.status !== 'rescindido'
        ? { ...contrato, status: 'concluido' as const, ...(fim < fimPlanejado ? { fimEm: fim } : {}) }
        : contrato,
    ),
    pagamentos: [...pagamentos, ...s.pagamentos],
    profissionais: s.profissionais.map((p) => {
      const valor = valorPorProf.get(p.id)
      return valor ? { ...p, saldo: centavos(p.saldo + valor), ganhosMes: centavos(p.ganhosMes + valor) } : p
    }),
  }
}

/** Ao abrir: no modo real, só mantém o usuário logado se a sessão do servidor ainda vale. */
function estadoAoAbrir(): AppState {
  const s = loadState()
  if (emDemo()) return s
  const sessao = lerSessao()
  if (sessao && !sessao.trocarSenha && sessao.contaId === s.sessionUserId) return s
  if (sessao) limparSessao()
  return persist(estadoVazio())
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(estadoAoAbrir)
  const stateRef = useRef(state)
  /** Só envia mudanças depois do primeiro pull da sessão (senão dados velhos sobrescreveriam o banco). */
  const sincronizadoRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const aplicar = useCallback((next: AppState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    function aoStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const remoto = JSON.parse(event.newValue) as AppState
        setState((atual) => ({ ...remoto, sessionUserId: atual.sessionUserId }))
      } catch {
        /* a outra aba gravou um estado ilegível */
      }
    }
    window.addEventListener('storage', aoStorage)
    return () => window.removeEventListener('storage', aoStorage)
  }, [])

  /**
   * Sai da conta. No modo real os dados baixados saem deste aparelho (antes ficavam todos no
   * navegador, inclusive de outras pessoas). No demo só desloga.
   */
  const sairDaSessao = useCallback(() => {
    limparSessao()
    zerarBase()
    sincronizadoRef.current = false
    aplicar(persist(emDemo() ? { ...stateRef.current, sessionUserId: null } : estadoVazio()))
  }, [aplicar])

  const refreshFromCloud = useCallback(async () => {
    if (emDemo() || !tokenAtual()) return
    const cloud = await pullCloudBundle()
    if (cloud === 'sessao_expirada') {
      sairDaSessao()
      return
    }
    if (!cloud) return
    if (!tokenAtual()) return
    // O resultado vai para stateRef na hora: quem espera este pull (o login decide para onde ir
    // olhando se a empresa/perfil chegou) precisa ver os dados já mesclados. Com só a
    // atualização funcional, ela rodava depois e a empresa aprovada caía no formulário de cadastro.
    // Se o usuário mudou algo enquanto o pull estava a caminho, a mescla é refeita sobre a versão
    // mais nova; as decisões usam a mesma foto da base, então repetir (StrictMode) dá o mesmo resultado.
    const foto = fotografarBase()
    const origem = stateRef.current
    const mesclado = persist(recalcularDerivados(mesclarNuvem(origem, cloud, foto)))
    stateRef.current = mesclado
    setState((prev) => {
      if (prev === origem) return mesclado
      const refeito = persist(recalcularDerivados(mesclarNuvem(prev, cloud, foto)))
      stateRef.current = refeito
      return refeito
    })
    sincronizadoRef.current = true
  }, [sairDaSessao])

  useEffect(() => {
    void refreshFromCloud()
    const id = window.setInterval(() => {
      void refreshFromCloud()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [refreshFromCloud])

  // Envia ao banco o que mudou neste aparelho (vagas, candidaturas, perfil, documentos…).
  useEffect(() => {
    if (emDemo() || !sincronizadoRef.current || !tokenAtual() || !state.sessionUserId) return
    const t = window.setTimeout(() => {
      void enviarMudancas(stateRef.current).then((erros) => {
        if (erros.length) console.warn('[sincronizacao]', erros)
      })
    }, 800)
    return () => window.clearTimeout(t)
  }, [state])

  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState((prev) => persist(fn(prev)))
  }, [])

  /** Abre a sessão do servidor neste aparelho e baixa o que a conta pode ver. */
  const abrirSessaoReal = useCallback(
    async (resposta: RespostaSessao) => {
      const user = contaDaApi(resposta.conta)
      salvarSessao({
        token: resposta.token,
        expira: resposta.expira,
        contaId: user.id,
        trocarSenha: Boolean(resposta.trocarSenha),
      })
      if (resposta.trocarSenha) return user
      zerarBase()
      sincronizadoRef.current = false
      aplicar(persist({ ...estadoVazio(), users: [user], sessionUserId: user.id }))
      await refreshFromCloud()
      return user
    },
    [aplicar, refreshFromCloud],
  )

  /** Depois do login real: avisos de aprovação e se falta completar o perfil. */
  const concluirEntrada = useCallback(
    (conta: User, portal: PortalLogin): ResultadoLogin => {
      const live = stateRef.current
      const user = live.users.find((u) => u.id === conta.id) ?? conta
      const resultado = avaliarPerfil(user, portal, live)
      if (!resultado.ok) sairDaSessao()
      return resultado
    },
    [sairDaSessao],
  )

  const currentUser = useMemo(
    () => state.users.find((u) => u.id === state.sessionUserId) ?? null,
    [state.users, state.sessionUserId],
  )

  const currentEmpresa = useMemo(() => {
    if (!currentUser || currentUser.role !== 'empresa') return null
    return state.empresas.find((e) => e.userId === currentUser.id) ?? null
  }, [currentUser, state.empresas])

  const currentProfissional = useMemo(() => {
    if (!currentUser || currentUser.role !== 'profissional') return null
    return state.profissionais.find((p) => p.userId === currentUser.id) ?? null
  }, [currentUser, state.profissionais])

  const audit = useCallback(
    (action: string, detail: string) => {
      update((s) => ({
        ...s,
        auditLogs: [
          {
            id: uid('log'),
            at: nowIso(),
            actorId: s.sessionUserId ?? 'system',
            action,
            detail,
          },
          ...s.auditLogs,
        ].slice(0, 200),
      }))
    },
    [update],
  )

  const api: StoreApi = {
    state,
    currentUser,
    currentEmpresa,
    currentProfissional,

    async login(email, senha) {
      // Só no modo demo: no real o login é sempre pelo portal, no servidor.
      if (!emDemo()) return { ok: false, error: 'Entre pela tela de login do portal.' }
      const key = email.trim().toLowerCase()
      const user = state.users.find(
        (u) =>
          (u.email.toLowerCase() === key || (u.usuario || '').toLowerCase() === key) && u.senha === senha && u.ativo,
      )
      if (!user) return { ok: false, error: 'E-mail ou senha inválidos.' }
      update((s) => ({ ...s, sessionUserId: user.id }))
      return { ok: true, role: user.role }
    },

    async loginPortal(usuarioOuEmail, senha, portal) {
      if (emDemo()) {
        const key = usuarioOuEmail.trim().toLowerCase()
        // Só na demonstração: "admin" / "admin" abre os três portais com as contas de exemplo
        // (pedido do Diego para conferir as telas). No sistema real isso não existe.
        if (key === 'admin' && senha === 'admin') {
          const exemplo =
            portal === 'empresa'
              ? state.users.find((u) => u.email === 'empresa@logexpress.com') ||
                state.users.find((u) => u.role === 'empresa' && u.ativo)
              : portal === 'profissional'
                ? state.users.find((u) => u.email === 'joao@email.com') ||
                  state.users.find(
                    (u) => u.role === 'profissional' && state.profissionais.some((p) => p.userId === u.id && p.status === 'aprovado'),
                  )
                : state.users.find((u) => (u.usuario || '').toLowerCase() === 'admin' && u.ativo)
          if (!exemplo) return { ok: false, error: 'Conta de exemplo não encontrada na demonstração.' }
          const avaliadoDemo = avaliarEntradaDemo(exemplo, portal, state)
          if (avaliadoDemo.contaId) update((s) => ({ ...s, sessionUserId: avaliadoDemo.contaId! }))
          return avaliadoDemo.resultado
        }
        const user = state.users.find(
          (u) =>
            u.ativo && u.senha === senha && (u.email.toLowerCase() === key || (u.usuario || '').toLowerCase() === key),
        )
        if (!user) return { ok: false, error: 'Usuário ou senha inválidos.' }
        const avaliado = avaliarEntradaDemo(user, portal, state)
        if (avaliado.contaId) update((s) => ({ ...s, sessionUserId: avaliado.contaId! }))
        return avaliado.resultado
      }
      // Contas de teste da equipe no sistema real (pedido do Diego, 12/11/2026): "admin" nos
      // portais Empresa e Profissional entra em "admin.empresa" e "admin.profissional". O usuário
      // "admin" de verdade é o da gestão, e só o portal Admin chega nele.
      const identificador =
        portal !== 'admin' && usuarioOuEmail.trim().toLowerCase() === 'admin' ? `admin.${portal}` : usuarioOuEmail.trim()
      // Modo real: a senha é conferida no servidor (antes o navegador baixava todas as contas
      // com a senha em texto puro e comparava ele mesmo).
      const r = await chamarApi<RespostaSessao>(
        '/api/auth/entrar',
        { identificador, senha },
        { erroPadrao: 'Não foi possível entrar agora. Tente de novo em instantes.' },
      )
      if (!r.ok) {
        // Quem digita "admin" aqui quase sempre quer o super usuário, que só entra pelo portal Admin.
        if (identificador !== usuarioOuEmail.trim() && /inválid|tentativas/i.test(r.erro)) {
          return {
            ok: false,
            error: `Aqui "admin" é a conta de teste do portal ${portal === 'empresa' ? 'Empresa' : 'Trabalhador'}. Para o super usuário, volte à tela inicial e use "Acesso Admin / Superusuário".`,
          }
        }
        return { ok: false, error: r.erro }
      }
      const conta = contaDaApi(r.conta)
      const falha = portalErrado(conta, portal)
      if (falha) return { ok: false, error: falha }
      await abrirSessaoReal(r)
      if (r.trocarSenha) {
        return { ok: true, trocarSenha: true, role: conta.role, usuario: conta.usuario || conta.email }
      }
      return concluirEntrada(conta, portal)
    },

    async concluirTrocaSenha(senhaAtual, novaSenha, portal) {
      const r = await chamarApi<RespostaSessao>(
        '/api/auth/trocar-senha',
        { senhaAtual, novaSenha },
        { tokenProvisorio: true, erroPadrao: 'Não foi possível trocar a senha. Tente de novo.' },
      )
      if (!r.ok) return { ok: false, error: r.erro }
      const conta = await abrirSessaoReal(r)
      return concluirEntrada(conta, portal)
    },

    async trocarMinhaSenha(senhaAtual, novaSenha) {
      if (emDemo()) return { ok: false, error: 'Indisponível no modo demonstração.' }
      const r = await chamarApi<RespostaSessao>(
        '/api/auth/trocar-senha',
        { senhaAtual, novaSenha },
        { erroPadrao: 'Não foi possível trocar a senha. Tente de novo.' },
      )
      if (!r.ok) return { ok: false, error: r.erro }
      // A API devolve uma sessão nova; o resto da tela continua como está.
      const atual = lerSessao()
      salvarSessao({
        token: r.token,
        expira: r.expira,
        contaId: atual?.contaId ?? String(r.conta.id ?? ''),
        trocarSenha: false,
      })
      return { ok: true }
    },

    async adminRedefinirSenha(userId) {
      if (emDemo()) return { ok: false, error: 'Indisponível no modo demonstração.' }
      const r = await chamarApi<{ senhaTemporaria: string }>('/api/auth/admin/redefinir-senha', { contaId: userId })
      if (!r.ok) return { ok: false, error: r.erro }
      return { ok: true, senha: r.senhaTemporaria }
    },

    async adminCriarEmpresa(dados) {
      if (emDemo()) return { ok: false, error: 'Indisponível no modo demonstração.' }
      const r = await chamarApi<{ usuario: string; email: string; senhaTemporaria: string; emailEnviado: boolean }>(
        '/api/auth/admin/criar-empresa',
        dados as unknown as Record<string, unknown>,
        { erroPadrao: 'Não foi possível cadastrar a empresa. Tente de novo em instantes.' },
      )
      if (!r.ok) return { ok: false, error: r.erro }
      await refreshFromCloud()
      return { ok: true, usuario: r.usuario, email: r.email, senha: r.senhaTemporaria, emailEnviado: r.emailEnviado }
    },

    async adminPosicionarEmpresa(empresaId, { orgTipo, orgPaiId }) {
      const atual = state.empresas.find((e) => e.id === empresaId)
      if (!atual) return { ok: false, error: 'Empresa não encontrada.' }
      const next: Empresa = { ...atual, orgTipo: orgTipo ?? undefined, orgPaiId: orgTipo ? orgPaiId : null }
      if (await supabaseConfigured()) {
        const remoto = await upsertEmpresa(next)
        if (!remoto.ok) return { ok: false, error: remoto.erro }
      }
      update((s) => ({ ...s, empresas: s.empresas.map((e) => (e.id === empresaId ? next : e)) }))
      return { ok: true }
    },

    async adminTirarDaHierarquia(empresaId) {
      const alvo = state.empresas.find((e) => e.id === empresaId)
      if (!alvo) return { ok: false, error: 'Empresa não encontrada.' }
      const pai = alvo.orgPaiId ? state.empresas.find((e) => e.id === alvo.orgPaiId) : undefined
      const mudadas: Empresa[] = state.empresas
        .filter((e) => e.orgPaiId === empresaId && e.orgTipo)
        .map((filho) => ({
          ...filho,
          orgPaiId: pai && podeFicarAbaixo(filho.orgTipo!, pai.orgTipo) ? pai.id : null,
        }))
      mudadas.push({ ...alvo, orgTipo: undefined, orgPaiId: null })
      if (await supabaseConfigured()) {
        for (const empresa of mudadas) {
          const remoto = await upsertEmpresa(empresa)
          if (!remoto.ok) return { ok: false, error: remoto.erro }
        }
      }
      const porId = new Map(mudadas.map((e) => [e.id, e]))
      update((s) => ({ ...s, empresas: s.empresas.map((e) => porId.get(e.id) ?? e) }))
      return { ok: true }
    },

    async resolveEmailByIdentificador(id) {
      const key = id.trim().toLowerCase()
      const user = state.users.find(
        (u) => u.email.toLowerCase() === key || (u.usuario || '').toLowerCase() === key,
      )
      return user?.email ?? null
    },

    async portalRegisterUser({ email, usuario, senha, role, verifyToken }) {
      const em = email.trim().toLowerCase()
      const us = usuario.trim()
      if (!emDemo()) {
        // A conta nasce no servidor, que confere o e-mail confirmado (token) e guarda a senha em hash.
        const r = await chamarApi<RespostaSessao>(
          '/api/auth/criar-conta',
          { verify_token: verifyToken, usuario: us, senha },
          { erroPadrao: 'Não foi possível criar a conta. Tente de novo em instantes.' },
        )
        if (!r.ok) return { ok: false, error: r.erro }
        await abrirSessaoReal(r)
        return { ok: true }
      }
      if (state.users.some((u) => u.email.toLowerCase() === em)) {
        return { ok: false, error: 'Este e-mail já está sendo utilizado.' }
      }
      if (state.users.some((u) => (u.usuario || '').toLowerCase() === us.toLowerCase())) {
        return { ok: false, error: 'Nome de usuário já existe.' }
      }
      const userId = uid('user')
      const user: User = {
        id: userId,
        email: em,
        senha,
        usuario: us,
        role,
        nivelHierarquia: 'operador',
        perfilCompleto: false,
        ativo: true,
        createdAt: nowIso(),
      }
      update((s) => ({
        ...s,
        users: [...s.users, user],
        sessionUserId: userId,
        auditLogs: [
          { id: uid('log'), at: nowIso(), actorId: userId, action: 'portal_cadastro', detail: `${us} (${role})` },
          ...s.auditLogs,
        ],
      }))
      return { ok: true }
    },

    async portalResetSenha(email, novaSenha, verifyToken) {
      if (!emDemo()) {
        const r = await chamarApi('/api/auth/redefinir-senha', { verify_token: verifyToken, novaSenha })
        return r.ok ? { ok: true } : { ok: false, error: r.erro }
      }
      const em = email.trim().toLowerCase()
      if (!state.users.some((u) => u.email.toLowerCase() === em)) return { ok: false, error: 'Usuário não encontrado.' }
      update((s) => ({
        ...s,
        users: s.users.map((u) => (u.email.toLowerCase() === em ? { ...u, senha: novaSenha } : u)),
      }))
      return { ok: true }
    },

    logout() {
      sairDaSessao()
    },

    async registerEmpresa(userData, empresaData, documentos, termos) {
      // Conta nova só pelo servidor (login → criar conta com código por e-mail).
      if (!emDemo()) return { ok: false, error: 'Crie a conta pela tela de login, com o código enviado por e-mail.' }
      const em = userData.email.trim().toLowerCase()
      if (state.users.some((u) => u.email.toLowerCase() === em)) {
        return { ok: false, error: 'Este e-mail já está sendo utilizado.' }
      }
      const userId = uid('user')
      const empresaId = uid('emp')
      const user: User = {
        id: userId,
        email: em,
        senha: userData.senha,
        role: 'empresa',
        ativo: true,
        createdAt: nowIso(),
        aceites: aceitesComTermos(undefined, termos),
      }
      const empresa = novaEmpresa(empresaData, empresaId, userId)
      const docs = documentosDeCadastro([], empresaId, documentos, 'empresa')
      update((s) => ({
        ...s,
        users: [...s.users, user],
        empresas: [...s.empresas.filter((e) => e.id !== empresa.id), empresa],
        documentos: juntarDocumentos(s.documentos, docs),
        sessionUserId: userId,
        auditLogs: [
          { id: uid('log'), at: nowIso(), actorId: userId, action: 'cadastro_empresa', detail: empresa.nomeFantasia },
          ...s.auditLogs,
        ],
      }))
      return { ok: true }
    },

    async registerProfissional(userData, profissionalData, documentos) {
      if (!emDemo()) return { ok: false, error: 'Crie a conta pela tela de login, com o código enviado por e-mail.' }
      if (state.users.some((u) => u.email.toLowerCase() === userData.email.toLowerCase())) {
        return { ok: false, error: 'Este e-mail já está sendo utilizado.' }
      }
      const userId = uid('user')
      const profId = uid('prof')
      const user: User = {
        id: userId,
        email: userData.email,
        senha: userData.senha,
        role: 'profissional',
        ativo: true,
        createdAt: nowIso(),
      }
      const profissional = novoProfissional(profissionalData, profId, userId)
      update((s) => ({
        ...s,
        users: [...s.users, user],
        profissionais: [...s.profissionais, profissional],
        documentos: documentosDeCadastro(s.documentos, profId, documentos),
        sessionUserId: userId,
        auditLogs: [
          { id: uid('log'), at: nowIso(), actorId: userId, action: 'cadastro_profissional', detail: profissional.nome },
          ...s.auditLogs,
        ],
      }))
      return { ok: true }
    },

    async completeEmpresaPerfil(empresaData, documentos, termos) {
      const user = state.users.find((u) => u.id === state.sessionUserId)
      if (!user || user.role !== 'empresa') {
        return { ok: false, error: 'Sessão de empresa inválida.' }
      }
      const existente = state.empresas.find((e) => e.userId === user.id)
      // Antes, se a empresa já existia, os dados que a pessoa acabou de preencher eram descartados.
      const empresa: Empresa = existente
        ? { ...existente, ...empresaData }
        : novaEmpresa(empresaData, uid('emp'), user.id)
      let docs = documentosDeCadastro([], empresa.id, documentos, 'empresa')
      const conta: User = { ...user, perfilCompleto: true, aceites: aceitesComTermos(user.aceites, termos) }

      if (await supabaseConfigured()) {
        // A ordem importa: empresa e documentos antes de marcar a conta como completa.
        // Antes os erros eram ignorados; a conta ficava "completa" sem empresa na nuvem, o admin
        // nunca via o cadastro e o próximo login caía no formulário pedindo e-mail já usado.
        const salvo = await salvarPerfilNaNuvem('empresa', empresa, docs)
        if (!salvo.ok) return { ok: false, error: salvo.erro }
        docs = salvo.docs
        const contaSalva = await atualizarConta(conta)
        if (!contaSalva.ok) return { ok: false, error: contaSalva.erro }
      }

      update((s) => ({
        ...s,
        empresas: s.empresas.some((e) => e.id === empresa.id)
          ? s.empresas.map((e) => (e.id === empresa.id ? empresa : e))
          : [...s.empresas, empresa],
        documentos: juntarDocumentos(s.documentos, docs),
        users: s.users.map((u) => (u.id === user.id ? { ...u, perfilCompleto: true, aceites: conta.aceites } : u)),
        auditLogs: [
          { id: uid('log'), at: nowIso(), actorId: user.id, action: 'completar_perfil_empresa', detail: empresa.nomeFantasia },
          ...s.auditLogs,
        ],
      }))
      return { ok: true }
    },

    async completeProfissionalPerfil(profissionalData, documentos, termos) {
      const user = state.users.find((u) => u.id === state.sessionUserId)
      if (!user || user.role !== 'profissional') {
        return { ok: false, error: 'Sessão de profissional inválida.' }
      }
      const existente = state.profissionais.find((p) => p.userId === user.id)
      // Mesmo tratamento do cadastro da empresa: dados novos valem, nada é ignorado em silêncio.
      const profissional: Profissional = existente
        ? { ...existente, ...profissionalData }
        : novoProfissional(profissionalData, uid('prof'), user.id)
      let docs = documentosDeCadastro([], profissional.id, documentos)
      const conta: User = { ...user, perfilCompleto: true, aceites: aceitesComTermos(user.aceites, termos) }

      if (await supabaseConfigured()) {
        const salvo = await salvarPerfilNaNuvem('profissional', profissional, docs)
        if (!salvo.ok) return { ok: false, error: salvo.erro }
        docs = salvo.docs
        const contaSalva = await atualizarConta(conta)
        if (!contaSalva.ok) return { ok: false, error: contaSalva.erro }
      }

      update((s) => ({
        ...s,
        profissionais: s.profissionais.some((p) => p.id === profissional.id)
          ? s.profissionais.map((p) => (p.id === profissional.id ? profissional : p))
          : [...s.profissionais, profissional],
        documentos: juntarDocumentos(s.documentos, docs),
        users: s.users.map((u) => (u.id === user.id ? { ...u, perfilCompleto: true, aceites: conta.aceites } : u)),
        auditLogs: [
          {
            id: uid('log'),
            at: nowIso(),
            actorId: user.id,
            action: 'completar_perfil_profissional',
            detail: profissional.nome,
          },
          ...s.auditLogs,
        ],
      }))
      return { ok: true }
    },

    createDemanda(data) {
      const demanda: Demanda = {
        ...data,
        id: uid('dem'),
        categoria: cargoCategoria(data.cargo),
        status: 'aberta',
        createdAt: nowIso(),
      }

      update((s) => {
        const matches = matchDemanda(demanda, s.profissionais, 40, s.documentos)
        const novas: Candidatura[] = matches.slice(0, 15).map((m) => ({
          id: uid('cand'),
          demandaId: demanda.id,
          profissionalId: m.profissional.id,
          status: 'pendente',
          score: m.score,
          distanciaKm: Math.round(m.distanciaKm * 10) / 10,
          createdAt: nowIso(),
          origem: 'convite',
        }))
        return {
          ...s,
          demandas: [demanda, ...s.demandas],
          candidaturas: [...novas, ...s.candidaturas],
          auditLogs: [
            {
              id: uid('log'),
              at: nowIso(),
              actorId: s.sessionUserId ?? 'system',
              action: 'criar_demanda',
              detail: `${demanda.cargo} x${demanda.quantidade} — ${novas.length} matches`,
            },
            ...s.auditLogs,
          ],
        }
      })

      return demanda
    },

    publicarVaga(data) {
      const demanda: Demanda = {
        ...data,
        id: uid('dem'),
        categoria: cargoCategoria(data.cargo),
        status: 'aberta',
        createdAt: nowIso(),
      }
      update((s) => ({
        ...s,
        demandas: [demanda, ...s.demandas],
        auditLogs: [
          {
            id: uid('log'),
            at: nowIso(),
            actorId: s.sessionUserId ?? 'system',
            action: 'publicar_vaga',
            detail: `${demanda.cargo} · ${demanda.endereco.cidade}`,
          },
          ...s.auditLogs,
        ],
      }))
      return demanda
    },

    candidatar(demandaId, profissionalId) {
      const atual = state
      const demanda = atual.demandas.find((item) => item.id === demandaId)
      const profissional = atual.profissionais.find((item) => item.id === profissionalId)
      if (!demanda || !profissional) return { ok: false, error: 'Vaga não encontrada.' }
      if (demanda.status !== 'aberta') return { ok: false, error: 'Esta vaga não está aberta.' }
      const empresa = atual.empresas.find((item) => item.id === demanda.empresaId)
      if (empresa?.bloqueados.includes(profissionalId)) {
        return { ok: false, error: 'Esta empresa não está recebendo a sua candidatura.' }
      }
      const distancia = Math.round(distanciaKm(profissional.endereco, demanda.endereco) * 10) / 10
      update((s) => {
        const existente = s.candidaturas.find(
          (item) => item.demandaId === demandaId && item.profissionalId === profissionalId,
        )
        if (existente?.status === 'aceita' || existente?.status === 'confirmada') return s
        const agora = nowIso()
        const candidaturas = existente
          ? s.candidaturas.map((item) =>
              item.id === existente.id
                ? {
                    ...item,
                    status: 'aceita' as const,
                    origem: item.origem ?? 'convite',
                    respondidoEm: agora,
                  }
                : item,
            )
          : [
              {
                id: uid('cand'),
                demandaId,
                profissionalId,
                status: 'aceita' as const,
                score: 0,
                distanciaKm: Number.isFinite(distancia) ? distancia : 0,
                createdAt: agora,
                origem: 'candidatura' as const,
                respondidoEm: agora,
              },
              ...s.candidaturas,
            ]
        return {
          ...s,
          candidaturas,
          auditLogs: [
            {
              id: uid('log'),
              at: nowIso(),
              actorId: s.sessionUserId ?? 'system',
              action: 'candidatar_vaga',
              detail: `${profissional.nome} — ${demanda.cargo}`,
            },
            ...s.auditLogs,
          ],
        }
      })
      return { ok: true }
    },

    convidarParaMissao(input) {
      // Ids decididos antes do update: o React pode rodar a função de atualização depois do
      // return, e a tela recebia null (o próximo convite criava outra vaga igual).
      const criarVaga = !input.demandaId
      if (criarVaga && !input.pedido) return null
      const demandaId = input.demandaId || uid('dem')
      const atual = state.demandas.find((d) => d.id === demandaId)
      if (atual && (atual.status === 'finalizada' || atual.status === 'cancelada')) return null
      // Vaga já lotada não recebe convite.
      if (
        atual &&
        atual.quantidade > 0 &&
        state.candidaturas.filter((c) => c.demandaId === demandaId && c.status === 'confirmada').length >= atual.quantidade
      ) {
        return null
      }
      const jaConvidado = state.candidaturas.find(
        (c) => c.demandaId === demandaId && c.profissionalId === input.profissionalId,
      )
      const candidaturaId = jaConvidado?.id ?? uid('cand')
      update((s) => {
        let demandas = s.demandas
        if (criarVaga && input.pedido && !s.demandas.some((d) => d.id === demandaId)) {
          const criada: Demanda = {
            ...input.pedido,
            id: demandaId,
            categoria: cargoCategoria(input.pedido.cargo),
            status: 'aberta',
            createdAt: nowIso(),
          }
          demandas = [criada, ...s.demandas]
        }
        const existente = s.candidaturas.find(
          (c) => c.demandaId === demandaId && c.profissionalId === input.profissionalId,
        )
        if (existente) return { ...s, demandas }
        const cand: Candidatura = {
          id: candidaturaId,
          demandaId,
          profissionalId: input.profissionalId,
          status: 'pendente',
          score: input.score,
          distanciaKm: Math.round(input.distanciaKm * 10) / 10,
          createdAt: nowIso(),
          origem: 'convite',
        }
        const profissional = s.profissionais.find((p) => p.id === input.profissionalId)
        const demanda = demandas.find((d) => d.id === demandaId)
        const empresa = demanda ? s.empresas.find((e) => e.id === demanda.empresaId) : undefined
        const pecasAtuais = s.pecas ?? []
        const novasPecas =
          demanda && empresa
            ? criarPecasIniciais({
                pecas: pecasAtuais,
                demanda,
                empresa,
                ett: s.cadastroEtt ?? cadastroEttInicial(),
                signatarioTomadora: empresa.responsavelNome,
              })
            : []
        return {
          ...s,
          demandas,
          pecas: [...novasPecas, ...pecasAtuais],
          candidaturas: [cand, ...s.candidaturas],
          auditLogs: [
            {
              id: uid('log'),
              at: nowIso(),
              actorId: s.sessionUserId ?? 'system',
              action: 'convidar_missao',
              detail: `${profissional?.nome ?? input.profissionalId} — ${demandaId}`,
            },
            ...s.auditLogs,
          ],
        }
      })
      return { demandaId, candidaturaId }
    },

    updateCandidaturaStatus(id, status) {
      update((s) => ({
        ...s,
        candidaturas: s.candidaturas.map((c) => (c.id === id ? { ...c, status } : c)),
      }))
    },

    acceptOferta(demandaId, profissionalId) {
      update((s) => ({
        ...s,
        candidaturas: s.candidaturas.map((c) =>
          c.demandaId === demandaId &&
          c.profissionalId === profissionalId &&
          c.status !== 'aceita' &&
          c.status !== 'confirmada'
            ? { ...c, status: 'aceita' as const, origem: c.origem ?? 'convite', respondidoEm: nowIso() }
            : c,
        ),
      }))
    },

    refuseOferta(demandaId, profissionalId) {
      update((s) => ({
        ...s,
        candidaturas: s.candidaturas.map((c) =>
          c.demandaId === demandaId &&
          c.profissionalId === profissionalId &&
          (c.status === 'pendente' || c.status === 'aceita')
            ? { ...c, status: 'recusada' as const, recusadaPor: 'profissional' as const }
            : c,
        ),
      }))
    },

    confirmCandidato(candidaturaId) {
      update((s) => {
        const cand = s.candidaturas.find((c) => c.id === candidaturaId)
        if (!cand || cand.status !== 'aceita') return s
        const demanda = s.demandas.find((d) => d.id === cand.demandaId)
        const profissional = s.profissionais.find((p) => p.id === cand.profissionalId)
        const empresa = demanda
          ? s.empresas.find((e) => e.id === demanda.empresaId)
          : undefined
        if (!demanda || !profissional || !empresa) return s
        // Missão encerrada/cancelada não recebe mais gente (antes reabria e pagava de novo).
        if (demanda.status === 'finalizada' || demanda.status === 'cancelada') return s

        const confirmados = s.candidaturas.filter(
          (c) => c.demandaId === cand.demandaId && c.status === 'confirmada',
        ).length
        if (demanda.quantidade > 0 && confirmados >= demanda.quantidade) return s
        const vagaFechada = confirmados + 1 >= demanda.quantidade
        const nextCands = s.candidaturas.map((c) => {
          if (c.id === candidaturaId) return { ...c, status: 'confirmada' as const }
          if (vagaFechada && c.demandaId === cand.demandaId && (c.status === 'pendente' || c.status === 'aceita')) {
            return { ...c, status: 'cancelada' as const }
          }
          return c
        })
        let demandas = s.demandas
        if (vagaFechada) {
          demandas = s.demandas.map((d) =>
            d.id === demanda.id ? { ...d, status: 'em_andamento' as const } : d,
          )
        }
        const checkIns: CheckIn[] = [
          {
            id: uid('chk'),
            demandaId: cand.demandaId,
            profissionalId: cand.profissionalId,
            gpsOk: false,
          },
          ...s.checkIns,
        ]

        const jaTemContrato = s.contratos.some((c) => c.candidaturaId === candidaturaId)
        const contratos = jaTemContrato
          ? s.contratos
          : [
              buildContratoFromConfirmacao({
                demanda,
                empresa,
                profissional,
                candidaturaId,
              }),
              ...s.contratos,
            ]

        const novasPecas = pecasDaContratacao({
          pecas: s.pecas ?? [],
          demanda,
          empresa,
          profissional,
          ett: s.cadastroEtt ?? cadastroEttInicial(),
          candidaturaId,
        })

        return {
          ...s,
          candidaturas: nextCands,
          demandas,
          checkIns,
          contratos,
          pecas: [...novasPecas, ...(s.pecas ?? [])],
          auditLogs: [
            {
              id: uid('log'),
              at: nowIso(),
              actorId: s.sessionUserId ?? 'system',
              action: 'gerar_contrato',
              detail: `Contrato gerado para ${profissional.nome} — demanda ${demanda.id}`,
            },
            ...s.auditLogs,
          ],
        }
      })
    },

    assinarContrato(contratoId) {
      update((s) => ({
        ...s,
        contratos: s.contratos.map((c) =>
          c.id === contratoId
            ? {
                ...c,
                status: 'assinado_profissional' as const,
                assinaturaProfissionalEm: nowIso(),
              }
            : c,
        ),
      }))
    },

    assinarPeca(pecaId, papel, nome) {
      update((s) => ({
        ...s,
        pecas: (s.pecas ?? []).map((p) => (p.id === pecaId ? atualizarAssinatura(p, papel, nome) : p)),
      }))
    },

    aceitarTermos(documentos) {
      update((s) => {
        const userId = s.sessionUserId
        if (!userId || documentos.length === 0) return s
        const em = nowIso()
        return {
          ...s,
          users: s.users.map((u) => {
            if (u.id !== userId) return u
            const outros = (u.aceites ?? []).filter(
              (item) => !(item.versao === VERSAO_TERMOS && documentos.includes(item.documento)),
            )
            return {
              ...u,
              aceites: [...outros, ...documentos.map((documento) => ({ documento, versao: VERSAO_TERMOS, em }))],
            }
          }),
          auditLogs: [
            {
              id: uid('log'),
              at: em,
              actorId: userId,
              action: 'aceite_termos',
              detail: `${documentos.join(', ')} · versão ${VERSAO_TERMOS}`,
            },
            ...s.auditLogs,
          ],
        }
      })
    },

    marcarEsocial(pecaId) {
      update((s) => ({
        ...s,
        pecas: (s.pecas ?? []).map((p) =>
          p.id === pecaId ? { ...p, meta: { ...p.meta, esocial: 'informado' } } : p,
        ),
      }))
    },

    registrarEncerramento(input) {
      update((s) => {
        const demanda = s.demandas.find((d) => d.id === input.demandaId)
        if (!demanda) return s
        const existentes = s.pecas ?? []
        const ja = existentes.some((p) => p.demandaId === demanda.id && p.tipo === 'encerramento')
        const alvos = input.profissionalId
          ? [input.profissionalId]
          : s.candidaturas
              .filter((c) => c.demandaId === demanda.id && c.status === 'confirmada')
              .map((c) => c.profissionalId)
        const novas: PecaDocumental[] = []
        if (!ja) {
          const base = {
            demanda,
            dataEfetiva: input.dataEfetiva,
            motivo: input.motivo,
            responsavel: input.responsavel,
            observacoes: input.observacoes,
            ettNome: (s.cadastroEtt ?? cadastroEttInicial()).nomeFantasia,
          }
          if (alvos.length === 0) {
            novas.push(criarEncerramento({ ...base, pecas: existentes }))
          }
          for (const profissionalId of alvos) {
            const profissional = s.profissionais.find((p) => p.id === profissionalId)
            novas.push(
              criarEncerramento({
                ...base,
                pecas: [...novas, ...existentes],
                profissionalId,
                profissionalNome: profissional?.nome,
              }),
            )
          }
        }
        const encerrada = finishDemandaState(s, demanda.id, input.dataEfetiva)
        return {
          ...encerrada,
          pecas: [...novas, ...(encerrada.pecas ?? [])],
        }
      })
    },

    atualizarCadastroEtt(cadastro) {
      update((s) => ({ ...s, cadastroEtt: cadastro }))
    },

    registrarConsentimento(profissionalId, campo, dar = true) {
      const chave =
        campo === 'politica' ? 'politicaEm' : campo === 'curriculo' ? 'curriculoEm' : 'compartilhamentoEm'
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) => {
          if (p.id !== profissionalId) return p
          // Desmarcar retira o consentimento (o termo diz que dá para retirar; antes só renovava a data).
          const { [chave]: _antigo, ...resto } = p.consentimentoPrivacidade ?? {}
          return { ...p, consentimentoPrivacidade: dar ? { ...resto, [chave]: nowIso() } : resto }
        }),
      }))
    },

    enviarDocumento({ tipoId, donoTipo, donoId, arquivoNome, arquivoDados, validade, meta }) {
      update((s) => {
        const existentes = s.documentos.filter(
          (d) => !(d.tipoId === tipoId && d.donoTipo === donoTipo && d.donoId === donoId),
        )
        const novo: DocumentoRegistro = {
          id: uid('doc'),
          tipoId,
          donoTipo,
          donoId,
          status: 'em_analise',
          arquivoNome,
          arquivoDados,
          validade,
          meta,
          enviadoEm: nowIso(),
        }
        return {
          ...s,
          documentos: [novo, ...existentes],
          auditLogs: [
            {
              id: uid('log'),
              at: nowIso(),
              actorId: s.sessionUserId ?? 'system',
              action: 'enviar_documento',
              detail: `${tipoId} — ${donoTipo}:${donoId}`,
            },
            ...s.auditLogs,
          ],
        }
      })
    },

    revisarDocumento(docId, status, observacao) {
      update((s) => ({
        ...s,
        documentos: s.documentos.map((d) =>
          d.id === docId
            ? {
                ...d,
                status,
                observacao,
                revisadoEm: nowIso(),
                revisadoPor: s.sessionUserId ?? 'admin',
              }
            : d,
        ),
        auditLogs: [
          {
            id: uid('log'),
            at: nowIso(),
            actorId: s.sessionUserId ?? 'system',
            action: 'revisar_documento',
            detail: `${docId} → ${status}`,
          },
          ...s.auditLogs,
        ],
      }))
    },

    refuseCandidato(candidaturaId) {
      // Só pendente/aceita: recusar uma confirmada deixava o contrato ativo.
      update((s) => ({
        ...s,
        candidaturas: s.candidaturas.map((c) =>
          c.id === candidaturaId && (c.status === 'pendente' || c.status === 'aceita')
            ? { ...c, status: 'recusada' as const, recusadaPor: 'empresa' as const }
            : c,
        ),
      }))
    },

    // Ponto por dia: antes havia um único registro por missão e, depois da primeira saída,
    // "Registrar entrada" nunca voltava — missões de vários dias só contavam o 1º dia.
    doCheckIn(demandaId, profissionalId) {
      update((s) => {
        const demanda = s.demandas.find((d) => d.id === demandaId)
        if (!demanda || demanda.status === 'finalizada' || demanda.status === 'cancelada') return s
        const hoje = hojeLocal()
        const meus = s.checkIns.filter((c) => c.demandaId === demandaId && c.profissionalId === profissionalId)
        if (meus.some((c) => c.checkInAt && diaDoPonto(c) === hoje)) return s
        const vazio = meus.find((c) => !c.checkInAt)
        const registro: CheckIn = {
          id: vazio?.id ?? uid('chk'),
          demandaId,
          profissionalId,
          data: hoje,
          checkInAt: nowIso(),
          gpsOk: true,
        }
        return {
          ...s,
          checkIns: vazio
            ? s.checkIns.map((c) => (c.id === vazio.id ? registro : c))
            : [registro, ...s.checkIns],
        }
      })
    },

    doCheckOut(demandaId, profissionalId) {
      update((s) => {
        const aberto = s.checkIns.find(
          (c) => c.demandaId === demandaId && c.profissionalId === profissionalId && c.checkInAt && !c.checkOutAt,
        )
        if (!aberto?.checkInAt) return s
        const horas = Math.max(1, Math.round((Date.now() - new Date(aberto.checkInAt).getTime()) / 3600000))
        return {
          ...s,
          checkIns: s.checkIns.map((c) =>
            c.id === aberto.id ? { ...c, checkOutAt: nowIso(), horasTrabalhadas: horas } : c,
          ),
        }
      })
    },

    addAvaliacao(data) {
      update((s) => {
        const repetida = s.avaliacoes.some(
          (item) =>
            item.demandaId === data.demandaId &&
            item.deUserId === data.deUserId &&
            item.paraUserId === data.paraUserId &&
            item.deRole === data.deRole,
        )
        if (repetida) return s
        const avaliacao: Avaliacao = { ...data, id: uid('av'), createdAt: nowIso() }
        const avaliacoes = [avaliacao, ...s.avaliacoes]
        const profissionais =
          data.deRole === 'empresa'
            ? s.profissionais.map((pessoa) => {
                if (pessoa.userId !== data.paraUserId) return pessoa
                const notas = avaliacoes.filter(
                  (item) => item.paraUserId === pessoa.userId && item.deRole === 'empresa',
                )
                const soma = notas.reduce((total, item) => total + mediaDaAvaliacao(item.notas), 0)
                const media = Math.round((soma / notas.length) * 10) / 10
                return { ...pessoa, avaliacaoMedia: media, nivel: nivelPelaMedia(media, notas.length) }
              })
            : s.profissionais
        return { ...s, avaliacoes, profissionais }
      })
    },

    updateDisponibilidade(profissionalId, disp) {
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) =>
          p.id === profissionalId ? { ...p, disponibilidade: disp } : p,
        ),
      }))
    },

    definirVerTodasVagas(profissionalId, verTodas) {
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) =>
          p.id === profissionalId ? { ...p, verTodasVagas: verTodas } : p,
        ),
      }))
    },

    atualizarPerfilProfissional(profissionalId, dados) {
      const nome = dados.nome.trim()
      if (nome.length < 3) return { ok: false, error: 'Informe o nome.' }
      if (!dados.endereco.cidade.trim() || !dados.endereco.estado.trim()) {
        return { ok: false, error: 'Informe a cidade e o estado.' }
      }
      if (!Number.isFinite(dados.raioKm) || dados.raioKm < 1) {
        return { ok: false, error: 'Informe o raio máximo, em km.' }
      }
      const pix = validarChavePix(dados.pix)
      if (!pix.ok) return { ok: false, error: pix.erro }
      if (!state.profissionais.some((p) => p.id === profissionalId)) {
        return { ok: false, error: 'Perfil não encontrado.' }
      }
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) =>
          p.id === profissionalId
            ? {
                ...p,
                nome,
                cpf: dados.cpf.trim(),
                rg: dados.rg.trim(),
                nascimento: dados.nascimento,
                telefone: dados.telefone.trim(),
                // undefined = não mexeu; '' = removeu a foto.
                foto: dados.foto === undefined ? p.foto : dados.foto || undefined,
                resumo: dados.resumo === undefined ? p.resumo : semContato(dados.resumo).slice(0, 600) || undefined,
                escolaridade: dados.escolaridade === undefined ? p.escolaridade : dados.escolaridade || undefined,
                habilidades:
                  dados.habilidades === undefined
                    ? p.habilidades
                    : dados.habilidades.length
                      ? dados.habilidades
                      : undefined,
                profissoes: dados.profissoes,
                experiencia: dados.experiencia.map((item) => ({ ...item, descricao: semContato(item.descricao) })),
                certificados: dados.certificados,
                cnhCategoria: dados.cnhCategoria?.trim() || undefined,
                cnhValidade: dados.cnhValidade || undefined,
                disponibilidade: dados.disponibilidade,
                endereco: {
                  ...dados.endereco,
                  cep: dados.endereco.cep.trim(),
                  rua: dados.endereco.rua.trim(),
                  numero: dados.endereco.numero.trim(),
                  cidade: dados.endereco.cidade.trim(),
                  estado: dados.endereco.estado.trim().toUpperCase(),
                },
                raioKm: Math.min(500, Math.round(dados.raioKm)),
                pix: pix.chave,
              }
            : p,
        ),
      }))
      return { ok: true }
    },

    atualizarFotoProfissional(profissionalId, foto) {
      if (!state.profissionais.some((p) => p.id === profissionalId)) {
        return { ok: false, error: 'Perfil não encontrado.' }
      }
      if (foto && (!foto.startsWith('data:image/') || foto.length > 400_000)) {
        return { ok: false, error: 'A foto ficou grande demais. Escolha outra imagem.' }
      }
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) => (p.id === profissionalId ? { ...p, foto: foto || undefined } : p)),
      }))
      return { ok: true }
    },

    atualizarPix(profissionalId, pixInformado) {
      const pix = validarChavePix(pixInformado)
      if (!pix.ok) return { ok: false, error: pix.erro }
      if (!state.profissionais.some((p) => p.id === profissionalId)) {
        return { ok: false, error: 'Perfil não encontrado.' }
      }
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) => (p.id === profissionalId ? { ...p, pix: pix.chave } : p)),
      }))
      return { ok: true, chave: pix.chave, rotulo: pix.rotulo }
    },

    toggleFavorito(empresaId, profissionalId) {
      update((s) => ({
        ...s,
        empresas: s.empresas.map((e) => {
          if (e.id !== empresaId) return e
          const has = e.favoritos.includes(profissionalId)
          return {
            ...e,
            favoritos: has
              ? e.favoritos.filter((id) => id !== profissionalId)
              : [...e.favoritos, profissionalId],
          }
        }),
      }))
    },

    toggleBloqueado(empresaId, profissionalId) {
      update((s) => ({
        ...s,
        empresas: s.empresas.map((e) => {
          if (e.id !== empresaId) return e
          const has = e.bloqueados.includes(profissionalId)
          return {
            ...e,
            bloqueados: has
              ? e.bloqueados.filter((id) => id !== profissionalId)
              : [...e.bloqueados, profissionalId],
          }
        }),
      }))
    },

    patchState(fn) {
      update(fn)
    },

async setEmpresaStatus(id, status, opts) {
      const atual = state.empresas.find((e) => e.id === id)
      if (!atual) return { ok: false, error: 'Empresa não encontrada.' }
      const next = {
        ...atual,
        status,
        motivoRecusa:
          status === 'recusada' ? String(opts?.motivoRecusa || '').trim() || atual.motivoRecusa : undefined,
      }
      // Antes a falha da nuvem era ignorada: o admin via "aprovado", o e-mail saía,
      // mas o banco seguia "pendente" e a empresa continuava sem conseguir entrar.
      if (await supabaseConfigured()) {
        const remoto = await upsertEmpresa(next)
        if (!remoto.ok) return { ok: false, error: remoto.erro }
      }
      update((s) => ({
        ...s,
        empresas: s.empresas.map((e) => (e.id === id ? next : e)),
      }))
      return { ok: true }
    },
async setProfissionalStatus(id, status, opts) {
      const atual = state.profissionais.find((p) => p.id === id)
      if (!atual) return { ok: false, error: 'Colaborador não encontrado.' }
      const next = {
        ...atual,
        status,
        motivoRecusa:
          status === 'recusado' ? String(opts?.motivoRecusa || '').trim() || atual.motivoRecusa : undefined,
      }
      if (await supabaseConfigured()) {
        const remoto = await upsertProfissional(next)
        if (!remoto.ok) return { ok: false, error: remoto.erro }
      }
      update((s) => ({
        ...s,
        profissionais: s.profissionais.map((p) => (p.id === id ? next : p)),
      }))
      return { ok: true }
    },
    finishDemanda(demandaId) {
      update((s) => finishDemandaState(s, demandaId))
    },

    cancelDemanda(demandaId) {
      update((s) => {
        const demanda = s.demandas.find((d) => d.id === demandaId)
        if (!demanda || demanda.status === 'finalizada' || demanda.status === 'cancelada') return s
        // Se alguém já trabalhou (entrada no ponto), "cancelar" vira encerramento hoje: os dias
        // trabalhados são pagos. Antes a vaga sumia e ninguém recebia.
        if (s.checkIns.some((c) => c.demandaId === demandaId && c.checkInAt)) {
          return finishDemandaState(s, demandaId, hojeLocal())
        }
        return {
          ...s,
          demandas: s.demandas.map((d) => (d.id === demandaId ? { ...d, status: 'cancelada' as const } : d)),
          // Inclui quem já estava confirmado: antes a vaga cancelada seguia "em andamento" para ele.
          candidaturas: s.candidaturas.map((c) =>
            c.demandaId === demandaId && (c.status === 'pendente' || c.status === 'aceita' || c.status === 'confirmada')
              ? { ...c, status: 'cancelada' as const }
              : c,
          ),
          contratos: s.contratos.map((contrato) =>
            contrato.demandaId === demandaId && contrato.status !== 'concluido'
              ? { ...contrato, status: 'rescindido' as const }
              : contrato,
          ),
        }
      })
    },

    resetDemo() {
      setState(persist(resetState()))
    },

    // Referência estável (useCallback): quem usa em dependência de efeito não entra em loop.
    refreshFromCloud,

    async excluirUsuario(userId) {
      const alvo = state.users.find((u) => u.id === userId)
      if (!alvo) return { ok: false, error: 'Usuário não encontrado.' }
      if (state.sessionUserId === userId) {
        return { ok: false, error: 'Você não pode excluir a conta em que está logado.' }
      }
      if (
        alvo.role === 'super' ||
        isLocalSuperUser(alvo.usuario || '') ||
        isLocalSuperUser(alvo.email)
      ) {
        return { ok: false, error: 'Superusuários não podem ser excluídos.' }
      }

      const profIds = state.profissionais.filter((p) => p.userId === userId).map((p) => p.id)
      const empIds = state.empresas.filter((e) => e.userId === userId).map((e) => e.id)

      update((s) => ({
        ...s,
        users: s.users.filter((u) => u.id !== userId),
        profissionais: s.profissionais.filter((p) => p.userId !== userId),
        empresas: s.empresas.filter((e) => e.userId !== userId),
        documentos: s.documentos.filter(
          (d) =>
            !(
              (d.donoTipo === 'profissional' && profIds.includes(d.donoId)) ||
              (d.donoTipo === 'empresa' && empIds.includes(d.donoId))
            ),
        ),
        auditLogs: [
          {
            id: uid('log'),
            at: nowIso(),
            actorId: s.sessionUserId ?? 'system',
            action: 'excluir_usuario',
            detail: `${alvo.usuario || alvo.email} (${alvo.role})`,
          },
          ...s.auditLogs,
        ],
      }))

      if (await supabaseConfigured()) {
        const remoto = await excluirContaCloud(userId)
        if (!remoto.ok) return { ok: false, error: remoto.erro }
      }
      return { ok: true }
    },

    audit,
  }

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
