import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { BRAND_PRODUCT_NAME, LOGO_DOCA_LIVRE_SRC } from '../../lib/brandAssets'
import { usuarioExisteNaNuvem } from '../../lib/supabaseSync'
import {
  REGRAS_SENHA,
  normalizarUsuario,
  problemaSenhaCadastro,
  usuarioComNumero,
  usuarioDoEmail,
} from '../../lib/usuarioAcesso'
import {
  portalCadastroEnviarCodigo,
  portalCadastroVerificarCodigo,
  portalConsumeCadastroToken,
  portalConsumeSenhaToken,
  portalPeekCadastroToken,
  portalPeekSenhaToken,
  portalSenhaEnviarCodigo,
  portalSenhaVerificarCodigo,
  type PortalRole,
} from '../../lib/portalAuth'
import { emDemo } from '../../lib/modo'
import { useStore } from '../../lib/store'
import './PortalLoginScreen.css'

export type PortalLoginSuccess = {
  usuario: string
  role: string
  isSuperuser?: boolean
  precisaConfig?: boolean
  precisaPerfil?: boolean
}

type Props = {
  portal: PortalRole | 'admin'
  avisoInicial?: string | null
  onSuccess: (result: PortalLoginSuccess) => void
  onBack: () => void
}

type Mode = 'login' | 'cadastro' | 'senha' | 'trocar'

const REGRA_SENHA_FORTE = 'Pelo menos 10 caracteres, com letra maiúscula, minúscula e número.'
const REGRA_SENHA = 'Pelo menos 8 caracteres, com letras e números.'
type Step = 'form' | 'codigo' | 'dados'

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  id: string
}

function PasswordField({ id, className, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="portal-login__password-wrap">
      <input
        id={id}
        className={`portal-login__input portal-login__input--password${className ? ` ${className}` : ''}`}
        {...rest}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="portal-login__password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        title={visible ? 'Ocultar senha' : 'Mostrar senha'}
      >
        <span className="portal-login__password-toggle-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
            {visible ? (
              <path
                fill="currentColor"
                d="M2.1 3.5 3.5 2.1 21.9 20.5 20.5 21.9l-3.1-3.1A11.5 11.5 0 0 1 12 19.5C6.5 19.5 1.9 16 0 12c.7-1.5 1.8-2.9 3.1-4.1L2.1 3.5zm6.2 6.2 1.5 1.5a2.5 2.5 0 0 0 3.1 3.1l1.5 1.5A4.5 4.5 0 0 1 8.3 9.7zM12 6.5c5.5 0 10.1 3.5 12 7.5-.6 1.3-1.5 2.5-2.6 3.5l-1.5-1.5c.7-.7 1.3-1.5 1.7-2.4A10 10 0 0 0 12 8.5c-.7 0-1.3.1-1.9.2L8.5 7A11 11 0 0 1 12 6.5z"
              />
            ) : (
              <path
                fill="currentColor"
                d="M12 5C6.5 5 1.9 8.5 0 12.5 1.9 16.5 6.5 20 12 20s10.1-3.5 12-7.5C22.1 8.5 17.5 5 12 5zm0 12.5a5.5 5.5 0 1 1 0-10 5.5 5.5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
              />
            )}
          </svg>
        </span>
      </button>
    </div>
  )
}

const PORTAL_TITLE: Record<PortalRole | 'admin', string> = {
  empresa: 'Login Empresa',
  profissional: 'Login Trabalhador',
  admin: 'Login Admin',
}

const PORTAL_TAG: Record<PortalRole | 'admin', string> = {
  empresa: 'Contratantes · demandas · prestadores',
  profissional: 'Currículo · vagas · missões temporárias',
  admin: 'Administração · hierarquia · permissões',
}

/**
 * Ajuda na tela do código: onde procurar o e-mail e o botão de reenviar. O servidor só aceita um
 * código novo a cada 60 segundos, então o botão espera esse tempo.
 */
function AjudaCodigo({ onReenviar }: { onReenviar: () => Promise<void> }) {
  const [liberaEm, setLiberaEm] = useState(() => Date.now() + 60_000)
  const [agora, setAgora] = useState(() => Date.now())
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const faltam = Math.max(0, Math.ceil((liberaEm - agora) / 1000))
  async function reenviar() {
    setEnviando(true)
    try {
      await onReenviar()
    } finally {
      setEnviando(false)
      setLiberaEm(Date.now() + 60_000)
    }
  }
  return (
    <div className="portal-login__ajuda-codigo">
      <p>
        Não chegou? Pode levar alguns minutos. Procure por <strong>fazumfreela</strong> também na pasta{' '}
        <strong>Spam</strong> (ou Lixo eletrônico) e marque como "Não é spam".
      </p>
      <button
        type="button"
        className="portal-login__link"
        disabled={faltam > 0 || enviando}
        onClick={() => void reenviar()}
      >
        {enviando ? 'Reenviando…' : faltam > 0 ? `Reenviar código em ${faltam}s` : 'Reenviar código'}
      </button>
    </div>
  )
}

