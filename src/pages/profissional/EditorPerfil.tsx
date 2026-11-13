import { UFS, mascararCep, useCepAutomatico, useCidadesDaUf } from '../../lib/apisPublicas'
import { mascararCpf, mascararRg, mascararTelefone } from '../../lib/documentosPessoais'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnexoCurriculo, CamposSobre, ListaExperiencias, conferirExperiencias } from '../../components/CurriculoCampos'
import { MapaRaio } from '../../components/MapaRaio'
import { RecorteFoto, carregarFotoParaRecorte } from '../../components/RecorteFoto'
import { CATEGORIES, cargoLabel } from '../../data/categories'
import { LOCAIS_OPERACAO } from '../../data/cidades'
import { coordenadaDaCidade } from '../../lib/coordenadaCidade'
import { chaveDoEndereco, pontoValido, useLocalizacaoEndereco } from '../../lib/localizacaoEndereco'
import { hojeLocal } from '../../lib/ponto'
import { CERTIFICADOS_COMUNS, habilidadesDoTexto, mesclarCurriculo, nomeCertificado } from '../../lib/curriculo'
import type { LeituraCurriculo } from '../../lib/lerCurriculo'
import { validarChavePix } from '../../lib/pix'
import { useStore } from '../../lib/store'
import type { Certificado, Disponibilidade, Experiencia, Profissional } from '../../lib/types'

const CERTS = CERTIFICADOS_COMUNS
const RAIOS = [10, 25, 50, 100]
const TURNOS: { key: keyof Disponibilidade; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'amanha', label: 'Amanhã' },
  { key: 'estaSemana', label: 'Esta semana' },
  { key: 'finaisDeSemana', label: 'Finais de semana' },
  { key: 'noturno', label: 'Noturno' },
  { key: 'viagens', label: 'Viagens' },
  { key: 'temporario', label: 'Temporário' },
  { key: 'efetivo', label: 'Efetivo' },
  { key: 'freelancer', label: 'Freelancer' },
]

type Rascunho = {
  nome: string
  cpf: string
  rg: string
  nascimento: string
  telefone: string
  foto?: string
  resumo: string
  escolaridade: string
  habilidades: string
  profissoes: string[]
  experiencia: Experiencia[]
  certificados: Certificado[]
  cnhCategoria: string
  cnhValidade: string
  disponibilidade: Disponibilidade
  cep: string
  rua: string
  numero: string
  complemento: string
  cidade: string
  estado: string
  raioKm: number | null
  pix: string
}

function rascunhoDe(prof: Profissional): Rascunho {
  return {
    nome: prof.nome,
    cpf: prof.cpf,
    rg: prof.rg,
    nascimento: prof.nascimento,
    telefone: prof.telefone,
    foto: prof.foto,
    resumo: prof.resumo ?? '',
    escolaridade: prof.escolaridade ?? '',
    habilidades: (prof.habilidades ?? []).join(', '),
    profissoes: [...prof.profissoes],
    experiencia: prof.experiencia.map((item) => ({ ...item })),
    certificados: prof.certificados.map((item) => ({ ...item })),
    cnhCategoria: prof.cnhCategoria ?? '',
    cnhValidade: prof.cnhValidade ?? '',
    disponibilidade: { ...prof.disponibilidade },
    cep: prof.endereco.cep,
    rua: prof.endereco.rua,
    numero: prof.endereco.numero,
    complemento: prof.endereco.complemento ?? '',
    cidade: prof.endereco.cidade,
    estado: prof.endereco.estado,
    raioKm: prof.raioKm,
    pix: prof.pix,
  }
}

