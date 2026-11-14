export type UserRole = 'empresa' | 'profissional' | 'admin' | 'super'

export type NivelHierarquia = 'super' | 'gestor' | 'operador'

export type Nivel = 'bronze' | 'prata' | 'ouro' | 'elite'

export type DemandaStatus =
  | 'aberta'
  | 'em_andamento'
  | 'finalizada'
  | 'cancelada'

export type CandidaturaStatus =
  | 'pendente'
  | 'aceita'
  | 'recusada'
  | 'confirmada'
  | 'cancelada'

export type EmpresaTipo =
  | 'transportadora'
  | 'operador_logistico'
  | 'industria'
  | 'centro_distribuicao'
  | 'atacadista'
  | 'varejo'
  | 'outro'

export type Plano = 'gratuito' | 'premium' | 'enterprise'

export type Disponibilidade = {
  hoje: boolean
  amanha: boolean
  estaSemana: boolean
  finaisDeSemana: boolean
  noturno: boolean
  viagens: boolean
  temporario: boolean
  efetivo: boolean
  freelancer: boolean
}

export type Endereco = {
  cep: string
  rua: string
  numero: string
  /** Apto, bloco, casa 2... Fica só com a pessoa e a gestão (a empresa vê só cidade e UF). */
  complemento?: string
  /** De onde veio lat/lng: rua (OpenStreetMap), CEP, centro da cidade ou marcador arrastado. O servidor recalcula cidade/CEP. */
  coordOrigem?: 'endereco' | 'cep' | 'cidade' | 'manual'
  cidade: string
  estado: string
  lat: number
  lng: number
}

export type User = {
  id: string
  email: string
  senha: string
  role: UserRole
  /** Login estilo portal (ex.: Diego, Elder, logexpress). */
  usuario?: string
  nivelHierarquia?: NivelHierarquia
  superiorUsuario?: string | null
  perfilCompleto?: boolean
  ativo: boolean
  createdAt: string
  aceites?: AceiteTermo[]
}

export type AceiteTermo = {
  documento: 'termos_uso' | 'privacidade' | 'dados' | 'veracidade'
  versao: string
  em: string
}

export type Empresa = {
  id: string
  userId: string
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  tipo: EmpresaTipo
  /** Marca exibida para o trabalhador na vaga. */
  logo?: string
  plano: Plano
  responsavelNome: string
  responsavelCpf: string
  responsavelCargo: string
  telefone: string
  endereco: Endereco
  status: 'pendente' | 'aprovada' | 'bloqueada' | 'recusada'
  /** Motivo quando status = recusada. */
  motivoRecusa?: string
  avaliacaoMedia: number
  favoritos: string[]
  bloqueados: string[]
  docsOk: boolean
  saldo: number
  limitePosPago: number
  diasTaxaZero: number
  metaTaxaZero: number
  diasAgenciados: number
  rankingDias: number
  economiaTotal: number
  /** Ponto da empresa na hierarquia (mesma do Oferta de Carga). Sem isso, fica fora da hierarquia. */
  orgTipo?: OrgTipo
  /** Empresa logo acima na hierarquia (null = topo). */
  orgPaiId?: string | null
  /** Usuário da gestão que cadastrou a empresa pelo painel. */
  cadastradaPor?: string
}

/** Operador Logístico → Filial do Operador → Embarcador → Unidade → Transportadora. */
export type OrgTipo = 'operador_logistico' | 'filial_operador' | 'embarcador' | 'unidade' | 'transportadora'

/** Empresa dentro de um grupo de hierarquia: em cada grupo ela tem o próprio "pai". */
export type MembroGrupo = {
  empresaId: string
  paiEmpresaId: string | null
  posicao: number
}

/**
 * Grupo de hierarquia, no mesmo modelo do Oferta de Carga: a empresa existe uma vez e pode estar
 * em vários grupos, cada um com o seu desenho. Só a gestão vê e altera.
 */
export type GrupoHierarquia = {
  id: string
  nome: string
  descricao: string
  /** Empresa principal do grupo (opcional). */
  empresaId: string
  criadoEm: string
  membros: MembroGrupo[]
}

export type Infracao = {
  id: string
  empresaId: string
  titulo: string
  status: 'aberta' | 'em_analise' | 'encerrada'
  data: string
  palavraChave: string
}

