import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { AceiteTermosGate } from '../../components/AceiteTermos'
import { BibliotecaDocumental } from '../../components/BibliotecaDocumental'
import { CurriculoDetalhado } from '../../components/CurriculoDetalhado'
import { PecaViewer } from '../../components/PecaViewer'
import { CATEGORIES, allCargos, cargoCategoria, cargoLabel } from '../../data/categories'
import { LOCAIS_OPERACAO } from '../../data/cidades'
import {
  analisarCurriculos,
  buscarPorAtividades,
  requisitosDoCargo,
  rotuloAnos,
  termosDasAtividades,
  type CurriculoAnalisado,
  type ModoBusca,
} from '../../lib/analiseCurriculo'
import { abrirCurriculoPdf } from '../../lib/curriculoPdf'
import { useFeriadosNoPeriodo } from '../../lib/apisPublicas'
import { MapaMaoDeObra } from './MapaMaoDeObra'
import { SinoEmpresa } from './SinoEmpresa'
import { AvaliacaoTrabalhador } from './AvaliacaoTrabalhador'
import { PerfilColaborador } from './PerfilColaborador'
import { checklistProfissional, resumoDocumental } from '../../lib/documentos'
import { distanciaKm } from '../../lib/matching'
import { coordenadaDaCidade } from '../../lib/coordenadaCidade'
import { rotuloPeriodo } from '../../lib/periodoMissao'
import { hojeLocal } from '../../lib/ponto'
import type { Demanda, DocumentoRegistro } from '../../lib/types'
import {
  AVISO_FORMALIZACAO,
  MOTIVOS_TEMPORARIOS,
  rotuloMotivo,
  validarNecessidade,
  type MotivoTemporario,
} from '../../lib/modalidadeContratacao'
import { BoasVindas, BotaoAtualizar, BotaoTema, RelogioTopo, UsuarioTopo } from '../../components/TopoDocaLivre'
import { AplicativoCelular, IconeCelular } from '../../components/AplicativoCelular'
import { abaPedida, esquecerAbaPedida } from '../../lib/aplicativo'
import { BRAND_PRODUCT_NAME, LOGO_DOCA_LIVRE_SRC } from '../../lib/brandAssets'
import { useStore } from '../../lib/store'
import './contratar.css'

/** Dados de uma vaga antes de virar demanda (o que `publicarVaga`/`convidarParaMissao` recebem). */
type PedidoVaga = Omit<Demanda, 'id' | 'createdAt' | 'status' | 'categoria'>

/** Todos os trabalhadores pedidos já foram confirmados. */
function vagaLotada(
  demanda: Pick<Demanda, 'id' | 'quantidade'>,
  candidaturas: { demandaId: string; status: string }[],
) {
  const confirmados = candidaturas.filter((c) => c.demandaId === demanda.id && c.status === 'confirmada').length
  return demanda.quantidade > 0 && confirmados >= demanda.quantidade
}

function vagaEncerrada(status: string) {
  return status === 'finalizada' || status === 'cancelada'
}

type LocalComCoordenada = { cidade: string; estado: string; lat: number; lng: number }

type PontoOperacao = {
  lat: number
  lng: number
  /** A cidade escolhida não foi localizada: distâncias e raio saem da sede da empresa. */
  daSede: boolean
}

function coordenadaValida(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
}

/**
 * Coordenada da cidade da operação. Antes, cidade sem nenhum cadastro com coordenada (ex.: uma
 * das cidades da lista padrão) ficava, sem aviso, com a coordenada da sede: a busca por raio e as
 * distâncias eram medidas a partir da sede, e a vaga era gravada com o ponto errado.
 */
function pontoOperacao(
  cidade: string,
  estado: string,
  empresa: { endereco: LocalComCoordenada },
  locais: LocalComCoordenada[],
): PontoOperacao {
  const sede = { lat: empresa.endereco.lat, lng: empresa.endereco.lng }
  const nome = cidade.trim() || empresa.endereco.cidade
  const uf = estado.trim().toUpperCase()
  const ehCidadeDaSede =
    semAcento(nome) === semAcento(empresa.endereco.cidade) && (!uf || uf === empresa.endereco.estado.toUpperCase())
  if (ehCidadeDaSede && coordenadaValida(sede.lat, sede.lng)) return { ...sede, daSede: false }
  const conhecidos = locais.filter((local) => coordenadaValida(local.lat, local.lng))
  const mesmaCidade = (local: { cidade: string }) => semAcento(local.cidade) === semAcento(nome)
  // Coordenada exata de um cadastro na cidade (sem o deslocamento aleatório de coordenadaDaCidade).
  const exato = conhecidos.find((local) => mesmaCidade(local) && (!uf || local.estado.toUpperCase() === uf))
  if (exato) return { lat: exato.lat, lng: exato.lng, daSede: false }
  // Sem UF escolhida ("Todos"): usa a UF da lista de cidades de operação.
  const ufCidade = uf || LOCAIS_OPERACAO.find(mesmaCidade)?.estado?.toUpperCase() || ''
  if (ufCidade) {
    const ponto = coordenadaDaCidade(nome, ufCidade, conhecidos)
    if (coordenadaValida(ponto.lat, ponto.lng)) return { ...ponto, daSede: false }
  }
  // Cidade desconhecida (coordenadaDaCidade devolve NaN): cai para a sede e a tela avisa.
  return { ...sede, daSede: !ehCidadeDaSede }
}

