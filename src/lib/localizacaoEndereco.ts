import { useEffect, useState } from 'react'

/**
 * Ponto do endereço do trabalhador no mapa do cadastro (casa + raio de trabalho).
 * Ordem: o que a pessoa ajustou arrastando o marcador > o ponto já salvo (endereço igual) > rua e número
 * (OpenStreetMap) > CEP (BrasilAPI) > centro da cidade.
 * A empresa nunca recebe esse ponto exato: o servidor só entrega cidade, UF e coordenada arredondada (~1 km).
 */

export type Ponto = { lat: number; lng: number }
export type OrigemPonto = 'manual' | 'salvo' | 'endereco' | 'cep' | 'cidade'

export type EnderecoParaMapa = { rua: string; numero: string; cidade: string; estado: string }

/** Origem que fica gravada no endereço (o ponto salvo mantém a origem de quando foi gravado). */
export function origemParaGravar(origem: OrigemPonto | null, salva?: 'endereco' | 'cep' | 'cidade' | 'manual') {
  if (origem === 'salvo') return salva
  if (origem === 'manual' || origem === 'endereco' || origem === 'cep') return origem
  return 'cidade' as const
}

export function pontoValido(ponto: Partial<Ponto> | null | undefined): ponto is Ponto {
  return Boolean(
    ponto &&
      typeof ponto.lat === 'number' &&
      typeof ponto.lng === 'number' &&
      Number.isFinite(ponto.lat) &&
      Number.isFinite(ponto.lng) &&
      !(ponto.lat === 0 && ponto.lng === 0),
  )
}

export function chaveDoEndereco(e: EnderecoParaMapa) {
  return [e.rua, e.numero, e.cidade, e.estado].map((parte) => parte.trim().toLowerCase()).join('|')
}

const cache = new Map<string, Ponto | null>()

async function buscar(q: string): Promise<Ponto | null | undefined> {
  if (cache.has(q)) return cache.get(q)
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', 'accept-language': 'pt-BR', q })
  try {
    const resposta = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (!resposta.ok) return undefined
    const lista = (await resposta.json()) as { lat?: string; lon?: string }[]
    const ponto = lista[0] ? { lat: Number(lista[0].lat), lng: Number(lista[0].lon) } : null
    const final = pontoValido(ponto) ? ponto : null
    cache.set(q, final)
    return final
  } catch {
    return undefined
  }
}

/** Ponto da rua (e do número, quando o OpenStreetMap conhece). undefined = serviço fora do ar. */
export async function pontoDoEndereco(e: EnderecoParaMapa): Promise<Ponto | null | undefined> {
  // O CEP preenche a rua como "Rua X - Bairro": para a busca vale só o nome da rua.
  const rua = e.rua.split(' - ')[0].trim()
  const cidade = e.cidade.trim()
  if (!rua || !cidade) return null
  const lugar = `${cidade}, ${e.estado.trim().toUpperCase()}, Brasil`
  const numero = e.numero.trim()
  if (numero) {
    const comNumero = await buscar(`${rua}, ${numero}, ${lugar}`)
    if (comNumero !== null) return comNumero
  }
  return buscar(`${rua}, ${lugar}`)
}

export function useLocalizacaoEndereco({
  endereco,
  pontoCep,
  pontoCidade,
  salvo,
}: {
  endereco: EnderecoParaMapa
  pontoCep?: Ponto
  pontoCidade?: Ponto | null
  /** Ponto já gravado no perfil e o endereço de quando foi gravado. */
  salvo?: { chave: string; ponto: Ponto } | null
}) {
  const chave = chaveDoEndereco(endereco)
  const usaSalvo = Boolean(salvo && salvo.chave === chave && pontoValido(salvo.ponto))
  const [geo, setGeo] = useState<{ chave: string; ponto: Ponto | null } | null>(null)
  const [manual, setManual] = useState<{ chave: string; ponto: Ponto } | null>(null)

  useEffect(() => {
    if (usaSalvo || !endereco.rua.trim() || !endereco.cidade.trim()) return
    let vivo = true
    // Espera a pessoa parar de digitar: o OpenStreetMap pede no máximo uma busca por segundo.
    const espera = window.setTimeout(() => {
      void pontoDoEndereco(endereco).then((ponto) => {
        if (vivo && ponto !== undefined) setGeo({ chave, ponto })
      })
    }, 1000)
    return () => {
      vivo = false
      window.clearTimeout(espera)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, usaSalvo])

  let ponto: Ponto | null = null
  let origem: OrigemPonto | null = null
  if (manual && manual.chave === chave) {
    ponto = manual.ponto
    origem = 'manual'
  } else if (usaSalvo && salvo) {
    ponto = salvo.ponto
    origem = 'salvo'
  } else if (geo && geo.chave === chave && geo.ponto) {
    ponto = geo.ponto
    origem = 'endereco'
  } else if (pontoValido(pontoCep)) {
    ponto = pontoCep
    origem = 'cep'
  } else if (pontoValido(pontoCidade)) {
    ponto = pontoCidade
    origem = 'cidade'
  }

  return {
    ponto,
    origem,
    /** A pessoa arrastou o marcador: vale até ela mudar o endereço. */
    mover: (novo: Ponto) => setManual({ chave, ponto: novo }),
  }
}