export type Sinistro = {
  id: string
  empresaId: string
  titulo: string
  status: 'aberto' | 'em_analise' | 'encerrado'
  data: string
  palavraChave: string
}

export type OperacaoModelo = {
  id: string
  empresaId: string
  tipoContrato: string
  perfilIdeal: string
  titulo: string
  tipoOperacao: string
  categoria: 'motorista' | 'ajudante'
}

export type PerfilIdeal = {
  id: string
  empresaId: string
  nome: string
  operacao: string
  categoria: 'motorista' | 'ajudante'
  selecaoAutomatica: boolean
}

export type EnderecoEmpresa = {
  id: string
  empresaId: string
  nome: string
  rua: string
  cidade: string
  uf: string
}

export type Veiculo = {
  id: string
  empresaId: string
  marca: string
  modelo: string
  ano: string
  placa: string
}

export type RelatorioGerado = {
  id: string
  empresaId: string
  tipo: string
  periodo: string
  createdAt: string
}

export type Experiencia = {
  cargo: string
  empresa: string
  inicio: string
  fim: string
  descricao: string
}

export type Certificado = {
  tipo: string
  validade: string
  valido: boolean
}

export type Profissional = {
  id: string
  userId: string
  nome: string
  cpf: string
  rg: string
  nascimento: string
  /** Idade calculada no servidor: a empresa recebe a idade, não a data de nascimento. */
  idade?: number
  telefone: string
  foto?: string
  /** Aparece para a empresa tomadora. Sem telefone, e-mail, CPF ou endereço. */
  resumo?: string
  escolaridade?: string
  habilidades?: string[]
  profissoes: string[]
  experiencia: Experiencia[]
  certificados: Certificado[]
  cnhCategoria?: string
  cnhValidade?: string
  disponibilidade: Disponibilidade
  nivel: Nivel
  avaliacaoMedia: number
  taxaComparecimento: number
  faltas: number
  tempoRespostaMin: number
  endereco: Endereco
  raioKm: number
  pix: string
  /** Quando falso, a aba Vagas mostra só publicações dos cargos do perfil. */
  verTodasVagas?: boolean
  banco?: string
  status: 'pendente' | 'aprovado' | 'bloqueado' | 'recusado'
  /** Motivo quando status = recusado. */
  motivoRecusa?: string
  consentimentoPrivacidade?: {
    politicaEm?: string
    curriculoEm?: string
    compartilhamentoEm?: string
  }
  ganhosMes: number
  saldo: number
}

export type Demanda = {
  id: string
  empresaId: string
  cargo: string
  categoria: string
  quantidade: number
  data: string
  horaInicio: string
  horaFim: string
  endereco: Endereco
  valorDiaria: number
  descricao: string
  epis: string
  observacoes: string
  requisitos: string[]
  /** Término previsto da missão temporária. A data de início continua em `data`. */
  dataFim?: string
  motivo?: string
  atividades?: string
  beneficios?: string
  diferenciais?: string[]
  status: DemandaStatus
  createdAt: string
}

export type Candidatura = {
  id: string
  demandaId: string
  profissionalId: string
  status: CandidaturaStatus
  score: number
  distanciaKm: number
  createdAt: string
  /** Candidatura veio da vaga publicada; convite foi enviado pela empresa. */
  origem?: 'candidatura' | 'convite'
  /** Momento em que o trabalhador se candidatou ou aceitou o convite. */
  respondidoEm?: string
  /** Quem recusou (status = recusada): a empresa ou o próprio trabalhador. */
  recusadaPor?: 'empresa' | 'profissional'
}

export type CheckIn = {
  id: string
  demandaId: string
  profissionalId: string
  /** Dia do ponto (AAAA-MM-DD, local). Uma missão de vários dias tem um registro por dia. */
  data?: string
  checkInAt?: string
  checkOutAt?: string
  gpsOk: boolean
  horasTrabalhadas?: number
}

export type Avaliacao = {
  id: string
  demandaId: string
  deUserId: string
  paraUserId: string
  deRole: UserRole
  notas: {
    pontualidade: number
    qualidade: number
    educacao: number
    produtividade: number
  }
  observacoes: string
  createdAt: string
}

export type Pagamento = {
  id: string
  demandaId: string
  profissionalId: string
  empresaId: string
  valor: number
  comissao: number
  status: 'pendente' | 'pago' | 'estornado'
  createdAt: string
}

