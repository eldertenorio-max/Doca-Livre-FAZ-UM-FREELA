import { useCallback, useEffect, useState } from 'react'
import { IntroSplash } from './components/IntroSplash'
import { AppDoNavegadorDesativado } from './components/AplicativoCelular'
import { abertoComoAppDoNavegador } from './lib/aplicativo'
import { emDemo, trocarModo } from './lib/modo'
import './pages/auth/PortalSelectScreen.css'
import { StoreProvider, avisoAcessoEmpresa, avisoAcessoProfissional, useStore } from './lib/store'
import { AdminApp } from './pages/admin/AdminApp'
import { CadastroEmpresaScreen } from './pages/auth/CadastroEmpresaScreen'
import { CadastroProfissionalScreen } from './pages/auth/CadastroProfissionalScreen'
import { PortalConfigScreen } from './pages/auth/PortalConfigScreen'
import { PortalLoginScreen } from './pages/auth/PortalLoginScreen'
import { PortalSelectScreen } from './pages/auth/PortalSelectScreen'
import { ContratarFreelancer } from './pages/empresa/ContratarFreelancer'
import { ProfissionalApp } from './pages/profissional/ProfissionalApp'
import './App.css'

type PortalTipo = 'empresa' | 'profissional' | 'admin'

type Gate =
  | 'splash'
  | 'select'
  | 'login'
  | 'config'
  | 'cadastro_empresa'
  | 'cadastro_profissional'
  | 'app'

const PORTAL_SESSION_KEY = 'mao-portal-ativo'

function readPortal(): PortalTipo | null {
  try {
    const v = sessionStorage.getItem(PORTAL_SESSION_KEY)
    if (v === 'empresa' || v === 'profissional' || v === 'admin') return v
  } catch {
    /* ignore */
  }
  return null
}

function writePortal(p: PortalTipo) {
  try {
    sessionStorage.setItem(PORTAL_SESSION_KEY, p)
  } catch {
    /* ignore */
  }
}

function portalFromUser(role: string | undefined): PortalTipo {
  if (role === 'profissional') return 'profissional'
  if (role === 'empresa') return 'empresa'
  return 'admin'
}

