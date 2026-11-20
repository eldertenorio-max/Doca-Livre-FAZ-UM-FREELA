import { useMemo, useState } from 'react'
import { ContratoViewer, ContratosList } from '../../components/ContratoViewer'
import {
  DocumentacaoEmpresaPanel,
  DocumentacaoPrestadorResumo,
} from '../../components/DocumentacaoPanel'
import { LevelBadge } from '../../components/LevelBadge'
import { PxSidebar, type PxNavId } from '../../components/PxSidebar'
import { cargoLabel, CATEGORIES } from '../../data/categories'
import { LOGO_DOCA_LIVRE_SRC } from '../../lib/brandAssets'
import { uid } from '../../lib/seed'
import { useStore } from '../../lib/store'
import type { Demanda, Empresa, OperacaoModelo, PerfilIdeal } from '../../lib/types'
import './empresa-px.css'

export function EmpresaApp({ onLogout }: { onLogout: () => void }) {
  const store = useStore()
  const empresa = store.currentEmpresa
  const [section, setSection] = useState<PxNavId>('inicio')
  const [selectedDemandaId, setSelectedDemandaId] = useState<string | null>(null)
  const [showSaldo, setShowSaldo] = useState(true)
  const [contratoAberto, setContratoAberto] = useState<string | null>(null)

  const demandas = useMemo(
    () => store.state.demandas.filter((d) => d.empresaId === empresa?.id),
    [store.state.demandas, empresa?.id],
  )

  if (!empresa) {
    return (
      <div className="auth-screen tema-forcar-claro">
        <div className="auth-card">
          <p>Empresa não encontrada.</p>
          <button type="button" className="btn btn-primary" onClick={onLogout}>Sair</button>
        </div>
      </div>
    )
  }

  function goNova() {
    setSection('nova_demanda')
  }

  function goCandidatos(id: string) {
    setSelectedDemandaId(id)
    setSection('candidatos')
  }

  const selected = demandas.find((d) => d.id === selectedDemandaId) ?? demandas[0] ?? null

  return (
    <div className="px-shell">
      <header className="px-topbar">
        <div className="px-topbar-left">
          <img src={LOGO_DOCA_LIVRE_SRC} alt="Doca Livre" className="px-topbar-logo" />
          <div>
            <strong className="px-topbar-brand">Painel fazumfreela</strong>
            <p className="px-topbar-sub">{empresa.nomeFantasia}</p>
          </div>
        </div>
        <div className="px-topbar-center">
          <div className="px-taxazero">
            <span className="px-taxazero-label">TAXA ZERO</span>
            <div className="px-progress">
              <div
                className="px-progress-bar"
                style={{ width: `${Math.min(100, (empresa.diasTaxaZero / empresa.metaTaxaZero) * 100)}%` }}
              />
            </div>
            <span className="px-taxazero-count">
              {empresa.diasTaxaZero}/{empresa.metaTaxaZero} dias
            </span>
          </div>
        </div>
        <div className="px-topbar-right">
          <div className="px-saldo-box">
            <span>Saldo disponível: <strong>{showSaldo ? `R$ ${empresa.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '••••'}</strong></span>
            <span className="muted">Limite pós-pago: {showSaldo ? `R$ ${empresa.limitePosPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '••••'}</span>
          </div>
          <button type="button" className="px-btn px-btn-primary" onClick={goNova}>
            + Lançar contrato
          </button>
          <button type="button" className="px-bell" title="Notificações">
            🔔<span className="px-bell-badge">{demandas.filter((d) => d.status === 'aberta').length || 1}</span>
          </button>
          <button type="button" className="px-btn px-btn-ghost" onClick={onLogout}>Sair</button>
        </div>
      </header>

      <div className="px-body">
        <PxSidebar active={section === 'nova_demanda' || section === 'candidatos' ? 'contratos' : section} onSelect={setSection} />
        <main className="px-main">
          {section === 'inicio' && (
            <InicioPage
              empresa={empresa}
              showSaldo={showSaldo}
              onToggleSaldo={() => setShowSaldo((v) => !v)}
              onContratar={() => setSection('nova_demanda')}
              onCampanhas={() => setSection('campanhas')}
              onFinancas={() => setSection('financas')}
            />
          )}
          {section === 'contratos' && (
            <ContratosPage
              demandas={demandas}
              onNova={goNova}
              onOpen={goCandidatos}
            />
          )}
          {section === 'nova_demanda' && (
            <NovaDemandaPage
              empresa={empresa}
              onCreated={(id) => goCandidatos(id)}
              onCancel={() => setSection('contratos')}
            />
          )}
          {section === 'candidatos' && selected && (
            <CandidatosPage demanda={selected} empresaId={empresa.id} onBack={() => setSection('contratos')} />
          )}
          {section === 'candidatos' && !selected && (
            <EmptyState title="Nenhum contrato selecionado" text="Lance um contrato para ver candidatos." />
          )}
          {section === 'prestadores' && <PrestadoresPage empresa={empresa} />}
          {section === 'docs_contratos' && (
            <div className="px-page">
              <h1 className="px-title">Documentos contratuais</h1>
              <p className="muted">
                Modelo adaptado do contrato de prestação de serviço via plataforma, com a marca
                Doca Livre fazumfreela. Gerado automaticamente ao confirmar um prestador.
              </p>
              <ContratosList empresaId={empresa.id} onOpen={setContratoAberto} />
            </div>
          )}
          {section === 'docs_empresa' && (
            <div className="px-page">
              <h1 className="px-title">Documentação da empresa</h1>
              <DocumentacaoEmpresaPanel empresa={empresa} />
            </div>
          )}
          {section === 'infracoes' && <InfracoesPage empresaId={empresa.id} />}
          {section === 'sinistros' && <SinistrosPage empresaId={empresa.id} />}
          {section === 'financas' && <FinancasPage empresa={empresa} showSaldo={showSaldo} onToggleSaldo={() => setShowSaldo((v) => !v)} />}
          {section === 'campanhas' && <CampanhasPage onContratar={goNova} empresa={empresa} />}
          {section === 'calculadora' && <CalculadoraPage />}
          {section === 'relatorio_operacional' && <RelatorioPage empresaId={empresa.id} />}
          {section === 'operacoes' && <OperacoesPage empresaId={empresa.id} />}
          {section === 'perfis' && <PerfisPage empresaId={empresa.id} />}
          {section === 'enderecos' && <EnderecosPage empresaId={empresa.id} />}
          {section === 'veiculos' && <VeiculosPage empresaId={empresa.id} />}
        </main>
      </div>
      {contratoAberto && (
        <ContratoViewer contratoId={contratoAberto} onClose={() => setContratoAberto(null)} />
      )}
      <button type="button" className="px-chat-fab" title="Suporte">💬</button>
    </div>
  )
}

function InicioPage({
  empresa,
  showSaldo,
  onToggleSaldo,
  onContratar,
  onCampanhas,
  onFinancas,
}: {
  empresa: Empresa
  showSaldo: boolean
  onToggleSaldo: () => void
  onContratar: () => void
  onCampanhas: () => void
  onFinancas: () => void
}) {
  const saldo = showSaldo ? empresa.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '••••'
  const limite = showSaldo ? empresa.limitePosPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '••••'
  const total = empresa.saldo + empresa.limitePosPago
  const pctSaldo = total > 0 ? (empresa.saldo / total) * 100 : 0

  return (
    <div className="px-page">
      <div className="px-hero-grid">
        <div className="px-card px-hero-hire">
          <div className="px-hero-hire-text">
            <h2>Precisando de um Motorista ou Ajudante?</h2>
            <p>Monte sua equipe operacional em minutos. Publique um contrato e receba profissionais disponíveis próximos.</p>
            <div className="px-hero-actions">
              <button type="button" className="px-btn px-btn-primary px-btn-lg" onClick={onContratar}>
                Contratar Motorista
              </button>
              <button type="button" className="px-btn px-btn-success px-btn-lg" onClick={onContratar}>
                Contratar Ajudante
              </button>
            </div>
          </div>
        </div>
        <div className="px-card">
          <div className="px-card-head">
            <h3>Resumo financeiro</h3>
            <button type="button" className="px-icon-btn" onClick={onToggleSaldo} title="Mostrar/ocultar">
              {showSaldo ? '👁' : '🙈'}
            </button>
          </div>
          <div className="px-finance-bar">
            <div className="px-finance-saldo" style={{ width: `${pctSaldo}%` }} />
            <div className="px-finance-limite" style={{ width: `${100 - pctSaldo}%` }} />
          </div>
          <div className="px-finance-rows">
            <div><span className="muted">Saldo disponível</span><strong>R$ {saldo}</strong></div>
            <div><span className="muted">Limite pós-pago</span><strong>R$ {limite}</strong></div>
          </div>
          <div className="px-hero-actions">
            <button type="button" className="px-btn px-btn-outline" onClick={onFinancas}>Ver extrato</button>
            <button type="button" className="px-btn px-btn-outline" onClick={onFinancas}>Adicionar saldo</button>
            <button type="button" className="px-btn px-btn-primary" onClick={onFinancas}>Pegar pós-pago</button>
          </div>
        </div>
      </div>

      <div className="px-section-head">
        <h3>Campanhas promocionais</h3>
        <button type="button" className="px-link" onClick={onCampanhas}>Ver todas</button>
      </div>
      <div className="px-campaign-row">
        <CampaignCard
          title="TAXA ZERO"
          bullets={[`Média dos últimos 3 meses: 39`, `Dias de serviço: ${empresa.diasTaxaZero}`]}
          onAction={onContratar}
        />
        <CampaignCard
          title="Taxas reduzidas em SP"
          bullets={['Contratos iniciados em São Paulo', 'Válido entre 20/03 e 31/12/2026']}
          highlight="2% de desconto no agenciamento"
          highlightTone="blue"
          onAction={onContratar}
        />
        <CampaignCard
          title="Seleção Automática do perfil ideal"
          bullets={['Seleção Automática de Prestador', 'Válido de 20/03 a 31/12/2026']}
          highlight="2% de Saldo de volta"
          highlightTone="green"
          onAction={onContratar}
        />
      </div>

      <CruzeiroBlock empresa={empresa} onContratar={onContratar} />
    </div>
  )
}

function CampaignCard({
  title,
  bullets,
  highlight,
  highlightTone,
  onAction,
}: {
  title: string
  bullets: string[]
  highlight?: string
  highlightTone?: 'blue' | 'green'
  onAction: () => void
}) {
  return (
    <div className="px-card px-campaign-card">
      <h4>{title}</h4>
      <ul>
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {highlight && (
        <div className={`px-highlight px-highlight--${highlightTone ?? 'blue'}`}>{highlight}</div>
      )}
      <button type="button" className="px-btn px-btn-outline px-btn-block" onClick={onAction}>
        Lançar contrato
      </button>
    </div>
  )
}

function CruzeiroBlock({ empresa, onContratar }: { empresa: Empresa; onContratar: () => void }) {
  return (
    <div className="px-cruzeiro">
      <div className="px-section-head">
        <h3>🏆 Cruzeiro fazumfreela</h3>
        <button type="button" className="px-link">O que é o Cruzeiro?</button>
      </div>
      <div className="px-hero-grid">
        <div className="px-card">
          <div className="px-card-head">
            <strong>Dias agenciados</strong>
            <span className="px-badge-green">O TOP 10 GANHA!</span>
          </div>
          <p className="muted">{empresa.razaoSocial}</p>
          <div className="px-rank-row">
            <strong className="px-rank">TOP {empresa.rankingDias}</strong>
            <span className="px-rank-tip">+{Math.max(0, empresa.rankingDias - 200)} dias para chegar ao TOP 200!</span>
          </div>
          <p className="muted">{empresa.diasAgenciados} dias agenciados</p>
          <button type="button" className="px-btn px-btn-outline" onClick={onContratar}>Lançar contrato</button>
        </div>
        <div className="px-card">
          <div className="px-card-head">
            <strong>TAXA ZERO</strong>
            <span className="px-badge-green">O TOP 10 GANHA!</span>
          </div>
          <div className="px-info-box">
            Comece a acumular saldo pelo Taxa Zero para entrar no ranking!
          </div>
          <button type="button" className="px-btn px-btn-outline px-btn-block" onClick={onContratar}>
            Lançar contrato
          </button>
        </div>
      </div>
      <div className="px-card" style={{ marginTop: 16 }}>
        <h4>Total economizado</h4>
        <p className="px-big-money">R$ {empresa.economiaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        <div className="px-stat-3">
          <div className="px-mini-card">
            <span className="muted">% economizado em agenciamento</span>
            <strong>R$ {empresa.economiaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className="px-mini-card">
            <span className="muted">Saldo de volta recebido</span>
            <strong>—</strong>
          </div>
          <div className="px-mini-card">
            <span className="muted">Contratos em campanhas</span>
            <strong>157</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function ContratosPage({
  demandas,
  onNova,
  onOpen,
}: {
  demandas: Demanda[]
  onNova: () => void
  onOpen: (id: string) => void
}) {
  const { state, cancelDemanda, finishDemanda } = useStore()
  const [tab, setTab] = useState<'em_contratacao' | 'aguardando_gr' | 'em_andamento' | 'em_revisao' | 'finalizados' | 'cancelados'>('em_andamento')
  const [q, setQ] = useState('')

  const counts = {
    em_contratacao: demandas.filter((d) => d.status === 'aberta').length,
    aguardando_gr: 0,
    em_andamento: demandas.filter((d) => d.status === 'em_andamento').length,
    em_revisao: demandas.filter((d) => {
      if (d.status !== 'aberta') return false
      return state.candidaturas.some((c) => c.demandaId === d.id && c.status === 'aceita')
    }).length,
    finalizados: demandas.filter((d) => d.status === 'finalizada').length,
    cancelados: demandas.filter((d) => d.status === 'cancelada').length,
  }

  const filtered = demandas.filter((d) => {
    if (tab === 'em_contratacao') return d.status === 'aberta'
    if (tab === 'aguardando_gr') return false
    if (tab === 'em_andamento') return d.status === 'em_andamento'
    if (tab === 'em_revisao') {
      return d.status === 'aberta' && state.candidaturas.some((c) => c.demandaId === d.id && c.status === 'aceita')
    }
    if (tab === 'finalizados') return d.status === 'finalizada'
    if (tab === 'cancelados') return d.status === 'cancelada'
    return true
  }).filter((d) => !q || cargoLabel(d.cargo).toLowerCase().includes(q.toLowerCase()) || d.descricao.toLowerCase().includes(q.toLowerCase()))

  const comCand = demandas.filter((d) => state.candidaturas.some((c) => c.demandaId === d.id)).length
  const semCand = demandas.length - comCand

  return (
    <div className="px-page">
      <h1 className="px-title">Contratos</h1>
      <div className="px-tabs">
        {(
          [
            ['em_contratacao', 'Em contratação', counts.em_contratacao],
            ['aguardando_gr', 'Aguardando GR', counts.aguardando_gr],
            ['em_andamento', 'Em andamento', counts.em_andamento],
            ['em_revisao', 'Em revisão', counts.em_revisao],
            ['finalizados', 'Finalizados', counts.finalizados],
            ['cancelados', 'Cancelados', counts.cancelados],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            className={`px-tab ${tab === id ? 'px-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label} ({n})
          </button>
        ))}
      </div>

      <div className="px-metric-row">
        <MetricCard icon="⏱" label="Expirados" value={0} tone="red" />
        <MetricCard icon="📅" label="Iniciam em 24h" value={0} tone="red" />
        <MetricCard icon="👤" label="Com candidatos" value={comCand} tone="green" />
        <MetricCard icon="🚫" label="Sem candidatos" value={semCand} tone="yellow" />
      </div>

      <div className="px-toolbar">
        <input className="px-input" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-btn px-btn-ghost">Agrupar por: Status ▾</button>
        <button type="button" className="px-btn px-btn-ghost">Filtros</button>
        <button type="button" className="px-btn px-btn-outline" onClick={onNova}>+ Lançar contrato</button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Nenhum resultado encontrado" text="Tente novamente mais tarde" />
      ) : (
        <ul className="px-list">
          {filtered.map((d) => (
            <li key={d.id} className="px-list-card">
              <div>
                <strong>{cargoLabel(d.cargo)}</strong>
                <p className="muted">{d.data} {d.horaInicio}–{d.horaFim} · {d.endereco.cidade} · R$ {d.valorDiaria}</p>
              </div>
              <div className="px-row-actions">
                <span className={`px-status px-status--${d.status}`}>{d.status.replace('_', ' ')}</span>
                <button type="button" className="px-btn px-btn-outline" onClick={() => onOpen(d.id)}>Candidatos</button>
                {d.status !== 'finalizada' && d.status !== 'cancelada' && (
                  <>
                    <button type="button" className="px-btn px-btn-ghost" onClick={() => finishDemanda(d.id)}>Finalizar</button>
                    <button type="button" className="px-btn px-btn-ghost" onClick={() => cancelDemanda(d.id)}>Cancelar</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className="px-card px-metric">
      <span className={`px-metric-ico px-metric-ico--${tone}`}>{icon}</span>
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  )
}

function NovaDemandaPage({
  empresa,
  onCreated,
  onCancel,
}: {
  empresa: Empresa
  onCreated: (id: string) => void
  onCancel: () => void
}) {
  const { createDemanda } = useStore()
  const [cargo, setCargo] = useState('motorista_truck')
  const [quantidade, setQuantidade] = useState(1)
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [horaInicio, setHoraInicio] = useState('08:00')
  const [horaFim, setHoraFim] = useState('18:00')
  const [valor, setValor] = useState(280)
  const [descricao, setDescricao] = useState('')
  const [epis, setEpis] = useState('Capacete, colete, botina')
  const requisitos = CATEGORIES.flatMap((c) => c.cargos).find((c) => c.id === cargo)?.requisitos ?? []

  return (
    <div className="px-page">
      <h1 className="px-title">Lançar contrato</h1>
      <div className="px-card">
        <div className="px-form-grid">
          <label className="px-field">
            <span>Tipo de profissional</span>
            <select value={cargo} onChange={(e) => setCargo(e.target.value)}>
              {CATEGORIES.map((cat) => (
                <optgroup key={cat.id} label={cat.label}>
                  {cat.cargos.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="px-field"><span>Quantidade</span><input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} /></label>
          <label className="px-field"><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label className="px-field"><span>Início</span><input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} /></label>
          <label className="px-field"><span>Fim</span><input type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} /></label>
          <label className="px-field"><span>Diária (R$)</span><input type="number" value={valor} onChange={(e) => setValor(Number(e.target.value))} /></label>
          <label className="px-field px-field--full"><span>Descrição</span><textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          <label className="px-field px-field--full"><span>EPIs</span><input value={epis} onChange={(e) => setEpis(e.target.value)} /></label>
        </div>
        <p className="muted">Local: {empresa.endereco.cidade}/{empresa.endereco.estado}</p>
        {requisitos.length > 0 && <p className="muted">Requisitos: {requisitos.join(', ')}</p>}
        <div className="px-row-actions">
          <button type="button" className="px-btn px-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            className="px-btn px-btn-primary"
            onClick={() => {
              const dem = createDemanda({
                empresaId: empresa.id,
                cargo,
                quantidade,
                data,
                horaInicio,
                horaFim,
                endereco: empresa.endereco,
                valorDiaria: valor,
                descricao,
                epis,
                observacoes: '',
                requisitos,
              })
              onCreated(dem.id)
            }}
          >
            Publicar contrato
          </button>
        </div>
      </div>
    </div>
  )
}

function CandidatosPage({ demanda, empresaId, onBack }: { demanda: Demanda; empresaId: string; onBack: () => void }) {
  const { state, confirmCandidato, refuseCandidato, toggleFavorito } = useStore()
  const empresa = state.empresas.find((e) => e.id === empresaId)
  const [contratoAberto, setContratoAberto] = useState<string | null>(null)
  const cands = state.candidaturas.filter((c) => c.demandaId === demanda.id).sort((a, b) => b.score - a.score)

  return (
    <div className="px-page">
      <button type="button" className="px-link" onClick={onBack}>← Voltar aos contratos</button>
      <h1 className="px-title">Candidatos — {cargoLabel(demanda.cargo)}</h1>
      <ul className="px-list">
        {cands.map((c, idx) => {
          const p = state.profissionais.find((x) => x.id === c.profissionalId)
          if (!p) return null
          const contrato = state.contratos.find((ct) => ct.candidaturaId === c.id)
          return (
            <li key={c.id} className="px-list-card">
              <div>
                <strong>{idx + 1}º {p.nome}</strong>
                <p className="muted">★ {p.avaliacaoMedia.toFixed(1)} · {c.distanciaKm} km · score {c.score}%</p>
                <LevelBadge nivel={p.nivel} />
                <DocumentacaoPrestadorResumo profissional={p} requisitos={demanda.requisitos} />
              </div>
              <div className="px-row-actions">
                <span className={`px-status px-status--${c.status}`}>{c.status}</span>
                {(c.status === 'aceita' || c.status === 'pendente') && (
                  <>
                    <button
                      type="button"
                      className="px-btn px-btn-primary"
                      onClick={() => {
                        confirmCandidato(c.id)
                      }}
                    >
                      Aceitar e gerar contrato
                    </button>
                    <button type="button" className="px-btn px-btn-ghost" onClick={() => refuseCandidato(c.id)}>Recusar</button>
                  </>
                )}
                {contrato && (
                  <button type="button" className="px-btn px-btn-outline" onClick={() => setContratoAberto(contrato.id)}>
                    Ver contrato #{contrato.numero}
                  </button>
                )}
                <button type="button" className="px-btn px-btn-ghost" onClick={() => toggleFavorito(empresaId, p.id)}>
                  {empresa?.favoritos.includes(p.id) ? '♥ Favorito' : '♡ Favoritar'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {cands.length === 0 && <EmptyState title="Sem candidatos" text="O matching não encontrou profissionais compatíveis." />}
      {contratoAberto && (
        <ContratoViewer contratoId={contratoAberto} onClose={() => setContratoAberto(null)} />
      )}
    </div>
  )
}

function PrestadoresPage({ empresa }: { empresa: Empresa }) {
  const { state, toggleFavorito, toggleBloqueado } = useStore()
  const [tab, setTab] = useState<'favoritos' | 'bloqueados'>('favoritos')
  const [cat, setCat] = useState<'todos' | 'motorista' | 'ajudante'>('todos')
  const [q, setQ] = useState('')

  const ids = tab === 'favoritos' ? empresa.favoritos : empresa.bloqueados
  let list = state.profissionais.filter((p) => ids.includes(p.id))
  if (cat === 'motorista') list = list.filter((p) => p.profissoes.some((x) => x.includes('motorista') || x.includes('carret') || x.includes('bitrem') || x.includes('mopp')))
  if (cat === 'ajudante') list = list.filter((p) => !p.profissoes.some((x) => x.includes('motorista') || x.includes('carret')))
  if (q) list = list.filter((p) => p.nome.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="px-page">
      <h1 className="px-title">Prestadores</h1>
      <div className="px-tabs">
        <button type="button" className={`px-tab ${tab === 'favoritos' ? 'px-tab--active' : ''}`} onClick={() => setTab('favoritos')}>Favoritos</button>
        <button type="button" className={`px-tab ${tab === 'bloqueados' ? 'px-tab--active' : ''}`} onClick={() => setTab('bloqueados')}>
          Bloqueados <span className="px-count-pill">{empresa.bloqueados.length}</span>
        </button>
      </div>
      <div className="px-pills">
        <button type="button" className={`px-pill ${cat === 'motorista' ? 'px-pill--on' : ''}`} onClick={() => setCat('motorista')}>Motoristas</button>
        <button type="button" className={`px-pill ${cat === 'ajudante' ? 'px-pill--on' : ''}`} onClick={() => setCat('ajudante')}>Ajudantes</button>
        <button type="button" className={`px-pill ${cat === 'todos' ? 'px-pill--on' : ''}`} onClick={() => setCat('todos')}>Todos</button>
      </div>
      <div className="px-toolbar">
        <select className="px-input"><option>Tipo de curso:</option><option>NR11</option><option>MOPP</option></select>
        <select className="px-input"><option>Tipo de veículo:</option><option>VUC</option><option>Truck</option></select>
        <input className="px-input" placeholder="Pesquisar por nome" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar</button>
        <button type="button" className="px-btn px-btn-primary">Adicionar favoritos</button>
      </div>
      <div className="px-provider-grid">
        {list.map((p) => (
          <div key={p.id} className="px-card px-provider-card">
            <span className={`px-rank-pill px-rank-pill--${p.nivel}`}>
              Ranking: {p.nivel.charAt(0).toUpperCase() + p.nivel.slice(1)}
            </span>
            <div className="px-avatar">👤</div>
            <p className="px-rating">★ {p.avaliacaoMedia.toFixed(2).replace('.', ',')} ({Math.round(p.taxaComparecimento)})</p>
            <strong>{p.nome}</strong>
            <p className="muted">📍 {p.endereco.cidade}, {p.endereco.estado}</p>
            <div className="px-tags">
              <span className="px-tag px-tag--green">✓ Verificado</span>
              <span className="px-tag">{p.disponibilidade.hoje ? 'Disponível' : 'Indisponível'}</span>
            </div>
            <div className="px-row-actions">
              <button type="button" className="px-icon-btn" onClick={() => toggleFavorito(empresa.id, p.id)}>♥</button>
              <button type="button" className="px-btn px-btn-outline">Ver perfil</button>
              {tab === 'bloqueados' && (
                <button type="button" className="px-btn px-btn-ghost" onClick={() => toggleBloqueado(empresa.id, p.id)}>Desbloquear</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && <EmptyState title="Nenhum prestador nesta lista" text="Favorite profissionais a partir dos candidatos." />}
    </div>
  )
}

function InfracoesPage({ empresaId }: { empresaId: string }) {
  const { state, patchState } = useStore()
  const [q, setQ] = useState('')
  const list = state.infracoes.filter((i) => i.empresaId === empresaId && (!q || i.palavraChave.includes(q) || i.titulo.includes(q)))

  return (
    <div className="px-page">
      <h1 className="px-title">Infrações</h1>
      <p className="px-breadcrumb">Ocorrências &gt; Infrações</p>
      <div className="px-toolbar">
        <input className="px-input" placeholder="Pesquise por uma palavra-chave" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="px-input" type="date" aria-label="Data inicial" />
        <input className="px-input" type="date" aria-label="Data final" />
        <select className="px-input"><option>Status</option><option>Aberta</option><option>Em análise</option><option>Encerrada</option></select>
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar</button>
        <button
          type="button"
          className="px-btn px-btn-primary"
          onClick={() =>
            patchState((s) => ({
              ...s,
              infracoes: [
                {
                  id: uid('inf'),
                  empresaId,
                  titulo: 'Nova infração',
                  status: 'aberta',
                  data: new Date().toISOString().slice(0, 10),
                  palavraChave: 'infracao',
                },
                ...s.infracoes,
              ],
            }))
          }
        >
          Cadastrar infração
        </button>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Não há nada por aqui ainda." text="" />
      ) : (
        <ul className="px-list">
          {list.map((i) => (
            <li key={i.id} className="px-list-card">
              <div><strong>{i.titulo}</strong><p className="muted">{i.data}</p></div>
              <span className="px-status">{i.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SinistrosPage({ empresaId }: { empresaId: string }) {
  const { state } = useStore()
  const [q, setQ] = useState('')
  const list = state.sinistros.filter((i) => i.empresaId === empresaId && (!q || i.palavraChave.includes(q) || i.titulo.includes(q)))

  return (
    <div className="px-page">
      <h1 className="px-title">Sinistros</h1>
      <p className="px-breadcrumb">Ocorrências &gt; Sinistros</p>
      <div className="px-toolbar">
        <input className="px-input" placeholder="Pesquise por uma palavra-chave" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="px-input" type="date" aria-label="Data inicial" />
        <input className="px-input" type="date" aria-label="Data final" />
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar</button>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Não há nada por aqui ainda." text="" />
      ) : (
        <ul className="px-list">
          {list.map((i) => (
            <li key={i.id} className="px-list-card">
              <div><strong>{i.titulo}</strong><p className="muted">{i.data}</p></div>
              <span className="px-status">{i.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FinancasPage({ empresa, showSaldo, onToggleSaldo }: { empresa: Empresa; showSaldo: boolean; onToggleSaldo: () => void }) {
  const { state } = useStore()
  const pags = state.pagamentos.filter((p) => p.empresaId === empresa.id)

  return (
    <div className="px-page">
      <h1 className="px-title">Finanças</h1>
      <div className="px-card">
        <div className="px-card-head">
          <h3>Resumo</h3>
          <button type="button" className="px-icon-btn" onClick={onToggleSaldo}>{showSaldo ? '👁' : '🙈'}</button>
        </div>
        <div className="px-stat-3">
          <div className="px-mini-card"><span className="muted">Saldo</span><strong>R$ {showSaldo ? empresa.saldo.toFixed(2) : '••••'}</strong></div>
          <div className="px-mini-card"><span className="muted">Limite pós-pago</span><strong>R$ {showSaldo ? empresa.limitePosPago.toFixed(2) : '••••'}</strong></div>
          <div className="px-mini-card"><span className="muted">Economia total</span><strong>R$ {empresa.economiaTotal.toFixed(2)}</strong></div>
        </div>
        <div className="px-row-actions" style={{ marginTop: 12 }}>
          <button type="button" className="px-btn px-btn-outline">Ver extrato</button>
          <button type="button" className="px-btn px-btn-outline">Adicionar saldo</button>
          <button type="button" className="px-btn px-btn-primary">Pegar pós-pago</button>
        </div>
      </div>
      <h3>Extrato de diárias</h3>
      <ul className="px-list">
        {pags.map((p) => (
          <li key={p.id} className="px-list-card">
            <span>R$ {p.valor}</span>
            <span className="muted">comissão R$ {p.comissao} · {p.status}</span>
          </li>
        ))}
        {pags.length === 0 && <EmptyState title="Sem lançamentos" text="Finalize contratos para gerar extrato." />}
      </ul>
    </div>
  )
}

function CampanhasPage({ onContratar, empresa }: { onContratar: () => void; empresa: Empresa }) {
  return (
    <div className="px-page">
      <h1 className="px-title">Campanhas promocionais</h1>
      <div className="px-campaign-row">
        <CampaignCard title="TAXA ZERO" bullets={[`Dias: ${empresa.diasTaxaZero}/${empresa.metaTaxaZero}`]} onAction={onContratar} />
        <CampaignCard title="Taxas reduzidas SP" bullets={['Curtas e Ajudantes', 'Até 31/12/2026']} highlight="2% de desconto" highlightTone="blue" onAction={onContratar} />
        <CampaignCard title="Seleção Automática" bullets={['Perfil ideal', 'Cashback 2%']} highlight="2% de Saldo de volta" highlightTone="green" onAction={onContratar} />
      </div>
      <CruzeiroBlock empresa={empresa} onContratar={onContratar} />
      <div className="px-card" style={{ marginTop: 16 }}>
        <div className="px-card-head"><strong>% Desconto no agenciamento</strong><span>⌃</span></div>
        <div className="px-table">
          <div className="px-table-head">
            <span>Campanha</span><span>Tipo</span><span>Desconto</span><span>Período</span><span>Contratos</span><span>Economia</span>
          </div>
          <div className="px-table-row">
            <span>Taxas reduzidas em SP</span>
            <span><span className="px-tag">Ajudante</span> <span className="px-tag">Coleta e Entrega</span></span>
            <span className="px-tag px-tag--blue">2%</span>
            <span>20/03 a 31/12/2026</span>
            <span>157</span>
            <span className="px-money">R$ 655,90</span>
          </div>
        </div>
      </div>
      <div className="px-card" style={{ marginTop: 16 }}>
        <div className="px-card-head"><strong>Saldo de volta</strong><span>⌃</span></div>
        <EmptyState title="Você ainda não participou de uma campanha" text="Quando participar, os resultados aparecerão aqui." />
      </div>
    </div>
  )
}

function CalculadoraPage() {
  const [diaria, setDiaria] = useState(250)
  const [dias, setDias] = useState(20)
  const taxa = 0.12
  const bruto = diaria * dias
  const agenciamento = bruto * taxa
  const liquido = bruto + agenciamento

  return (
    <div className="px-page">
      <h1 className="px-title">Calculadora</h1>
      <div className="px-card" style={{ maxWidth: 480 }}>
        <label className="px-field"><span>Valor da diária</span><input type="number" value={diaria} onChange={(e) => setDiaria(Number(e.target.value))} /></label>
        <label className="px-field"><span>Quantidade de dias</span><input type="number" value={dias} onChange={(e) => setDias(Number(e.target.value))} /></label>
        <div className="px-stat-3" style={{ marginTop: 16 }}>
          <div className="px-mini-card"><span className="muted">Bruto</span><strong>R$ {bruto.toFixed(2)}</strong></div>
          <div className="px-mini-card"><span className="muted">Agenciamento 12%</span><strong>R$ {agenciamento.toFixed(2)}</strong></div>
          <div className="px-mini-card"><span className="muted">Total estimado</span><strong>R$ {liquido.toFixed(2)}</strong></div>
        </div>
      </div>
    </div>
  )
}

function RelatorioPage({ empresaId }: { empresaId: string }) {
  const { state, patchState } = useStore()
  const [tipo, setTipo] = useState('')
  const hist = state.relatorios.filter((r) => r.empresaId === empresaId)

  return (
    <div className="px-page">
      <h1 className="px-title">Relatório operacional</h1>
      <div className="px-card">
        <div className="px-toolbar" style={{ marginBottom: 0 }}>
          <label className="px-field"><span>Relatório de</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Selecione</option>
              <option>Contratos</option>
              <option>Prestadores</option>
              <option>Financeiro</option>
            </select>
          </label>
          <label className="px-field"><span>Período</span><input type="text" placeholder="DD/MM/AAAA → DD/MM/AAAA" /></label>
          <label className="px-field"><span>Operação (opcional)</span><select><option>Selecione</option></select></label>
          <button
            type="button"
            className="px-btn px-btn-primary"
            onClick={() => {
              if (!tipo) return
              patchState((s) => ({
                ...s,
                relatorios: [
                  { id: uid('rel'), empresaId, tipo, periodo: 'últimos 30 dias', createdAt: new Date().toISOString() },
                  ...s.relatorios,
                ],
              }))
            }}
          >
            Gerar relatório
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>O período de seleção é limitado a 1 ano.</p>
      </div>
      <h3>Histórico de relatórios</h3>
      <p className="muted">Relatórios solicitados nos últimos 30 dias</p>
      {hist.length === 0 ? (
        <EmptyState title="Nenhum relatório gerado" text="Configure os filtros acima e clique em Gerar relatório para começar." />
      ) : (
        <ul className="px-list">
          {hist.map((r) => (
            <li key={r.id} className="px-list-card">
              <strong>{r.tipo}</strong>
              <span className="muted">{r.periodo} · {new Date(r.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OperacoesPage({ empresaId }: { empresaId: string }) {
  const { state, patchState } = useStore()
  const [cat, setCat] = useState<'motorista' | 'ajudante' | 'todos'>('todos')
  const [q, setQ] = useState('')
  let list = state.operacoes.filter((o) => o.empresaId === empresaId)
  if (cat !== 'todos') list = list.filter((o) => o.categoria === cat)
  if (q) list = list.filter((o) => o.titulo.toLowerCase().includes(q.toLowerCase()))
  const nMot = state.operacoes.filter((o) => o.empresaId === empresaId && o.categoria === 'motorista').length
  const nAj = state.operacoes.filter((o) => o.empresaId === empresaId && o.categoria === 'ajudante').length

  function remove(id: string) {
    patchState((s) => ({ ...s, operacoes: s.operacoes.filter((o) => o.id !== id) }))
  }

  function add() {
    const nova: OperacaoModelo = {
      id: uid('op'),
      empresaId,
      tipoContrato: 'Motorista - Curtas Distâncias',
      perfilIdeal: 'Possui',
      titulo: 'NOVA OPERAÇÃO',
      tipoOperacao: 'Carga Geral',
      categoria: 'motorista',
    }
    patchState((s) => ({ ...s, operacoes: [nova, ...s.operacoes] }))
  }

  return (
    <div className="px-page">
      <h1 className="px-title">Operações</h1>
      <div className="px-toolbar">
        <button type="button" className={`px-pill ${cat === 'motorista' ? 'px-pill--on' : ''}`} onClick={() => setCat('motorista')}>
          Motorista <span className="px-count-pill">{nMot}</span>
        </button>
        <button type="button" className={`px-pill ${cat === 'ajudante' ? 'px-pill--on' : ''}`} onClick={() => setCat('ajudante')}>
          Ajudante <span className="px-count-pill">{nAj}</span>
        </button>
        <input className="px-input" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar</button>
        <button type="button" className="px-btn px-btn-primary" onClick={add}>+ Adicionar nova operação</button>
      </div>
      <ul className="px-list">
        {list.map((o) => (
          <li key={o.id} className="px-list-card px-op-card">
            <div className="px-op-cols">
              <div><span className="muted">ID</span><strong>{o.id.slice(-4)}</strong></div>
              <div><span className="muted">Tipo de contrato</span><strong>{o.tipoContrato}</strong></div>
              <div><span className="muted">Perfil ideal</span><strong>{o.perfilIdeal}</strong></div>
              <div><span className="muted">Título</span><strong>{o.titulo}</strong></div>
              <div><span className="muted">Tipo de operação</span><strong>{o.tipoOperacao || '—'}</strong></div>
            </div>
            <div className="px-row-actions">
              <button type="button" className="px-btn px-btn-outline">Editar operação</button>
              <button type="button" className="px-icon-btn px-danger" onClick={() => remove(o.id)}>🗑</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PerfisPage({ empresaId }: { empresaId: string }) {
  const { state, patchState } = useStore()
  const [tab, setTab] = useState<'motorista' | 'ajudante'>('motorista')
  const [q, setQ] = useState('')
  const list = state.perfisIdeais
    .filter((p) => p.empresaId === empresaId && p.categoria === tab)
    .filter((p) => !q || p.nome.toLowerCase().includes(q.toLowerCase()))
  const nMot = state.perfisIdeais.filter((p) => p.empresaId === empresaId && p.categoria === 'motorista').length
  const nAj = state.perfisIdeais.filter((p) => p.empresaId === empresaId && p.categoria === 'ajudante').length

  function toggleAuto(id: string) {
    patchState((s) => ({
      ...s,
      perfisIdeais: s.perfisIdeais.map((p) =>
        p.id === id ? { ...p, selecaoAutomatica: !p.selecaoAutomatica } : p,
      ),
    }))
  }

  function remove(id: string) {
    patchState((s) => ({ ...s, perfisIdeais: s.perfisIdeais.filter((p) => p.id !== id) }))
  }

  function add() {
    const novo: PerfilIdeal = {
      id: uid('pi'),
      empresaId,
      nome: 'NOVO PERFIL',
      operacao: '—',
      categoria: tab,
      selecaoAutomatica: false,
    }
    patchState((s) => ({ ...s, perfisIdeais: [novo, ...s.perfisIdeais] }))
  }

  return (
    <div className="px-page">
      <h1 className="px-title">Perfis ideais</h1>
      <div className="px-tabs">
        <button type="button" className={`px-tab ${tab === 'motorista' ? 'px-tab--active' : ''}`} onClick={() => setTab('motorista')}>Motorista {nMot}</button>
        <button type="button" className={`px-tab ${tab === 'ajudante' ? 'px-tab--active' : ''}`} onClick={() => setTab('ajudante')}>Ajudante {nAj}</button>
      </div>
      <div className="px-toolbar">
        <input className="px-input" placeholder="Pesquisar:" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar pesquisa</button>
        <button type="button" className="px-btn px-btn-outline" onClick={add}>Adicionar perfil ideal</button>
      </div>
      <ul className="px-list">
        {list.map((p) => (
          <li key={p.id} className="px-list-card px-op-card">
            <div className="px-op-cols">
              <div><span className="muted">Nome</span><strong>{p.nome}</strong></div>
              <div><span className="muted">Operação</span><strong>{p.operacao}</strong></div>
              <div>
                <span className="muted">Seleção automática</span>
                <button type="button" className={`px-switch ${p.selecaoAutomatica ? 'px-switch--on' : ''}`} onClick={() => toggleAuto(p.id)} />
              </div>
            </div>
            <div className="px-row-actions">
              <button type="button" className="px-icon-btn">👁</button>
              <button type="button" className="px-icon-btn">✎</button>
              <button type="button" className="px-icon-btn px-danger" onClick={() => remove(p.id)}>🗑</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EnderecosPage({ empresaId }: { empresaId: string }) {
  const { state, patchState } = useStore()
  const [q, setQ] = useState('')
  const list = state.enderecosEmpresa
    .filter((e) => e.empresaId === empresaId)
    .filter((e) => !q || e.nome.toLowerCase().includes(q.toLowerCase()) || e.cidade.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="px-page">
      <h1 className="px-title">Endereços</h1>
      <div className="px-toolbar">
        <input className="px-input" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar</button>
        <button
          type="button"
          className="px-btn px-btn-primary"
          onClick={() =>
            patchState((s) => ({
              ...s,
              enderecosEmpresa: [
                { id: uid('end'), empresaId, nome: 'Novo endereço', rua: 'Rua Exemplo', cidade: 'São Paulo', uf: 'SP' },
                ...s.enderecosEmpresa,
              ],
            }))
          }
        >
          Adicionar endereço
        </button>
      </div>
      <ul className="px-list">
        {list.map((e) => (
          <li key={e.id} className="px-list-card px-op-card">
            <div className="px-op-cols">
              <div><span className="muted">ID</span><strong>{e.id.slice(-5)}</strong></div>
              <div><span className="muted">Nome do endereço</span><strong>{e.nome}</strong></div>
              <div><span className="muted">Endereço</span><strong>{e.rua}</strong></div>
              <div><span className="muted">Cidade/UF</span><strong>{e.cidade} - {e.uf}</strong></div>
            </div>
            <div className="px-row-actions">
              <button type="button" className="px-sq-btn">✎</button>
              <button
                type="button"
                className="px-sq-btn px-danger"
                onClick={() => patchState((s) => ({ ...s, enderecosEmpresa: s.enderecosEmpresa.filter((x) => x.id !== e.id) }))}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function VeiculosPage({ empresaId }: { empresaId: string }) {
  const { state, patchState } = useStore()
  const [q, setQ] = useState('')
  const list = state.veiculos
    .filter((v) => v.empresaId === empresaId)
    .filter((v) => !q || v.placa.toLowerCase().includes(q.toLowerCase()) || v.marca.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="px-page">
      <h1 className="px-title">Veículos</h1>
      <div className="px-toolbar">
        <input className="px-input" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-link" onClick={() => setQ('')}>Limpar</button>
        <button
          type="button"
          className="px-btn px-btn-primary"
          onClick={() =>
            patchState((s) => ({
              ...s,
              veiculos: [
                { id: uid('vei'), empresaId, marca: 'NOVA MARCA', modelo: 'MODELO', ano: '2024', placa: 'ABC-0000' },
                ...s.veiculos,
              ],
            }))
          }
        >
          Adicionar veículo
        </button>
      </div>
      <ul className="px-list">
        {list.map((v) => (
          <li key={v.id} className="px-list-card px-op-card">
            <div className="px-op-cols">
              <div><span className="muted">Marca</span><strong>{v.marca}</strong></div>
              <div><span className="muted">Modelo</span><strong>{v.modelo}</strong></div>
              <div><span className="muted">Ano</span><strong>{v.ano}</strong></div>
              <div><span className="muted">Placa</span><strong>{v.placa}</strong></div>
            </div>
            <div className="px-row-actions">
              <button type="button" className="px-sq-btn">✎</button>
              <button
                type="button"
                className="px-icon-btn px-danger"
                onClick={() => patchState((s) => ({ ...s, veiculos: s.veiculos.filter((x) => x.id !== v.id) }))}
              >
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-empty">
      <div className="px-empty-art">📋</div>
      <strong>{title}</strong>
      {text && <p className="muted">{text}</p>}
    </div>
  )
}
