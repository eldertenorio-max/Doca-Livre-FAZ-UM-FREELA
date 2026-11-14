/**
 * Posição (lat/lng) de trabalhadores e empresas a partir do endereço cadastrado.
 *
 * Cadastros antigos ficaram com o centro da cidade (com um desvio aleatório), e o mapa da empresa mostrava todo
 * mundo no centro. Ao subir a API, esta tarefa roda em segundo plano e recalcula quem ainda não tem posição tirada
 * do endereço: primeiro pela rua e cidade (OpenStreetMap/Nominatim), depois pelo CEP (BrasilAPI). Quem ajustou o
 * marcador à mão ("manual") ou já tem posição pela rua ("endereco") fica como está.
 *
 * Privacidade: para o OpenStreetMap vão só rua, cidade e UF (sem número); para a BrasilAPI, só o CEP. A empresa
 * continua recebendo a coordenada arredondada (~1 km) pela vitrine (003_seguranca.sql).
 */
import { pool } from './migrar.mjs'

const AGENTE = 'fazumfreela/1.0 (+https://fazumfreela.com.br)'
const INTERVALO_MS = 1100 // o Nominatim pede no máximo uma busca por segundo
const NOVA_TENTATIVA_DIAS = 7
const TRAVA = 7182031 // pg_advisory_lock: só uma réplica roda a tarefa

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function pontoValido(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) && lat > -35 && lat < 6 && lng > -75 && lng < -32
}

async function nominatim(q) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', q })
  const resposta = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': AGENTE, Accept: 'application/json', 'Accept-Language': 'pt-BR' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!resposta.ok) throw new Error(`OpenStreetMap respondeu ${resposta.status}`)
  const lista = await resposta.json()
  const lat = Number(lista[0]?.lat)
  const lng = Number(lista[0]?.lon)
  return pontoValido(lat, lng) ? { lat, lng } : null
}

async function pontoDoCep(cep) {
  const digitos = String(cep || '').replace(/\D/g, '')
  if (digitos.length !== 8) return null
  try {
    const resposta = await fetch(`https://brasilapi.com.br/api/cep/v2/${digitos}`, {
      headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!resposta.ok) return null
    const dados = await resposta.json()
    const lat = Number(dados?.location?.coordinates?.latitude)
    const lng = Number(dados?.location?.coordinates?.longitude)
    return pontoValido(lat, lng) ? { lat, lng } : null
  } catch {
    return null
  }
}

/** Ponto do endereço: { lat, lng, origem } ou null. Lança erro se o OpenStreetMap estiver fora do ar. */
export async function pontoDoEndereco(endereco) {
  const rua = String(endereco?.rua || '').split(' - ')[0].trim()
  const cidade = String(endereco?.cidade || '').trim()
  const uf = String(endereco?.estado || '').trim().toUpperCase()
  if (rua && cidade) {
    const ponto = await nominatim(`${rua}, ${cidade}, ${uf}, Brasil`)
    await esperar(INTERVALO_MS)
    if (ponto) return { ...ponto, origem: 'endereco' }
  }
  const doCep = await pontoDoCep(endereco?.cep)
  return doCep ? { ...doCep, origem: 'cep' } : null
}

function precisaRecalcular(endereco, limite) {
  if (!endereco || typeof endereco !== 'object') return false
  if (!String(endereco.rua || '').trim() && String(endereco.cep || '').replace(/\D/g, '').length !== 8) return false
  const origem = endereco.coordOrigem
  if (origem === 'endereco' || origem === 'manual') return false
  return !endereco.coordTentativa || endereco.coordTentativa < limite
}

async function recalcularTabela(cliente, tabela, limite) {
  const { rows } = await cliente.query(`select id, payload->'endereco' as endereco from ${tabela}`)
  let corrigidos = 0
  for (const linha of rows) {
    if (!precisaRecalcular(linha.endereco, limite)) continue
    const ponto = await pontoDoEndereco(linha.endereco)
    const extra = { coordTentativa: new Date().toISOString().slice(0, 10) }
    if (ponto) Object.assign(extra, { lat: Number(ponto.lat.toFixed(6)), lng: Number(ponto.lng.toFixed(6)), coordOrigem: ponto.origem })
    // updated_at muda para os navegadores buscarem a posição nova na próxima sincronização.
    await cliente.query(
      `update ${tabela}
         set payload = jsonb_set(payload, '{endereco}', coalesce(payload->'endereco', '{}'::jsonb) || $2::jsonb),
             updated_at = case when $3 then now() else updated_at end
       where id = $1`,
      [linha.id, JSON.stringify(extra), Boolean(ponto)],
    )
    if (ponto) corrigidos += 1
  }
  return corrigidos
}

/** Roda uma vez por subida da API, em segundo plano. Nunca derruba a API. */
export async function atualizarLocalizacoes() {
  const cliente = await pool.connect()
  try {
    const { rows } = await cliente.query('select pg_try_advisory_lock($1) as ok', [TRAVA])
    if (!rows[0]?.ok) return
    const limite = new Date(Date.now() - NOVA_TENTATIVA_DIAS * 86_400_000).toISOString().slice(0, 10)
    try {
      const profissionais = await recalcularTabela(cliente, 'mao_profissionais', limite)
      const empresas = await recalcularTabela(cliente, 'mao_empresas', limite)
      if (profissionais || empresas) {
        console.log(`[localizacao] posição pelo endereço: ${profissionais} trabalhador(es), ${empresas} empresa(s)`)
      }
    } finally {
      await cliente.query('select pg_advisory_unlock($1)', [TRAVA])
    }
  } catch (erro) {
    console.error('[localizacao]', erro instanceof Error ? erro.message : erro)
  } finally {
    cliente.release()
  }
}