function AppRoutes() {
  const store = useStore()
  const { currentUser, currentProfissional, currentEmpresa, logout, login } = store
  const [portal, setPortal] = useState<PortalTipo>(
    () => readPortal() ?? portalFromUser(currentUser?.role),
  )
  const [gate, setGate] = useState<Gate>(() => (currentUser ? 'app' : 'splash'))
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null)

  const finishSplash = useCallback(() => {
    if (currentUser) {
      const p = readPortal() ?? portalFromUser(currentUser.role)
      setPortal(p)
      writePortal(p)
      setGate('app')
      return
    }
    setGate('select')
  }, [currentUser])

  // Sessão presa sem perfil do portal → demo ou cadastro
  useEffect(() => {
    if (gate !== 'app' || !currentUser) return

    if (portal === 'profissional' && !currentProfissional) {
      if (currentUser.role === 'profissional') {
        setGate('cadastro_profissional')
        return
      }
      logout()
      setGate('select')
      return
    }

    if (portal === 'empresa' && !currentEmpresa) {
      if (currentUser.role === 'empresa') {
        setGate('cadastro_empresa')
        return
      }
      // Só na demonstração o gestor abre a empresa de exemplo. No sistema real isso dava a
      // qualquer admin a sessão de uma empresa com senha publicada.
      if (!emDemo()) {
        logout()
        setGate('select')
        return
      }
      void login('empresa@logexpress.com', 'demo123').then((res) => {
        if (!res.ok) {
          logout()
          setGate('select')
        }
      })
    }
  }, [gate, portal, currentUser, currentProfissional, currentEmpresa, login, logout])

  useEffect(() => {
    if (gate === 'cadastro_empresa' || gate === 'login' || gate === 'splash') return
    if (portal !== 'empresa' || !currentEmpresa) return
    const aviso = avisoAcessoEmpresa(currentEmpresa.status)
    if (!aviso) return
    setAvisoLogin(aviso)
    logout()
    setGate('login')
  }, [gate, portal, currentEmpresa, logout])

  useEffect(() => {
    if (gate === 'cadastro_profissional' || gate === 'login' || gate === 'splash') return
    if (portal !== 'profissional' || !currentProfissional) return
    const aviso = avisoAcessoProfissional(currentProfissional.status)
    if (!aviso) return
    setAvisoLogin(aviso)
    logout()
    setGate('login')
  }, [gate, portal, currentProfissional, logout])

  function handleLogout() {
    logout()
    setGate('select')
  }

  function openPortal(p: PortalTipo) {
    setAvisoLogin(null)
    setPortal(p)
    writePortal(p)
    setGate('login')
  }

  function afterLogin(opts: {
    isSuperuser?: boolean
    precisaConfig?: boolean
    precisaPerfil?: boolean
    role: string
  }) {
    writePortal(portal)
    // O superusuário entra direto no painel; a hierarquia abre pelo botão "Hierarquia" de lá.
    if (opts.precisaPerfil) {
      if (opts.role === 'empresa' || portal === 'empresa') setGate('cadastro_empresa')
      else if (opts.role === 'profissional' || portal === 'profissional') {
        setGate('cadastro_profissional')
      } else setGate('app')
      return
    }
    setGate('app')
  }

  if (gate === 'splash') {
    return <IntroSplash onFinish={finishSplash} />
  }

  if (gate === 'config' && currentUser) {
    return (
      <PortalConfigScreen
        onContinuar={() => setGate('app')}
        onSair={handleLogout}
      />
    )
  }

  if (gate === 'app' && currentUser) {
    if (portal === 'profissional') {
      if (!currentProfissional) {
        return (
          <div className="auth-screen tema-forcar-claro">
            <div className="auth-card">
              <p>Carregando painel do trabalhador…</p>
            </div>
          </div>
        )
      }
      if (currentProfissional.status !== 'aprovado') return null
      return <ProfissionalApp onLogout={handleLogout} />
    }
    if (portal === 'empresa') {
      if (!currentEmpresa) {
        return (
          <div className="auth-screen tema-forcar-claro">
            <div className="auth-card">
              <p>Carregando painel da empresa…</p>
            </div>
          </div>
        )
      }
      if (currentEmpresa.status !== 'aprovada') return null
      return <ContratarFreelancer onLogout={handleLogout} />
    }
    return <AdminApp onLogout={handleLogout} onOpenConfig={() => setGate('config')} />
  }

  if (gate === 'login') {
    return (
      <PortalLoginScreen
        portal={portal}
        avisoInicial={avisoLogin}
        onBack={() => setGate('select')}
        onSuccess={(r) =>
          afterLogin({
            isSuperuser: r.isSuperuser,
            precisaConfig: r.precisaConfig,
            precisaPerfil: r.precisaPerfil,
            role: r.role,
          })
        }
      />
    )
  }

  if (gate === 'cadastro_empresa') {
    return (
      <CadastroEmpresaScreen
        onBack={() => setGate('select')}
        onDone={() => {
          setAvisoLogin(
            'Sua empresa foi cadastrada e aguarda aprovação. O login libera quando o administrador validar o cadastro.',
          )
          logout()
          writePortal('empresa')
          setPortal('empresa')
          setGate('login')
        }}
      />
    )
  }

  if (gate === 'cadastro_profissional') {
    return (
      <CadastroProfissionalScreen
        onBack={() => setGate('select')}
        onDone={() => {
          setAvisoLogin(
            'Seu cadastro foi enviado e aguarda aprovação. O login libera quando o administrador validar o colaborador.',
          )
          logout()
          writePortal('profissional')
          setPortal('profissional')
          setGate('login')
        }}
      />
    )
  }

  return (
    <PortalSelectScreen
      onEmpresa={() => openPortal('empresa')}
      onProfissional={() => openPortal('profissional')}
      onAdmin={() => openPortal('admin')}
    />
  )
}

function FaixaDemo() {
  if (!emDemo()) return null
  return (
    <div className="faixa-demo" role="status">
      <span>Modo demonstração — dados fictícios, só neste aparelho. Nada aqui vai para o sistema real.</span>
      <button type="button" onClick={() => trocarModo('real')}>
        Sair da demonstração
      </button>
    </div>
  )
}

// O app instalado pelo navegador (Chrome/Edge, Tela de Início do iPhone) não abre mais o sistema: só o APK.
const APP_DO_NAVEGADOR = abertoComoAppDoNavegador()

export default function App() {
  if (APP_DO_NAVEGADOR) return <AppDoNavegadorDesativado />
  return (
    <StoreProvider>
      <AppRoutes />
      <FaixaDemo />
    </StoreProvider>
  )
}
