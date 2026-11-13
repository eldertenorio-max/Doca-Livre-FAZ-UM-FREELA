// Peças do topo e da tela inicial no mesmo desenho do Oferta de Carga e do WMS Doca Livre: relógio com
// data e versão, botão de atualizar, tema claro/escuro, usuário com avatar (abre o painel do perfil)
// e a tela "Bem Vindo" com a logo apagada no centro.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LOGO_DOCA_LIVRE_SRC } from '../lib/brandAssets'
import { emDemo } from '../lib/modo'
import { useStore } from '../lib/store'
import { useTema } from '../lib/tema'
import './topo-doca-livre.css'

export const VERSAO_SISTEMA = 'v1.0'

function horaEData(agora: Date) {
  return {
    hora: agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    data: agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  }
}

function dataHora(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

export function iniciaisDoNome(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return 'DL'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase()
}

export function RelogioTopo() {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  const { hora, data } = horaEData(agora)
  return (
    <div className="dl-topo-meta" aria-label="Data e hora">
      <span className="dl-topo-meta-hora">{hora}</span>
      <span className="dl-topo-meta-data">{data}</span>
      <span className="dl-topo-meta-versao">{VERSAO_SISTEMA}</span>
    </div>
  )
}

/** Busca de novo os dados do servidor (sem recarregar a página e sem perder o que está aberto). */
export function BotaoAtualizar({ onAtualizar }: { onAtualizar: () => Promise<void> | void }) {
  const [girando, setGirando] = useState(false)
  async function atualizar() {
    if (girando) return
    setGirando(true)
    try {
      await onAtualizar()
    } finally {
      window.setTimeout(() => setGirando(false), 400)
    }
  }
  return (
    <button
      type="button"
      className={`dl-topo-atualizar${girando ? ' dl-topo-atualizar--girando' : ''}`}
      onClick={() => void atualizar()}
      title="Atualizar"
      aria-label="Atualizar os dados"
    >
      <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden>
        <path d="M20 6v5h-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 11a7 7 0 1 0-2.05 4.95" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/** Lua no tema claro, sol no escuro (igual ao WMS). Fica salvo no aparelho. */
export function BotaoTema() {
  const { tema, alternar } = useTema()
  const escuro = tema === 'escuro'
  return (
    <button
      type="button"
      className="dl-topo-tema"
      onClick={alternar}
      title={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      aria-pressed={escuro}
    >
      {escuro ? (
        <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden>
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <path
            d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z" fill="currentColor" />
        </svg>
      )}
    </button>
  )
}

export type PerfilDoTopo = {
  nome: string
  papel: string
  usuario?: string
  email?: string
  criadoEm?: string
  ativo?: boolean
  foto?: string
  estatisticas: { valor: string | number; rotulo: string }[]
  verificacoes: { ok: boolean; texto: string }[]
  onIrPainel: () => void
  /** Ex.: "Editar perfil" leva para a aba de perfil do portal. */
  editar?: { rotulo: string; onClick: () => void }
  /** Foto de perfil direto no painel: adicionar, trocar ou remover (no lugar de "editar"). */
  fotoAcoes?: { temFoto: boolean; trocar: () => void; remover: () => void }
  onSair: () => void
}

/** Usuário no canto do topo; ao clicar, abre o painel com "Sobre você" e "Conta". */
export function UsuarioTopo({ perfil }: { perfil: PerfilDoTopo }) {
  const [aberto, setAberto] = useState(false)
  const [aba, setAba] = useState<'sobre' | 'conta'>('sobre')
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function fora(evento: MouseEvent) {
      if (caixa.current && !caixa.current.contains(evento.target as Node)) setAberto(false)
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  function ir(acao: () => void) {
    setAberto(false)
    acao()
  }

  return (
    <div className="dl-topo-usuario-wrap" ref={caixa}>
      <button
        type="button"
        className="dl-topo-usuario"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title="Ver perfil"
        onClick={() => {
          setAba('sobre')
          setAberto((valor) => !valor)
        }}
      >
        <span className="dl-topo-usuario-texto">
          <strong>{perfil.nome}</strong>
          <span>{perfil.papel}</span>
        </span>
        <span className="dl-topo-avatar" aria-hidden>
          {perfil.foto ? <img src={perfil.foto} alt="" /> : iniciaisDoNome(perfil.nome)}
        </span>
      </button>

      {aberto && (
        <div className="dl-perfil-painel" role="dialog" aria-label="Perfil">
          <div className="dl-perfil-abas" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={aba === 'sobre'}
              className={aba === 'sobre' ? 'is-ativa' : ''}
              onClick={() => setAba('sobre')}
            >
              Sobre você
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={aba === 'conta'}
              className={aba === 'conta' ? 'is-ativa' : ''}
              onClick={() => setAba('conta')}
            >
              Conta
            </button>
          </div>

          {aba === 'sobre' ? (
            <div className="dl-perfil-conteudo">
              <div className="dl-perfil-hero">
                <span className="dl-perfil-hero-avatar" aria-hidden>
                  {perfil.foto ? <img src={perfil.foto} alt="" /> : <span>{iniciaisDoNome(perfil.nome)}</span>}
                  {perfil.ativo !== false && <i className="dl-perfil-hero-selo" title="Usuário ativo" />}
                </span>
                <span className="dl-perfil-hero-texto">
                  <strong>{perfil.nome}</strong>
                  <span>{perfil.papel}</span>
                  {perfil.fotoAcoes ? (
                    <span className="dl-perfil-acoes-foto">
                      <button type="button" className="dl-perfil-acao-foto" onClick={() => ir(perfil.fotoAcoes!.trocar)}>
                        {perfil.fotoAcoes.temFoto ? 'Trocar foto' : 'Adicionar foto'}
                      </button>
                      {perfil.fotoAcoes.temFoto && (
                        <button type="button" className="dl-perfil-acao-foto dl-perfil-acao-foto--remover" onClick={() => ir(perfil.fotoAcoes!.remover)}>
                          Remover foto
                        </button>
                      )}
                    </span>
                  ) : (
                    perfil.editar && (
                      <button type="button" className="dl-perfil-acao-foto" onClick={() => ir(perfil.editar!.onClick)}>
                        {perfil.editar.rotulo}
                      </button>
                    )
                  )}
                </span>
              </div>

              {perfil.estatisticas.length > 0 && (
                <div className="dl-perfil-numeros">
                  {perfil.estatisticas.map((item) => (
                    <div key={item.rotulo}>
                      <p className="dl-perfil-numeros-valor">{item.valor}</p>
                      <p className="dl-perfil-numeros-rotulo">{item.rotulo}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="dl-perfil-links">
                <button type="button" className="dl-perfil-link" onClick={() => ir(perfil.onIrPainel)}>
                  Ir para o Painel
                </button>
                <button type="button" className="dl-perfil-link" onClick={() => setAba('conta')}>
                  Ver dados pessoais
                </button>
              </div>

              <div className="dl-perfil-verificado">
                <h3>{perfil.verificacoes.every((v) => v.ok) ? 'Você tem um Perfil Verificado' : 'Seu perfil'}</h3>
                <ul>
                  {perfil.verificacoes.map((item) => (
                    <li key={item.texto} className={item.ok ? 'is-ok' : ''}>
                      {item.texto}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ContaDoPerfil perfil={perfil} onFechar={() => setAberto(false)} />
          )}
        </div>
      )}
    </div>
  )
}

function ContaDoPerfil({ perfil, onFechar }: { perfil: PerfilDoTopo; onFechar: () => void }) {
  const { trocarMinhaSenha } = useStore()
  const [trocando, setTrocando] = useState(false)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  async function salvar(evento: FormEvent) {
    evento.preventDefault()
    setErro('')
    setAviso('')
    if (nova !== confirmar) {
      setErro('A confirmação não bate com a nova senha.')
      return
    }
    setSalvando(true)
    try {
      const r = await trocarMinhaSenha(atual, nova)
      if (!r.ok) {
        setErro(r.error || 'Não foi possível trocar a senha.')
        return
      }
      setAtual('')
      setNova('')
      setConfirmar('')
      setTrocando(false)
      setAviso('Senha trocada. Use a nova no próximo login.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="dl-perfil-conteudo">
      <h3 className="dl-perfil-conta-titulo">Dados da conta</h3>
      <dl className="dl-perfil-dados">
        <div>
          <dt>Nome</dt>
          <dd>{perfil.nome}</dd>
        </div>
        <div>
          <dt>Usuário</dt>
          <dd>{perfil.usuario || '—'}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>{perfil.email || '—'}</dd>
        </div>
        <div>
          <dt>Perfil</dt>
          <dd>{perfil.papel}</dd>
        </div>
        <div>
          <dt>Conta criada em</dt>
          <dd>{dataHora(perfil.criadoEm)}</dd>
        </div>
      </dl>

      {trocando && (
        <form className="dl-perfil-senha" onSubmit={(evento) => void salvar(evento)}>
          <label>
            Senha atual
            <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" required />
          </label>
          <label>
            Nova senha
            <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Confirmar nova senha
            <input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
          {erro && <p className="dl-perfil-erro">{erro}</p>}
          <div className="dl-perfil-acoes">
            <button type="submit" className="dl-perfil-btn" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar nova senha'}
            </button>
            <button type="button" className="dl-perfil-btn dl-perfil-btn--leve" onClick={() => setTrocando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {aviso && <p className="dl-perfil-aviso">{aviso}</p>}

      {!trocando && (
        <div className="dl-perfil-acoes">
          {!emDemo() && (
            <button
              type="button"
              className="dl-perfil-btn"
              onClick={() => {
                setAviso('')
                setTrocando(true)
              }}
            >
              Trocar senha
            </button>
          )}
          <button type="button" className="dl-perfil-btn dl-perfil-btn--leve" onClick={perfil.onSair}>
            Sair
          </button>
          <button type="button" className="dl-perfil-btn dl-perfil-btn--leve" onClick={onFechar}>
            Fechar
          </button>
        </div>
      )}
    </div>
  )
}

/** Tela inicial: a logo da Doca Livre apagada no centro e "Bem Vindo" logo abaixo. */
export function BoasVindas() {
  return (
    <section className="dl-boas-vindas" aria-label="Bem Vindo">
      <img src={LOGO_DOCA_LIVRE_SRC} alt="" className="dl-boas-vindas-logo" />
      <p className="dl-boas-vindas-texto">Bem Vindo</p>
    </section>
  )
}
