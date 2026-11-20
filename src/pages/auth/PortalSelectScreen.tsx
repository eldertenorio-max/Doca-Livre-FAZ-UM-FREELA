import { useState } from 'react'
import { AplicativoJanela } from '../../components/AplicativoCelular'
import { estaNoApp } from '../../lib/aplicativo'
import { LOGO_DOCA_LIVRE_SRC, BRAND_SLOGAN } from '../../lib/brandAssets'
import { emDemo, trocarModo } from '../../lib/modo'
import './PortalSelectScreen.css'

function linkDeDemonstracao() {
  try {
    return new URLSearchParams(window.location.search).has('demo')
  } catch {
    return false
  }
}

type Props = {
  onEmpresa: () => void
  onProfissional: () => void
  onAdmin: () => void
}

export function PortalSelectScreen({ onEmpresa, onProfissional, onAdmin }: Props) {
  const [verApp, setVerApp] = useState(false)
  return (
    <div className="portal-select tema-forcar-claro">
      <div className="portal-select__inner">
        <img src={LOGO_DOCA_LIVRE_SRC} alt="Doca Livre" className="portal-select__logo" />
        <h1 className="portal-select__brand">fazumfreela</h1>
        <p className="portal-select__slogan">{BRAND_SLOGAN}</p>

        <div className="portal-select__grid">
          <button type="button" className="portal-select__card" onClick={onEmpresa}>
            <span className="portal-select__card-kicker">Quero contratar</span>
            <strong className="portal-select__card-title">Empresa</strong>
            <span className="portal-select__card-desc">
              Publique demandas, gerencie prestadores, contratos e financeiro.
            </span>
          </button>
          <button type="button" className="portal-select__card" onClick={onProfissional}>
            <span className="portal-select__card-kicker">Quero trabalhar</span>
            <strong className="portal-select__card-title">Trabalhador</strong>
            <span className="portal-select__card-desc">
              Encontre oportunidades, agenda, documentos e pagamentos.
            </span>
          </button>
        </div>

        {/* O app Android substitui a instalação pelo Chrome. Dentro do app, o link some. */}
        {!estaNoApp() && (
          <button type="button" className="portal-select__app" onClick={() => setVerApp(true)}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="6.5" y="2.75" width="11" height="18.5" rx="2.2" stroke="currentColor" strokeWidth="1.75" />
              <path d="M10.5 18h3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            Baixar o aplicativo para Android
          </button>
        )}

        <button type="button" className="portal-select__admin" onClick={onAdmin}>
          Acesso Admin / Superusuário
        </button>

        {emDemo() ? (
          <button type="button" className="portal-select__demo" onClick={() => trocarModo('real')}>
            Sair da demonstração e voltar ao sistema real
          </button>
        ) : (
          // Fechado para o público desde a abertura dos cadastros (12/11/2026): a demonstração
          // só aparece para quem abre o site com ?demo no endereço (fazumfreela.com.br/?demo).
          linkDeDemonstracao() && (
            <button type="button" className="portal-select__demo" onClick={() => trocarModo('demo')}>
              Ver demonstração (dados fictícios, só neste aparelho)
            </button>
          )
        )}
      </div>
      {verApp && <AplicativoJanela onFechar={() => setVerApp(false)} />}
    </div>
  )
}
