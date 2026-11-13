import { useEffect, useState } from 'react'
import { CentralDocumentacaoAdmin } from '../../components/DocumentacaoPanel'
import { BibliotecaDocumental } from '../../components/BibliotecaDocumental'
import { LevelBadge } from '../../components/LevelBadge'
import { cargoLabel } from '../../data/categories'
import {
  BoasVindas,
  BotaoAtualizar,
  BotaoTema,
  RelogioTopo,
  UsuarioTopo,
  type PerfilDoTopo,
} from '../../components/TopoDocaLivre'
import { LOGO_DOCA_LIVRE_SRC } from '../../lib/brandAssets'
import { emDemo } from '../../lib/modo'
import { useStore } from '../../lib/store'
import { abaPedida, esquecerAbaPedida } from '../../lib/aplicativo'
import { AplicativoCelular } from '../../components/AplicativoCelular'

/**
 * Gera uma senha provisória (a pessoa troca no primeiro login). O sistema não guarda senhas,
 * então é assim que o admin devolve o acesso a quem esqueceu e não recebe o e-mail.
 */
function BotaoSenhaProvisoria({ userId, rotulo }: { userId: string; rotulo: string }) {
  const { adminRedefinirSenha } = useStore()
  if (emDemo()) return null
  async function gerar() {
    if (!window.confirm(`Gerar uma senha provisória para ${rotulo}? A senha atual deixa de valer.`)) return
    const r = await adminRedefinirSenha(userId)
    if (!r.ok) {
      window.alert(r.error)
      return
    }
    window.prompt(
      `Senha provisória de ${rotulo} (copie e passe para a pessoa; no primeiro login ela define a própria senha):`,
      r.senha,
    )
  }
  return (
    <button type="button" className="px-btn px-btn-ghost" onClick={() => void gerar()}>
      Senha provisória
    </button>
  )
}
import { AdminDashboard } from './AdminDashboard'
import { CadastroEmpresaDetalhe, CadastroProfissionalDetalhe } from './CadastroDetalheModal'
import { HierarquiaEmpresas, NovaEmpresaModal } from './HierarquiaEmpresas'
import { AuditoriaAdmin, DemandasAdmin, FinanceiroAdmin } from './PaginasOperacao'
import { ORG_TIPO_LABEL } from '../../lib/orgHierarquia'
import '../empresa/empresa-px.css'
import './admin.css'

const ITEMS = [
  { id: 'inicio', label: 'Início' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'empresas', label: 'Empresas' },
  { id: 'hierarquia', label: 'Hierarquia' },
  { id: 'profissionais', label: 'Profissionais' },
  { id: 'documentacao', label: 'Documentação' },
  { id: 'demandas', label: 'Demandas' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'auditoria', label: 'Auditoria' },
  { id: 'aplicativo', label: 'Aplicativo' },
]