export type AuditLog = {
  id: string
  at: string
  actorId: string
  action: string
  detail: string
}

export type ContratoStatus = 'gerado' | 'assinado_profissional' | 'concluido' | 'rescindido'

export type ContratoServico = {
  id: string
  numero: string
  demandaId: string
  candidaturaId: string
  empresaId: string
  profissionalId: string
  status: ContratoStatus
  createdAt: string
  ofertaEm: string
  cienciaEm: string
  selecaoEm: string
  assinaturaProfissionalEm?: string
  valor: number
  inicioEm: string
  fimEm: string
  oQueEmpresaOferece: string[]
  episEmpresa: string[]
  episPrestador: string[]
  tiposServico: string[]
  instrucoesExtras: string
  proibicoes: string[]
}

export type DocumentoStatus = 'pendente' | 'em_analise' | 'aprovado' | 'recusado' | 'vencido'

export type DocumentoRegistro = {
  id: string
  tipoId: string
  /** profissional | empresa tomadora | empresa de trabalho temporário */
  donoTipo: 'profissional' | 'empresa' | 'ett'
  donoId: string
  status: DocumentoStatus
  arquivoNome?: string
  /** Cópia para a validação manual. Ausente nos registros antigos. */
  arquivoDados?: string
  validade?: string
  enviadoEm: string
  revisadoEm?: string
  revisadoPor?: string
  observacao?: string
  /** metadados extras (ex.: categoria CNH) */
  meta?: Record<string, string>
}

export type PecaTipo =
  | 'solicitacao'
  | 'contrato_ett_tomadora'
  | 'contrato_individual'
  | 'termo_integracao'
  | 'ficha_epi'
  | 'encerramento'
  | 'recibo'

export type PecaStatus = 'registrada' | 'aguardando_assinatura' | 'concluida' | 'encerrada'

export type AssinaturaPeca = {
  papel: 'ett' | 'tomadora' | 'trabalhador'
  nome: string
  status: 'pendente' | 'assinado'
  em?: string
}

export type PecaDocumental = {
  id: string
  numero: string
  tipo: PecaTipo
  status: PecaStatus
  demandaId: string
  empresaId: string
  profissionalId?: string
  candidaturaId?: string
  titulo: string
  resumo: string[]
  assinaturas: AssinaturaPeca[]
  criadoEm: string
  aviso: string
  meta?: Record<string, string>
}

export type CadastroEtt = {
  razaoSocial: string
  nomeFantasia: string
  cnpj: string
  juntaComercial: string
  socios: string
  documentosSocios: string
  capitalSocial: string
  cnae: string
  sede: string
  registroSirett: string
  certificadoRegistro: string
  certificadoDigital: string
  procuracoes: string
}

/** Modelo de vaga salvo pela empresa ("Salvar como modelo"). Fica no servidor: vale em qualquer aparelho. */
export type ModeloVaga = {
  id: string
  empresaId: string
  salvoEm: string
  titulo: string
  cargoId: string
  requisitos: string[]
  diferenciais: string[]
  cidade: string
  estado?: string
  raioKm?: number | null
  horaInicio: string
  horaFim: string
  inicio: string
  fim: string
  observacoes: string
  motivo: string
  atividades: string
  remuneracao: string
  beneficios: string
  quantidade: number
}

export type AppState = {
  users: User[]
  empresas: Empresa[]
  profissionais: Profissional[]
  demandas: Demanda[]
  candidaturas: Candidatura[]
  checkIns: CheckIn[]
  avaliacoes: Avaliacao[]
  pagamentos: Pagamento[]
  auditLogs: AuditLog[]
  infracoes: Infracao[]
  sinistros: Sinistro[]
  operacoes: OperacaoModelo[]
  perfisIdeais: PerfilIdeal[]
  enderecosEmpresa: EnderecoEmpresa[]
  veiculos: Veiculo[]
  relatorios: RelatorioGerado[]
  /** Modelos de vaga salvos pelas empresas. */
  modelosVaga: ModeloVaga[]
  contratos: ContratoServico[]
  documentos: DocumentoRegistro[]
  pecas: PecaDocumental[]
  cadastroEtt: CadastroEtt
  /** Grupos de hierarquia das empresas (só a gestão). */
  gruposHierarquia?: GrupoHierarquia[]
  sessionUserId: string | null
}
