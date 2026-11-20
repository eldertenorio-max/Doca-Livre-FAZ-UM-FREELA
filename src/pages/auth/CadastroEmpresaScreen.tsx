import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { UFS, buscarCnpj, classificacaoCnae, responsavelEhSocio, capitalizar, erroCnpj, mascararCep, mascararCnpj, useCepAutomatico, useCidadesDaUf } from '../../lib/apisPublicas'
import { erroCpf, erroTelefone, mascararCpf, mascararTelefone } from '../../lib/documentosPessoais'
import { AceiteCadastro, todosAceitos } from '../../components/AceiteTermos'
import { LOCAIS_OPERACAO } from '../../data/cidades'
import type { TermoId } from '../../lib/termos'
import { ACCEPT_DOCUMENTO_CADASTRO, lerArquivoEmpresa, type FotoDocumento } from '../../lib/analisarDocumentoCadastro'
import { coordenadaDaCidade } from '../../lib/coordenadaCidade'
import { useStore } from '../../lib/store'
import type { EmpresaTipo } from '../../lib/types'

type Props = {
  onBack: () => void
  onDone: () => void
}

const TIPOS: { id: EmpresaTipo; label: string }[] = [
  { id: 'transportadora', label: 'Transportadora' },
  { id: 'operador_logistico', label: 'Operador logístico' },
  { id: 'industria', label: 'Indústria' },
  { id: 'centro_distribuicao', label: 'Centro de distribuição' },
  { id: 'atacadista', label: 'Atacadista' },
  { id: 'varejo', label: 'Varejo' },
  { id: 'outro', label: 'Outro' },
]

const DOCS_EMPRESA_CADASTRO = [
  { id: 'contrato_social', label: 'Contrato social', ajuda: 'Ato constitutivo, contrato social ou certificado MEI.' },
  { id: 'cartao_cnpj', label: 'Cartão CNPJ', ajuda: 'Comprovante de inscrição da Receita Federal.' },
  {
    id: 'comprovante_endereco_empresa',
    label: 'Comprovante de endereço da operação',
    ajuda: 'Conta de consumo ou IPTU do estabelecimento.',
  },
] as const

type DocEmpresaId = (typeof DOCS_EMPRESA_CADASTRO)[number]['id']

type EstadoDoc = {
  arquivo: FotoDocumento | null
}

const DOC_VAZIO: EstadoDoc = { arquivo: null }

function copiaDocumento(foto: FotoDocumento) {
  return `data:${foto.mime};base64,${foto.dados}`
}

const ETAPAS = [
  'Dados da empresa',
  'Responsável',
  'Acesso',
  'Endereço da operação',
  'Tipo de operação',
  'Documentos',
  'Revisão',
]