export function PortalLoginScreen({ portal, avisoInicial, onSuccess, onBack }: Props) {
  const store = useStore()
  const [mode, setMode] = useState<Mode>('login')
  const [step, setStep] = useState<Step>('form')

  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [email, setEmail] = useState('')
  const [identificador, setIdentificador] = useState('')
  const [codigo, setCodigo] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  /** Senha provisória digitada no login, usada para confirmar a troca obrigatória. */
  const [senhaProvisoria, setSenhaProvisoria] = useState('')
  const [trocaForte, setTrocaForte] = useState(true)

  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(avisoInicial ?? null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (avisoInicial) setAviso(avisoInicial)
  }, [avisoInicial])

  function resetMessages() {
    setErro(null)
    setInfo(null)
  }

  function goMode(next: Mode) {
    setMode(next)
    setStep('form')
    setCodigo('')
    setVerifyToken('')
    setSenha('')
    setConfirmarSenha('')
    setErro(null)
    setInfo(null)
    if (next === 'cadastro') setUsuario('')
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    try {
      const result = await store.loginPortal(usuario.trim(), senha, portal)
      if (result.ok && result.trocarSenha) {
        // Senha provisória (conta criada pelo sistema ou redefinida pelo admin): troca antes de entrar.
        setAviso(null)
        setSenhaProvisoria(senha)
        setTrocaForte(result.role === 'admin' || result.role === 'super')
        setSenha('')
        setConfirmarSenha('')
        setMode('trocar')
        setInfo('Por segurança, defina uma senha nova antes de continuar.')
        return
      }
      concluirLogin(result)
    } finally {
      setLoading(false)
    }
  }

  function concluirLogin(result: Awaited<ReturnType<typeof store.loginPortal>>) {
    if (!result.ok) {
      if (result.aviso) {
        setMode('login')
        setAviso(result.error || 'Seu cadastro ainda aguarda aprovação.')
      } else {
        setAviso(null)
        setErro(result.error || 'Falha no login.')
      }
      return
    }
    setAviso(null)
    onSuccess({
      usuario: result.usuario || usuario.trim(),
      role: result.role || portal,
      isSuperuser: result.isSuperuser,
      precisaConfig: result.precisaConfig,
      precisaPerfil: result.precisaPerfil,
    })
  }

  async function handleTrocarSenha(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem.')
      return
    }
    setLoading(true)
    try {
      const result = await store.concluirTrocaSenha(senhaProvisoria, senha, portal)
      if (!result.ok && !result.aviso) {
        setErro(result.error || 'Não foi possível trocar a senha.')
        return
      }
      setSenhaProvisoria('')
      concluirLogin(result)
    } finally {
      setLoading(false)
    }
  }

  async function handleCadastroEnviar(e: FormEvent) {
    e.preventDefault()
    if (portal === 'admin') {
      setErro('Cadastro pelo Admin não está disponível. Peça a um superusuário.')
      return
    }
    resetMessages()
    const em = email.trim().toLowerCase()
    if (store.state.users.some((usuarioCadastrado) => usuarioCadastrado.email.toLowerCase() === em)) {
      setErro('Este e-mail já está sendo utilizado.')
      return
    }
    setLoading(true)
    try {
      // O servidor recusa o envio se o e-mail já tiver conta (em qualquer aparelho).
      const result = await portalCadastroEnviarCodigo(email.trim(), portal)
      if (!result.ok) {
        setErro(result.erro)
        return
      }
      setInfo(result.mensagem)
      setStep('codigo')
    } finally {
      setLoading(false)
    }
  }

  async function reenviarCodigoCadastro() {
    resetMessages()
    if (portal === 'admin') return
    const result = await portalCadastroEnviarCodigo(email.trim(), portal)
    if (!result.ok) {
      setErro(result.erro)
      return
    }
    setCodigo('')
    setInfo(result.mensagem.startsWith('Modo demonstração') ? result.mensagem : 'Enviamos um código novo. Use o último que chegar.')
  }

  async function reenviarCodigoSenha() {
    resetMessages()
    const result = await portalSenhaEnviarCodigo(identificador.trim(), (id) => store.resolveEmailByIdentificador(id))
    if (!result.ok) {
      setErro(result.erro)
      return
    }
    setCodigo('')
    setInfo(result.mensagem.startsWith('Modo demonstração') ? result.mensagem : 'Enviamos um código novo. Use o último que chegar.')
  }

  async function handleCadastroVerificar(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    try {
      const result = await portalCadastroVerificarCodigo(email.trim(), codigo.trim())
      if (!result.ok) {
        setErro(result.erro)
        return
      }
      setVerifyToken(result.verify_token)
      setInfo(result.mensagem)
      // O usuário já vem sugerido pelo e-mail (diego.isidoro@... vira diego.isidoro); a pessoa troca se quiser.
      const sugestao = usuarioDoEmail(email)
      setUsuario(sugestao)
      setSenha('')
      setConfirmarSenha('')
      setStep('dados')
      setCodigo('')
      if (sugestao) void trocarSeJaExiste(sugestao)
    } finally {
      setLoading(false)
    }
  }

  /** Se a sugestão já for de outra pessoa, coloca a mesma com números no fim (só se a pessoa não mexeu). */
  async function trocarSeJaExiste(sugestao: string) {
    const local = store.state.users.some((conta) => (conta.usuario || '').toLowerCase() === sugestao)
    const existe = local || (await usuarioExisteNaNuvem(sugestao))
    if (existe) setUsuario((atual) => (atual === sugestao ? usuarioComNumero(sugestao) : atual))
  }

  async function handleCadastroConcluir(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    const us = normalizarUsuario(usuario)
    if (us.length < 3) {
      setErro('Escolha um usuário com pelo menos 3 letras ou números.')
      return
    }
    if (us !== usuario) setUsuario(us)
    const falhaSenha = problemaSenhaCadastro(senha)
    if (falhaSenha) {
      setErro(falhaSenha)
      return
    }
    if (senha !== confirmarSenha) {
      setErro('As duas senhas não são iguais. Digite a mesma senha nos dois campos.')
      return
    }
    const peeked = portalPeekCadastroToken(verifyToken)
    if (!peeked) {
      setErro('Sessão de cadastro expirada. Solicite um novo código.')
      return
    }
    setLoading(true)
    try {
      const reg = await store.portalRegisterUser({
        email: peeked.email,
        usuario: us,
        senha,
        role: peeked.portalRole,
        verifyToken,
      })
      if (!reg.ok) {
        if (/já existe/i.test(reg.error ?? '')) {
          const outro = usuarioComNumero(us)
          setUsuario(outro)
          setErro(`O usuário ${us} já é de outra pessoa. Deixamos ${outro} no lugar: é só tocar em Concluir cadastro.`)
          return
        }
        setErro(reg.error || 'Não foi possível cadastrar.')
        return
      }
      await portalConsumeCadastroToken(verifyToken)
      onSuccess({
        usuario: us,
        role: peeked.portalRole,
        precisaPerfil: true,
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSenhaEnviar(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    try {
      const result = await portalSenhaEnviarCodigo(identificador.trim(), (id) =>
        store.resolveEmailByIdentificador(id),
      )
      if (!result.ok) {
        setErro(result.erro)
        return
      }
      setEmail(result.email)
      setInfo(result.mensagem)
      setStep('codigo')
    } finally {
      setLoading(false)
    }
  }

  async function handleSenhaVerificar(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    setLoading(true)
    try {
      const result = await portalSenhaVerificarCodigo(email.trim(), codigo.trim())
      if (!result.ok) {
        setErro(result.erro)
        return
      }
      setVerifyToken(result.verify_token)
      setInfo(result.mensagem)
      setSenha('')
      setConfirmarSenha('')
      setStep('dados')
      setCodigo('')
    } finally {
      setLoading(false)
    }
  }

  async function handleSenhaRedefinir(e: FormEvent) {
    e.preventDefault()
    resetMessages()
    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem.')
      return
    }
    const em = portalPeekSenhaToken(verifyToken)
    if (!em) {
      setErro('Sessão expirada. Solicite um novo código.')
      return
    }
    setLoading(true)
    try {
      const res = await store.portalResetSenha(em, senha, verifyToken)
      if (!res.ok) {
        setErro(res.error || 'Não foi possível alterar a senha.')
        return
      }
      await portalConsumeSenhaToken(verifyToken)
      setInfo('Senha alterada. Faça login.')
      goMode('login')
      setInfo('Senha alterada. Faça login.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="portal-login tema-forcar-claro">
      <div className="portal-login__card">
        <div className="portal-login__header">
          <img src={LOGO_DOCA_LIVRE_SRC} alt="Doca Livre" className="portal-login__logo" />
          {/* Nome do sistema embaixo da logo: a Doca Livre tem outros sistemas (WMS, Oferta de Carga). */}
          <p className="portal-login__produto">{BRAND_PRODUCT_NAME}</p>
          <h1 className="portal-login__title">
            {mode === 'cadastro'
              ? portal === 'empresa'
                ? 'Cadastro de empresa'
                : 'Cadastro de trabalhador'
              : mode === 'trocar'
                ? 'Defina sua senha'
                : PORTAL_TITLE[portal]}
          </h1>
          <p className="portal-login__tagline">{PORTAL_TAG[portal]}</p>
        </div>

        {mode === 'login' && aviso && (
          <p className="portal-login__aviso" role="status">
            {aviso}
          </p>
        )}

        {mode === 'login' && (
          <form className="portal-login__form" onSubmit={handleLogin}>
            <label className="portal-login__label" htmlFor="pl-usuario">
              Usuário ou e-mail
            </label>
            <input
              id="pl-usuario"
              className="portal-login__input"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              required
            />
            <label className="portal-login__label" htmlFor="pl-senha">
              Senha
            </label>
            <PasswordField
              id="pl-senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading}>
              {loading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}

        {mode === 'cadastro' && portal !== 'admin' && step === 'form' && (
          <form className="portal-login__form" onSubmit={handleCadastroEnviar}>
            <p className="portal-login__hint">
              Enviaremos um código de 6 dígitos para confirmar seu e-mail.
            </p>
            <label className="portal-login__label" htmlFor="pl-email">
              E-mail
            </label>
            <input
              id="pl-email"
              type="email"
              className="portal-login__input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            {info && <p className="portal-login__info">{info}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading}>
              {loading ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        )}

        {mode === 'cadastro' && step === 'codigo' && (
          <form className="portal-login__form" onSubmit={handleCadastroVerificar}>
            <p className="portal-login__hint">
              Enviamos um código para <strong>{email}</strong>. Abra o e-mail, copie o código e cole abaixo.
            </p>
            <label className="portal-login__label" htmlFor="pl-otp">
              Código
            </label>
            <input
              id="pl-otp"
              className="portal-login__input portal-login__input--otp"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            {info && <p className="portal-login__info">{info}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading || codigo.length < 6}>
              {loading ? 'Verificando…' : 'Verificar código'}
            </button>
            <AjudaCodigo onReenviar={reenviarCodigoCadastro} />
          </form>
        )}

        {mode === 'cadastro' && step === 'dados' && (
          <form className="portal-login__form" onSubmit={handleCadastroConcluir}>
            <label className="portal-login__label" htmlFor="pl-new-user">
              Usuário
            </label>
            <input
              id="pl-new-user"
              className="portal-login__input"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              onBlur={() => {
                const ajustado = normalizarUsuario(usuario)
                if (ajustado) setUsuario(ajustado)
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <p className="portal-login__hint" aria-live="polite">
              {usuario.trim() && normalizarUsuario(usuario) !== usuario.trim() ? (
                <>
                  Você vai entrar como <strong>{normalizarUsuario(usuario) || '…'}</strong>. Também dá para entrar com o
                  seu e-mail.
                </>
              ) : (
                'É com ele, ou com o seu e-mail, que você entra no sistema. Pode trocar se quiser.'
              )}
            </p>
            <label className="portal-login__label" htmlFor="pl-new-pass">
              Senha
            </label>
            <PasswordField
              id="pl-new-pass"
              value={senha}
              onChange={(e) => {
                setSenha(e.target.value)
                setErro(null)
              }}
              autoComplete="new-password"
              required
            />
            <ul className="portal-login__regras" aria-label="Regras da senha">
              {REGRAS_SENHA.map((regra) => {
                const ok = regra.ok(senha)
                return (
                  <li key={regra.id} className={ok ? 'portal-login__regra--ok' : undefined}>
                    <span aria-hidden="true">{ok ? '✓' : '•'}</span>
                    {regra.texto}
                    <span className="portal-login__oculto">{ok ? ' (cumprido)' : ' (falta)'}</span>
                  </li>
                )
              })}
            </ul>
            <label className="portal-login__label" htmlFor="pl-new-pass2">
              Repetir senha
            </label>
            <PasswordField
              id="pl-new-pass2"
              value={confirmarSenha}
              onChange={(e) => {
                setConfirmarSenha(e.target.value)
                setErro(null)
              }}
              autoComplete="new-password"
              required
            />
            {confirmarSenha && (
              <ul className="portal-login__regras" aria-live="polite">
                <li className={confirmarSenha === senha ? 'portal-login__regra--ok' : undefined}>
                  <span aria-hidden="true">{confirmarSenha === senha ? '✓' : '•'}</span>
                  {confirmarSenha === senha ? 'As duas senhas são iguais' : 'As senhas ainda não são iguais'}
                </li>
              </ul>
            )}
            {erro && <p className="portal-login__erro">{erro}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading}>
              {loading ? 'Salvando…' : 'Concluir cadastro'}
            </button>
          </form>
        )}

        {mode === 'senha' && step === 'form' && (
          <form className="portal-login__form" onSubmit={handleSenhaEnviar}>
            <p className="portal-login__hint">Informe usuário ou e-mail para receber o código.</p>
            <label className="portal-login__label" htmlFor="pl-id">
              Usuário ou e-mail
            </label>
            <input
              id="pl-id"
              className="portal-login__input"
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              required
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            {info && <p className="portal-login__info">{info}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading}>
              {loading ? 'Enviando…' : 'Enviar código'}
            </button>
          </form>
        )}

        {mode === 'senha' && step === 'codigo' && (
          <form className="portal-login__form" onSubmit={handleSenhaVerificar}>
            <p className="portal-login__hint">
              Enviamos um código para <strong>{email}</strong>. Abra o e-mail, copie o código e cole abaixo.
            </p>
            <label className="portal-login__label" htmlFor="pl-otp-s">
              Código
            </label>
            <input
              id="pl-otp-s"
              className="portal-login__input portal-login__input--otp"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            {info && <p className="portal-login__info">{info}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading || codigo.length < 6}>
              {loading ? 'Verificando…' : 'Verificar código'}
            </button>
            <AjudaCodigo onReenviar={reenviarCodigoSenha} />
          </form>
        )}

        {mode === 'senha' && step === 'dados' && (
          <form className="portal-login__form" onSubmit={handleSenhaRedefinir}>
            <label className="portal-login__label" htmlFor="pl-np">
              Nova senha
            </label>
            <PasswordField
              id="pl-np"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
            <p className="portal-login__hint">{REGRA_SENHA} Contas de gestão: {REGRA_SENHA_FORTE.toLowerCase()}</p>
            <label className="portal-login__label" htmlFor="pl-np2">
              Confirmar nova senha
            </label>
            <PasswordField
              id="pl-np2"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading}>
              {loading ? 'Salvando…' : 'Redefinir senha'}
            </button>
          </form>
        )}

        {mode === 'trocar' && (
          <form className="portal-login__form" onSubmit={handleTrocarSenha}>
            {info && <p className="portal-login__info">{info}</p>}
            <label className="portal-login__label" htmlFor="pl-troca">
              Nova senha
            </label>
            <PasswordField
              id="pl-troca"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              required
              minLength={trocaForte ? 10 : 8}
            />
            <p className="portal-login__hint">{trocaForte ? REGRA_SENHA_FORTE : REGRA_SENHA}</p>
            <label className="portal-login__label" htmlFor="pl-troca2">
              Confirmar nova senha
            </label>
            <PasswordField
              id="pl-troca2"
              value={confirmarSenha}
              onChange={(e) => setConfirmarSenha(e.target.value)}
              autoComplete="new-password"
              required
              minLength={trocaForte ? 10 : 8}
            />
            {erro && <p className="portal-login__erro">{erro}</p>}
            <button type="submit" className="portal-login__submit" disabled={loading}>
              {loading ? 'Salvando…' : 'Salvar senha e entrar'}
            </button>
          </form>
        )}

        <div className="portal-login__links">
          {mode !== 'login' && (
            <button type="button" className="portal-login__link" onClick={() => goMode('login')}>
              Voltar ao login
            </button>
          )}
          {/* Antes o portal Empresa não tinha este botão: nenhuma empresa conseguia se cadastrar. */}
          {mode === 'login' && portal !== 'admin' && (
            <button type="button" className="portal-login__link" onClick={() => goMode('cadastro')}>
              Criar conta
            </button>
          )}
          {mode === 'login' && (
            <button type="button" className="portal-login__link" onClick={() => goMode('senha')}>
              Esqueci a senha
            </button>
          )}
          <button type="button" className="portal-login__link" onClick={onBack}>
            Trocar tipo de acesso
          </button>
        </div>

        {/* A senha de demonstração só aparece no modo demo (antes aparecia no site real). */}
        {mode === 'login' && emDemo() && (
          <p className="portal-login__hint" style={{ marginTop: 16, textAlign: 'center' }}>
            Demonstração — superusuários: <strong>Diego</strong> / <strong>Elder</strong>, senha{' '}
            <code>demo123</code>
          </p>
        )}
      </div>
    </div>
  )
}
