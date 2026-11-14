import { UFS, estadoDoDdd, useBancos, mascararCep, useCepAutomatico, useCidadesDaUf } from '../../lib/apisPublicas'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CATEGORIES } from '../../data/categories'
import { LOCAIS_OPERACAO } from '../../data/cidades'
import { AvailabilityToggle } from '../../components/AvailabilityToggle'
import { MapaRaio } from '../../components/MapaRaio'
import { AceiteCadastro, todosAceitos } from '../../components/AceiteTermos'
import { AnexoCurriculo, CamposSobre, ListaExperiencias, conferirExperiencias } from '../../components/CurriculoCampos'
import type { TermoId } from '../../lib/termos'
import { ACCEPT_DOCUMENTO_CADASTRO, lerArquivoCadastro, type FotoDocumento, type PapelDocumento } from '../../lib/analisarDocumentoCadastro'
import { coordenadaDaCidade } from '../../lib/coordenadaCidade'
import { origemParaGravar, pontoValido, useLocalizacaoEndereco } from '../../lib/localizacaoEndereco'
import { hojeLocal } from '../../lib/ponto'
import { CERTIFICADOS_COMUNS, habilidadesDoTexto, mesclarCurriculo, nomeCertificado, semContato } from '../../lib/curriculo'
import type { LeituraCurriculo } from '../../lib/lerCurriculo'
import { validarChavePix } from '../../lib/pix'
import { erroCpf, erroTelefone, soDigitos, mascararCpf, mascararRg, mascararTelefone } from '../../lib/documentosPessoais'
import { useStore } from '../../lib/store'
import { emailExisteNaNuvem } from '../../lib/supabaseSync'
import type { Certificado, Disponibilidade, Experiencia } from '../../lib/types'

type Props = {
  onBack: () => void
  onDone: () => void
}

type StatusDoc = 'vazio' | 'analisando' | 'aceito' | 'recusado' | 'manual'

type LinhaDoc = {
  arquivo: FotoDocumento | null
  status: StatusDoc
  motivo: string
}

const LINHA_VAZIA: LinhaDoc = { arquivo: null, status: 'vazio', motivo: '' }

function observacaoDoc(linha: LinhaDoc) {
  if (linha.status === 'aceito') return `Conferido automaticamente${linha.motivo ? `: ${linha.motivo}` : '.'} Aguardando validação manual.`
  return 'Aguardando validação manual.'
}

function abrirArquivo(foto: FotoDocumento) {
  const binario = atob(foto.dados)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: foto.mime }))
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

function copiaDocumento(foto: FotoDocumento) {
  return `data:${foto.mime};base64,${foto.dados}`
}

const RAIOS = [10, 25, 50, 100]
const ETAPAS = [
  'Currículo',
  'Seus dados',
  'Documentos',
  'Cargos',
  'Experiência',
  'Certificações',
  'Disponibilidade',
  'Raio de trabalho',
  'Pagamento',
]
const PASSO = {
  curriculo: 1,
  dados: 2,
  documentos: 3,
  cargos: 4,
  experiencia: 5,
  certificacoes: 6,
  disponibilidade: 7,
  raio: 8,
  pagamento: 9,
} as const