function semAcento(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

type LocalBusca = { cidade: string; estado: string }

const RAIOS_BUSCA = [10, 25, 50, 100]
const ATALHOS_DIAS = [7, 15, 30, 60, 90, 180]
/** 180 dias e mais uma prorrogação de até 90. */
const LIMITE_DIAS = 180
const MAXIMO_DIAS = 270

function CampoCidade({
  cidade,
  estado,
  onChange,
  locais,
}: {
  cidade: string
  estado: string
  onChange: (cidade: string, estado: string) => void
  locais: LocalBusca[]
}) {
  const listaId = useId()
  const caixa = useRef<HTMLDivElement>(null)
  const [aberta, setAberta] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [destaque, setDestaque] = useState(0)
  const texto = cidade ? `${cidade}${estado ? `/${estado}` : ''}` : ''

  const opcoes = useMemo(() => {
    const unicas = new Map<string, LocalBusca>()
    for (const local of locais) {
      const nome = local.cidade.trim()
      const uf = local.estado.trim().toUpperCase()
      if (!nome || !uf) continue
      if (estado && uf !== estado) continue
      unicas.set(`${semAcento(nome)}|${uf}`, { cidade: nome, estado: uf })
    }
    const lista = [...unicas.values()]
    const termo = semAcento(consulta.trim())
    const filtradas = termo
      ? lista.filter((local) => {
          const rotulo = semAcento(`${local.cidade}/${local.estado}`)
          return rotulo.includes(termo) || semAcento(local.estado).startsWith(termo)
        })
      : lista
    return filtradas.sort((a, b) => {
      if (termo) {
        const aComeca = semAcento(a.cidade).startsWith(termo) ? 0 : 1
        const bComeca = semAcento(b.cidade).startsWith(termo) ? 0 : 1
        if (aComeca !== bComeca) return aComeca - bComeca
      }
      const porCidade = a.cidade.localeCompare(b.cidade, 'pt-BR')
      return porCidade || a.estado.localeCompare(b.estado, 'pt-BR')
    })
  }, [consulta, estado, locais])

  useEffect(() => {
    setDestaque(0)
  }, [consulta, aberta])

  useEffect(() => {
    if (!aberta) return
    function fecharAoClicarFora(evento: MouseEvent) {
      if (!caixa.current?.contains(evento.target as Node)) setAberta(false)
    }
    document.addEventListener('mousedown', fecharAoClicarFora)
    return () => document.removeEventListener('mousedown', fecharAoClicarFora)
  }, [aberta])

  function escolher(local: LocalBusca) {
    onChange(local.cidade, local.estado)
    setConsulta('')
    setAberta(false)
  }

  return (
    <div className="cf-field cf-city" ref={caixa}>
      <span id={`${listaId}-label`}>Cidade da operação</span>
      <input
        role="combobox"
        aria-expanded={aberta}
        aria-controls={listaId}
        aria-labelledby={`${listaId}-label`}
        aria-autocomplete="list"
        value={aberta && consulta !== '' ? consulta : texto}
        placeholder="Cidade ou cidade/estado"
        onClick={() => setAberta(true)}
        onFocus={(e) => {
          setConsulta('')
          setAberta(true)
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setConsulta(e.target.value)
          setAberta(true)
        }}
        onKeyDown={(e) => {
          if (!aberta && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            setAberta(true)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setDestaque((i) => Math.min(i + 1, Math.max(opcoes.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setDestaque((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && aberta && opcoes[destaque]) {
            e.preventDefault()
            escolher(opcoes[destaque])
          } else if (e.key === 'Escape') {
            setAberta(false)
            setConsulta('')
          }
        }}
      />
      {aberta && (
        <ul className="cf-city-list" id={listaId} role="listbox">
          {opcoes.length === 0 && <li className="cf-city-empty muted">Nenhuma cidade com esse nome.</li>}
          {opcoes.map((local, indice) => (
            <li key={`${local.cidade}-${local.estado}`}>
              <button
                type="button"
                role="option"
                aria-selected={indice === destaque}
                className={indice === destaque ? 'cf-city-list--on' : undefined}
                onMouseEnter={() => setDestaque(indice)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(local)}
              >
                {local.cidade}/{local.estado}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type ModeloMissao = {
  id: string
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
  motivo: MotivoTemporario | ''
  atividades: string
  remuneracao: string
  beneficios: string
  quantidade: number
}

function chaveModelos(empresaId: string) {
  return `doca-modelos-missao:${empresaId}`
}

function modeloValido(valor: unknown): valor is ModeloMissao {
  if (!valor || typeof valor !== 'object') return false
  const item = valor as Partial<ModeloMissao>
  return typeof item.cargoId === 'string' && typeof item.titulo === 'string'
}

function normalizarModelo(valor: ModeloMissao): ModeloMissao {
  return {
    ...valor,
    id: valor.id || `mod_${Date.now()}`,
    salvoEm: valor.salvoEm || new Date().toISOString(),
    inicio: valor.inicio || '',
    fim: valor.fim || '',
    requisitos: Array.isArray(valor.requisitos) ? valor.requisitos : [],
    diferenciais: Array.isArray(valor.diferenciais) ? valor.diferenciais : [],
    quantidade: Number.isFinite(valor.quantidade) ? valor.quantidade : 1,
  }
}

function lerModelos(empresaId: string): ModeloMissao[] {
  try {
    const lista = localStorage.getItem(chaveModelos(empresaId))
    if (lista) {
      const parsed = JSON.parse(lista) as unknown
      if (Array.isArray(parsed)) return parsed.filter(modeloValido).map(normalizarModelo)
    }
    const antigo = localStorage.getItem(`doca-modelo-missao:${empresaId}`)
    if (!antigo) return []
    const um = JSON.parse(antigo) as unknown
    return modeloValido(um) ? [normalizarModelo(um)] : []
  } catch {
    return []
  }
}

/** Os modelos antigos ficavam só no navegador; depois de subir para o servidor, saem daqui. */
function apagarModelosLocais(empresaId: string) {
  try {
    localStorage.removeItem(chaveModelos(empresaId))
    localStorage.removeItem(`doca-modelo-missao:${empresaId}`)
  } catch {
    /* sem localStorage */
  }
}

function assinaturaModelo(modelo: ModeloMissao) {
  return [
    modelo.cargoId,
    modelo.cidade,
    modelo.estado ?? '',
    modelo.horaInicio,
    modelo.horaFim,
    String(modelo.quantidade),
    [...modelo.requisitos].sort().join('|'),
    [...modelo.diferenciais].sort().join('|'),
    modelo.motivo,
    modelo.atividades.trim(),
    modelo.remuneracao,
    modelo.beneficios,
    String(modelo.raioKm ?? ''),
    modelo.observacoes.trim(),
  ].join('§')
}

function formatarMoedaDigitando(entrada: string) {
  const limpo = entrada.replace(/R\$\s?/gi, '').replace(/[^\d,]/g, '')
  if (!limpo) return ''
  const temVirgula = limpo.includes(',')
  const [inteiroRaw, ...resto] = limpo.split(',')
  const inteiro = inteiroRaw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const decimal = resto.join('').replace(/\D/g, '').slice(0, 2)
  if (!inteiro && !temVirgula) return ''
  const inteiroFmt = (inteiro || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  if (!temVirgula) return `R$ ${inteiroFmt}`
  return `R$ ${inteiroFmt},${decimal}`
}

function finalizarMoeda(entrada: string) {
  const parcial = formatarMoedaDigitando(entrada)
  if (!parcial) return ''
  const semSimbolo = parcial.replace(/R\$\s?/g, '')
  const [inteiroRaw, decimalRaw = ''] = semSimbolo.split(',')
  const inteiro = inteiroRaw.replace(/\./g, '') || '0'
  const centavos = decimalRaw.padEnd(2, '0').slice(0, 2)
  const numero = Number(`${inteiro}.${centavos}`)
  if (!Number.isFinite(numero)) return ''
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function posicaoAposDigitos(texto: string, digitos: number) {
  if (digitos <= 0) return texto.startsWith('R$') ? 3 : 0
  let vistos = 0
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i)
    if (codigo >= 48 && codigo <= 57) {
      vistos += 1
      if (vistos === digitos) return i + 1
    }
  }
  return texto.length
}

const brl = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type CampoObrigatorio = 'cargo' | 'quantidade' | 'periodo' | 'jornada' | 'motivo' | 'atividades' | 'remuneracao'

/** Asterisco dos campos obrigatórios da vaga. */
function Obrig() {
  return (
    <span className="cf-obrig" aria-hidden>
      *
    </span>
  )
}

function valorNumero(texto: string) {
  const match = texto.replace(/\./g, '').replace(',', '.').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function listaChave(itens?: string[]) {
  return [...(itens ?? [])]
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join('|')
}

function chaveVaga(dados: {
  cargo: string
  requisitos?: string[]
  diferenciais?: string[]
  inicio: string
  fim?: string
  horaInicio: string
  horaFim: string
  quantidade: number
  motivo?: string
  atividades?: string
  valorDiaria: number
  beneficios?: string
  cidade: string
  estado: string
  observacoes?: string
}) {
  const beneficios = (dados.beneficios ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join('|')
  return [
    dados.cargo,
    listaChave(dados.requisitos),
    listaChave(dados.diferenciais),
    dados.inicio,
    dados.fim ?? '',
    dados.horaInicio,
    dados.horaFim,
    String(dados.quantidade),
    dados.motivo ?? '',
    (dados.atividades ?? '').trim(),
    String(Math.round((dados.valorDiaria || 0) * 100)),
    beneficios,
    semAcento(dados.cidade.trim()),
    semAcento(dados.estado.trim()),
    (dados.observacoes ?? '').trim(),
  ].join('§')
}

const ABAS_EMPRESA = [
  { id: 'inicio', label: 'Início', icon: <IconeInicio /> },
  { id: 'missao', label: 'Vaga temporária', icon: <IconeVaga /> },
  { id: 'vagas', label: 'Vagas Publicadas', icon: <IconeVagasLista /> },
  { id: 'missoes', label: 'Convites enviados', icon: <IconeMissoes /> },
  { id: 'mapa', label: 'Mapa fazumfreela', icon: <IconeMapa /> },
  { id: 'contratacoes', label: 'Minhas contratações', icon: <IconeContratacoes /> },
  { id: 'documentos', label: 'Documentação', icon: <IconeDocs /> },
  { id: 'dados', label: 'Dados da empresa', icon: <IconeEmpresa /> },
  { id: 'aplicativo', label: 'Aplicativo', icon: <IconeCelular /> },
] as const

type AbaEmpresa = (typeof ABAS_EMPRESA)[number]['id']

const BENEFICIOS_OPCOES = [
  'Vale-transporte',
  'Vale-refeição',
  'Vale-alimentação',
  'Refeição no local',
  'Cesta básica',
  'Plano de saúde',
  'Plano odontológico',
  'Seguro de vida',
  'Auxílio-creche',
  'Ajuda de custo',
] as const

function IconeBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  )
}

function IconeInicio() {
  return (
    <IconeBase>
      <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </IconeBase>
  )
}

function IconeVaga() {
  return (
    <IconeBase>
      <rect x="6" y="3.5" width="12" height="17" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9 3.5h6v2.2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3.5z" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9 11h6M9 14.5h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </IconeBase>
  )
}

function IconeVagasLista() {
  return (
    <IconeBase>
      <path d="M8 6.5h11M8 12h11M8 17.5h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="4.5" cy="6.5" r="1.1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="4.5" cy="17.5" r="1.1" fill="currentColor" />
    </IconeBase>
  )
}

function IconeMissoes() {
  return (
    <IconeBase>
      <path d="M3 16V8h10v8M13 11h4l3 3v2h-7" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="7" cy="16.5" r="1.5" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="17" cy="16.5" r="1.5" stroke="currentColor" strokeWidth="1.75" />
    </IconeBase>
  )
}

function IconeMapa() {
  return (
    <IconeBase>
      <path d="M12 21s6.5-5.6 6.5-10.2a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="10.6" r="2.1" stroke="currentColor" strokeWidth="1.75" />
    </IconeBase>
  )
}

function IconeContratacoes() {
  return (
    <IconeBase>
      <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5V20L12 17.2 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M9 9.5h6M9 13h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </IconeBase>
  )
}

function IconeDocs() {
  return (
    <IconeBase>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M14 3.8V8h4.2M8.5 12h7M8.5 15.5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </IconeBase>
  )
}

function IconeEmpresa() {
  return (
    <IconeBase>
      <path d="M4 20V6.5A1.5 1.5 0 0 1 5.5 5H13v15" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M13 9h5.5A1.5 1.5 0 0 1 20 10.5V20" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M7.5 8.5h2.5M7.5 12h2.5M7.5 15.5h2.5M16 13h1.5M16 16.5h1.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </IconeBase>
  )
}

function beneficiosDoTexto(texto: string) {
  const normal = texto.toLocaleLowerCase('pt-BR')
  return BENEFICIOS_OPCOES.filter((item) => normal.includes(item.toLocaleLowerCase('pt-BR')))
}

function formatarDataBr(iso: string) {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function diasEntre(inicio: string, fim: string) {
  const a = new Date(`${inicio}T12:00:00`)
  const b = new Date(`${fim}T12:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

function somarDias(iso: string, quantidade: number) {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + quantidade)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ContratarFreelancer({ onLogout }: { onLogout: () => void }) {
  const {
    currentEmpresa,
    currentUser,
    state,
    convidarParaMissao,
    confirmCandidato,
    publicarVaga,
    patchState,
    refreshFromCloud,
  } = useStore()
  const empresa = currentEmpresa!
  const [cargoId, setCargoId] = useState('empilhadeira')
  const [requisitos, setRequisitos] = useState<string[]>(() => requisitosDoCargo('empilhadeira').padrao)
  const [diferenciais, setDiferenciais] = useState<string[]>([])
  const [inicio, setInicio] = useState(() => somarDias(hojeLocal(), 1))
  const [fim, setFim] = useState(() => somarDias(hojeLocal(), 5))
  const feriados = useFeriadosNoPeriodo(inicio, fim)
  const [horaInicio, setHoraInicio] = useState('08:00')
  const [horaFim, setHoraFim] = useState('18:00')
  const [quantidade, setQuantidade] = useState(1)
  const [motivo, setMotivo] = useState<MotivoTemporario | ''>('')
  const [atividades, setAtividades] = useState('')
  const [remuneracao, setRemuneracao] = useState('')
  const remuneracaoRef = useRef<HTMLInputElement>(null)
  const cursorRemuneracao = useRef<number | null>(null)
  const [beneficios, setBeneficios] = useState<string[]>([])
  const [cidade, setCidade] = useState(empresa.endereco.cidade)
  const [estado, setEstado] = useState(empresa.endereco.estado)
  const [raioKm, setRaioKm] = useState<number | null>(null)
  const locaisBusca = useMemo(() => {
    const extras: LocalBusca[] = [
      ...state.profissionais.map((pessoa) => ({ cidade: pessoa.endereco.cidade, estado: pessoa.endereco.estado })),
      ...state.empresas.map((item) => ({ cidade: item.endereco.cidade, estado: item.endereco.estado })),
      ...state.enderecosEmpresa.map((item) => ({ cidade: item.cidade, estado: item.uf })),
    ]
    return [...LOCAIS_OPERACAO, ...extras]
  }, [state.enderecosEmpresa, state.empresas, state.profissionais])
  const ufs = useMemo(
    () => [...new Set(locaisBusca.map((local) => local.estado.toUpperCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [locaisBusca],
  )
  const locaisComCoordenada = useMemo(
    () => [...state.empresas.map((item) => item.endereco), ...state.profissionais.map((item) => item.endereco)],
    [state.empresas, state.profissionais],
  )
  const cidadeOperacao = cidade.trim() || empresa.endereco.cidade
  // Estado "Todos" com uma cidade escolhida: a vaga ficava com a UF da sede (ex.: Curitiba/SP).
  const ufOperacao =
    estado ||
    (semAcento(cidadeOperacao) === semAcento(empresa.endereco.cidade)
      ? empresa.endereco.estado
      : locaisBusca.find((local) => semAcento(local.cidade) === semAcento(cidadeOperacao))?.estado.toUpperCase()) ||
    empresa.endereco.estado
  // Calculado uma vez por cidade escolhida: a busca e a vaga gravada usam o mesmo ponto.
  const pontoBusca = useMemo(
    () => pontoOperacao(cidadeOperacao, ufOperacao, empresa, locaisComCoordenada),
    [cidadeOperacao, ufOperacao, empresa, locaisComCoordenada],
  )
  const [observacoes, setObservacoes] = useState('')
  const [erro, setErro] = useState('')
  const [analisando, setAnalisando] = useState(false)
  const esperaBusca = useRef<number | null>(null)
  const resultadosRef = useRef<HTMLElement>(null)
  const [resultados, setResultados] = useState<CurriculoAnalisado[] | null>(null)
  const [modoBusca, setModoBusca] = useState<ModoBusca>('completa')
  const [modoResultado, setModoResultado] = useState<ModoBusca>('completa')
  const [analisados, setAnalisados] = useState(0)
  const [aberto, setAberto] = useState<string | null>(null)
  /** Última vaga (demanda) usada por este formulário: criada ao publicar ou no primeiro convite. */
  const [missaoId, setMissaoId] = useState<string | null>(null)
  /** Vaga de cada pedido (chave do pedido → id da demanda). Outro pedido = outra vaga. */
  const [vagasPorChave, setVagasPorChave] = useState<Record<string, string>>({})
  /** Pedido usado na última busca completa: o convite usa exatamente o que foi analisado. */
  const [pedidoBusca, setPedidoBusca] = useState<{ pedido: PedidoVaga; chave: string } | null>(null)
  const [avisoPublicacao, setAvisoPublicacao] = useState('')
  const publicando = useRef(false)
  // Modelos de vaga ficam no servidor (valem em qualquer aparelho da empresa).
  const modelos = useMemo(
    () =>
      (state.modelosVaga ?? [])
        .filter((item) => item.empresaId === empresa.id && modeloValido(item))
        .map((item) => normalizarModelo(item as unknown as ModeloMissao))
        .sort((a, b) => b.salvoEm.localeCompare(a.salvoEm)),
    [state.modelosVaga, empresa.id],
  )
  function gravarModelosDaEmpresa(lista: ModeloMissao[]) {
    const proprios = lista.slice(0, 12).map((item) => ({ ...item, empresaId: empresa.id }))
    patchState((s) => ({
      ...s,
      modelosVaga: [...(s.modelosVaga ?? []).filter((item) => item.empresaId !== empresa.id), ...proprios],
    }))
  }
  // Os que estavam só neste navegador sobem uma vez e saem daqui.
  useEffect(() => {
    const locais = lerModelos(empresa.id)
    if (locais.length === 0) return
    patchState((s) => {
      const atuais = s.modelosVaga ?? []
      const ja = new Set(
        atuais
          .filter((item) => item.empresaId === empresa.id)
          .map((item) => assinaturaModelo(normalizarModelo(item as unknown as ModeloMissao))),
      )
      const novos = locais
        .filter((item) => !ja.has(assinaturaModelo(item)))
        .map((item) => ({ ...item, empresaId: empresa.id }))
      return novos.length ? { ...s, modelosVaga: [...atuais, ...novos] } : s
    })
    apagarModelosLocais(empresa.id)
  }, [empresa.id, patchState])
  const [avisoModelo, setAvisoModelo] = useState('')
  // Abre na tela de boas-vindas, como o Oferta de Carga (ou na aba pedida por um atalho/aviso do app: /?aba=).
  const [aba, setAba] = useState<AbaEmpresa>(() => abaPedida(ABAS_EMPRESA.map((item) => item.id)) ?? 'inicio')
  useEffect(() => esquecerAbaPedida(), [])
  const [menuFixo, setMenuFixo] = useState(false)
  const [menuHover, setMenuHover] = useState(false)
  const [telaEstreita, setTelaEstreita] = useState(false)
  const empresaValidada = empresa.status === 'aprovada'

  useEffect(() => {
    return () => {
      if (esperaBusca.current) window.clearTimeout(esperaBusca.current)
    }
  }, [])

  useEffect(() => {
    if (analisando || !resultados) return
    const alvo = resultadosRef.current
    const painel = alvo?.closest('.cf-main')
    if (!alvo || !(painel instanceof HTMLElement)) return
    const topo = alvo.getBoundingClientRect().top - painel.getBoundingClientRect().top + painel.scrollTop
    painel.scrollTo({ top: Math.max(0, topo - 8), behavior: 'smooth' })
  }, [analisando, resultados])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const atualizar = () => setTelaEstreita(mq.matches)
    atualizar()
    mq.addEventListener('change', atualizar)
    return () => mq.removeEventListener('change', atualizar)
  }, [])

  useLayoutEffect(() => {
    const el = remuneracaoRef.current
    const pos = cursorRemuneracao.current
    if (!el || pos == null || document.activeElement !== el) return
    cursorRemuneracao.current = null
    el.setSelectionRange(pos, pos)
  }, [remuneracao])

  function aoDigitarRemuneracao(event: ChangeEvent<HTMLInputElement>) {
    const bruto = event.target.value
    const cursor = event.target.selectionStart ?? bruto.length
    const decimalAnterior = remuneracao.includes(',') ? (remuneracao.split(',')[1] ?? '') : ''
    const apagouVirgula =
      decimalAnterior.length > 0 &&
      !bruto.includes(',') &&
      bruto.replace(/\D/g, '') === remuneracao.replace(/\D/g, '')
    const formatado = formatarMoedaDigitando(apagouVirgula ? remuneracao : bruto)
    const digitosAntes = bruto.slice(0, cursor).replace(/\D/g, '').length
    const virgula = formatado.indexOf(',')
    const pos = apagouVirgula && virgula >= 0 ? virgula + 1 : posicaoAposDigitos(formatado, digitosAntes)
    if (formatado === remuneracao) {
      event.target.value = formatado
      event.target.setSelectionRange(pos, pos)
      return
    }
    cursorRemuneracao.current = pos
    setRemuneracao(formatado)
  }

  const menuAberto = menuFixo || (!telaEstreita && menuHover)

  const dias = diasEntre(inicio, fim)
  const avisoPrazo = validarNecessidade('temporario', inicio, fim)
  // O que ainda falta para publicar ou encontrar profissionais (mesmas regras de validarPedido).
  const [tentouEnviar, setTentouEnviar] = useState(false)
  const pendencias: { campo: CampoObrigatorio; texto: string }[] = []
  if (!cargoId) pendencias.push({ campo: 'cargo', texto: 'Cargo / função' })
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    pendencias.push({ campo: 'quantidade', texto: 'Quantidade de trabalhadores' })
  }
  if (!inicio || !fim) pendencias.push({ campo: 'periodo', texto: 'Período da missão (início e término)' })
  else if (inicio < hojeLocal()) pendencias.push({ campo: 'periodo', texto: 'Data de início (já passou)' })
  else if (avisoPrazo.nivel === 'bloqueio') {
    pendencias.push({ campo: 'periodo', texto: 'Período da missão (passa do limite legal)' })
  }
  if (!horaInicio || !horaFim) pendencias.push({ campo: 'jornada', texto: 'Jornada / turno' })
  if (!motivo) pendencias.push({ campo: 'motivo', texto: 'Motivo da contratação temporária' })
  if (!atividades.trim()) pendencias.push({ campo: 'atividades', texto: 'Atividades que serão realizadas' })
  if (!(valorNumero(finalizarMoeda(remuneracao)) > 0)) {
    pendencias.push({ campo: 'remuneracao', texto: 'Remuneração prevista por dia' })
  }
  const falta = (campo: CampoObrigatorio) => tentouEnviar && pendencias.some((p) => p.campo === campo)

  // Resumo ao lado do formulário: prévia da vaga e custo estimado (diária × dias × pessoas).
  const diariaResumo = valorNumero(finalizarMoeda(remuneracao))
  const custoResumo =
    diariaResumo > 0 && dias >= 1 && Number.isInteger(quantidade) && quantidade >= 1 ? diariaResumo * dias * quantidade : 0
  const localResumo = cidade
    ? `${cidade}${estado ? `/${estado}` : ''}`
    : estado || `${empresa.endereco.cidade}/${empresa.endereco.estado}`
  const periodoResumo =
    inicio && fim && dias >= 1 ? `${formatarDataBr(inicio)} a ${formatarDataBr(fim)} (${dias} dia${dias === 1 ? '' : 's'})` : '—'

  function irParaCampo(campo: CampoObrigatorio) {
    const alvo = document.querySelector<HTMLElement>(`[data-campo="${campo}"]`)
    if (!alvo) return
    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' })
    alvo.classList.remove('cf-campo-piscar')
    void alvo.offsetWidth
    alvo.classList.add('cf-campo-piscar')
    const entrada = alvo.querySelector<HTMLElement>('input, select, textarea')
    window.setTimeout(() => entrada?.focus({ preventScroll: true }), 350)
  }

  /** Com algo faltando, o botão leva ao primeiro campo vazio e marca os que faltam. */
  function seCompleto(acao: () => void) {
    if (pendencias.length > 0) {
      setTentouEnviar(true)
      setErro('')
      irParaCampo(pendencias[0].campo)
      return
    }
    acao()
  }

  function definirDias(quantidade: number) {
    const total = Math.min(MAXIMO_DIAS, Math.max(1, Math.round(quantidade)))
    if (inicio) setFim(somarDias(inicio, total - 1))
  }

  function mudarInicio(valor: string) {
    setInicio(valor)
    if (valor && dias >= 1) setFim(somarDias(valor, dias - 1))
  }
  const base = state.profissionais.filter((p) => p.status === 'aprovado').length
  const opcoesRequisito = requisitosDoCargo(cargoId).opcoes
  // O que já é obrigatório não aparece de novo como diferencial.
  const diferenciaisPossiveis = opcoesRequisito.filter((req) => !requisitos.includes(req))

  function aoMudarCargo(id: string) {
    setCargoId(id)
    setRequisitos(requisitosDoCargo(id).padrao)
    setDiferenciais([])
    setResultados(null)
    setMissaoId(null)
  }

  function marcarRequisito(grupo: 'obrigatorio' | 'diferencial', req: string) {
    if (grupo === 'obrigatorio') {
      setRequisitos((atual) => (atual.includes(req) ? atual.filter((item) => item !== req) : [...atual, req]))
      setDiferenciais((atual) => atual.filter((item) => item !== req))
      return
    }
    setDiferenciais((atual) => (atual.includes(req) ? atual.filter((item) => item !== req) : [...atual, req]))
    setRequisitos((atual) => atual.filter((item) => item !== req))
  }

  const beneficiosTexto = beneficios.join(', ')

  function aplicarModelo(modelo: ModeloMissao) {
    setCargoId(modelo.cargoId)
    setRequisitos(modelo.requisitos)
    setDiferenciais(modelo.diferenciais)
    setCidade(modelo.cidade)
    setEstado(modelo.estado || empresa.endereco.estado)
    setRaioKm(modelo.raioKm ?? null)
    setHoraInicio(modelo.horaInicio)
    setHoraFim(modelo.horaFim)
    // Publicação salva com datas que já passaram: começa hoje e mantém a mesma duração (antes
    // restaurava o início no passado e a vaga podia ser publicada assim).
    const hoje = hojeLocal()
    let avisoDatas = ''
    if (modelo.inicio && modelo.inicio < hoje) {
      const duracao = modelo.fim && modelo.fim >= modelo.inicio ? diasEntre(modelo.inicio, modelo.fim) : 1
      setInicio(hoje)
      setFim(somarDias(hoje, duracao - 1))
      avisoDatas = ` As datas salvas já tinham passado: o início foi ajustado para hoje, com os mesmos ${duracao} dia${duracao === 1 ? '' : 's'}.`
    } else {
      if (modelo.inicio) setInicio(modelo.inicio)
      if (modelo.fim) setFim(modelo.fim)
    }
    setObservacoes(modelo.observacoes)
    setMotivo(modelo.motivo)
    setAtividades(modelo.atividades)
    setRemuneracao(finalizarMoeda(modelo.remuneracao))
    setBeneficios(beneficiosDoTexto(modelo.beneficios))
    setQuantidade(modelo.quantidade)
    setResultados(null)
    setMissaoId(null)
    setAvisoModelo(`Preenchido com ${modelo.titulo}.${avisoDatas}`)
    setErro('')
  }

  function guardarModelo(remuneracaoFinal: string) {
    const rascunho: ModeloMissao = {
      id: `mod_${Date.now()}`,
      salvoEm: new Date().toISOString(),
      titulo: `${cargoLabel(cargoId)} — ${cidade || empresa.endereco.cidade}${estado ? `/${estado}` : ''}`,
      cargoId,
      requisitos,
      diferenciais,
      cidade,
      estado,
      raioKm,
      horaInicio,
      horaFim,
      inicio,
      fim,
      observacoes,
      motivo,
      atividades,
      remuneracao: remuneracaoFinal,
      beneficios: beneficiosTexto,
      quantidade,
    }
    const assinatura = assinaturaModelo(rascunho)
    const existente = modelos.find((item) => assinaturaModelo(item) === assinatura)
    const proxima = existente
      ? modelos.map((item) => (item.id === existente.id ? { ...rascunho, id: existente.id } : item))
      : [rascunho, ...modelos].slice(0, 12)
    gravarModelosDaEmpresa(proxima)
  }

  function salvarPublicacao() {
    const remuneracaoFinal = finalizarMoeda(remuneracao)
    if (remuneracaoFinal) setRemuneracao(remuneracaoFinal)
    guardarModelo(remuneracaoFinal)
    setAvisoModelo('Modelo salvo. Ele aparece em "Modelos salvos", no topo, em qualquer computador ou celular da empresa.')
    setErro('')
  }

  function removerModelo(id: string) {
    const proxima = modelos.filter((item) => item.id !== id)
    gravarModelosDaEmpresa(proxima)
  }

  function chaveDaVaga(remuneracaoFinal = finalizarMoeda(remuneracao)) {
    return chaveVaga({
      cargo: cargoId,
      requisitos,
      diferenciais,
      inicio,
      fim,
      horaInicio,
      horaFim,
      quantidade,
      motivo,
      atividades,
      valorDiaria: valorNumero(remuneracaoFinal),
      beneficios: beneficiosTexto,
      cidade: cidadeOperacao,
      estado: ufOperacao,
      observacoes,
    })
  }

  function chaveDemanda(demanda: (typeof state.demandas)[number]) {
    return chaveVaga({
      cargo: demanda.cargo,
      requisitos: demanda.requisitos,
      diferenciais: demanda.diferenciais,
      inicio: demanda.data,
      fim: demanda.dataFim,
      horaInicio: demanda.horaInicio,
      horaFim: demanda.horaFim,
      quantidade: demanda.quantidade,
      motivo: demanda.motivo,
      atividades: demanda.atividades || demanda.descricao,
      valorDiaria: demanda.valorDiaria,
      beneficios: demanda.beneficios || demanda.epis,
      cidade: demanda.endereco.cidade,
      estado: demanda.endereco.estado,
      observacoes: demanda.observacoes,
    })
  }

  function vagasIguaisAbertas(chave: string) {
    return state.demandas.filter(
      (item) => item.empresaId === empresa.id && item.status === 'aberta' && chaveDemanda(item) === chave,
    )
  }

  function pedidoDaVaga(remuneracaoFinal: string): PedidoVaga {
    return {
      empresaId: empresa.id,
      cargo: cargoId,
      quantidade,
      data: inicio,
      dataFim: fim,
      horaInicio,
      horaFim,
      endereco: {
        ...empresa.endereco,
        cidade: cidadeOperacao,
        estado: ufOperacao,
        lat: pontoBusca.lat,
        lng: pontoBusca.lng,
      },
      valorDiaria: valorNumero(remuneracaoFinal),
      descricao: atividades,
      epis: beneficiosTexto,
      observacoes,
      requisitos,
      diferenciais,
      motivo,
      atividades,
      beneficios: beneficiosTexto,
    }
  }

  function validarPedido() {
    if (!empresaValidada) {
      setErro('A empresa tomadora precisa estar validada antes de publicar uma missão temporária.')
      return null
    }
    if (!cargoId) {
      setErro('Escolha o cargo.')
      return null
    }
    if (!motivo) {
      setErro('Informe o motivo da contratação temporária. Sem isso a missão não pode ser publicada.')
      return null
    }
    if (!atividades.trim()) {
      setErro('Descreva as atividades que serão realizadas.')
      return null
    }
    const remuneracaoFinal = finalizarMoeda(remuneracao)
    if (!remuneracaoFinal) {
      setErro('Informe a remuneração prevista. Ela entra no contrato com a empresa tomadora.')
      return null
    }
    setRemuneracao(remuneracaoFinal)
    // "R$ 0,00" passava: a vaga era publicada e o contrato gerado sem remuneração.
    if (!(valorNumero(remuneracaoFinal) > 0)) {
      setErro('Informe uma remuneração por dia maior que zero.')
      return null
    }
    // 1,5 ou 0 trabalhadores passavam (o campo aceita qualquer número).
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      setErro('Informe quantos trabalhadores a missão precisa: um número inteiro, a partir de 1.')
      return null
    }
    if (!horaInicio || !horaFim) {
      setErro('Informe a jornada.')
      return null
    }
    if (!inicio || !fim) {
      setErro('Informe o início e o término previsto da missão.')
      return null
    }
    if (inicio < hojeLocal()) {
      setErro('A data de início já passou. Escolha hoje ou uma data futura.')
      return null
    }
    const aviso = validarNecessidade('temporario', inicio, fim)
    if (aviso.nivel === 'bloqueio') {
      setErro(aviso.texto)
      return null
    }
    setErro('')
    return remuneracaoFinal
  }

  function alternarBeneficio(item: string) {
    setBeneficios((atual) => (atual.includes(item) ? atual.filter((b) => b !== item) : [...atual, item]))
  }

  function analisar() {
    const remuneracaoFinal = validarPedido()
    if (!remuneracaoFinal) return
    guardarModelo(remuneracaoFinal)
    setAnalisando(true)
    setResultados(null)
    const chave = chaveDaVaga(remuneracaoFinal)
    // Mesmo pedido de uma vaga já criada (publicada ou com convites) e ainda aberta: continua nela.
    const corrente = missaoCorrente(chave)
    setMissaoId(corrente?.id ?? null)
    if (!corrente && vagasPorChave[chave]) {
      // A vaga deste pedido foi encerrada/cancelada: o próximo convite abre outra.
      setVagasPorChave((atual) => {
        const proximo = { ...atual }
        delete proximo[chave]
        return proximo
      })
    }
    const pedidoVaga = pedidoDaVaga(remuneracaoFinal)
    setPedidoBusca({ pedido: pedidoVaga, chave })
    if (esperaBusca.current) window.clearTimeout(esperaBusca.current)
    esperaBusca.current = window.setTimeout(() => {
      const busca = analisarCurriculos({
      pedido: {
        cargoId,
        requisitos,
        diferenciais,
        inicio,
        fim,
        cidade,
        estado,
        raioKm,
        origem: { lat: pedidoVaga.endereco.lat, lng: pedidoVaga.endereco.lng },
        observacoes,
        modalidade: 'temporario',
        quantidade,
        horaInicio,
        horaFim,
        motivo,
        atividades,
        remuneracao: remuneracaoFinal,
        beneficios: beneficiosTexto,
      },
      empresa,
      profissionais: state.profissionais,
      documentos: state.documentos,
      demandas: state.demandas,
      candidaturas: state.candidaturas,
      // A própria vaga não conta no ciclo: quem já aceitou o convite dela não vira "Fora do ciclo".
      demandaAtualId: corrente?.id ?? null,
    })
      setResultados(busca.pessoas)
      setModoResultado('completa')
      setAnalisados(busca.analisados)
      setAberto(busca.pessoas[0]?.profissional.id ?? null)
      setAnalisando(false)
      esperaBusca.current = null
    }, 5000)
  }

  function trocarModo(modo: ModoBusca) {
    if (modo === modoBusca || analisando) return
    setModoBusca(modo)
    setResultados(null)
    setErro('')
  }

  function analisarBasica() {
    if (!empresaValidada) {
      setErro('A empresa tomadora precisa estar validada antes de pesquisar profissionais.')
      return
    }
    if (!atividades.trim()) {
      setErro('Descreva as atividades que a vaga precisa.')
      return
    }
    if (!termosDasAtividades(atividades).length) {
      setErro('Descreva as atividades com mais detalhe. Ex.: conferência de carga com coletor, separação de pedidos.')
      return
    }
    setErro('')
    setAnalisando(true)
    setResultados(null)
    if (esperaBusca.current) window.clearTimeout(esperaBusca.current)
    esperaBusca.current = window.setTimeout(() => {
      const busca = buscarPorAtividades({
        atividades,
        cidade,
        estado,
        raioKm,
        origem: { lat: pontoBusca.lat, lng: pontoBusca.lng },
        empresa,
        profissionais: state.profissionais,
        documentos: state.documentos,
      })
      setResultados(busca.pessoas)
      setModoResultado('basica')
      setAnalisados(busca.analisados)
      setAberto(busca.pessoas[0]?.profissional.id ?? null)
      setAnalisando(false)
      esperaBusca.current = null
    }, 5000)
  }

  function irParaCompleta() {
    setModoBusca('completa')
    setResultados(null)
    setErro('')
    const painel = document.querySelector('.cf-main')
    if (painel instanceof HTMLElement) painel.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function publicar(confirmarRepeticao = false) {
    if (publicando.current) return
    const remuneracaoFinal = validarPedido()
    if (!remuneracaoFinal) return
    const chave = chaveDaVaga(remuneracaoFinal)
    const iguais = vagasIguaisAbertas(chave)
    if (iguais.length > 0 && !confirmarRepeticao) {
      setAvisoPublicacao('Esta vaga já está publicada.')
      return
    }
    publicando.current = true
    try {
      const pedido = pedidoDaVaga(remuneracaoFinal)
      const aberta =
        confirmarRepeticao || !missaoId
          ? undefined
          : state.demandas.find((item) => item.id === missaoId && item.empresaId === empresa.id && item.status === 'aberta')
      // Editar no lugar só enquanto ninguém está ligado à vaga. Com convite, candidatura, contrato
      // ou peça documental, mudar datas/valor/quantidade alteraria o que a pessoa aceitou e o que
      // já está no contrato: os dados novos viram outra vaga e a anterior fica como estava.
      const comVinculo =
        aberta &&
        (state.candidaturas.some((c) => c.demandaId === aberta.id) ||
          state.contratos.some((c) => c.demandaId === aberta.id) ||
          (state.pecas ?? []).some((p) => p.demandaId === aberta.id))
      if (aberta && !comVinculo) {
        patchState((s) => ({
          ...s,
          demandas: s.demandas.map((item) =>
            item.id === aberta.id
              ? {
                  ...item,
                  ...pedido,
                  id: item.id,
                  createdAt: item.createdAt,
                  status: item.status,
                  categoria: cargoCategoria(pedido.cargo),
                }
              : item,
          ),
        }))
        lembrarVaga(chave, aberta.id)
      } else {
        const criada = publicarVaga(pedido)
        // "Publicar de novo" é uma cópia pedida: os convites deste pedido seguem na vaga original.
        if (confirmarRepeticao && missaoCorrente(chave)) setMissaoId(criada.id)
        else lembrarVaga(chave, criada.id)
      }
      setAvisoPublicacao(
        confirmarRepeticao
          ? 'Vaga publicada de novo. Os colaboradores verão as duas.'
          : comVinculo
            ? 'A vaga anterior já tem convidados ou candidatos e continua com os dados originais. Os dados novos foram publicados como outra vaga. Se a anterior não serve mais, cancele-a em Vagas Publicadas.'
            : 'Vaga publicada. Os colaboradores já podem ver e se candidatar.',
      )
      setAba('vagas')
    } finally {
      publicando.current = false
    }
  }

  /** Guarda a vaga deste pedido: nova busca + convite com o mesmo pedido reutiliza a mesma demanda. */
  function lembrarVaga(chave: string, demandaId: string) {
    setMissaoId(demandaId)
    setVagasPorChave((atual) => {
      // Uma demanda corresponde a um pedido só: se foi editada no lugar, a chave antiga sai.
      const proximo: Record<string, string> = {}
      for (const [k, id] of Object.entries(atual)) if (id !== demandaId) proximo[k] = id
      proximo[chave] = demandaId
      return proximo
    })
  }

  /** Demanda já criada para este pedido, se existir. */
  function vagaDoPedido(chave: string) {
    const id = vagasPorChave[chave]
    return id ? state.demandas.find((item) => item.id === id && item.empresaId === empresa.id) : undefined
  }

  /** Vaga do pedido se ela ainda aceita gente (não encerrada nem cancelada). */
  function missaoCorrente(chave: string): Demanda | null {
    const demanda = vagaDoPedido(chave)
    return demanda && !vagaEncerrada(demanda.status) ? demanda : null
  }

  function convidar(item: CurriculoAnalisado) {
    if (!pedidoBusca) return
    const corrente = missaoCorrente(pedidoBusca.chave)
    if (!corrente && pedidoBusca.pedido.data < hojeLocal()) {
      setErro('A data de início desta busca já passou. Ajuste o período e clique em Encontrar profissionais de novo.')
      return
    }
    // Antes: a busca zerava `missaoId` e o convite não guardava a chave da vaga, então cada nova
    // busca + convite criava outra demanda igual. Agora a vaga criada vira a vaga corrente.
    const resp = convidarParaMissao({
      demandaId: corrente?.id ?? null,
      profissionalId: item.profissional.id,
      score: item.score,
      distanciaKm: item.distanciaKm,
      pedido: corrente ? undefined : pedidoBusca.pedido,
    })
    if (!resp) {
      setErro('Não foi possível enviar o convite: a vaga foi encerrada ou cancelada. Clique em Encontrar profissionais para abrir outra.')
      return
    }
    setErro('')
    lembrarVaga(pedidoBusca.chave, resp.demandaId)
  }

  const compativeis = resultados?.filter((r) => r.situacao !== 'bloqueado' && r.atendeObrigatorios) ?? []
  const incompletos = resultados?.filter((r) => r.situacao !== 'bloqueado' && !r.atendeObrigatorios) ?? []
  const bloqueadosPeriodo = resultados?.filter((r) => r.situacao === 'bloqueado') ?? []
  const atendemTudo = compativeis.length
  const iguaisAbertas = vagasIguaisAbertas(chaveDaVaga())
  // Vaga dos resultados na tela (a do pedido analisado), não a última publicada.
  const missaoAtual = pedidoBusca ? vagaDoPedido(pedidoBusca.chave) : undefined
  const missaoFechada = missaoAtual ? vagaEncerrada(missaoAtual.status) : false
  const missaoLotada = missaoAtual ? vagaLotada(missaoAtual, state.candidaturas) : false

  function conviteDe(profissionalId: string) {
    if (!missaoAtual) return null
    const cand = state.candidaturas.find(
      (c) => c.demandaId === missaoAtual.id && c.profissionalId === profissionalId,
    )
    if (!cand) return null
    const contrato = state.contratos.find((c) => c.candidaturaId === cand.id)
    return {
      id: cand.id,
      status: cand.status,
      contratoNumero: contrato?.numero,
      // Vaga encerrada, cancelada ou com todos os confirmados: não gera mais contrato.
      fechada: missaoFechada || missaoLotada,
    }
  }

  const basica = modoResultado === 'basica'
  const vagaDaBusca = basica
    ? `Pesquisa básica · ${cidade || empresa.endereco.cidade}${estado ? `/${estado}` : ''}`
    : `${quantidade} ${cargoLabel(cargoId)} · ${dias} dia${dias === 1 ? '' : 's'} · ${horaInicio}–${horaFim} · ${cidade || empresa.endereco.cidade}${estado ? `/${estado}` : ''}${motivo ? ` · ${rotuloMotivo(motivo)}` : ''}`

  const camposCidade = (
    <>
      <label className="cf-field">
        <span>Estado</span>
        <select
          value={estado}
          onChange={(event) => {
            const uf = event.target.value
            setEstado(uf)
            if (uf) {
              const cabe = locaisBusca.some(
                (local) => semAcento(local.cidade) === semAcento(cidade) && local.estado.toUpperCase() === uf,
              )
              if (!cabe) setCidade('')
            }
          }}
        >
          <option value="">Todos</option>
          {ufs.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>
      </label>
      <CampoCidade
        cidade={cidade}
        estado={estado}
        onChange={(proximaCidade, proximoEstado) => {
          setCidade(proximaCidade)
          setEstado(proximoEstado)
        }}
        locais={locaisBusca}
      />
    </>
  )
  const avisoSede = (
    <>
      {pontoBusca.daSede && (
        <p className="cf-local-aviso" role="note">
          Não encontramos a localização de {cidadeOperacao}/{ufOperacao}. A distância e o raio serão medidos a partir
          da sede ({empresa.endereco.cidade}/{empresa.endereco.estado}).
        </p>
      )}
    </>
  )
  const blocoRaio = (
      <div className="cf-raio">
        <label className="cf-field">
          <span>Raio de busca</span>
          <span className="cf-raio-linha">
            <input
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              value={raioKm ?? ''}
              placeholder="km"
              aria-label="Raio de busca em quilômetros"
              onChange={(event) => {
                const valor = Number(event.target.value)
                setRaioKm(event.target.value === '' || !Number.isFinite(valor) || valor <= 0 ? null : Math.min(500, valor))
              }}
            />
            <span>km</span>
          </span>
        </label>
        <div className="cf-opcoes">
          {RAIOS_BUSCA.map((km) => (
            <button key={km} type="button" className={raioKm === km ? 'on' : ''} onClick={() => setRaioKm(km)}>
              {km} km
            </button>
          ))}
          <button type="button" className={raioKm == null ? 'on' : ''} onClick={() => setRaioKm(null)}>
            Todos
          </button>
        </div>
      </div>
  )
  // "Onde" da vaga: estado e cidade. O raio fica junto do botão Encontrar profissionais.
  const blocoCidade = (
    <div className="cf-local">
      {camposCidade}
      {avisoSede}
    </div>
  )
  const blocoLocal = (
    <div className="cf-local">
      {camposCidade}
      {blocoRaio}
      {avisoSede}
    </div>
  )

  return (
    <div className="cf-shell">
      <header className="cf-topbar">
        <div className="cf-topbar-left">
          <button
            type="button"
            className="cf-topbar-menu"
            aria-label={menuFixo ? 'Recolher menu lateral' : 'Fixar menu expandido'}
            aria-pressed={menuFixo}
            onClick={() => setMenuFixo((valor) => !valor)}
          >
            <span className="cf-topbar-menu-icon" aria-hidden />
          </button>
          {/* A logo leva para o Início (o Início saiu do menu lateral). */}
          <button type="button" className="cf-topbar-brand topo-logo-botao" onClick={() => setAba('inicio')} title="Ir para o início" aria-label="Ir para o início">
            <img src={LOGO_DOCA_LIVRE_SRC} alt="Doca Livre" className="cf-topbar-logo" />
            <span className="cf-product">{BRAND_PRODUCT_NAME}</span>
          </button>
        </div>
        <div className="cf-topbar-right">
          <SinoEmpresa empresaId={empresa.id} onIr={setAba} />
          <BotaoAtualizar onAtualizar={refreshFromCloud} />
          <BotaoTema />
          <RelogioTopo />
          <UsuarioTopo
            perfil={{
              nome: empresa.nomeFantasia,
              papel: 'Empresa tomadora',
              usuario: currentUser?.usuario,
              email: currentUser?.email,
              criadoEm: currentUser?.createdAt,
              ativo: currentUser?.ativo !== false,
              foto: empresa.logo,
              estatisticas: [
                { valor: state.demandas.filter((d) => d.empresaId === empresa.id).length, rotulo: 'Vagas publicadas' },
                { valor: state.contratos.filter((c) => c.empresaId === empresa.id).length, rotulo: 'Contratações' },
              ],
              verificacoes: [
                { ok: currentUser?.ativo !== false, texto: 'Usuário ativo no sistema' },
                { ok: Boolean(currentUser?.email), texto: currentUser?.email || 'E-mail não informado' },
                {
                  ok: empresa.status === 'aprovada',
                  texto: empresa.status === 'aprovada' ? 'Cadastro aprovado' : 'Cadastro em análise',
                },
              ],
              onIrPainel: () => setAba('inicio'),
              editar: { rotulo: 'Ver dados da empresa', onClick: () => setAba('dados') },
              onSair: onLogout,
            }}
          />
          <button type="button" className="cf-sair" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>

      <div className="cf-workspace">
        {menuHover && !menuFixo && !telaEstreita && <div className="cf-menu-rail" aria-hidden />}
        {menuFixo && telaEstreita && (
          <button type="button" className="cf-menu-backdrop" aria-label="Fechar menu" onClick={() => setMenuFixo(false)} />
        )}
        <aside
          className={`cf-menu ${menuAberto ? 'cf-menu--wide' : ''} ${menuHover && !menuFixo ? 'cf-menu--flyout' : ''} ${menuFixo ? 'cf-menu--pinned' : ''}`}
          onMouseEnter={() => setMenuHover(true)}
          onMouseLeave={() => setMenuHover(false)}
        >
          <nav className="cf-menu-body" aria-label="Conta da empresa">
            {ABAS_EMPRESA.filter((item) => item.id !== 'inicio').map((item) => {
              const ativo = aba === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cf-menu-link ${ativo ? 'cf-menu-link--on' : ''}`}
                  aria-current={ativo ? 'page' : undefined}
                  title={menuAberto ? undefined : item.label}
                  onClick={() => {
                    setAba(item.id)
                    if (telaEstreita) setMenuFixo(false)
                  }}
                >
                  <span className="cf-menu-icon">{item.icon}</span>
                  <span className="cf-menu-label">{item.label}</span>
                  <span className="cf-menu-chevron" aria-hidden>
                    ›
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

      <main className="cf-main">
        <div className="cf-wrap">
          {aba === 'inicio' && <BoasVindas />}
          {aba === 'documentos' && <BibliotecaDocumental modo="tomadora" empresaId={empresa.id} />}
          {aba === 'vagas' && <PainelVagas empresaId={empresa.id} onPublicar={() => setAba('missao')} />}
          {aba === 'missoes' && <PainelMissoes empresaId={empresa.id} />}
          {aba === 'mapa' && <MapaMaoDeObra empresa={empresa} />}
          {aba === 'contratacoes' && <PainelContratacoes empresaId={empresa.id} />}
          {aba === 'dados' && <PainelDados />}
          {aba === 'aplicativo' && <AplicativoCelular papel="empresa" />}
          {aba === 'missao' && (
          <>
          <div className="cf-intro">
            <h1>Vaga temporária</h1>
            <p>
              {empresa.nomeFantasia} descreve a missão. A análise compara o pedido com o banco de currículos
              estruturados e mostra quem atende. A escolha continua com a empresa tomadora. Hoje há {base}{' '}
              currículos aprovados na base.
            </p>
            {modelos.length > 0 && (
              <div className="cf-modelos">
                <p>Modelos salvos (clique para preencher o formulário)</p>
                <ul>
                  {modelos.map((item) => (
                    <li key={item.id} className="cf-modelo">
                      <button type="button" onClick={() => aplicarModelo(item)}>
                        <strong>{item.titulo}</strong>
                        <small>
                          {item.inicio ? `${formatarDataBr(item.inicio)}${item.fim ? ` a ${formatarDataBr(item.fim)}` : ''} · ` : ''}
                          {item.horaInicio}–{item.horaFim}
                        </small>
                      </button>
                      <button type="button" className="cf-modelo-excluir" aria-label={`Excluir ${item.titulo}`} onClick={() => removerModelo(item.id)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {modoBusca === 'basica' ? (
          <section className="cf-card">
            <div className="cf-basica-topo">
              <div>
                <h2 className="cf-bloco-titulo cf-bloco-titulo--solto">Pesquisa básica</h2>
                <p className="muted">
                  Só pelas atividades. Mostra quem tem pelo menos um certificado de curso aprovado. Para publicar a vaga
                  ou convidar alguém, use a vaga completa.
                </p>
              </div>
              <button type="button" className="cf-btn cf-btn--leve" onClick={() => trocarModo('completa')} disabled={analisando}>
                Voltar para a vaga completa
              </button>
            </div>
            <div className="cf-basica">
              <label className="cf-field">
                <span>Atividades que a vaga precisa</span>
                <textarea
                  value={atividades}
                  onChange={(e) => setAtividades(e.target.value)}
                  placeholder="Ex.: conferência de carga com coletor, separação de pedidos no WMS, operação de empilhadeira."
                />
              </label>
              <div>{blocoLocal}</div>
            </div>
            {!empresaValidada && (
              <div className="cf-rule cf-rule--block">
                <p>A empresa tomadora precisa estar validada antes de pesquisar profissionais.</p>
              </div>
            )}
            {erro && <p className="error">{erro}</p>}
            <div className="cf-actions">
              <button type="button" className="cf-primary" onClick={analisarBasica} disabled={analisando || !empresaValidada}>
                {analisando ? 'Analisando currículos' : 'Encontrar profissionais'}
              </button>
            </div>
          </section>
          ) : (
          <section className="cf-pub">
            <div className="cf-pub-form">
              <p className="cf-legenda-obrig">
                Campos com <Obrig /> são obrigatórios para publicar ou encontrar profissionais.
              </p>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">1</span>A vaga
                </legend>
                <div className="cf-bloco-linha cf-bloco-linha--cargo">
                  <label className={`cf-field ${falta('cargo') ? 'cf-field--falta' : ''}`} data-campo="cargo">
                    <span>
                      Cargo / função
                      <Obrig />
                    </span>
                    <select value={cargoId} onChange={(e) => aoMudarCargo(e.target.value)}>
                      {CATEGORIES.map((cat) => (
                        <optgroup key={cat.id} label={cat.label}>
                          {cat.cargos.map((cargo) => (
                            <option key={cargo.id} value={cargo.id}>
                              {cargo.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className={`cf-field ${falta('quantidade') ? 'cf-field--falta' : ''}`} data-campo="quantidade">
                    <span>
                      Quantidade de trabalhadores
                      <Obrig />
                    </span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={quantidade}
                      onChange={(e) => setQuantidade(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label className={`cf-field ${falta('atividades') ? 'cf-field--falta' : ''}`} data-campo="atividades">
                  <span>
                    Atividades que serão realizadas
                    <Obrig />
                  </span>
                  <textarea
                    value={atividades}
                    onChange={(e) => setAtividades(e.target.value)}
                    placeholder="Descreva o que o trabalhador fará na tomadora durante a missão."
                  />
                </label>
              </fieldset>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">2</span>Quando
                </legend>
                <p className="cf-label">
                  Período da missão temporária
                  <Obrig />
                </p>
                <div className={`cf-dates ${falta('periodo') ? 'cf-grupo--falta' : ''}`} data-campo="periodo">
                  <label className="cf-field">
                    <span>Início</span>
                    <input type="date" value={inicio} min={hojeLocal()} onChange={(e) => mudarInicio(e.target.value)} />
                  </label>
                  <label className="cf-field">
                    <span>Término previsto</span>
                    <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} />
                  </label>
                </div>
                <div className="cf-duracao">
                  <strong
                    className={`cf-periodo-dias ${
                      dias < 1 || dias > MAXIMO_DIAS ? 'cf-periodo-dias--erro' : dias > LIMITE_DIAS ? 'cf-periodo-dias--alerta' : ''
                    }`}
                    aria-live="polite"
                  >
                    {dias >= 1 ? (
                      <>
                        {dias}
                        <small>dia{dias === 1 ? '' : 's'}</small>
                      </>
                    ) : (
                      'período inválido'
                    )}
                  </strong>
                  <div className="cf-opcoes" aria-label="Atalhos de duração">
                    {ATALHOS_DIAS.map((n) => (
                      <button key={n} type="button" className={dias === n ? 'on' : ''} onClick={() => definirDias(n)}>
                        {n} dias
                      </button>
                    ))}
                  </div>
                </div>
                {avisoPrazo.nivel !== 'ok' && (
                  <div className={`cf-rule ${avisoPrazo.nivel === 'bloqueio' ? 'cf-rule--block' : ''}`}>
                    <p>{avisoPrazo.texto}</p>
                  </div>
                )}
                {feriados.length > 0 && (
                  <p className="cf-feriado">
                    Feriado nacional no período:{' '}
                    {feriados.map((f) => `${f.data.split('-').reverse().join('/')} (${f.nome})`).join(', ')}. Trabalho em
                    feriado costuma ter adicional (em geral 100% sobre a diária). Combine o valor antes de confirmar.
                  </p>
                )}
                <details className="cf-detalhes">
                  <summary>Regras de prazo do trabalho temporário</summary>
                  <p>Limite legal: até {LIMITE_DIAS} dias, consecutivos ou não.</p>
                  <p>Prorrogação: até 90 dias, desde que permaneçam as condições que justificaram o trabalho temporário.</p>
                </details>
                <p className="cf-label">
                  Jornada / turno
                  <Obrig />
                </p>
                <div className={`cf-dates ${falta('jornada') ? 'cf-grupo--falta' : ''}`} data-campo="jornada">
                  <label className="cf-field">
                    <span>Das</span>
                    <input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
                  </label>
                  <label className="cf-field">
                    <span>Às</span>
                    <input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
                  </label>
                </div>
              </fieldset>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">3</span>Onde
                </legend>
                {blocoCidade}
              </fieldset>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">4</span>Pagamento
                </legend>
                <div className="cf-bloco-linha">
                  <label className={`cf-field ${falta('remuneracao') ? 'cf-field--falta' : ''}`} data-campo="remuneracao">
                    <span>
                      Remuneração prevista por dia (R$)
                      <Obrig />
                    </span>
                    <input
                      ref={remuneracaoRef}
                      inputMode="decimal"
                      value={remuneracao}
                      onChange={aoDigitarRemuneracao}
                      onBlur={() => setRemuneracao((atual) => finalizarMoeda(atual))}
                      placeholder="R$ 0,00"
                    />
                  </label>
                </div>
                <p className="cf-label">Benefícios</p>
                <div className="cf-checks cf-checks--tres">
                  {BENEFICIOS_OPCOES.map((item) => (
                    <label key={item} className="cf-check">
                      <input type="checkbox" checked={beneficios.includes(item)} onChange={() => alternarBeneficio(item)} />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">5</span>Requisitos
                </legend>
                <p className="cf-label">Obrigatórios</p>
                <p className="muted">Quem não comprovar fica numa lista separada.</p>
                <div className="cf-chips cf-chips--bloco">
                  {opcoesRequisito.map((req) => (
                    <button
                      key={req}
                      type="button"
                      className={`cf-chip ${requisitos.includes(req) ? 'cf-chip--on' : ''}`}
                      onClick={() => marcarRequisito('obrigatorio', req)}
                    >
                      {req}
                    </button>
                  ))}
                </div>
                <p className="cf-label">Diferenciais</p>
                <p className="muted">Contam pontos a mais, mas não eliminam ninguém.</p>
                {diferenciaisPossiveis.length > 0 ? (
                  <div className="cf-chips cf-chips--bloco">
                    {diferenciaisPossiveis.map((req) => (
                      <button
                        key={req}
                        type="button"
                        className={`cf-chip ${diferenciais.includes(req) ? 'cf-chip--on' : ''}`}
                        onClick={() => marcarRequisito('diferencial', req)}
                      >
                        {req}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Todos os requisitos deste cargo já estão como obrigatórios.</p>
                )}
              </fieldset>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">6</span>Motivo da contratação temporária
                  <Obrig />
                </legend>
                <div className={`cf-checks cf-checks--duo ${falta('motivo') ? 'cf-grupo--falta' : ''}`} data-campo="motivo">
                  {MOTIVOS_TEMPORARIOS.map((item) => (
                    <label key={item.id} className="cf-check">
                      <input
                        type="radio"
                        name="motivo-temporario"
                        checked={motivo === item.id}
                        onChange={() => setMotivo(item.id)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <details className="cf-detalhes">
                  <summary>Por que o motivo é obrigatório?</summary>
                  <p>{AVISO_FORMALIZACAO}</p>
                </details>
              </fieldset>

              <fieldset className="cf-bloco">
                <legend className="cf-bloco-titulo">
                  <span className="cf-bloco-num">7</span>Observações <span className="cf-opcional">(opcional)</span>
                </legend>
                <label className="cf-field">
                  <span className="cf-oculto">Observações da operação</span>
                  <textarea
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    placeholder="Ex.: turno da noite, câmara fria, experiência com rota SP-Campinas, EAR."
                  />
                </label>
              </fieldset>
            </div>

            <aside className="cf-pub-resumo" aria-label="Resumo da vaga">
              <div className="cf-resumo-card">
                <p className="cf-resumo-kicker">Prévia da vaga</p>
                <h2 className="cf-resumo-titulo">{cargoId ? cargoLabel(cargoId) : 'Escolha o cargo'}</h2>
                <p className="cf-resumo-sub">
                  {empresa.nomeFantasia} · {localResumo}
                </p>
                <dl className="cf-resumo-dados">
                  <div>
                    <dt>Período</dt>
                    <dd>{periodoResumo}</dd>
                  </div>
                  <div>
                    <dt>Jornada</dt>
                    <dd>{horaInicio && horaFim ? `${horaInicio} às ${horaFim}` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Trabalhadores</dt>
                    <dd>{Number.isInteger(quantidade) && quantidade >= 1 ? quantidade : '—'}</dd>
                  </div>
                  <div>
                    <dt>Diária</dt>
                    <dd>{diariaResumo > 0 ? brl(diariaResumo) : '—'}</dd>
                  </div>
                </dl>
                {beneficios.length > 0 && (
                  <div className="cf-resumo-beneficios">
                    {beneficios.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                )}
                <div className="cf-resumo-custo">
                  <span>Custo estimado</span>
                  <strong>{custoResumo > 0 ? brl(custoResumo) : '—'}</strong>
                  {custoResumo > 0 ? (
                    <small>
                      {brl(diariaResumo)} × {dias} dia{dias === 1 ? '' : 's'} × {quantidade} pessoa{quantidade === 1 ? '' : 's'}
                    </small>
                  ) : (
                    <small>Preencha a diária, o período e a quantidade.</small>
                  )}
                  {custoResumo > 0 && feriados.length > 0 && (
                    <small className="cf-resumo-feriado">Há feriado no período: o adicional não entra nesta conta.</small>
                  )}
                </div>

                {!empresaValidada && (
                  <div className="cf-rule cf-rule--block">
                    <p>A empresa tomadora precisa estar validada antes de publicar uma missão temporária.</p>
                  </div>
                )}
                {erro && <p className="error">{erro}</p>}
                {avisoModelo && <p className="success">{avisoModelo}</p>}
                {avisoPublicacao && iguaisAbertas.length === 0 && <p className="success">{avisoPublicacao}</p>}
                {iguaisAbertas.length > 0 && (
                  <div className="cf-rule" role="status">
                    <p>
                      Esta vaga já está publicada
                      {iguaisAbertas.length > 1 ? ` (${iguaisAbertas.length} iguais em aberto)` : ''}. Quer publicar de novo?
                    </p>
                    <div className="cf-actions">
                      <button type="button" className="cf-primary" onClick={() => publicar(true)}>
                        Publicar de novo
                      </button>
                      <button type="button" className="cf-btn cf-btn--dark" onClick={() => setAba('vagas')}>
                        Manter a publicada
                      </button>
                    </div>
                  </div>
                )}
                {empresaValidada &&
                  (pendencias.length > 0 ? (
                    <div className="cf-faltam" role="status">
                      <strong>Falta preencher para publicar ou encontrar profissionais:</strong>
                      <div className="cf-faltam-lista">
                        {pendencias.map((p) => (
                          <button key={p.campo} type="button" onClick={() => irParaCampo(p.campo)}>
                            {p.texto}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="cf-faltam cf-faltam--ok" role="status">
                      Tudo preenchido. Já dá para publicar a vaga ou encontrar profissionais.
                    </p>
                  ))}
                <div className="cf-resumo-acoes">
                  {iguaisAbertas.length === 0 && (
                    <button
                      type="button"
                      className="cf-primary"
                      onClick={() => seCompleto(() => publicar(false))}
                      disabled={analisando || !empresaValidada}
                    >
                      Publicar vaga
                    </button>
                  )}
                  <button
                    type="button"
                    className="cf-btn cf-btn--dark"
                    onClick={() => seCompleto(analisar)}
                    disabled={analisando || !empresaValidada}
                  >
                    {analisando ? 'Analisando currículos' : 'Encontrar profissionais'}
                  </button>
                  <button type="button" className="cf-btn cf-btn--leve" onClick={salvarPublicacao} disabled={analisando}>
                    Salvar como modelo
                  </button>
                </div>
                <p className="cf-resumo-nota">
                  Publicar deixa a vaga visível para os colaboradores se candidatarem. Encontrar profissionais mostra
                  quem atende e permite convidar.
                </p>
              </div>

              <div className="cf-resumo-card cf-resumo-busca">
                <p className="cf-resumo-kicker">Busca de profissionais</p>
                {blocoRaio}
                <button type="button" className="cf-link-texto" onClick={() => trocarModo('basica')} disabled={analisando}>
                  Prefere buscar só pelas atividades? Usar a pesquisa básica
                </button>
              </div>
            </aside>

            {iguaisAbertas.length === 0 && (
              <div className="cf-pub-barra">
                <span>
                  <small>Custo estimado</small>
                  <strong>{custoResumo > 0 ? brl(custoResumo) : '—'}</strong>
                </span>
                <button
                  type="button"
                  className="cf-primary"
                  onClick={() => seCompleto(() => publicar(false))}
                  disabled={analisando || !empresaValidada}
                >
                  Publicar vaga
                </button>
              </div>
            )}
          </section>
          )}


          {resultados && (
            <section className="cf-results" ref={resultadosRef}>
              {basica ? (
                <div className="cf-stat-row cf-stat-row--trio">
                  <article className="cf-stat cf-stat--dark">
                    <span>Analisados</span>
                    <strong>{analisados}</strong>
                    <small>currículos da base</small>
                  </article>
                  <article className="cf-stat cf-stat--green">
                    <span>Com certificado</span>
                    <strong>{atendemTudo}</strong>
                    <small>atividades e certificado aprovado</small>
                  </article>
                  <article className="cf-stat cf-stat--amber">
                    <span>Sem certificado</span>
                    <strong>{incompletos.length}</strong>
                    <small>atividades batem, falta certificado</small>
                  </article>
                </div>
              ) : (
                <div className="cf-stat-row">
                  <article className="cf-stat cf-stat--dark">
                    <span>Analisados</span>
                    <strong>{analisados}</strong>
                    <small>currículos da base</small>
                  </article>
                  <article className="cf-stat cf-stat--green">
                    <span>Encaixe completo</span>
                    <strong>{atendemTudo}</strong>
                    <small>todos os obrigatórios</small>
                  </article>
                  <article className="cf-stat cf-stat--amber">
                    <span>Quase lá</span>
                    <strong>{incompletos.length}</strong>
                    <small>falta um requisito</small>
                  </article>
                  <article className="cf-stat cf-stat--rose">
                    <span>Fora do ciclo</span>
                    <strong>{bloqueadosPeriodo.length}</strong>
                    <small>prazo legal</small>
                  </article>
                </div>
              )}
              <p className="cf-mission-chip">
                {basica
                  ? `Pesquisa básica · ${cidade || empresa.endereco.cidade}${estado ? `/${estado}` : ''}${raioKm != null ? ` · até ${raioKm} km` : ''}`
                  : (
                    <>
                      {quantidade} {cargoLabel(cargoId)} · {dias} dia{dias === 1 ? '' : 's'} · {horaInicio}–{horaFim} · {cidade || empresa.endereco.cidade}{estado ? `/${estado}` : ''}
                      {raioKm != null ? ` · até ${raioKm} km` : ''}
                      {motivo ? ` · ${rotuloMotivo(motivo)}` : ''}
                    </>
                  )}
              </p>
              {basica && (
                <div className="cf-rule" role="note">
                  <p>
                    A pesquisa básica mostra o encaixe pelas atividades. Para convidar, faça a pesquisa completa com
                    cargo, período e motivo da vaga. As atividades que você descreveu continuam preenchidas.
                  </p>
                  <div className="cf-actions">
                    <button type="button" className="cf-btn cf-btn--dark" onClick={irParaCompleta}>
                      Fazer a pesquisa completa
                    </button>
                  </div>
                </div>
              )}

              {!basica && missaoFechada && (
                <div className="cf-rule cf-rule--block" role="status">
                  <p>
                    A vaga desta busca foi {missaoAtual?.status === 'cancelada' ? 'cancelada' : 'encerrada'}. Para chamar
                    mais gente, clique em Encontrar profissionais e uma nova vaga será aberta no primeiro convite.
                  </p>
                </div>
              )}

              <h2 className="cf-section-title cf-section-title--green">
                {basica ? 'Atividades e certificado aprovado' : 'Profissionais com encaixe completo'}
              </h2>
              <div className="cf-gallery">
                {compativeis.map((item) => (
                  <PessoaCard
                    key={item.profissional.id}
                    vaga={vagaDaBusca}
                    item={item}
                    modo={modoResultado}
                    aberto={aberto === item.profissional.id}
                    convite={basica ? null : conviteDe(item.profissional.id)}
                    documentos={state.documentos}
                    requisitos={basica ? [] : requisitos}
                    onToggle={() =>
                      setAberto((id) => (id === item.profissional.id ? null : item.profissional.id))
                    }
                    onConvidar={basica || missaoFechada ? undefined : () => convidar(item)}
                    onContrato={basica ? undefined : (candidaturaId) => confirmCandidato(candidaturaId)}
                  />
                ))}
                {compativeis.length === 0 && (
                  <div className="cf-empty">
                    <strong>
                      {basica
                        ? 'Ninguém com essas atividades tem certificado de curso aprovado.'
                        : 'Ninguém atendeu todos os requisitos obrigatórios.'}
                    </strong>
                    <p>
                      {incompletos.length
                        ? basica
                          ? 'Quem tem as atividades no currículo aparece na lista seguinte.'
                          : 'Quem ficou perto aparece na lista seguinte, com o item que faltou. Você pode convidar mesmo assim.'
                        : basica
                          ? 'Tente descrever as atividades com outras palavras ou aumentar o raio de busca.'
                          : 'Quem ficou perto aparece na lista seguinte, com o item que faltou.'}
                    </p>
                  </div>
                )}
              </div>

              {incompletos.length > 0 && (
                <>
                  <h2 className="cf-section-title cf-section-title--amber">
                    {basica ? 'As atividades batem, falta certificado aprovado' : 'Não atende requisito obrigatório'}
                  </h2>
                  <div className="cf-gallery">
                    {incompletos.map((item) => (
                      <PessoaCard
                        key={item.profissional.id}
                        vaga={vagaDaBusca}
                        item={item}
                        modo={modoResultado}
                        aberto={aberto === item.profissional.id}
                        convite={basica ? null : conviteDe(item.profissional.id)}
                        documentos={state.documentos}
                        requisitos={basica ? [] : requisitos}
                        onToggle={() =>
                          setAberto((id) => (id === item.profissional.id ? null : item.profissional.id))
                        }
                        onConvidar={basica || missaoFechada ? undefined : () => convidar(item)}
                        onContrato={basica ? undefined : (candidaturaId) => confirmCandidato(candidaturaId)}
                      />
                    ))}
                  </div>
                </>
              )}

              {bloqueadosPeriodo.length > 0 && (
                <>
                  <h2 className="cf-section-title cf-section-title--rose">Fora deste ciclo temporário</h2>
                  <p className="cf-section-note">O prazo de 180 dias, a prorrogação de 90 ou a carência de 90 dias não permite nova missão agora.</p>
                  <div className="cf-gallery">
                    {bloqueadosPeriodo.map((item) => (
                      <PessoaCard
                        key={item.profissional.id}
                        vaga={vagaDaBusca}
                        item={item}
                        aberto={aberto === item.profissional.id}
                        documentos={state.documentos}
                        requisitos={requisitos}
                        onToggle={() =>
                          setAberto((id) => (id === item.profissional.id ? null : item.profissional.id))
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
          </>
          )}
        </div>
      </main>
      </div>
      {analisando && <CartaoAnalise />}
      <AceiteTermosGate onSair={onLogout} />
    </div>
  )
}

function CartaoAnalise() {
  const [progresso, setProgresso] = useState(0)
  const lupaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const inicio = performance.now()
    let quadro = 0
    let ultimo = -1
    const tick = (agora: number) => {
      const decorrido = agora - inicio
      const pct = Math.min(100, Math.round((decorrido / 5000) * 100))
      if (pct !== ultimo) {
        ultimo = pct
        setProgresso(pct)
      }
      const lado = Math.sin(decorrido / 240)
      const lupa = lupaRef.current
      if (lupa) lupa.style.transform = `translateX(${lado * 46}px) rotate(${lado * 8}deg)`
      if (decorrido < 5200) quadro = requestAnimationFrame(tick)
    }
    quadro = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(quadro)
  }, [])

  return (
    <div className="cf-analisando" role="status" aria-live="polite">
      <div className="cf-analisando-card">
        <div className="cf-busca" aria-hidden>
          <div className="cf-folha">
            <strong>Currículo</strong>
            <span />
            <span />
            <span />
            <span />
            <div className="cf-lupa-move" ref={lupaRef}>
              <svg className="cf-lupa" viewBox="0 0 88 88">
                <circle cx="36" cy="36" r="20" />
                <path d="M50 50.5 68 68" />
                <path className="cf-ia-estrela" d="M36 28.5 37.6 33.4 42.8 34.1 38.8 37.6 40.1 42.6 36 39.8 31.9 42.6 33.2 37.6 29.2 34.1 34.4 33.4z" />
              </svg>
            </div>
          </div>
          <span className="cf-ia-selo">IA</span>
        </div>
        <p>Aguarda um momento. A IA está analisando os currículos para trazer os melhores profissionais para você.</p>
        <div className="cf-busca-linha">
          <div className="cf-busca-trilha" aria-hidden>
            <span style={{ width: `${progresso}%` }} />
          </div>
          <strong>{progresso}%</strong>
        </div>
      </div>
    </div>
  )
}

function PainelVagas({ empresaId, onPublicar }: { empresaId: string; onPublicar: () => void }) {
  const { state } = useStore()
  const [perfil, setPerfil] = useState<{ pessoaId: string; lat: number; lng: number } | null>(null)
  const vagas = state.demandas
    .filter((demanda) => demanda.empresaId === empresaId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.data.localeCompare(a.data))
  const abertas = vagas.filter((demanda) => demanda.status === 'aberta').length
  const candidaturas = state.candidaturas.filter((item) => vagas.some((demanda) => demanda.id === item.demandaId)).length

  return (
    <section className="cf-panel">
      <header className="cf-vaga-pagina">
        <div className="cf-intro">
          <h1>Vagas e candidatos</h1>
          <p>Vagas publicadas por esta empresa e quem já se candidatou.</p>
        </div>
        <button type="button" className="cf-primary" onClick={onPublicar}>
          Nova vaga
        </button>
      </header>
      {vagas.length > 0 && (
        <div className="cf-vaga-resumo">
          <span>
            <b>{vagas.length}</b> {vagas.length === 1 ? 'publicada' : 'publicadas'}
          </span>
          <span>
            <b>{abertas}</b> {abertas === 1 ? 'aberta' : 'abertas'}
          </span>
          <span>
            <b>{candidaturas}</b> {candidaturas === 1 ? 'candidatura' : 'candidaturas'}
          </span>
        </div>
      )}
      {vagas.length === 0 && (
        <div className="cf-card cf-vaga-vazia">
          <strong>Nenhuma vaga publicada.</strong>
          <p className="muted">Publique uma vaga temporária para ela aparecer aqui e na aba Vagas do colaborador.</p>
        </div>
      )}
      <div className="cf-vaga-lista">
        {vagas.map((vaga) => {
          const inscritos = state.candidaturas.filter((item) => item.demandaId === vaga.id)
          const situacao = statusDaVaga(vaga.status, inscritos, vaga.quantidade)
          const periodo = rotuloPeriodo(vaga.data, vaga.dataFim)
          const texto = vaga.atividades || vaga.descricao
          return (
            <article key={vaga.id} className="cf-vaga">
              <div className="cf-vaga-corpo">
                <div className="cf-vaga-topo">
                  <div>
                    <span className={`cf-status cf-status--${situacao.classe}`}>{situacao.rotulo}</span>
                    <h2>{cargoLabel(vaga.cargo)}</h2>
                    <p>
                      {vaga.endereco.cidade}/{vaga.endereco.estado}
                    </p>
                  </div>
                  <div className="cf-vaga-valor">
                    <strong>
                      {vaga.valorDiaria.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </strong>
                    <small>por dia</small>
                  </div>
                </div>
                <dl className="cf-vaga-fatos">
                  <div>
                    <dt>Período</dt>
                    <dd>{periodo}</dd>
                  </div>
                  <div>
                    <dt>Jornada</dt>
                    <dd>
                      {vaga.horaInicio}–{vaga.horaFim}
                    </dd>
                  </div>
                  <div>
                    <dt>Pessoas</dt>
                    <dd>
                      {vaga.quantidade} {vaga.quantidade === 1 ? 'trabalhador' : 'trabalhadores'}
                    </dd>
                  </div>
                  <div>
                    <dt>Candidatos</dt>
                    <dd>{inscritos.length}</dd>
                  </div>
                </dl>
                {texto && <p className="cf-vaga-texto">{texto}</p>}
                {(vaga.requisitos.length > 0 || vaga.beneficios) && (
                  <div className="cf-vaga-chips">
                    {vaga.requisitos.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                    {vaga.beneficios && <span className="cf-vaga-chip--soft">{vaga.beneficios}</span>}
                  </div>
                )}
                <ContratoComMaoDeObra demandaId={vaga.id} />
                <div className="cf-vaga-acoes">
                  <BotaoCancelarVaga demanda={vaga} />
                </div>
              </div>
              <aside className="cf-vaga-pessoas">
                <h3>
                  Candidatos
                  <span>{inscritos.length}</span>
                </h3>
                {inscritos.length === 0 ? (
                  <p>Ninguém se candidatou ainda.</p>
                ) : (
                  <ul>
                    {inscritos.map((inscrito) => {
                      const pessoa = state.profissionais.find((item) => item.id === inscrito.profissionalId)
                      const nome = pessoa?.nome ?? 'Trabalhador'
                      return (
                        <li key={inscrito.id}>
                          <span className="cf-vaga-avatar">
                            {pessoa?.foto ? <img src={pessoa.foto} alt="" /> : iniciaisNome(nome)}
                          </span>
                          <button
                            type="button"
                            className="cf-vaga-nome"
                            disabled={!pessoa}
                            aria-label={`Abrir perfil de ${nome}`}
                            onClick={() =>
                              pessoa &&
                              setPerfil({ pessoaId: pessoa.id, lat: vaga.endereco.lat, lng: vaga.endereco.lng })
                            }
                          >
                            <strong>{nome}</strong>
                            <small>
                              {pessoa ? `${pessoa.endereco.cidade}/${pessoa.endereco.estado}` : 'Colaborador'}
                            </small>
                          </button>
                          <span className={`cf-vaga-selo cf-vaga-selo--${inscrito.status}`}>{rotuloConvite(inscrito.status, inscrito.recusadaPor)}</span>
                          <AceiteCandidatura
                            candidaturaId={inscrito.id}
                            status={inscrito.status}
                            profissionalId={inscrito.profissionalId}
                            demanda={vaga}
                          />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </aside>
            </article>
          )
        })}
      </div>
      {perfil && <PerfilDoCandidato perfil={perfil} onFechar={() => setPerfil(null)} />}
    </section>
  )
}

function ContratoComMaoDeObra({ demandaId }: { demandaId: string }) {
  const { state, currentEmpresa } = useStore()
  const [aberto, setAberto] = useState(false)
  const peca = (state.pecas ?? []).find((p) => p.demandaId === demandaId && p.tipo === 'contrato_ett_tomadora')
  if (!peca) return null
  const minha = peca.assinaturas.find((a) => a.papel === 'tomadora')
  const ett = peca.assinaturas.find((a) => a.papel === 'ett')
  const pendente = minha?.status === 'pendente'
  return (
    <div className={`cf-contrato-mo ${pendente ? 'cf-contrato-mo--pendente' : ''}`}>
      <div>
        <strong>Contrato com a fazumfreela · {peca.numero}</strong>
        <small>
          {pendente
            ? 'Falta a assinatura da sua empresa.'
            : ett?.status === 'assinado'
              ? 'Assinado pelas duas partes.'
              : 'Sua empresa assinou. Falta a assinatura da fazumfreela.'}
        </small>
      </div>
      <button type="button" className={pendente ? 'cf-primary' : 'cf-secondary'} onClick={() => setAberto(true)}>
        {pendente ? 'Assinar contrato' : 'Ver contrato'}
      </button>
      {aberto && (
        <PecaViewer
          pecaId={peca.id}
          papel="tomadora"
          nome={currentEmpresa?.responsavelNome}
          onClose={() => setAberto(false)}
        />
      )}
    </div>
  )
}

function PerfilDoCandidato({
  perfil,
  onFechar,
}: {
  perfil: { pessoaId: string; lat: number; lng: number }
  onFechar: () => void
}) {
  const { state } = useStore()
  const pessoa = state.profissionais.find((item) => item.id === perfil.pessoaId)
  if (!pessoa) return null
  return (
    <PerfilColaborador
      pessoa={pessoa}
      distancia={distanciaKm(pessoa.endereco, perfil)}
      onFechar={onFechar}
    />
  )
}

function iniciaisNome(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.[0] ?? '' : ''
  return `${primeira}${ultima}`.toUpperCase()
}

function PainelMissoes({ empresaId }: { empresaId: string }) {
  const { state } = useStore()
  const [perfil, setPerfil] = useState<{ pessoaId: string; lat: number; lng: number } | null>(null)
  const missoes = state.demandas
    .filter((demanda) => demanda.empresaId === empresaId)
    .filter(
      (demanda) =>
        demanda.status === 'em_andamento' ||
        demanda.status === 'finalizada' ||
        state.candidaturas.some((item) => item.demandaId === demanda.id),
    )
    .slice()
    .sort((a, b) => b.data.localeCompare(a.data))
  const emAndamento = missoes.filter((missao) => missao.status === 'em_andamento').length
  const confirmados = state.candidaturas.filter(
    (item) => missoes.some((missao) => missao.id === item.demandaId) && item.status === 'confirmada',
  ).length

  return (
    <section className="cf-panel">
      <div className="cf-intro">
        <h1>Convites enviados</h1>
        <p>Andamento de quem já foi chamado: convite, interesse, contrato e entrada.</p>
      </div>
      {missoes.length > 0 && (
        <div className="cf-vaga-resumo">
          <span>
            <b>{missoes.length}</b> {missoes.length === 1 ? 'missão' : 'missões'}
          </span>
          <span>
            <b>{emAndamento}</b> em andamento
          </span>
          <span>
            <b>{confirmados}</b> {confirmados === 1 ? 'confirmado' : 'confirmados'}
          </span>
        </div>
      )}
      {missoes.length === 0 && (
        <div className="cf-card cf-vaga-vazia">
          <strong>Nenhuma missão em andamento.</strong>
          <p className="muted">A missão aparece aqui quando alguém é convidado ou se candidata. A vaga publicada continua na aba Vagas.</p>
        </div>
      )}
      <div className="cf-missao-lista">
        {missoes.map((missao) => {
          const convites = state.candidaturas.filter((item) => item.demandaId === missao.id)
          const situacao = statusDaVaga(missao.status, convites, missao.quantidade)
          const confirmadosMissao = convites.filter((item) => item.status === 'confirmada').length
          const progresso = missao.quantidade > 0 ? Math.min(100, Math.round((confirmadosMissao / missao.quantidade) * 100)) : 0
          const periodo = rotuloPeriodo(missao.data, missao.dataFim)
          return (
            <article key={missao.id} className="cf-missao">
              <header className="cf-missao-topo">
                <div className="cf-missao-cabeca">
                  <span className={`cf-status cf-status--${situacao.classe}`}>{situacao.rotulo}</span>
                  <h2>{cargoLabel(missao.cargo)}</h2>
                </div>
                <p>
                  {periodo} · {missao.horaInicio}–{missao.horaFim} · {missao.endereco.cidade}/{missao.endereco.estado}
                </p>
                <ContratoComMaoDeObra demandaId={missao.id} />
                <BotaoCancelarVaga demanda={missao} />
                <div className="cf-missao-progresso">
                  <div className="cf-missao-trilha" aria-hidden>
                    <span style={{ width: `${progresso}%` }} />
                  </div>
                  <small>
                    {confirmadosMissao} de {missao.quantidade} {missao.quantidade === 1 ? 'confirmado' : 'confirmados'}
                  </small>
                </div>
              </header>
              <ul className="cf-missao-fila">
                {convites.length === 0 && <li className="cf-missao-vazio">Aguardando o primeiro convite ou candidatura.</li>}
                {convites.map((convite) => {
                  const pessoa = state.profissionais.find((item) => item.id === convite.profissionalId)
                  const nome = pessoa?.nome ?? 'Trabalhador'
                  const check = state.checkIns.find(
                    (item) => item.demandaId === missao.id && item.profissionalId === convite.profissionalId,
                  )
                  const passo = passoDaMissao(convite.status, check)
                  const contrato = state.contratos.find((item) => item.candidaturaId === convite.id)
                  return (
                    <li key={convite.id} className="cf-missao-pessoa">
                      <div className="cf-missao-lado">
                      <div className="cf-missao-quem">
                        <span className="cf-vaga-avatar">
                          {pessoa?.foto ? <img src={pessoa.foto} alt="" /> : iniciaisNome(nome)}
                        </span>
                        <button
                          type="button"
                          className="cf-vaga-nome"
                          disabled={!pessoa}
                          aria-label={`Abrir perfil de ${nome}`}
                          onClick={() =>
                            pessoa &&
                            setPerfil({ pessoaId: pessoa.id, lat: missao.endereco.lat, lng: missao.endereco.lng })
                          }
                        >
                          <strong>{nome}</strong>
                          <small>
                            {pessoa ? `${pessoa.endereco.cidade}/${pessoa.endereco.estado}` : 'Colaborador'}
                            {contrato?.numero ? ` · Contrato ${contrato.numero}` : ''}
                          </small>
                        </button>
                      </div>
                      <AceiteCandidatura
                        candidaturaId={convite.id}
                        status={convite.status}
                        profissionalId={convite.profissionalId}
                        demanda={missao}
                      />
                      </div>
                      {passo < 0 ? (
                        <span className={`cf-vaga-selo cf-vaga-selo--${convite.status}`}>{rotuloConvite(convite.status, convite.recusadaPor)}</span>
                      ) : (
                        <ol className="cf-missao-etapas">
                          {PASSOS_MISSAO.map((rotulo, indice) => (
                            <li
                              key={rotulo}
                              className={
                                indice < passo ? 'cf-missao-etapa cf-missao-etapa--feita' : indice === passo ? 'cf-missao-etapa cf-missao-etapa--agora' : 'cf-missao-etapa'
                              }
                            >
                              <span />
                              {rotulo}
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  )
                })}
              </ul>
            </article>
          )
        })}
      </div>
      {perfil && <PerfilDoCandidato perfil={perfil} onFechar={() => setPerfil(null)} />}
    </section>
  )
}

const PASSOS_MISSAO = ['Convite', 'Interesse', 'Contrato', 'Entrada']

function passoDaMissao(status: string, check?: { checkInAt?: string; checkOutAt?: string }) {
  if (status === 'recusada' || status === 'cancelada') return -1
  if (check?.checkInAt || check?.checkOutAt) return 3
  if (status === 'confirmada') return 2
  if (status === 'aceita') return 1
  return 0
}

function PainelContratacoes({ empresaId }: { empresaId: string }) {
  const { state } = useStore()
  const demandas = state.demandas.filter((demanda) => demanda.empresaId === empresaId)
  const demandasIds = new Set(demandas.map((demanda) => demanda.id))
  const contratos = state.contratos.filter(
    (contrato) => contrato.empresaId === empresaId || demandasIds.has(contrato.demandaId),
  )
  const confirmadasSemContrato = state.candidaturas.filter(
    (candidatura) =>
      demandasIds.has(candidatura.demandaId) &&
      candidatura.status === 'confirmada' &&
      !contratos.some((contrato) => contrato.candidaturaId === candidatura.id),
  )
  const linhas = [
    ...contratos.map((contrato) => {
      const demanda = demandas.find((item) => item.id === contrato.demandaId)
      const profissional = state.profissionais.find((item) => item.id === contrato.profissionalId)
      return {
        id: contrato.id,
        quando: contrato.createdAt,
        cargo: demanda?.cargo ?? '',
        profissional: profissional?.nome ?? 'Trabalhador',
        cidade: demanda ? `${demanda.endereco.cidade}/${demanda.endereco.estado}` : '',
        inicio: contrato.inicioEm || demanda?.data || '',
        fim: contrato.fimEm || demanda?.dataFim || '',
        jornada: demanda ? `${demanda.horaInicio}–${demanda.horaFim}` : '',
        motivo: demanda?.motivo ?? '',
        atividades: demanda?.atividades ?? '',
        valor: contrato.valor || demanda?.valorDiaria || 0,
        numero: contrato.numero,
        status: rotuloContrato(contrato.status),
        statusClasse: contrato.status === 'rescindido' ? 'cancelada' : contrato.status === 'concluido' ? 'finalizada' : 'em_andamento',
        servicos: contrato.tiposServico.filter(Boolean),
        demandaId: contrato.demandaId,
        profissionalUserId: profissional?.userId ?? '',
        encerrada:
          demanda?.status === 'finalizada' || contrato.status === 'concluido' || contrato.status === 'rescindido',
      }
    }),
    ...confirmadasSemContrato.map((candidatura) => {
      const demanda = demandas.find((item) => item.id === candidatura.demandaId)
      const profissional = state.profissionais.find((item) => item.id === candidatura.profissionalId)
      return {
        id: candidatura.id,
        quando: candidatura.createdAt,
        cargo: demanda?.cargo ?? '',
        profissional: profissional?.nome ?? 'Trabalhador',
        cidade: demanda ? `${demanda.endereco.cidade}/${demanda.endereco.estado}` : '',
        inicio: demanda?.data ?? '',
        fim: demanda?.dataFim ?? '',
        jornada: demanda ? `${demanda.horaInicio}–${demanda.horaFim}` : '',
        motivo: demanda?.motivo ?? '',
        atividades: demanda?.atividades ?? '',
        valor: demanda?.valorDiaria ?? 0,
        numero: '',
        status: 'Confirmada',
        statusClasse: 'em_andamento',
        servicos: [] as string[],
        demandaId: candidatura.demandaId,
        profissionalUserId: profissional?.userId ?? '',
        encerrada: demanda?.status === 'finalizada',
      }
    }),
  ].sort((a, b) => b.quando.localeCompare(a.quando))
  const pendentes = linhas.filter((linha) => {
    if (!linha.encerrada || !linha.profissionalUserId) return false
    return !state.avaliacoes.some(
      (item) =>
        item.demandaId === linha.demandaId && item.paraUserId === linha.profissionalUserId && item.deRole === 'empresa',
    )
  }).length

  return (
    <section className="cf-panel">
      <div className="cf-intro">
        <h1>Minhas contratações</h1>
        <p>Contratos temporários desta empresa. Quando um contrato encerra, a avaliação do trabalhador aparece aqui.</p>
      </div>
      {pendentes > 0 && (
        <p className="cf-avaliar-aviso">
          {pendentes === 1
            ? '1 contrato encerrado espera a sua avaliação.'
            : `${pendentes} contratos encerrados esperam a sua avaliação.`}
        </p>
      )}
      {linhas.length === 0 && (
        <div className="cf-card">
          <strong>Nenhuma contratação ainda.</strong>
          <p className="muted">Quando um contrato temporário for gerado, ele aparece aqui com o tipo de serviço e o profissional.</p>
        </div>
      )}
      <div className="cf-mission-list">
        {linhas.map((linha) => (
          <article key={linha.id} className="cf-card cf-mission">
            <div className="cf-mission-head">
              <h2>{linha.cargo ? cargoLabel(linha.cargo) : 'Serviço temporário'}</h2>
              <span className={`cf-status cf-status--${linha.statusClasse}`}>{linha.status}</span>
            </div>
            <p>
              {linha.servicos.length ? linha.servicos.join(' · ') : rotuloCategoria(linha.cargo)}
              {linha.numero ? ` · Contrato ${linha.numero}` : ''}
            </p>
            <ul className="cf-invite-list">
              <li>
                <strong>{linha.profissional}</strong>
                <span>Profissional</span>
              </li>
            </ul>
            <p>
              {linha.inicio ? formatarDataBr(linha.inicio.slice(0, 10)) : 'Início não informado'}
              {linha.fim ? ` a ${formatarDataBr(linha.fim.slice(0, 10))}` : ''}
              {linha.jornada ? ` · ${linha.jornada}` : ''}
              {linha.cidade ? ` · ${linha.cidade}` : ''}
            </p>
            <p>
              {linha.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por dia
              {linha.motivo ? ` · ${rotuloMotivo(linha.motivo)}` : ''}
            </p>
            {linha.atividades && <p>{linha.atividades}</p>}
            {linha.encerrada && linha.profissionalUserId && (
              <AvaliacaoTrabalhador
                demandaId={linha.demandaId}
                profissionalUserId={linha.profissionalUserId}
                nome={linha.profissional}
              />
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function rotuloCategoria(cargoId: string) {
  return allCargos().find((cargo) => cargo.id === cargoId)?.categoriaLabel ?? 'Trabalho temporário'
}

function rotuloContrato(status: string) {
  if (status === 'assinado_profissional') return 'Assinado pelo trabalhador'
  if (status === 'concluido') return 'Concluída'
  if (status === 'rescindido') return 'Rescindida'
  return 'Contrato gerado'
}

function PainelDados() {
  const { currentEmpresa, currentUser } = useStore()
  const empresa = currentEmpresa!
  const endereco = empresa.endereco
  const situacao =
    empresa.status === 'aprovada' ? 'Validada' : empresa.status === 'bloqueada' ? 'Bloqueada' : 'Aguardando validação'
  const situacaoClasse = empresa.status === 'aprovada' ? 'ok' : empresa.status === 'bloqueada' ? 'off' : 'espera'

  return (
    <section className="cf-panel">
      <div className="cf-intro">
        <h1>Dados da empresa</h1>
        <p>Cadastro da empresa tomadora usado nas missões temporárias.</p>
      </div>
      <article className="cf-empresa">
        <header className="cf-empresa-topo">
          <span className="cf-empresa-marca" aria-hidden>
            <IconeEmpresa />
          </span>
          <div>
            <span className={`cf-empresa-selo cf-empresa-selo--${situacaoClasse}`}>{situacao}</span>
            <h2>{empresa.nomeFantasia}</h2>
            <p>{empresa.razaoSocial}</p>
          </div>
          <span className="cf-empresa-tipo">{rotuloTipoEmpresa(empresa.tipo)}</span>
        </header>
        <div className="cf-empresa-grade">
          <section>
            <h3>Identificação</h3>
            <dl>
              <div>
                <dt>CNPJ</dt>
                <dd>{empresa.cnpj}</dd>
              </div>
              {currentUser?.email && (
                <div>
                  <dt>E-mail</dt>
                  <dd>{currentUser.email}</dd>
                </div>
              )}
            </dl>
          </section>
          <section>
            <h3>Responsável</h3>
            <dl>
              <div>
                <dt>Nome</dt>
                <dd>{empresa.responsavelNome}</dd>
              </div>
              <div>
                <dt>Cargo</dt>
                <dd>{empresa.responsavelCargo}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{empresa.telefone}</dd>
              </div>
            </dl>
          </section>
        </div>
        <footer className="cf-empresa-endereco">
          <h3>Endereço da operação</h3>
          <p>
            {endereco.rua}, {endereco.numero}
          </p>
          <p>
            {endereco.cidade}/{endereco.estado}
            {endereco.cep ? ` · CEP ${endereco.cep}` : ''}
          </p>
          <small>Este endereço é a origem das buscas e do mapa.</small>
        </footer>
      </article>
    </section>
  )
}

/**
 * Aprovar / recusar quem se candidatou ou foi convidado. Antes "Aprovar candidatura" aparecia
 * também com a vaga encerrada, cancelada ou já completa, e não havia como recusar ninguém.
 */
function AceiteCandidatura({
  candidaturaId,
  status,
  profissionalId,
  demanda,
}: {
  candidaturaId: string
  status: string
  profissionalId: string
  demanda: Demanda
}) {
  const { state, confirmCandidato, refuseCandidato } = useStore()
  if (status !== 'aceita' && status !== 'pendente') return null
  if (vagaEncerrada(demanda.status)) return null
  const pessoa = state.profissionais.find((item) => item.id === profissionalId)
  const nome = pessoa?.nome ?? 'este trabalhador'
  const lotada = vagaLotada(demanda, state.candidaturas)
  const docs = pessoa ? resumoDocumental(checklistProfissional(pessoa, state.documentos, demanda.requisitos)) : null
  const convitePendente = status === 'pendente'

  function recusar() {
    const pergunta = convitePendente
      ? `Retirar o convite de ${nome} para esta vaga?`
      : `Recusar a candidatura de ${nome}? A pessoa deixa de concorrer a esta vaga.`
    if (!window.confirm(pergunta)) return
    refuseCandidato(candidaturaId)
  }

  return (
    <div className="cf-vaga-aceite-bloco">
      <div className="cf-vaga-aceite-acoes">
        {!convitePendente && pessoa && !lotada && (
          <button type="button" className="cf-btn cf-btn--yellow cf-vaga-aceite" onClick={() => confirmCandidato(candidaturaId)}>
            Aprovar candidatura
          </button>
        )}
        <button type="button" className="cf-secondary cf-vaga-recusar" onClick={recusar}>
          {convitePendente ? 'Retirar convite' : 'Recusar'}
        </button>
      </div>
      {!convitePendente && lotada && (
        <span className="cf-vaga-espera">
          {demanda.quantidade === 1 ? 'A vaga já foi preenchida.' : `As ${demanda.quantidade} vagas já foram preenchidas.`}
        </span>
      )}
      {!convitePendente && !lotada && docs && !docs.completo && (
        <span className="cf-vaga-espera">Documentação em {docs.pct}%. A validação dos arquivos segue no administrador.</span>
      )}
    </div>
  )
}

/** Cancela a vaga (abre/em andamento). A store cancela convites e rescinde os contratos. */
function BotaoCancelarVaga({ demanda }: { demanda: Demanda }) {
  const { state, cancelDemanda } = useStore()
  if (demanda.status !== 'aberta' && demanda.status !== 'em_andamento') return null

  function cancelar() {
    const daVaga = state.candidaturas.filter((c) => c.demandaId === demanda.id)
    const abertos = daVaga.filter((c) => c.status === 'pendente' || c.status === 'aceita').length
    const confirmados = daVaga.filter((c) => c.status === 'confirmada').length
    const comPresenca = state.checkIns.some((c) => c.demandaId === demanda.id && c.checkInAt)
    const linhas = [`Cancelar a vaga de ${cargoLabel(demanda.cargo)} (${rotuloPeriodo(demanda.data, demanda.dataFim)})?`]
    if (abertos) {
      linhas.push(abertos === 1 ? '1 convite ou candidatura em aberto será cancelado.' : `${abertos} convites ou candidaturas em aberto serão cancelados.`)
    }
    if (confirmados) {
      linhas.push(confirmados === 1 ? 'O contrato de 1 trabalhador será rescindido.' : `Os contratos de ${confirmados} trabalhadores serão rescindidos.`)
    }
    if (comPresenca) {
      linhas.push('Já há presença registrada: a missão será encerrada hoje e os dias trabalhados serão pagos, com recibo.')
    }
    linhas.push('Essa ação não pode ser desfeita.')
    if (!window.confirm(linhas.join('\n\n'))) return
    cancelDemanda(demanda.id)
  }

  return (
    <button type="button" className="cf-secondary cf-vaga-cancelar" onClick={cancelar}>
      Cancelar vaga
    </button>
  )
}

function rotuloTipoEmpresa(tipo: string) {
  const nomes: Record<string, string> = {
    transportadora: 'Transportadora',
    operador_logistico: 'Operador logístico',
    industria: 'Indústria',
    centro_distribuicao: 'Centro de distribuição',
    atacadista: 'Atacadista',
    varejo: 'Varejo',
    outro: 'Outro',
  }
  return nomes[tipo] ?? tipo
}

function rotuloStatusMissao(status: string) {
  if (status === 'em_andamento') return 'Em andamento'
  if (status === 'finalizada') return 'Encerrada'
  if (status === 'cancelada') return 'Cancelada'
  return 'Aberta'
}

function statusDaVaga(
  status: string,
  candidaturas: { status: string }[],
  quantidade: number,
) {
  const confirmados = candidaturas.filter((item) => item.status === 'confirmada').length
  if (status !== 'finalizada' && status !== 'cancelada' && quantidade > 0 && confirmados >= quantidade) {
    return { rotulo: 'Contrato fechado', classe: 'fechada' }
  }
  return { rotulo: rotuloStatusMissao(status), classe: status }
}

function rotuloConvite(status: string, recusadaPor?: 'empresa' | 'profissional') {
  if (status === 'aceita') return 'Candidatou-se'
  if (status === 'confirmada') return 'Contrato gerado'
  if (status === 'recusada') {
    if (recusadaPor === 'profissional') return 'Sem interesse'
    if (recusadaPor === 'empresa') return 'Recusada pela empresa'
    return 'Recusada'
  }
  if (status === 'cancelada') return 'Cancelado'
  return 'Convite enviado'
}

function PessoaCard({
  item,
  modo = 'completa',
  aberto,
  onToggle,
  onConvidar,
  onContrato,
  convite,
  documentos,
  requisitos,
  vaga,
}: {
  item: CurriculoAnalisado
  modo?: ModoBusca
  aberto: boolean
  onToggle: () => void
  onConvidar?: () => void
  onContrato?: (candidaturaId: string) => void
  convite?: { id: string; status: string; contratoNumero?: string; fechada?: boolean } | null
  documentos: DocumentoRegistro[]
  requisitos: string[]
  /** Texto da vaga pesquisada, para o PDF do currículo. */
  vaga?: string
}) {
  const p = item.profissional
  const [perfilAberto, setPerfilAberto] = useState(false)
  const [confirmarConvite, setConfirmarConvite] = useState(false)
  const docs = resumoDocumental(checklistProfissional(p, documentos, requisitos))
  const podeContrato = convite?.status === 'aceita' && docs.completo && !convite.fechada
  const bloqueado = item.situacao === 'bloqueado'
  // Fora do ciclo temporário (prazo legal) nunca recebe convite; quem só não atende um requisito pode ser
  // convidado se a empresa quiser, depois de ver o que falta.
  const podeConvidar = Boolean(onConvidar) && !bloqueado && !convite
  const faltando = item.checagens.filter((checagem) => checagem.obrigatorio && !checagem.ok).map((checagem) => checagem.rotulo)
  const selo = bloqueado
    ? 'Fora do ciclo'
    : modo === 'basica'
      ? item.atendeObrigatorios
        ? 'Com certificado'
        : 'Falta certificado'
      : item.atendeObrigatorios
        ? 'Encaixe completo'
        : 'Falta requisito'
  const seloClasse = bloqueado ? 'cf-badge--rose' : item.atendeObrigatorios ? 'cf-badge--green' : 'cf-badge--amber'
  const barras = [
    ['Requisitos', item.compatibilidade.requisitos],
    ['Experiência', item.compatibilidade.experiencia],
    ['Disponibilidade', item.compatibilidade.disponibilidade],
    ['Localização', item.compatibilidade.localizacao],
    ['Certificações', item.compatibilidade.certificacoes],
  ] as const
  const extrasCurriculo = { documentos, analise: item, vaga, selo, distanciaKm: item.distanciaKm }

  return (
    <article className={`cf-pro ${bloqueado ? 'cf-pro--blocked' : item.atendeObrigatorios ? 'cf-pro--fit' : 'cf-pro--aside'}`}>
      <div className="cf-pro-top">
        <div className="cf-avatar" style={{ background: corAvatar(p.id) }} aria-hidden>
          {iniciais(p.nome)}
        </div>
        <div className="cf-pro-id">
          <h3>{p.nome}</h3>
          <p>{p.profissoes.map(cargoLabel).join(' · ')}</p>
        </div>
        <div className="cf-pro-marks">
          <span className={`cf-badge ${seloClasse}`}>{selo}</span>
          <span className="cf-nota" title="Quanto este profissional atende a vaga">
            {item.score}
            <small>/100</small>
          </span>
        </div>
      </div>

      <div className="cf-meta">
        <span className="cf-pill cf-pill--city">{p.endereco.cidade}/{p.endereco.estado}</span>
        <span className="cf-pill cf-pill--exp">{rotuloAnos(item.anosExperiencia)}</span>
        <span className="cf-pill cf-pill--km">{item.distanciaKm} km</span>
        {item.checagens.map((checagem) => (
          <span
            key={`${checagem.rotulo}-${checagem.obrigatorio}`}
            className={`cf-pill ${checagem.ok ? (checagem.obrigatorio ? 'cf-mark--ok' : 'cf-mark--dif') : 'cf-mark--no'}`}
          >
            {checagem.ok ? '✓' : '✕'} {checagem.rotulo}
            {!checagem.obrigatorio ? ' · diferencial' : ''}
          </span>
        ))}
      </div>

      <div className="cf-bars">
        {barras.map(([rotulo, texto]) => {
          const nivel = nivelBarra(texto)
          return (
            <div key={rotulo} className={`cf-bar cf-bar--${nivel}`}>
              <span>{rotulo}</span>
              <div className="cf-bar-track" aria-hidden>
                <div className="cf-bar-fill" />
              </div>
              <small>{texto}</small>
            </div>
          )
        })}
      </div>

      <div className="cf-why">
        <strong>Por que este profissional apareceu?</strong>
        <p>{item.porque}</p>
      </div>

      <div className="cf-actions">
        <button
          type="button"
          className="cf-btn cf-btn--dark"
          onClick={(event) => {
            event.stopPropagation()
            setPerfilAberto(true)
          }}
        >
          Ver perfil
        </button>
        <button type="button" className="cf-btn cf-btn--dark" onClick={onToggle}>
          {aberto ? 'Ocultar currículo' : 'Ver currículo'}
        </button>
        <button type="button" className="cf-btn cf-btn--blue" onClick={() => abrirCurriculoPdf(p, extrasCurriculo)}>
          Ver currículo em PDF
        </button>
        {podeConvidar && item.atendeObrigatorios && (
          <button type="button" className="cf-btn cf-btn--yellow" onClick={onConvidar}>
            Convidar para a missão
          </button>
        )}
        {podeConvidar && !item.atendeObrigatorios && !confirmarConvite && (
          <button type="button" className="cf-btn cf-btn--mesmo-assim" onClick={() => setConfirmarConvite(true)}>
            Convidar mesmo assim
          </button>
        )}
        {convite?.status === 'pendente' && <span className="cf-note">Convite enviado. Aguardando o trabalhador.</span>}
        {convite?.status === 'aceita' && (
          <span className="cf-note">
            Demonstrou interesse. Documentação {docs.completo ? 'completa' : `em ${docs.pct}%`}.
          </span>
        )}
        {podeContrato && onContrato && (
          <button type="button" className="cf-btn cf-btn--yellow" onClick={() => onContrato(convite.id)}>
            Gerar contrato temporário
          </button>
        )}
        {convite?.status === 'aceita' && convite.fechada && (
          <span className="cf-note">A vaga já está completa ou encerrada. Não dá para gerar outro contrato nela.</span>
        )}
        {convite?.status === 'aceita' && !convite.fechada && !docs.completo && (
          <span className="cf-note">O contrato espera a validação documental.</span>
        )}
        {convite?.status === 'recusada' && <span className="cf-note">Convite recusado. Esta pessoa não segue nesta missão.</span>}
        {convite?.status === 'cancelada' && <span className="cf-note">Convite cancelado.</span>}
        {convite?.contratoNumero && <span className="cf-note">Contrato temporário {convite.contratoNumero} gerado.</span>}
      </div>
      {podeConvidar && !item.atendeObrigatorios && confirmarConvite && (
        <div className="cf-convite-aviso" role="alertdialog" aria-label="Confirmar convite">
          <strong>Convidar mesmo sem atender todos os requisitos?</strong>
          <p>
            {p.nome.split(' ')[0]} não atende: {faltando.length ? faltando.join(', ') : 'um requisito obrigatório da vaga'}.
          </p>
          <p>
            O convite vai normalmente. Se a pessoa aceitar, o contrato temporário continua esperando a documentação
            obrigatória ser validada, como em qualquer convite.
          </p>
          <div className="cf-actions">
            <button
              type="button"
              className="cf-btn cf-btn--yellow"
              onClick={() => {
                setConfirmarConvite(false)
                onConvidar?.()
              }}
            >
              Sim, convidar
            </button>
            <button type="button" className="cf-btn cf-btn--leve" onClick={() => setConfirmarConvite(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {perfilAberto && (
        <PerfilColaborador
          pessoa={p}
          distancia={item.distanciaKm}
          onFechar={() => setPerfilAberto(false)}
        />
      )}
      {aberto && <CurriculoDetalhado profissional={p} extras={extrasCurriculo} />}
    </article>
  )
}

const CORES_AVATAR = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5', '#ea580c']

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.[0] ?? '' : ''
  return `${primeira}${ultima}`.toUpperCase()
}

function corAvatar(id: string) {
  let n = 0
  for (const ch of id) n = (n + ch.charCodeAt(0)) % CORES_AVATAR.length
  return CORES_AVATAR[n]
}

function nivelBarra(texto: string) {
  const t = texto.toLowerCase()
  if (t.includes('não atende') || t.includes('falta') || t.includes('sem ') || t.includes('distante')) return 'baixo'
  if (t.includes('parcial')) return 'medio'
  return 'alto'
}