export function CadastroEmpresaScreen({ onBack, onDone }: Props) {
  const { registerEmpresa, completeEmpresaPerfil, currentUser, state } = useStore()
  // Qualquer conta de empresa já logada completa o perfil. Antes exigia perfilCompleto === false:
  // uma conta marcada "completa" sem empresa salva caía no cadastro novo, que pedia e-mail e senha
  // de novo e respondia "Este e-mail já está sendo utilizado" para sempre.
  const completing = currentUser?.role === 'empresa'
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aceites, setAceites] = useState<TermoId[]>([])
  const [docs, setDocs] = useState<Record<DocEmpresaId, EstadoDoc>>({
    contrato_social: DOC_VAZIO,
    cartao_cnpj: DOC_VAZIO,
    comprovante_endereco_empresa: DOC_VAZIO,
  })
  const geracaoDoc = useRef<Partial<Record<DocEmpresaId, number>>>({})
  const [form, setForm] = useState({
    cnpj: '',
    razaoSocial: '',
    nomeFantasia: '',
    responsavelNome: '',
    responsavelCpf: '',
    responsavelCargo: '',
    telefone: '',
    email: currentUser?.email || '',
    senha: '',
    cep: '',
    rua: '',
    numero: '',
    cidade: '',
    estado: 'SP',
    tipo: 'transportadora' as EmpresaTipo,
  })

  const ufs = useMemo(() => [...new Set([...UFS, ...LOCAIS_OPERACAO.map((local) => local.estado)])].sort(), [])
  const cidadesBase = useMemo(
    () => LOCAIS_OPERACAO.filter((local) => local.estado === form.estado).map((local) => local.cidade),
    [form.estado],
  )
  const cidades = useCidadesDaUf(form.estado, cidadesBase)
  const cepStatus = useCepAutomatico(form.cep, (e) =>
    setForm((f) => ({
      ...f,
      rua: e.rua ? (e.bairro ? `${e.rua} - ${e.bairro}` : e.rua) : f.rua,
      cidade: e.cidade || f.cidade,
      estado: e.estado || f.estado,
    })),
  )
  const [cnpjInfo, setCnpjInfo] = useState<{ texto: string; erro: boolean; bloqueia: boolean }>({
    texto: '',
    erro: false,
    bloqueia: false,
  })
  const [cnpjBuscando, setCnpjBuscando] = useState(false)
  const [cnpjDados, setCnpjDados] = useState<{ socios: string[]; atividade: string; cnae: string } | null>(null)
  const [classeIbge, setClasseIbge] = useState('')
  const cnpjDigitos = form.cnpj.replace(/\D/g, '')
  useEffect(() => {
    setCnpjDados(null)
    setClasseIbge('')
    if (cnpjDigitos.length !== 14) {
      setCnpjInfo({ texto: '', erro: false, bloqueia: false })
      setCnpjBuscando(false)
      return
    }
    const falha = erroCnpj(cnpjDigitos)
    if (falha) {
      setCnpjInfo({ texto: falha, erro: true, bloqueia: true })
      return
    }
    let vivo = true
    setCnpjBuscando(true)
    setCnpjInfo({ texto: 'Consultando o CNPJ na Receita...', erro: false, bloqueia: false })
    void buscarCnpj(cnpjDigitos).then((res) => {
      if (!vivo) return
      setCnpjBuscando(false)
      if (res === 'nao_encontrado') {
        setCnpjInfo({ texto: 'CNPJ não encontrado na Receita Federal. Confira os números.', erro: true, bloqueia: true })
        return
      }
      if (!res) {
        setCnpjInfo({
          texto: 'CNPJ válido. Não foi possível consultar a Receita agora, preencha os dados manualmente.',
          erro: false,
          bloqueia: false,
        })
        return
      }
      setCnpjDados({ socios: res.socios, atividade: res.atividade, cnae: res.cnae })
      void classificacaoCnae(res.cnae).then((c) => {
        if (vivo) setClasseIbge(c)
      })
      setForm((f) => ({
        ...f,
        razaoSocial: res.razaoSocial || f.razaoSocial,
        nomeFantasia: res.nomeFantasia || f.nomeFantasia || res.razaoSocial,
        cep: res.cep ? mascararCep(res.cep) : f.cep,
        rua: res.rua ? capitalizar(res.bairro ? `${res.rua} - ${res.bairro}` : res.rua) : f.rua,
        numero: res.numero || f.numero,
        cidade: res.cidade ? capitalizar(res.cidade) : f.cidade,
        estado: res.estado || f.estado,
        telefone: f.telefone || (res.telefone ? mascararTelefone(res.telefone) : ''),
      }))
      if (!res.ativa) {
        setCnpjInfo({
          texto: `Este CNPJ está com situação "${res.situacao || 'não informada'}" na Receita Federal. Só é possível cadastrar empresa com CNPJ ATIVO.`,
          erro: true,
          bloqueia: true,
        })
        return
      }
      setCnpjInfo({
        texto: `CNPJ ativo${res.mei ? ' (MEI)' : ''}. Dados preenchidos pela Receita, confira antes de continuar.`,
        erro: false,
        bloqueia: false,
      })
    })
    return () => {
      vivo = false
    }
  }, [cnpjDigitos])

  const socioConfere = cnpjDados && form.responsavelNome.trim().split(/\s+/).length >= 2 ? responsavelEhSocio(form.responsavelNome, cnpjDados.socios) : undefined

  function problemaEmpresa() {
    return (
      erroCnpj(form.cnpj) ||
      (cnpjBuscando ? 'Aguarde a consulta do CNPJ terminar.' : '') ||
      (cnpjInfo.bloqueia ? cnpjInfo.texto : '') ||
      (!form.razaoSocial.trim() ? 'Informe a razão social.' : '') ||
      (!form.nomeFantasia.trim() ? 'Informe o nome fantasia.' : '')
    )
  }

  function problemaResponsavel() {
    return (
      (!form.responsavelNome.trim() ? 'Informe o nome do responsável.' : '') ||
      erroCpf(form.responsavelCpf) ||
      erroTelefone(form.telefone)
    )
  }
  const tipoLabel = TIPOS.find((item) => item.id === form.tipo)?.label ?? form.tipo

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function documentosEnviados() {
    return DOCS_EMPRESA_CADASTRO.filter((item) => docs[item.id].arquivo).map((item) => {
      const foto = docs[item.id].arquivo
      return {
        tipoId: item.id,
        arquivoNome: foto?.nome || '',
        observacao: 'Aguardando validação manual.',
        arquivoDados: foto ? copiaDocumento(foto) : undefined,
      }
    })
  }

  function todosDocumentosEnviados() {
    return DOCS_EMPRESA_CADASTRO.every((item) => docs[item.id].arquivo)
  }

  async function escolherDocumento(id: DocEmpresaId, file: File | undefined) {
    setError('')
    const vez = (geracaoDoc.current[id] ?? 0) + 1
    geracaoDoc.current[id] = vez
    if (!file) {
      setDocs((atual) => ({ ...atual, [id]: DOC_VAZIO }))
      return
    }
    try {
      const foto = await lerArquivoEmpresa(file)
      if (geracaoDoc.current[id] !== vez) return
      setDocs((atual) => ({ ...atual, [id]: { arquivo: foto } }))
    } catch (falha) {
      if (geracaoDoc.current[id] !== vez) return
      setDocs((atual) => ({ ...atual, [id]: DOC_VAZIO }))
      setError(falha instanceof Error ? falha.message : 'Não foi possível ler o arquivo.')
    }
  }

  function next() {
    setError('')
    const falhaEtapa = step === 1 ? problemaEmpresa() : step === 2 ? problemaResponsavel() : ''
    if (falhaEtapa) {
      setError(falhaEtapa)
      return
    }
    if (step === 4 && (!form.cidade.trim() || !form.estado.trim())) {
      setError('Informe a cidade e o estado da operação.')
      return
    }
    if (step === 6 && !todosDocumentosEnviados()) {
      setError('Envie os três documentos para continuar.')
      return
    }
    setStep((s) => Math.min(ETAPAS.length, s + 1))
  }

  function prev() {
    setError('')
    if (step === 1) onBack()
    else setStep((s) => s - 1)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const falhaEmpresa = problemaEmpresa()
    if (falhaEmpresa) {
      setError(falhaEmpresa)
      setStep(1)
      return
    }
    const falhaResp = problemaResponsavel()
    if (falhaResp) {
      setError(falhaResp)
      setStep(2)
      return
    }
    if (!todosDocumentosEnviados()) {
      setError('Envie os três documentos antes de concluir.')
      setStep(6)
      return
    }
    if (!form.cidade.trim() || !form.estado.trim()) {
      setError('Informe a cidade e o estado da operação.')
      setStep(4)
      return
    }
    if (!todosAceitos('empresa', aceites)) {
      setError('Marque todos os termos para concluir o cadastro.')
      return
    }
    const empresaPayload = {
      cnpj: form.cnpj.trim(),
      razaoSocial: form.razaoSocial.trim(),
      nomeFantasia: form.nomeFantasia.trim(),
      tipo: form.tipo,
      plano: 'gratuito' as const,
      responsavelNome: form.responsavelNome.trim(),
      responsavelCpf: form.responsavelCpf.trim(),
      responsavelCargo: form.responsavelCargo.trim(),
      telefone: form.telefone.trim(),
      endereco: {
        cep: form.cep.trim(),
        rua: form.rua.trim(),
        numero: form.numero.trim(),
        cidade: form.cidade.trim(),
        estado: form.estado.trim().toUpperCase(),
        ...(cepStatus.coord ??
          coordenadaDaCidade(form.cidade, form.estado, [
            ...state.empresas.map((empresa) => empresa.endereco),
            ...state.profissionais.map((pessoa) => pessoa.endereco),
          ])),
      },
    }
    const documentos = documentosEnviados()
    if (enviando) return
    setEnviando(true)
    try {
      // Os termos vão junto para serem gravados na conta na nuvem; o aceitarTermos só gravava
      // no navegador e a sincronização seguinte apagava o aceite.
      const res = await (completing
        ? completeEmpresaPerfil(empresaPayload, documentos, aceites)
        : registerEmpresa({ email: form.email, senha: form.senha }, empresaPayload, documentos, aceites))
      if (!res.ok) {
        setError(res.error ?? 'Erro no cadastro')
        return
      }
      onDone()
    } catch {
      setError('Não foi possível concluir o cadastro. Confira a internet e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="auth-screen auth-screen--scroll tema-forcar-claro">
      <form
        className="auth-card auth-card--wide"
        onSubmit={step === ETAPAS.length ? submit : (e) => { e.preventDefault(); next() }}
      >
        <button type="button" className="btn btn-ghost link-back" onClick={prev}>
          ← Voltar
        </button>
        <h1 className="auth-title">Cadastro da empresa tomadora</h1>
        <p className="step-indicator">
          Etapa {step} de {ETAPAS.length} · {ETAPAS[step - 1]}
        </p>

        {step === 1 && (
          <>
            <label className="field">
              <span>CNPJ</span>
              <input value={form.cnpj} onChange={(e) => set('cnpj', mascararCnpj(e.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" maxLength={18} required />
              {cnpjInfo.texto && <small className={cnpjInfo.erro ? 'error' : 'muted'}>{cnpjInfo.texto}</small>}
              {cnpjDados?.atividade && (
                <small className="muted">
                  Atividade principal{cnpjDados.cnae ? ` (CNAE ${cnpjDados.cnae})` : ''}: {cnpjDados.atividade}
                  {classeIbge ? ` · ${classeIbge}` : ''}
                </small>
              )}
            </label>
            <label className="field">
              <span>Razão social</span>
              <input value={form.razaoSocial} onChange={(e) => set('razaoSocial', e.target.value)} required />
            </label>
            <label className="field">
              <span>Nome fantasia</span>
              <input value={form.nomeFantasia} onChange={(e) => set('nomeFantasia', e.target.value)} required />
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <label className="field">
              <span>Nome do responsável</span>
              <input value={form.responsavelNome} onChange={(e) => set('responsavelNome', e.target.value)} required />
              {socioConfere === true && <small className="docs-ok">Nome confere com o quadro de sócios da Receita.</small>}
              {socioConfere === false && (
                <small className="error">
                  Esse nome não aparece no quadro de sócios do CNPJ. Pode continuar, mas a equipe vai conferir a procuração ou o vínculo.
                </small>
              )}
              {socioConfere === null && <small className="muted">A Receita não informou sócios para conferir este CNPJ.</small>}
            </label>
            <label className="field">
              <span>CPF do responsável</span>
              <input value={form.responsavelCpf} onChange={(e) => set('responsavelCpf', mascararCpf(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} required />
            </label>
            <label className="field">
              <span>Cargo</span>
              <input value={form.responsavelCargo} onChange={(e) => set('responsavelCargo', e.target.value)} required />
            </label>
            <label className="field">
              <span>Telefone</span>
              <input type="tel" inputMode="tel" value={form.telefone} onChange={(e) => set('telefone', mascararTelefone(e.target.value))} placeholder="(11) 91234-5678" maxLength={15} required />
            </label>
          </>
        )}

        {step === 3 && (
          <>
            {completing ? (
              <p className="muted">Conta já confirmada: {currentUser?.email}</p>
            ) : (
              <>
                <label className="field">
                  <span>E-mail</span>
                  <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input type="password" value={form.senha} onChange={(e) => set('senha', e.target.value)} required minLength={6} />
                </label>
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p className="muted">Esse endereço é o ponto da operação no mapa e na busca de colaboradores.</p>
            <label className="field">
              <span>CEP</span>
              <input value={form.cep} onChange={(e) => set('cep', mascararCep(e.target.value))} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} required />
              {cepStatus.texto && <small className={cepStatus.erro ? 'error' : 'muted'}>{cepStatus.texto}</small>}
            </label>
            <label className="field">
              <span>Estado</span>
              <select value={form.estado} onChange={(e) => set('estado', e.target.value)}>
                {ufs.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cidade</span>
              <input
                value={form.cidade}
                list="cidades-empresa"
                onChange={(e) => set('cidade', e.target.value)}
                placeholder="Cidade da operação"
                required
              />
              <datalist id="cidades-empresa">
                {cidades.map((cidade) => (
                  <option key={cidade} value={cidade} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Rua</span>
              <input value={form.rua} onChange={(e) => set('rua', e.target.value)} required />
            </label>
            <label className="field">
              <span>Número</span>
              <input value={form.numero} onChange={(e) => set('numero', e.target.value)} required />
            </label>
          </>
        )}

        {step === 5 && (
          <>
            <p className="muted">Qual é a operação da empresa tomadora?</p>
            <div className="chip-wrap">
              {TIPOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`chip ${form.tipo === item.id ? 'chip--on' : ''}`}
                  onClick={() => set('tipo', item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 6 && (
          <div className="docs-mock">
            <p>Envie os três documentos. A validação é manual, um arquivo por vez, no painel administrativo.</p>
            {DOCS_EMPRESA_CADASTRO.map((item) => {
              const atual = docs[item.id]
              return (
                <div key={item.id} className="docs-item">
                  <label className="field">
                    <span>{item.label}</span>
                    <input
                      type="file"
                      accept={ACCEPT_DOCUMENTO_CADASTRO}
                      onChange={(e) => void escolherDocumento(item.id, e.target.files?.[0])}
                    />
                    <small className="muted">{item.ajuda}</small>
                    {atual.arquivo && <small className="muted">{atual.arquivo.nome}</small>}
                  </label>
                </div>
              )
            })}
          </div>
        )}

        {step === 7 && (
          <dl className="cadastro-resumo">
            <div>
              <dt>Empresa</dt>
              <dd>
                {form.nomeFantasia} · {form.cnpj}
              </dd>
            </div>
            <div>
              <dt>Razão social</dt>
              <dd>{form.razaoSocial}</dd>
            </div>
            <div>
              <dt>Responsável</dt>
              <dd>
                {form.responsavelNome} · {form.responsavelCargo}
              </dd>
            </div>
            <div>
              <dt>Operação</dt>
              <dd>
                {tipoLabel} · {form.cidade}/{form.estado}
              </dd>
            </div>
            <div>
              <dt>Endereço</dt>
              <dd>
                {form.rua}, {form.numero}
                {form.cep ? ` · ${form.cep}` : ''}
              </dd>
            </div>
            <div>
              <dt>Documentos</dt>
              <dd>{DOCS_EMPRESA_CADASTRO.map((item) => item.label).join(' · ')} · aguardando validação</dd>
            </div>
          </dl>
        )}
        {step === 7 && (
          <AceiteCadastro
            role="empresa"
            marcados={aceites}
            onMarcar={(marcados) => {
              setAceites(marcados)
              setError('')
            }}
          />
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-accent btn-block" disabled={enviando}>
          {step === ETAPAS.length ? (enviando ? 'Enviando cadastro…' : 'Concluir cadastro') : 'Continuar'}
        </button>
      </form>
    </div>
  )
}