export function CadastroProfissionalScreen({ onBack, onDone }: Props) {
  const { registerProfissional, completeProfissionalPerfil, currentUser, state } = useStore()
  // Qualquer conta de profissional já logada completa o perfil (antes exigia perfilCompleto === false
  // e uma conta "completa" sem perfil salvo caía no cadastro novo, que barrava o próprio e-mail).
  const completing = currentUser?.role === 'profissional'
  const [step, setStep] = useState<number>(PASSO.curriculo)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aceites, setAceites] = useState<TermoId[]>([])
  const [curriculo, setCurriculo] = useState<{ nome: string; copia?: string } | null>(null)
  const [certNovo, setCertNovo] = useState('')
  const [linhas, setLinhas] = useState<Record<PapelDocumento, LinhaDoc>>({
    documento: LINHA_VAZIA,
    verso: LINHA_VAZIA,
    selfie: LINHA_VAZIA,
  })
  const geracaoDoc = useRef<Partial<Record<PapelDocumento, number>>>({})
  const [form, setForm] = useState({
    nome: '',
    cpf: '',
    rg: '',
    /** Estado que emitiu o RG: o dígito verificador só é conferido quando é SP. */
    rgUf: 'SP',
    nascimento: '',
    telefone: '',
    email: currentUser?.email || '',
    senha: '',
    profissoes: [] as string[],
    experiencia: [] as Experiencia[],
    resumo: '',
    escolaridade: '',
    habilidades: '',
    certificados: [] as Certificado[],
    cnhCategoria: '',
    cnhValidade: '',
    disponibilidade: {
      hoje: true,
      amanha: true,
      estaSemana: true,
      finaisDeSemana: false,
      noturno: false,
      viagens: false,
      temporario: true,
      efetivo: false,
      freelancer: true,
    } as Disponibilidade,
    pix: '',
    banco: '',
    cep: '',
    cidade: '',
    estado: 'SP',
    rua: '',
    numero: '',
    complemento: '',
    raioKm: null as number | null,
  })
  const formAtual = useRef(form)
  useEffect(() => {
    formAtual.current = form
  }, [form])

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
  // Centro da cidade (fica parado enquanto a cidade não muda): último recurso do ponto no mapa.
  const pontoCidade = useMemo(() => {
    const ponto = coordenadaDaCidade(form.cidade, form.estado, [
      ...state.profissionais.map((pessoa) => pessoa.endereco),
      ...state.empresas.map((empresa) => empresa.endereco),
    ])
    return pontoValido(ponto) ? ponto : null
  }, [form.cidade, form.estado, state.profissionais, state.empresas])
  const localizacao = useLocalizacaoEndereco({
    endereco: { rua: form.rua, numero: form.numero, cidade: form.cidade, estado: form.estado },
    pontoCep: cepStatus.coord,
    pontoCidade,
  })
  const pixInfo = form.pix.trim() ? validarChavePix(form.pix) : null
  const certsExtras = form.certificados.filter((item) => !CERTIFICADOS_COMUNS.includes(item.tipo))

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function aplicarCurriculo(leitura: LeituraCurriculo) {
    const atual = formAtual.current
    const { form: novo, entrou } = mesclarCurriculo(atual, leitura.lido)
    const comEmail = !completing && !atual.email.trim() && leitura.lido.email
    const final = comEmail ? { ...novo, email: leitura.lido.email } : novo
    formAtual.current = final
    setForm(final)
    setCurriculo({ nome: leitura.arquivoNome, copia: leitura.copia })
    return comEmail ? ['E-mail', ...entrou] : entrou
  }

  function toggleProf(id: string) {
    setForm((f) => ({
      ...f,
      profissoes: f.profissoes.includes(id) ? f.profissoes.filter((p) => p !== id) : [...f.profissoes, id],
    }))
  }

  function toggleCert(tipo: string) {
    setForm((f) => ({
      ...f,
      certificados: f.certificados.some((c) => c.tipo === tipo)
        ? f.certificados.filter((c) => c.tipo !== tipo)
        : [...f.certificados, { tipo, validade: '', valido: true }],
    }))
  }

  function validadeCert(tipo: string, validade: string) {
    setForm((f) => ({
      ...f,
      certificados: f.certificados.map((c) => (c.tipo === tipo ? { ...c, validade } : c)),
    }))
  }

  function incluirCert() {
    const tipo = nomeCertificado(certNovo)
    if (!tipo) return
    if (!form.certificados.some((c) => c.tipo.toLowerCase() === tipo.toLowerCase())) toggleCert(tipo)
    setCertNovo('')
  }

  const bancos = useBancos()
  const [dddInfo, setDddInfo] = useState('')
  const dddTelefone = soDigitos(form.telefone).length >= 10 ? soDigitos(form.telefone).slice(0, 2) : ''
  useEffect(() => {
    if (!dddTelefone) {
      setDddInfo('')
      return
    }
    let vivo = true
    void estadoDoDdd(dddTelefone + '00000000').then((res) => {
      if (!vivo || !res) return
      setDddInfo(`DDD ${dddTelefone}: ${res.estado}${res.cidades.length ? `, região de ${res.cidades.slice(0, 3).join(', ')}` : ''}.`)
      setForm((f) => (f.cidade.trim() || f.cep.trim() ? f : { ...f, estado: res.estado }))
    })
    return () => {
      vivo = false
    }
  }, [dddTelefone])

  function definirRaio(valor: string) {
    const numero = Number(valor)
    set('raioKm', valor === '' || !Number.isFinite(numero) || numero <= 0 ? null : Math.min(500, Math.round(numero)))
  }

  function problemaDocumentos() {
    // Os arquivos não são conferidos aqui: quem valida é a equipe, no painel (pedido do Diego).
    if (!linhas.documento.arquivo) return 'Envie o documento com foto (RG, CIN ou CNH).'
    if (!linhas.selfie.arquivo) return 'Envie a selfie para continuar.'
    if (form.cnhCategoria.trim()) {
      if (!/^(ACC|A|B|C|D|E|AB|AC|AD|AE)$/.test(form.cnhCategoria.trim())) return 'Categoria da CNH inválida. Use ACC, A, B, C, D, E, AB, AC, AD ou AE.'
      if (!form.cnhValidade) return 'Informe a validade da CNH.'
    }
    return ''
  }

  function documentosProntos() {
    return !problemaDocumentos()
  }

  function documentosEnviados() {
    const frente = linhas.documento.arquivo
    const face = linhas.selfie.arquivo
    const costas = linhas.verso.arquivo
    if (!frente || !face) return []
    return [
      {
        tipoId: 'rg_cpf',
        arquivoNome: [frente.nome, costas?.nome].filter(Boolean).join(', '),
        observacao: observacaoDoc(linhas.documento),
        arquivoDados: copiaDocumento(frente),
        versoNome: costas?.nome,
        versoDados: costas ? copiaDocumento(costas) : undefined,
      },
      {
        tipoId: 'selfie',
        arquivoNome: face.nome,
        observacao: observacaoDoc(linhas.selfie),
        arquivoDados: copiaDocumento(face),
      },
      ...(curriculo
        ? [
            {
              tipoId: 'curriculo',
              arquivoNome: curriculo.nome,
              observacao: curriculo.copia
                ? 'Enviado no cadastro.'
                : 'Enviado no cadastro. O arquivo passou de 1 MB e ficou só a leitura dos campos.',
              arquivoDados: curriculo.copia,
            },
          ]
        : []),
    ]
  }

  async function escolherFoto(file: File | undefined, papel: PapelDocumento) {
    setError('')
    const vez = (geracaoDoc.current[papel] ?? 0) + 1
    geracaoDoc.current[papel] = vez
    if (!file) {
      setLinhas((atual) => ({ ...atual, [papel]: LINHA_VAZIA }))
      return
    }
    try {
      const foto = await lerArquivoCadastro(file)
      if (geracaoDoc.current[papel] !== vez) return
      // Sem conferência automática: o arquivo segue direto para a validação manual no painel.
      setLinhas((atual) => ({ ...atual, [papel]: { arquivo: foto, status: 'manual', motivo: '' } }))
    } catch (falha) {
      if (geracaoDoc.current[papel] !== vez) return
      setLinhas((atual) => ({ ...atual, [papel]: LINHA_VAZIA }))
      setError(falha instanceof Error ? falha.message : 'Não foi possível ler o arquivo.')
    }
  }

  async function next() {
    setError('')
    if (step === PASSO.dados) {
      const falhaDados =
        (form.nome.trim().split(/\s+/).length < 2 ? 'Informe o nome completo (nome e sobrenome).' : '') ||
        erroCpf(form.cpf) ||
        // O RG não é mais conferido pelo dígito: a equipe confere com o documento na validação.
        (form.rg.replace(/[^0-9Xx]/g, '').length < 5 ? 'Informe o RG completo.' : '') ||
        erroTelefone(form.telefone) ||
        (!completing && state.users.some((u) => u.email.trim().toLowerCase() === form.email.trim().toLowerCase())
          ? 'Este e-mail já tem uma conta. Use outro e-mail ou entre com ele na tela de login.'
          : '')
      if (!falhaDados && !completing) {
        const existeNuvem = await emailExisteNaNuvem(form.email.trim().toLowerCase())
        if (existeNuvem) {
          setError('Este e-mail já tem uma conta. Use outro e-mail ou entre com ele na tela de login.')
          return
        }
      }
      if (falhaDados) {
        setError(falhaDados)
        return
      }
    }
    if (step === PASSO.documentos && !documentosProntos()) {
      setError(problemaDocumentos())
      return
    }
    if (step === PASSO.cargos && form.profissoes.length === 0) {
      setError('Selecione ao menos um cargo.')
      return
    }
    if (step === PASSO.experiencia) {
      const falha = conferirExperiencias(form.experiencia)
      if (falha) {
        setError(falha)
        return
      }
    }
    if (step === PASSO.disponibilidade && !Object.values(form.disponibilidade).some(Boolean)) {
      setError('Marque pelo menos uma opção de disponibilidade.')
      return
    }
    if (step === PASSO.raio) {
      if (!form.cidade.trim() || !form.estado.trim()) {
        setError('Informe a cidade e o estado onde você mora.')
        return
      }
      if (form.raioKm == null || form.raioKm < 1) {
        setError('Informe o raio máximo, em km, que você pode ir trabalhar.')
        return
      }
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
    if (!documentosProntos()) {
      setError(problemaDocumentos())
      setStep(PASSO.documentos)
      return
    }
    const falhaExp = conferirExperiencias(form.experiencia)
    if (falhaExp) {
      setError(falhaExp)
      setStep(PASSO.experiencia)
      return
    }
    if (form.raioKm == null || form.raioKm < 1) {
      setError('Informe o raio máximo, em km, que você pode ir trabalhar.')
      setStep(PASSO.raio)
      return
    }
    const chave = validarChavePix(form.pix)
    if (!chave.ok) {
      setError(chave.erro)
      setStep(PASSO.pagamento)
      return
    }
    if (!todosAceitos('profissional', aceites)) {
      setError('Marque todos os termos e consentimentos para concluir o cadastro.')
      return
    }
    const hoje = hojeLocal()
    const habilidades = habilidadesDoTexto(form.habilidades)
    const cnh = form.cnhCategoria.trim()
    const profissionalPayload = {
      nome: form.nome,
      cpf: form.cpf,
      rg: form.rg,
      nascimento: form.nascimento,
      telefone: form.telefone,
      resumo: semContato(form.resumo).slice(0, 600) || undefined,
      escolaridade: form.escolaridade || undefined,
      habilidades: habilidades.length ? habilidades : undefined,
      profissoes: form.profissoes,
      experiencia: form.experiencia
        .filter((item) => item.cargo.trim() || item.empresa.trim())
        .map((item) => ({
          ...item,
          cargo: item.cargo.trim(),
          empresa: item.empresa.trim(),
          descricao: semContato(item.descricao),
        })),
      certificados: form.certificados.map((item) => ({
        ...item,
        valido: !item.validade || item.validade >= hoje,
      })),
      cnhCategoria: cnh || undefined,
      cnhValidade: cnh && form.cnhValidade ? form.cnhValidade : undefined,
      disponibilidade: form.disponibilidade,
      endereco: {
        cep: form.cep,
        rua: form.rua,
        numero: form.numero,
        complemento: form.complemento.trim() || undefined,
        coordOrigem: origemParaGravar(localizacao.origem),
        cidade: form.cidade.trim(),
        estado: form.estado.trim().toUpperCase(),
        ...(localizacao.ponto ??
          coordenadaDaCidade(form.cidade, form.estado, [
            ...state.profissionais.map((pessoa) => pessoa.endereco),
            ...state.empresas.map((empresa) => empresa.endereco),
          ])),
      },
      raioKm: form.raioKm,
      pix: chave.chave,
      banco: form.banco.trim() || undefined,
    }
    const documentos = documentosEnviados()
    if (enviando) return
    setEnviando(true)
    try {
      // Os termos vão junto para a conta no banco (antes ficavam só no navegador e o aviso de
      // termos voltava a cada sincronização).
      const res = await (completing
        ? completeProfissionalPerfil(profissionalPayload, documentos, aceites)
        : registerProfissional({ email: form.email, senha: form.senha }, profissionalPayload, documentos))
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
    <div className="auth-screen auth-screen--scroll">
      <form
        className="auth-card auth-card--wide"
        onSubmit={step === ETAPAS.length ? submit : (e) => { e.preventDefault(); next() }}
      >
        <button type="button" className="btn btn-ghost link-back" onClick={prev}>
          ← Voltar
        </button>
        <h1 className="auth-title">Cadastro de trabalhador</h1>
        <p className="step-indicator">
          Etapa {step} de {ETAPAS.length} · {ETAPAS[step - 1]}
        </p>

        {step === PASSO.curriculo && (
          <>
            <p>
              <strong>Como funciona:</strong> clique no quadro abaixo e escolha seu currículo em PDF ou Word. A gente lê o
              arquivo e já preenche nome, experiências, cursos e cidade nas próximas etapas. Depois é só conferir e corrigir
              o que precisar.
            </p>
            <AnexoCurriculo onLido={aplicarCurriculo} arquivoAtual={curriculo?.nome} />
            <p className="cv-nota">
              A empresa que contrata vê o currículo organizado pela plataforma: cargos, experiências, cursos e
              cidade. Telefone, CPF, endereço e o arquivo original ficam só com a equipe da fazumfreela.
            </p>
            {!curriculo && <p className="muted">Sem currículo, é só continuar e preencher os campos.</p>}
          </>
        )}
        {step === PASSO.dados && (
          <>
            <label className="field"><span>Nome completo</span><input value={form.nome} onChange={(e) => set('nome', e.target.value)} required /></label>
            <label className="field"><span>CPF</span><input value={form.cpf} onChange={(e) => set('cpf', mascararCpf(e.target.value))} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" maxLength={14} required /></label>
            {form.cpf.replace(/\D/g, '').length === 11 && erroCpf(form.cpf) && <p className="portal-login__erro">{erroCpf(form.cpf)}</p>}
            <label className="field"><span>RG</span><input value={form.rg} onChange={(e) => set('rg', mascararRg(e.target.value))} autoComplete="off" placeholder="00.000.000-0" maxLength={18} required /></label>
            <label className="field">
              <span>Estado que emitiu o RG</span>
              <select value={form.rgUf} onChange={(e) => set('rgUf', e.target.value)}>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </label>
            <label className="field"><span>Nascimento</span><input type="date" value={form.nascimento} onChange={(e) => set('nascimento', e.target.value)} required /></label>
            <label className="field"><span>Telefone</span><input type="tel" value={form.telefone} onChange={(e) => set('telefone', mascararTelefone(e.target.value))} inputMode="tel" autoComplete="tel-national" placeholder="(11) 91234-5678" maxLength={15} required /></label>
            {dddInfo && <small className="muted">{dddInfo}</small>}
            {!completing && (
              <>
                <label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></label>
                <label className="field"><span>Senha</span><input type="password" value={form.senha} onChange={(e) => set('senha', e.target.value)} required minLength={6} /></label>
              </>
            )}
            {completing && <p className="muted">Conta: {currentUser?.email}</p>}
          </>
        )}
        {step === PASSO.documentos && (
          <div className="docs-mock">
            <p>Anexe foto (JPG, PNG) ou PDF. Itens com * são obrigatórios. Os arquivos são conferidos pela equipe na validação do cadastro.</p>
            <CampoDoc titulo="Documento com foto (RG, CIN ou CNH)" obrigatorio dica="Frente legível, com nome e CPF." papel="documento" linha={linhas.documento} onEscolher={escolherFoto} />
            <CampoDoc titulo="Verso do documento" dica="Opcional. Envie se o CPF estiver no verso." papel="verso" linha={linhas.verso} onEscolher={escolherFoto} />
            <CampoDoc titulo="Selfie" obrigatorio dica="Rosto visível, sem óculos escuros ou boné." papel="selfie" linha={linhas.selfie} onEscolher={escolherFoto} />
            <label className="field">
              <span>CNH (categoria, se aplicável)</span>
              <input
                value={form.cnhCategoria}
                onChange={(e) => set('cnhCategoria', e.target.value.toUpperCase())}
                placeholder="Ex: ACC, A, B, C, D, E"
              />
            </label>
            {form.cnhCategoria.trim() && (
              <label className="field">
                <span>Validade da CNH</span>
                <input type="date" value={form.cnhValidade} onChange={(e) => set('cnhValidade', e.target.value)} />
              </label>
            )}
          </div>
        )}
        {step === PASSO.cargos && (
          <div className="prof-select">
            {CATEGORIES.map((cat) => (
              <div key={cat.id} className="prof-group">
                <h3>{cat.label}</h3>
                <div className="chip-wrap">
                  {cat.cargos.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`chip ${form.profissoes.includes(c.id) ? 'chip--on' : ''}`}
                      onClick={() => toggleProf(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {step === PASSO.experiencia && (
          <>
            <CamposSobre
              resumo={form.resumo}
              escolaridade={form.escolaridade}
              habilidades={form.habilidades}
              onChange={(campo, valor) => set(campo, valor)}
              classeCampo="field"
            />
            <ListaExperiencias itens={form.experiencia} onChange={(lista) => set('experiencia', lista)} classeCampo="field" />
          </>
        )}
        {step === PASSO.certificacoes && (
          <>
            <div className="chip-wrap">
              {CERTIFICADOS_COMUNS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`chip ${form.certificados.some((item) => item.tipo === c) ? 'chip--on' : ''}`}
                  onClick={() => toggleCert(c)}
                >
                  {c}
                </button>
              ))}
              {certsExtras.map((item) => (
                <button key={item.tipo} type="button" className="chip chip--on" onClick={() => toggleCert(item.tipo)}>
                  {item.tipo}
                </button>
              ))}
            </div>
            <div className="cv-certs__outro">
              <label className="field">
                <span>Outro curso ou certificado</span>
                <input
                  value={certNovo}
                  maxLength={60}
                  placeholder="Ex.: NR12, Direção defensiva"
                  onChange={(e) => setCertNovo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      incluirCert()
                    }
                  }}
                />
              </label>
              <button type="button" className="btn btn-ghost" onClick={incluirCert}>
                Incluir
              </button>
            </div>
            {form.certificados.length > 0 && (
              <div className="cv-certs">
                <p className="muted">Informe a validade de cada certificado que tiver data de vencimento.</p>
                {form.certificados.map((item) => (
                  <label key={item.tipo} className="field">
                    <span>Validade de {item.tipo}</span>
                    <input type="date" value={item.validade} onChange={(e) => validadeCert(item.tipo, e.target.value)} />
                  </label>
                ))}
              </div>
            )}
            <p className="cv-nota">
              Depois do cadastro, envie o certificado de cada curso em Documentos. As empresas encontram primeiro quem
              tem os certificados aprovados pela equipe da fazumfreela.
            </p>
          </>
        )}
        {step === PASSO.disponibilidade && (
          <AvailabilityToggle value={form.disponibilidade} onChange={(d) => set('disponibilidade', d)} />
        )}
        {step === PASSO.raio && (
          <div className="raio-passo">
            <label className="field">
              <span>CEP</span>
              <input value={form.cep} onChange={(e) => set('cep', mascararCep(e.target.value))} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} />
              {cepStatus.texto && <small className={cepStatus.erro ? 'error' : 'muted'}>{cepStatus.texto}</small>}
            </label>
            <p>A partir da sua cidade, você só entra em missões dentro desse raio.</p>
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
                list="cidades-colaborador"
                onChange={(e) => set('cidade', e.target.value)}
                placeholder="Onde você mora"
                required
              />
              <datalist id="cidades-colaborador">
                {cidades.map((cidade) => (
                  <option key={cidade} value={cidade} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Rua</span>
              <input value={form.rua} onChange={(e) => set('rua', e.target.value)} autoComplete="address-line1" />
            </label>
            <label className="field">
              <span>Número</span>
              <input value={form.numero} onChange={(e) => set('numero', e.target.value)} />
            </label>
            <label className="field">
              <span>Complemento (opcional)</span>
              <input
                value={form.complemento}
                onChange={(e) => set('complemento', e.target.value)}
                placeholder="Apto, bloco, casa 2..."
                autoComplete="address-line2"
                maxLength={60}
              />
            </label>
            <label className="field">
              <span>Raio máximo para trabalhar</span>
              <span className="raio-linha">
                <input
                  type="number"
                  min={1}
                  max={500}
                  inputMode="numeric"
                  value={form.raioKm ?? ''}
                  placeholder="km"
                  aria-label="Raio máximo em quilômetros"
                  onChange={(e) => definirRaio(e.target.value)}
                />
                <span>km</span>
              </span>
            </label>
            <div className="raio-opcoes">
              {RAIOS.map((km) => (
                <button
                  key={km}
                  type="button"
                  className={`chip ${form.raioKm === km ? 'chip--on' : ''}`}
                  onClick={() => set('raioKm', km)}
                >
                  {km} km
                </button>
              ))}
            </div>
            {form.cidade.trim() && form.raioKm != null && (
              <p className="raio-resumo">
                Você pode ir trabalhar em até {form.raioKm} km de {form.cidade.trim()}/{form.estado}.
              </p>
            )}
            <MapaRaio
              ponto={localizacao.ponto}
              origem={localizacao.origem}
              raioKm={form.raioKm}
              cidade={form.cidade.trim()}
              onMover={localizacao.mover}
            />
          </div>
        )}
        {step === PASSO.pagamento && (
          <>
            <p className="muted">
              Raio definido: até {form.raioKm} km de {form.cidade}/{form.estado}.
            </p>
            <label className="field">
              <span>Chave PIX</span>
              <input value={form.pix} onChange={(e) => set('pix', e.target.value)} placeholder="CPF, e-mail, celular ou chave aleatória" required />
            </label>
            {pixInfo?.ok && <p className="docs-ok">Chave de {pixInfo.rotulo} conferida.</p>}
            {pixInfo && !pixInfo.ok && <p className="error">{pixInfo.erro}</p>}
            <label className="field">
              <span>Banco da conta Pix (opcional)</span>
              <input value={form.banco} list="bancos-pix" onChange={(e) => set('banco', e.target.value)} placeholder="Comece a digitar o nome ou o código" />
              <datalist id="bancos-pix">
                {bancos.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <small className="muted">A chave Pix não mostra o banco. Informe para a equipe conferir o pagamento mais rápido.</small>
            </label>
            <AceiteCadastro
              role="profissional"
              marcados={aceites}
              onMarcar={(marcados) => {
                setAceites(marcados)
                setError('')
              }}
            />
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-accent btn-block" disabled={enviando}>
          {step === ETAPAS.length ? (enviando ? 'Enviando cadastro…' : 'Concluir cadastro') : 'Continuar'}
        </button>
      </form>
    </div>
  )
}

function CampoDoc({
  titulo,
  obrigatorio,
  dica,
  papel,
  linha,
  onEscolher,
}: {
  titulo: string
  obrigatorio?: boolean
  dica?: string
  papel: PapelDocumento
  linha: LinhaDoc
  onEscolher: (file: File | undefined, papel: PapelDocumento) => void
}) {
  return (
    <div className="docs-item">
      <div className="field">
        <span>
          {titulo}
          {obrigatorio ? <span className="error"> *</span> : null}
        </span>
        {dica && <small className="muted">{dica}</small>}
        {linha.arquivo && <small className="muted">{linha.arquivo.nome}</small>}
        {linha.status === 'analisando' && <small className="muted">Conferindo o arquivo...</small>}
        {linha.status === 'aceito' && <small style={{ color: '#15803d' }}>Arquivo conferido.</small>}
        {linha.status === 'manual' && <small className="muted">Recebido. Será conferido na validação manual.</small>}
        {linha.status === 'recusado' && <small className="error">Não aceito: {linha.motivo || 'não deu para conferir'}</small>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {linha.arquivo && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => linha.arquivo && abrirArquivo(linha.arquivo)}>
                Visualizar
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onEscolher(undefined, papel)}>
                Excluir
              </button>
            </>
          )}
          <label className="btn btn-ghost">
            {linha.arquivo ? 'Trocar' : 'Anexar'}
            <input
              type="file"
              hidden
              accept={ACCEPT_DOCUMENTO_CADASTRO}
              onChange={(e) => {
                onEscolher(e.target.files?.[0], papel)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