export function EditorPerfil({
  prof,
  onFechar,
  onSalvou,
}: {
  prof: Profissional
  onFechar: () => void
  onSalvou: () => void
}) {
  const { state, atualizarPerfilProfissional, enviarDocumento } = useStore()
  const certNovoId = useId()
  const [form, setForm] = useState<Rascunho>(() => rascunhoDe(prof))
  const [certNovo, setCertNovo] = useState('')
  const [erro, setErro] = useState('')
  const [curriculo, setCurriculo] = useState<{ nome: string; copia?: string } | null>(null)
  const formAtual = useRef(form)
  const arquivoAtual = state.documentos.find(
    (doc) => doc.donoTipo === 'profissional' && doc.donoId === prof.id && doc.tipoId === 'curriculo',
  )?.arquivoNome

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
  const pontoCidade = useMemo(() => {
    const ponto = coordenadaDaCidade(form.cidade, form.estado, [
      ...state.profissionais.map((pessoa) => pessoa.endereco),
      ...state.empresas.map((empresa) => empresa.endereco),
    ])
    return pontoValido(ponto) ? ponto : null
  }, [form.cidade, form.estado, state.profissionais, state.empresas])
  // O ponto já salvo vale enquanto o endereço não muda (pode ter sido ajustado à mão no mapa).
  const salvo = useMemo(
    () => ({ chave: chaveDoEndereco(prof.endereco), ponto: { lat: prof.endereco.lat, lng: prof.endereco.lng } }),
    [prof.endereco],
  )
  const localizacao = useLocalizacaoEndereco({
    endereco: { rua: form.rua, numero: form.numero, cidade: form.cidade, estado: form.estado },
    pontoCep: cepStatus.coord,
    pontoCidade,
    salvo,
  })
  const pixInfo = form.pix.trim() ? validarChavePix(form.pix) : null

  // Foto trocada por fora (painel do topo) enquanto o editor está aberto: o rascunho acompanha.
  const fotoSalva = useRef(prof.foto)
  useEffect(() => {
    if (prof.foto === fotoSalva.current) return
    fotoSalva.current = prof.foto
    setForm((atual) => ({ ...atual, foto: prof.foto }))
  }, [prof.foto])
  const arquivoFotoRef = useRef<HTMLInputElement>(null)
  const [fotoOriginal, setFotoOriginal] = useState<string | null>(null)
  const [erroFoto, setErroFoto] = useState('')

  async function escolherFoto(file: File | undefined) {
    if (!file) return
    try {
      setFotoOriginal(await carregarFotoParaRecorte(file))
      setErroFoto('')
    } catch (falha) {
      setErroFoto(falha instanceof Error ? falha.message : 'Não foi possível ler a foto.')
    }
  }
  const iniciaisNome = form.nome
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((parte, indice, partes) => (indice === 0 || indice === partes.length - 1 ? parte[0] : ''))
    .join('')
    .toUpperCase()

  function set<K extends keyof Rascunho>(chave: K, valor: Rascunho[K]) {
    setForm((atual) => ({ ...atual, [chave]: valor }))
  }

  function alternarProfissao(id: string) {
    set(
      'profissoes',
      form.profissoes.includes(id) ? form.profissoes.filter((item) => item !== id) : [...form.profissoes, id],
    )
  }

  function alternarCertificado(tipo: string) {
    const existe = form.certificados.some((item) => item.tipo === tipo)
    set(
      'certificados',
      existe
        ? form.certificados.filter((item) => item.tipo !== tipo)
        : [...form.certificados, { tipo, validade: '', valido: true }],
    )
  }

  function atualizarCertificado(tipo: string, validade: string) {
    const hoje = hojeLocal()
    set(
      'certificados',
      form.certificados.map((item) =>
        item.tipo === tipo ? { ...item, validade, valido: !validade || validade >= hoje } : item,
      ),
    )
  }

  function aplicarCurriculo(leitura: LeituraCurriculo) {
    const { form: novo, entrou } = mesclarCurriculo(formAtual.current, leitura.lido)
    formAtual.current = novo
    setForm(novo)
    setCurriculo({ nome: leitura.arquivoNome, copia: leitura.copia })
    return entrou
  }

  function salvar() {
    setErro('')
    if (form.nome.trim().length < 3) {
      setErro('Informe o nome.')
      return
    }
    if (form.profissoes.length === 0) {
      setErro('Selecione ao menos um cargo.')
      return
    }
    const falhaExp = conferirExperiencias(form.experiencia)
    if (falhaExp) {
      setErro(falhaExp)
      return
    }
    if (!form.cidade.trim() || !form.estado.trim()) {
      setErro('Informe a cidade e o estado.')
      return
    }
    if (form.raioKm == null || form.raioKm < 1) {
      setErro('Informe o raio máximo, em km.')
      return
    }
    const mesmaCidade =
      form.cidade.trim().toLowerCase() === prof.endereco.cidade.trim().toLowerCase() &&
      form.estado.trim().toUpperCase() === prof.endereco.estado.trim().toUpperCase()
    const coordenada = localizacao.ponto
      ? localizacao.ponto
      : cepStatus.coord
      ? cepStatus.coord
      : mesmaCidade
      ? { lat: prof.endereco.lat, lng: prof.endereco.lng }
      : coordenadaDaCidade(form.cidade, form.estado, [
          ...state.profissionais.map((pessoa) => pessoa.endereco),
          ...state.empresas.map((empresa) => empresa.endereco),
        ])
    const experiencia = form.experiencia
      .filter((item) => item.cargo.trim() || item.empresa.trim())
      .map((item) => ({ ...item, cargo: item.cargo.trim(), empresa: item.empresa.trim() }))
    const res = atualizarPerfilProfissional(prof.id, {
      nome: form.nome,
      cpf: form.cpf,
      rg: form.rg,
      nascimento: form.nascimento,
      telefone: form.telefone,
      foto: form.foto,
      resumo: form.resumo,
      escolaridade: form.escolaridade,
      habilidades: habilidadesDoTexto(form.habilidades),
      profissoes: form.profissoes,
      experiencia,
      certificados: form.certificados.filter((item) => item.tipo.trim()),
      cnhCategoria: form.cnhCategoria,
      cnhValidade: form.cnhValidade,
      disponibilidade: form.disponibilidade,
      endereco: {
        cep: form.cep,
        rua: form.rua,
        numero: form.numero,
        complemento: form.complemento.trim() || undefined,
        cidade: form.cidade,
        estado: form.estado,
        ...coordenada,
      },
      raioKm: form.raioKm,
      pix: form.pix,
    })
    if (!res.ok) {
      setErro(res.error ?? 'Não foi possível salvar o perfil.')
      return
    }
    if (curriculo) {
      enviarDocumento({
        tipoId: 'curriculo',
        donoTipo: 'profissional',
        donoId: prof.id,
        arquivoNome: curriculo.nome,
        arquivoDados: curriculo.copia,
      })
    }
    onSalvou()
  }

  return (
    <div className="td-editor">
      <section className="td-card">
        <h2>Foto de perfil</h2>
        <div className="td-foto-linha">
          <span className="td-foto-previa" aria-hidden="true">
            {form.foto ? <img src={form.foto} alt="" /> : <span>{iniciaisNome || '?'}</span>}
          </span>
          <div className="td-foto-botoes">
            <button type="button" className="td-editor-sec" onClick={() => arquivoFotoRef.current?.click()}>
              {form.foto ? 'Trocar foto' : 'Adicionar foto'}
            </button>
            {form.foto && (
              <button type="button" className="td-link td-link--perigo" onClick={() => set('foto', '')}>
                Remover foto
              </button>
            )}
          </div>
        </div>
        <p className="td-editor-resumo">
          Use uma foto do rosto, de frente e com boa luz. Depois de escolher, você ajusta o enquadramento. Vale quando
          tocar em Salvar perfil.
        </p>
        {erroFoto && <p className="error">{erroFoto}</p>}
        <input
          ref={arquivoFotoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(evento) => {
            void escolherFoto(evento.target.files?.[0])
            evento.target.value = ''
          }}
        />
        {fotoOriginal && (
          <RecorteFoto
            src={fotoOriginal}
            onCancelar={() => setFotoOriginal(null)}
            onConfirmar={(foto) => {
              setFotoOriginal(null)
              set('foto', foto)
            }}
          />
        )}
      </section>

      <section className="td-card">
        <h2>Currículo</h2>
        <p className="td-editor-resumo">
          Anexe o currículo em PDF ou Word. O que estiver nele entra nos campos abaixo, sem apagar o que você já
          escreveu. Confira e salve.
        </p>
        <AnexoCurriculo onLido={aplicarCurriculo} arquivoAtual={curriculo?.nome ?? arquivoAtual} />
      </section>

      <section className="td-card">
        <h2>Sobre você</h2>
        <div className="td-form">
          <CamposSobre
            resumo={form.resumo}
            escolaridade={form.escolaridade}
            habilidades={form.habilidades}
            onChange={(campo, valor) => set(campo, valor)}
          />
        </div>
      </section>

      <section className="td-card">
        <h2>Seus dados</h2>
        <div className="td-form">
          <label>
            <span>Nome completo</span>
            <input value={form.nome} onChange={(e) => set('nome', e.target.value)} />
          </label>
          <label>
            <span>Nascimento</span>
            <input type="date" value={form.nascimento} onChange={(e) => set('nascimento', e.target.value)} />
          </label>
          <label>
            <span>Telefone</span>
            <input type="tel" inputMode="tel" value={form.telefone} onChange={(e) => set('telefone', mascararTelefone(e.target.value))} placeholder="(11) 91234-5678" maxLength={15} />
          </label>
          <label>
            <span>CPF</span>
            <input inputMode="numeric" value={form.cpf} onChange={(e) => set('cpf', mascararCpf(e.target.value))} placeholder="000.000.000-00" maxLength={14} />
          </label>
          <label>
            <span>RG</span>
            <input value={form.rg} onChange={(e) => set('rg', mascararRg(e.target.value))} />
          </label>
        </div>
      </section>

      <section className="td-card">
        <h2>Onde você mora</h2>
        <div className="td-form">
          <label>
              <span>CEP</span>
              <input value={form.cep} onChange={(e) => set('cep', mascararCep(e.target.value))} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} />
              {cepStatus.texto && <small className={cepStatus.erro ? 'error' : 'muted'}>{cepStatus.texto}</small>}
            </label>
          <label>
            <span>Estado</span>
            <select value={form.estado} onChange={(e) => set('estado', e.target.value)}>
              {ufs.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Cidade</span>
            <input
              value={form.cidade}
              list="cidades-perfil"
              onChange={(e) => set('cidade', e.target.value)}
            />
            <datalist id="cidades-perfil">
              {cidades.map((cidade) => (
                <option key={cidade} value={cidade} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Rua</span>
            <input value={form.rua} onChange={(e) => set('rua', e.target.value)} />
          </label>
          <label>
            <span>Número</span>
            <input value={form.numero} onChange={(e) => set('numero', e.target.value)} />
          </label>
          <label>
            <span>Complemento (opcional)</span>
            <input
              value={form.complemento}
              onChange={(e) => set('complemento', e.target.value)}
              placeholder="Apto, bloco, casa 2..."
              autoComplete="address-line2"
              maxLength={60}
            />
          </label>

          <label>
            <span>Raio máximo para trabalhar (km)</span>
            <input
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              value={form.raioKm ?? ''}
              onChange={(e) => {
                const numero = Number(e.target.value)
                set('raioKm', e.target.value === '' || !Number.isFinite(numero) || numero <= 0 ? null : Math.min(500, Math.round(numero)))
              }}
            />
          </label>
        </div>
        <div className="td-chips">
          {RAIOS.map((km) => (
            <button
              key={km}
              type="button"
              className={form.raioKm === km ? 'td-chip td-chip--on' : 'td-chip'}
              onClick={() => set('raioKm', km)}
            >
              {km} km
            </button>
          ))}
        </div>
        <MapaRaio
          ponto={localizacao.ponto}
          origem={localizacao.origem}
          raioKm={form.raioKm}
          cidade={form.cidade.trim()}
          onMover={localizacao.mover}
        />
      </section>

      <section className="td-card">
        <h2>CNH e pagamento</h2>
        <div className="td-form">
          <label>
            <span>Categoria da CNH</span>
            <input
              value={form.cnhCategoria}
              placeholder="Ex: B, C, D, E"
              onChange={(e) => set('cnhCategoria', e.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>Validade da CNH</span>
            <input type="date" value={form.cnhValidade} onChange={(e) => set('cnhValidade', e.target.value)} />
          </label>
          <label>
            <span>Chave PIX</span>
            <input
              value={form.pix}
              placeholder="CPF, e-mail, celular ou chave aleatória"
              onChange={(e) => set('pix', e.target.value)}
            />
          </label>
          {pixInfo?.ok && <p className="td-form-full docs-ok">Chave de {pixInfo.rotulo} conferida.</p>}
          {pixInfo && !pixInfo.ok && <p className="td-form-full error">{pixInfo.erro}</p>}
        </div>
      </section>

      <section className="td-card">
        <h2>Profissões</h2>
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="td-editor-grupo">
            <h3>{cat.label}</h3>
            <div className="td-chips">
              {cat.cargos.map((cargo) => (
                <button
                  key={cargo.id}
                  type="button"
                  className={form.profissoes.includes(cargo.id) ? 'td-chip td-chip--on' : 'td-chip'}
                  onClick={() => alternarProfissao(cargo.id)}
                >
                  {cargo.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="td-card">
        <h2>Experiência</h2>
        <div className="td-form">
          <ListaExperiencias itens={form.experiencia} onChange={(lista) => set('experiencia', lista)} />
        </div>
      </section>

      <section className="td-card">
        <h2>Certificados</h2>
        <div className="td-chips">
          {CERTS.map((tipo) => (
            <button
              key={tipo}
              type="button"
              className={form.certificados.some((item) => item.tipo === tipo) ? 'td-chip td-chip--on' : 'td-chip'}
              onClick={() => alternarCertificado(tipo)}
            >
              {tipo}
            </button>
          ))}
          {form.certificados
            .filter((item) => !CERTS.includes(item.tipo))
            .map((item) => (
              <button
                key={item.tipo}
                type="button"
                className="td-chip td-chip--on"
                onClick={() => alternarCertificado(item.tipo)}
              >
                {item.tipo}
              </button>
            ))}
        </div>
        <div className="td-form" style={{ marginTop: 12 }}>
          {form.certificados.map((item) => (
            <label key={item.tipo}>
              <span>Validade de {item.tipo}</span>
              <input type="date" value={(item.validade || '').slice(0, 10)} onChange={(e) => atualizarCertificado(item.tipo, e.target.value)} />
            </label>
          ))}
          <label className="td-form-full">
            <span>Outro certificado</span>
            <span className="td-inline">
              <input id={certNovoId} value={certNovo} onChange={(e) => setCertNovo(e.target.value)} />
              <button
                type="button"
                className="td-link"
                onClick={() => {
                  const tipo = nomeCertificado(certNovo)
                  if (!tipo || form.certificados.some((item) => item.tipo.toLowerCase() === tipo.toLowerCase())) return
                  alternarCertificado(tipo)
                  setCertNovo('')
                }}
              >
                Incluir
              </button>
            </span>
          </label>
        </div>
      </section>

      <section className="td-card">
        <h2>Disponibilidade</h2>
        <div className="td-chips">
          {TURNOS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={form.disponibilidade[item.key] ? 'td-chip td-chip--on' : 'td-chip'}
              onClick={() =>
                set('disponibilidade', { ...form.disponibilidade, [item.key]: !form.disponibilidade[item.key] })
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {form.profissoes.length > 0 && (
        <p className="td-editor-resumo">
          Cargo principal: {cargoLabel(form.profissoes[0])}. A empresa vê o resumo, os cargos, as experiências, os
          certificados e a cidade.
        </p>
      )}
      {erro && <p className="error">{erro}</p>}
      <div className="td-editor-acoes">
        <button type="button" className="td-editor-sec" onClick={onFechar}>
          Cancelar
        </button>
        <button type="button" className="td-editor-pri" onClick={salvar}>
          Salvar perfil
        </button>
      </div>
    </div>
  )
}