export function AdminApp({
  onLogout,
  onOpenConfig,
}: {
  onLogout: () => void
  onOpenConfig?: () => void
}) {
  const store = useStore()
  const { refreshFromCloud } = store
  // Abre na tela de boas-vindas, como o Oferta de Carga.
  // Ou a aba pedida por um atalho ou aviso do app (/?aba=empresas).
  const [section, setSection] = useState(() => abaPedida(ITEMS.map((item) => item.id)) ?? 'inicio')
  useEffect(() => esquecerAbaPedida(), [])
  // Menu lateral como no WMS Doca Livre: recolhido, abre com o mouse; o botão do topo o deixa fixo.
  const [menuFixo, setMenuFixo] = useState(false)

  // Dependia de `store`, que é um objeto novo a cada render: cada atualização disparava outra
  // busca do banco inteiro, em loop, enquanto o admin ficava aberto.
  useEffect(() => {
    void refreshFromCloud()
    const id = window.setInterval(() => void refreshFromCloud(), 20_000)
    return () => window.clearInterval(id)
  }, [refreshFromCloud])

  async function irParaEmpresaDemo() {
    const res = await store.login('empresa@logexpress.com', 'demo123')
    if (!res.ok) {
      onLogout()
      return
    }
    try {
      sessionStorage.setItem('mao-portal-ativo', 'empresa')
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  // O Início saiu do menu: a logo do topo leva para ele.
  const navItems = ITEMS.filter((item) => item.id !== 'inicio')
  const usuarioLogado = store.currentUser
  const nomeUsuario = usuarioLogado?.usuario || usuarioLogado?.email.split('@')[0] || 'Doca Livre'
  const papelUsuario =
    usuarioLogado?.role === 'super' || usuarioLogado?.nivelHierarquia === 'super' ? 'Super Usuário' : 'Administrador'
  const perfilTopo: PerfilDoTopo = {
    nome: nomeUsuario,
    papel: papelUsuario,
    usuario: usuarioLogado?.usuario,
    email: usuarioLogado?.email,
    criadoEm: usuarioLogado?.createdAt,
    ativo: usuarioLogado?.ativo !== false,
    estatisticas: [
      { valor: store.state.empresas.length, rotulo: 'Empresas' },
      { valor: store.state.profissionais.length, rotulo: 'Profissionais' },
    ],
    verificacoes: [
      { ok: usuarioLogado?.ativo !== false, texto: 'Usuário ativo no sistema' },
      { ok: Boolean(usuarioLogado?.email), texto: usuarioLogado?.email || 'E-mail não informado' },
      { ok: true, texto: papelUsuario === 'Super Usuário' ? 'Acesso de superusuário' : 'Acesso de administrador' },
    ],
    onIrPainel: () => setSection('dashboard'),
    onSair: onLogout,
  }
  const alertaAba: Record<string, number> = {
    empresas: store.state.empresas.filter((empresa) => empresa.status === 'pendente').length,
    profissionais: store.state.profissionais.filter((pessoa) => pessoa.status === 'pendente').length,
  }

  return (
    <div className={`px-shell px-shell--admin${menuFixo ? ' px-shell--menu-fixo' : ''}`}>
      {emDemo() && (
        <div className="px-banner-switch">
          <span>
            Este é o <strong>Admin</strong>. O painel estilo PX (Contratos, Prestadores, Campanhas) fica no login de
            Empresa.
          </span>
          <button type="button" className="px-btn px-btn-primary" onClick={irParaEmpresaDemo}>
            Abrir Painel Empresa agora
          </button>
        </div>
      )}
      <header className="px-topbar">
        <button
          type="button"
          className="px-topbar-menu"
          aria-label={menuFixo ? 'Recolher o menu' : 'Fixar o menu aberto'}
          aria-pressed={menuFixo}
          title="Fixar / recolher o menu"
          onClick={() => setMenuFixo((valor) => !valor)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          className="px-topbar-left topo-logo-botao"
          onClick={() => setSection('inicio')}
          title="Ir para o início"
          aria-label="Ir para o início"
        >
          <img src={LOGO_DOCA_LIVRE_SRC} alt="Doca Livre" className="px-topbar-logo" />
          <strong className="px-topbar-brand">fazumfreela</strong>
        </button>
        <div className="px-topbar-right" style={{ marginLeft: 'auto' }}>
          {onOpenConfig && (
            <button type="button" className="px-btn px-btn-outline" onClick={onOpenConfig}>
              Permissões
            </button>
          )}
          <BotaoAtualizar onAtualizar={refreshFromCloud} />
          <BotaoTema />
          <RelogioTopo />
          <UsuarioTopo perfil={perfilTopo} />
          <button type="button" className="px-btn px-btn-ghost" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>

      <div className="px-body">
        <aside className="px-sidebar">
          <nav className="px-sidebar-nav">
            <p className="px-sidebar-kicker">Painel</p>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`px-nav-link ${section === item.id ? 'px-nav-link--active' : ''}`}
                onClick={() => {
                  if (item.id === 'config' && onOpenConfig) {
                    onOpenConfig()
                    return
                  }
                  setSection(item.id)
                }}
              >
                <span className="px-nav-ico" aria-hidden>
                  <IconeAba id={item.id} />
                </span>
                <span>{item.label}</span>
                {(alertaAba[item.id] ?? 0) > 0 && (
                  <span className="ad-nav-alerta">{alertaAba[item.id]}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        <main className="px-main">
          {section === 'inicio' && <BoasVindas />}
          {section === 'dashboard' && <AdminDashboard />}
          {section === 'empresas' && <EmpresasAdmin />}
          {section === 'hierarquia' && <HierarquiaEmpresas />}
          {section === 'profissionais' && <ProfissionaisAdmin />}
          {section === 'documentacao' && (
            <>
              <BibliotecaDocumental modo="ett" />
              <CentralDocumentacaoAdmin />
            </>
          )}
          {section === 'demandas' && <DemandasAdmin />}
          {section === 'financeiro' && <FinanceiroAdmin />}
          {section === 'auditoria' && <AuditoriaAdmin />}
          {section === 'aplicativo' && <AplicativoCelular papel="gestao" />}
        </main>
      </div>
      <button type="button" className="px-chat-fab" title="Suporte">
        💬
      </button>
    </div>
  )
}

function IconeAba({ id }: { id: string }) {
  const traco = {
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none">
      {id === 'inicio' && (
        <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5z" {...traco} />
      )}
      {id === 'dashboard' && (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" {...traco} />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" {...traco} />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" {...traco} />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" {...traco} />
        </>
      )}
      {id === 'empresas' && (
        <>
          <path d="M4 20V6.5A1.5 1.5 0 0 1 5.5 5H13v15" {...traco} />
          <path d="M13 9h5.5A1.5 1.5 0 0 1 20 10.5V20" {...traco} />
          <path d="M7.5 8.5h2.5M7.5 12h2.5M7.5 15.5h2.5M16 13h1.5M16 16.5h1.5" {...traco} />
        </>
      )}
      {id === 'profissionais' && (
        <>
          <circle cx="9" cy="8" r="2.4" {...traco} />
          <circle cx="16" cy="9" r="2" {...traco} />
          <path d="M4.5 18.5c.6-2.6 2.5-4 4.5-4s3.9 1.4 4.5 4" {...traco} />
          <path d="M13.5 14.8c1.3-.5 2.6-.4 3.7.4 1.1.8 1.7 2 2 3.3" {...traco} />
        </>
      )}
      {id === 'documentacao' && (
        <>
          <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" {...traco} />
          <path d="M14 3.8V8h4.2M8.5 12h7M8.5 15.5h5" {...traco} />
        </>
      )}
      {id === 'demandas' && (
        <>
          <path d="M8 6.5h11M8 12h11M8 17.5h11" {...traco} />
          <circle cx="4.6" cy="6.5" r="1.15" fill="currentColor" />
          <circle cx="4.6" cy="12" r="1.15" fill="currentColor" />
          <circle cx="4.6" cy="17.5" r="1.15" fill="currentColor" />
        </>
      )}
      {id === 'financeiro' && (
        <>
          <rect x="3.5" y="6" width="17" height="12" rx="2" {...traco} />
          <path d="M3.5 10h17" {...traco} />
          <path d="M7 14.5h4" {...traco} />
        </>
      )}
      {id === 'aplicativo' && (
        <>
          <rect x="6.5" y="2.75" width="11" height="18.5" rx="2.2" {...traco} />
          <path d="M10.5 18h3" {...traco} />
        </>
      )}
      {id === 'auditoria' && (
        <>
          <path d="M12 3.5l7 2.4v5.4c0 4.2-2.8 7.2-7 8.7-4.2-1.5-7-4.5-7-8.7V5.9l7-2.4z" {...traco} />
          <path d="M8.8 12.1l2.1 2.1 4.3-4.4" {...traco} />
        </>
      )}
      {id === 'hierarquia' && (
        <>
          <rect x="9" y="3.5" width="6" height="4.5" rx="1.2" {...traco} />
          <rect x="3.5" y="16" width="6" height="4.5" rx="1.2" {...traco} />
          <rect x="14.5" y="16" width="6" height="4.5" rx="1.2" {...traco} />
          <path d="M12 8v4M6.5 16v-2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" {...traco} />
        </>
      )}
      {id === 'config' && (
        <>
          <circle cx="8" cy="8" r="2.2" {...traco} />
          <circle cx="16" cy="16" r="2.2" {...traco} />
          <path d="M10.1 9.2l3.8 5.6M8 10.2V20M16 4v9.6" {...traco} />
        </>
      )}
    </svg>
  )
}

function ordemAprovacao(status: string) {
  if (status === 'pendente') return 0
  if (status === 'bloqueada' || status === 'bloqueado') return 2
  return 1
}

function EmpresasAdmin() {
  const { state, setEmpresaStatus, excluirUsuario, currentUser } = useStore()
  const [detalheId, setDetalheId] = useState<string | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  const empresas = [...state.empresas].sort((a, b) => ordemAprovacao(a.status) - ordemAprovacao(b.status))
  const pendentes = empresas.filter((empresa) => empresa.status === 'pendente').length
  const detalhe = detalheId ? empresas.find((e) => e.id === detalheId) : undefined
  const contaDetalhe = detalhe ? state.users.find((u) => u.id === detalhe.userId) : undefined
  const docsDetalhe = detalhe ? state.documentos.filter((d) => d.donoId === detalhe.id) : []

  async function excluirEmpresa(e: (typeof empresas)[number]) {
    const conta = state.users.find((u) => u.id === e.userId)
    const rotulo = conta?.usuario || conta?.email || e.nomeFantasia
    if (
      !window.confirm(
        `Excluir a empresa "${e.nomeFantasia}" e a conta ${rotulo}? Esta ação não tem volta.`,
      )
    ) {
      return
    }
    const res = await excluirUsuario(e.userId)
    if (!res.ok) window.alert(res.error || 'Não foi possível excluir.')
    if (detalheId === e.id) setDetalheId(null)
  }

  return (
    <div className="px-page">
      <div className="ad-titulo-acoes">
        <h1 className="px-title">Empresas</h1>
        {!emDemo() && (
          <button type="button" className="px-btn px-btn-primary" onClick={() => setCadastrando(true)}>
            + Cadastrar empresa
          </button>
        )}
      </div>
      {pendentes > 0 && (
        <p className="ad-pendente-nota">
          {pendentes === 1 ? '1 empresa aguardando aprovação.' : `${pendentes} empresas aguardando aprovação.`}
        </p>
      )}
      <ul className="px-list">
        {empresas.map((e) => {
          const podeExcluir = e.userId !== currentUser?.id
          return (
            <li key={e.id} className={`px-list-card${e.status === 'pendente' ? ' px-list-card--pendente' : ''}`}>
              <div>
                <strong>{e.nomeFantasia}</strong>
                {e.status === 'pendente' && <span className="ad-pendente-tag">Aguardando aprovação</span>}
                {e.status === 'recusada' && e.motivoRecusa && (
                  <p className="muted">Motivo da recusa: {e.motivoRecusa}</p>
                )}
                <p className="muted">
                  {e.cnpj} · {e.tipo} · {e.plano} · {e.endereco.cidade}
                  {e.orgTipo ? ` · ${ORG_TIPO_LABEL[e.orgTipo]}` : ' · fora da hierarquia'}
                </p>
              </div>
              <div className="px-row-actions">
                <span className={`px-status px-status--${e.status}`}>{e.status}</span>
                <button type="button" className="px-btn px-btn-ghost" onClick={() => setDetalheId(e.id)}>
                  Ver cadastro
                </button>
                {e.status === 'pendente' && (
                  <button type="button" className="px-btn px-btn-primary" onClick={() => setDetalheId(e.id)}>
                    Aprovar
                  </button>
                )}
                {e.status !== 'bloqueada' && (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost"
                    onClick={() =>
                      void setEmpresaStatus(e.id, 'bloqueada').then((res) => {
                        if (!res.ok) window.alert(res.error || 'Não foi possível bloquear.')
                      })
                    }
                  >
                    Bloquear
                  </button>
                )}
                <BotaoSenhaProvisoria userId={e.userId} rotulo={e.nomeFantasia} />
                {podeExcluir && (
                  <button type="button" className="px-btn px-btn-ghost" onClick={() => void excluirEmpresa(e)}>
                    Excluir
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {cadastrando && <NovaEmpresaModal onFechar={() => setCadastrando(false)} />}
      {detalhe && (
        <CadastroEmpresaDetalhe
          empresa={detalhe}
          conta={contaDetalhe}
          documentos={docsDetalhe}
          onClose={() => setDetalheId(null)}
          onAprovar={async () => {
            const res = await setEmpresaStatus(detalhe.id, 'aprovada')
            if (!res.ok) throw new Error(res.error || 'Não foi possível aprovar.')
          }}
          onRecusar={async (motivo) => {
            const res = await setEmpresaStatus(detalhe.id, 'recusada', { motivoRecusa: motivo })
            if (!res.ok) throw new Error(res.error || 'Não foi possível recusar.')
          }}
        />
      )}
    </div>
  )
}

function ProfissionaisAdmin() {
  const { state, setProfissionalStatus, excluirUsuario, currentUser } = useStore()
  const [detalheId, setDetalheId] = useState<string | null>(null)
  const profissionais = [...state.profissionais].sort(
    (a, b) => ordemAprovacao(a.status) - ordemAprovacao(b.status),
  )
  const pendentes = profissionais.filter((pessoa) => pessoa.status === 'pendente').length
  const detalhe = detalheId ? profissionais.find((p) => p.id === detalheId) : undefined
  const contaDetalhe = detalhe ? state.users.find((u) => u.id === detalhe.userId) : undefined
  const docsDetalhe = detalhe ? state.documentos.filter((d) => d.donoId === detalhe.id) : []

  async function excluirProfissional(p: (typeof profissionais)[number]) {
    const conta = state.users.find((u) => u.id === p.userId)
    const rotulo = conta?.usuario || conta?.email || p.nome
    if (
      !window.confirm(
        `Excluir o colaborador "${p.nome}" e a conta ${rotulo}? Esta ação não tem volta.`,
      )
    ) {
      return
    }
    const res = await excluirUsuario(p.userId)
    if (!res.ok) window.alert(res.error || 'Não foi possível excluir.')
    if (detalheId === p.id) setDetalheId(null)
  }

  return (
    <div className="px-page">
      <h1 className="px-title">Profissionais</h1>
      {pendentes > 0 && (
        <p className="ad-pendente-nota">
          {pendentes === 1
            ? '1 colaborador aguardando aprovação.'
            : `${pendentes} colaboradores aguardando aprovação.`}
        </p>
      )}
      <ul className="px-list">
        {profissionais.map((p) => {
          const podeExcluir = p.userId !== currentUser?.id
          return (
            <li key={p.id} className={`px-list-card${p.status === 'pendente' ? ' px-list-card--pendente' : ''}`}>
              <div>
                <strong>{p.nome}</strong>
                {p.status === 'pendente' && <span className="ad-pendente-tag">Aguardando aprovação</span>}
                {p.status === 'recusado' && p.motivoRecusa && (
                  <p className="muted">Motivo da recusa: {p.motivoRecusa}</p>
                )}
                <p className="muted">
                  {p.profissoes.map(cargoLabel).join(', ')} · {p.endereco.cidade} · ★ {p.avaliacaoMedia.toFixed(1)}
                </p>
                <LevelBadge nivel={p.nivel} />
              </div>
              <div className="px-row-actions">
                <span className={`px-status px-status--${p.status}`}>{p.status}</span>
                <button type="button" className="px-btn px-btn-ghost" onClick={() => setDetalheId(p.id)}>
                  Ver cadastro
                </button>
                {p.status === 'pendente' && (
                  <button type="button" className="px-btn px-btn-primary" onClick={() => setDetalheId(p.id)}>
                    Aprovar
                  </button>
                )}
                {p.status !== 'bloqueado' && (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost"
                    onClick={() =>
                      void setProfissionalStatus(p.id, 'bloqueado').then((res) => {
                        if (!res.ok) window.alert(res.error || 'Não foi possível bloquear.')
                      })
                    }
                  >
                    Bloquear
                  </button>
                )}
                <BotaoSenhaProvisoria userId={p.userId} rotulo={p.nome} />
                {podeExcluir && (
                  <button
                    type="button"
                    className="px-btn px-btn-ghost"
                    onClick={() => void excluirProfissional(p)}
                  >
                    Excluir
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {detalhe && (
        <CadastroProfissionalDetalhe
          profissional={detalhe}
          conta={contaDetalhe}
          documentos={docsDetalhe}
          onClose={() => setDetalheId(null)}
          onAprovar={async () => {
            const res = await setProfissionalStatus(detalhe.id, 'aprovado')
            if (!res.ok) throw new Error(res.error || 'Não foi possível aprovar.')
          }}
          onRecusar={async (motivo) => {
            const res = await setProfissionalStatus(detalhe.id, 'recusado', { motivoRecusa: motivo })
            if (!res.ok) throw new Error(res.error || 'Não foi possível recusar.')
          }}
        />
      )}
    </div>
  )
}

