// Tema escuro gerado na compilação, no padrão do WMS Doca Livre (html[data-tema="escuro"]).
//
// O visual do sistema tem cores fixas espalhadas em vários arquivos .css. Em vez de reescrever cada
// regra à mão, este plugin do PostCSS cria, logo depois de cada regra que mexe com cor, uma cópia
// que só vale no tema escuro:
//   - fundos claros e neutros (branco, cinza-claro, tons pastel) viram superfícies escuras;
//   - textos escuros viram claros;
//   - bordas e sombras claras viram escuras;
//   - cores da marca (amarelo, verde, azul-marinho), fundos que já são escuros e os textos sobre
//     eles ficam como estão.
// Toda regra com cor ganha a cópia (mesmo sem nada a converter), para que a ordem de prioridade
// entre as regras continue a mesma do tema claro.
// Regras escritas à mão para o tema escuro (com data-tema no seletor) passam sem cópia.
// Telas que ficam claras mesmo no tema escuro (entrada e login, como no WMS e no Oferta de Carga) usam a
// classe .tema-forcar-claro: nenhuma cópia escura vale dentro dela.
import type { AtRule, Container, Declaration, Plugin, Rule } from 'postcss'

const PREFIXO = 'html[data-tema="escuro"]'

type Cor = { r: number; g: number; b: number; a: number }
type Categoria = 'fundo' | 'texto' | 'borda'

// ------------------------------------------------------------------ leitura e escrita de cores
const RE_COR = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|rgba?\([^()]*\)|(?<![\w-])(?:white|black)(?![\w-])/g

function lerCor(texto: string): Cor | null {
  const t = texto.trim().toLowerCase()
  if (t === 'white') return { r: 255, g: 255, b: 255, a: 1 }
  if (t === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  if (t.startsWith('#')) {
    const h = t.slice(1)
    if (![3, 4, 6, 8].includes(h.length)) return null
    const cheio = h.length <= 4 ? [...h].map((c) => c + c).join('') : h
    const n = (i: number) => parseInt(cheio.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: cheio.length === 8 ? n(6) / 255 : 1 }
  }
  const m = t.match(/^rgba?\((.*)\)$/)
  if (!m || m[1].includes('var(')) return null
  const partes = m[1].split(/[\s,/]+/).filter(Boolean)
  if (partes.length < 3) return null
  const canal = (p: string) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p))
  const alfa = partes[3] === undefined ? 1 : partes[3].endsWith('%') ? parseFloat(partes[3]) / 100 : parseFloat(partes[3])
  const cor = { r: canal(partes[0]), g: canal(partes[1]), b: canal(partes[2]), a: alfa }
  return [cor.r, cor.g, cor.b, cor.a].every(Number.isFinite) ? cor : null
}

function escreverCor(c: Cor) {
  const r = Math.round(c.r)
  const g = Math.round(c.g)
  const b = Math.round(c.b)
  if (c.a >= 0.999) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  return `rgba(${r}, ${g}, ${b}, ${Number(c.a.toFixed(3))})`
}

// ------------------------------------------------------------------ OKLCH (clareza percebida)
const paraLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const deLinear = (v: number) => {
  const x = Math.max(0, v)
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, c * 255))
}

function paraOklch(c: Cor) {
  const r = paraLinear(c.r)
  const g = paraLinear(c.g)
  const b = paraLinear(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }
}

function deOklch(L: number, C: number, h: number, a: number): Cor {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: deLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: deLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: deLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  }
}

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Converte uma cor; devolve null quando ela fica como está. */
function converter(cor: Cor, categoria: Categoria): Cor | null {
  const { L, C, h } = paraOklch(cor)
  if (categoria === 'fundo') {
    // Branco quase transparente sobre fundo escuro é efeito de "clarear" (hover do menu): fica.
    if (cor.a < 0.35) return null
    if (L < 0.8 || C >= 0.12) return null
    const novoL = L >= 0.995 ? 0.215 : limitar(0.18 + (1 - L) * 1.6, 0.18, 0.5)
    return deOklch(novoL, Math.min(C, 0.05), h, cor.a)
  }
  if (categoria === 'texto') {
    if (L >= 0.62) return null
    return deOklch(Math.max(0.69, 0.96 - L * 0.45), Math.min(C, 0.16), h, cor.a)
  }
  if (L < 0.75 || C >= 0.12) return null
  return deOklch(limitar(0.28 + (1 - L) * 0.8, 0.28, 0.45), Math.min(C, 0.04), h, cor.a)
}

function converterValor(valor: string, categoria: Categoria) {
  let mudou = false
  const novo = valor.replace(RE_COR, (trecho) => {
    const cor = lerCor(trecho)
    if (!cor) return trecho
    const convertida = converter(cor, categoria)
    if (!convertida) return trecho
    mudou = true
    return escreverCor(convertida)
  })
  return mudou ? novo : null
}

// ------------------------------------------------------------------ quais propriedades entram
const TEXTO = new Set(['color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color'])

function categoriaDe(prop: string): Categoria | 'copiar' | null {
  const p = prop.toLowerCase()
  if (p.startsWith('--')) {
    if (/(borda|border|divider|linha)/.test(p)) return 'borda'
    if (/(texto|text|titulo|title|ink|-fg|muted)/.test(p)) return 'texto'
    if (/(bg|fundo|background|card|surface|panel|paper|suave|soft|elevated)/.test(p)) return 'fundo'
    return 'copiar'
  }
  if (p === 'background' || p === 'background-color' || p === 'background-image') return 'fundo'
  if (p.startsWith('background-')) return 'copiar'
  if (TEXTO.has(p)) return 'texto'
  if (p === 'box-shadow' || p === 'text-shadow') return 'borda'
  if (p.startsWith('border') && !/radius|collapse|spacing/.test(p)) return 'borda'
  if (p.startsWith('outline') && p !== 'outline-offset') return 'borda'
  if (p.startsWith('column-rule')) return 'borda'
  return null
}

const MARCA = /var\(--[\w-]*(yellow|amarelo|brand|accent|destaque|ativo|primar|verde|green|warn|danger|success|black)/i

/** O texto da regra fica como está quando ela mesma pinta um fundo escuro ou colorido. */
function fundoMantido(regra: Rule) {
  let mantido = false
  regra.each((no) => {
    if (no.type !== 'decl') return
    const d = no as Declaration
    if (categoriaDe(d.prop) !== 'fundo' || d.prop.startsWith('--')) return
    if (MARCA.test(d.value)) mantido = true
    for (const trecho of d.value.match(RE_COR) ?? []) {
      const cor = lerCor(trecho)
      if (cor && cor.a >= 0.5 && !converter(cor, 'fundo')) mantido = true
    }
  })
  return mantido
}

// Exclui as áreas que ficam claras. O :where() não soma prioridade: as regras escuras continuam
// valendo na mesma ordem de antes no resto do sistema.
const FORA_DO_CLARO = ':where(:not(.tema-forcar-claro, .tema-forcar-claro *))'

function prefixar(seletor: string) {
  const s = seletor.trim()
  if (/^:root(?![\w-])/.test(s)) return s.replace(/^:root/, ':root[data-tema="escuro"]')
  if (/^html(?![\w-])/.test(s)) return s.replace(/^html/, PREFIXO)
  // a exclusão entra antes do ::pseudo-elemento, se houver
  const i = s.indexOf('::')
  const comExclusao = i >= 0 ? `${s.slice(0, i)}${FORA_DO_CLARO}${s.slice(i)}` : `${s}${FORA_DO_CLARO}`
  return `${PREFIXO} ${comExclusao}`
}

function dentroDeKeyframes(regra: Rule) {
  let pai: Container | undefined = regra.parent as Container | undefined
  while (pai && pai.type !== 'root') {
    if (pai.type === 'atrule' && /keyframes$/i.test((pai as AtRule).name)) return true
    pai = pai.parent as Container | undefined
  }
  return false
}

export function temaEscuroPostcss(): Plugin {
  return {
    postcssPlugin: 'tema-escuro-doca-livre',
    OnceExit(raiz) {
      const regras: Rule[] = []
      raiz.walkRules((regra) => {
        if (regra.selector.includes('data-tema')) return
        if (dentroDeKeyframes(regra)) return
        regras.push(regra)
      })
      for (const regra of regras) {
        const manterTexto = fundoMantido(regra)
        const decls: Declaration[] = []
        regra.each((no) => {
          if (no.type !== 'decl') return
          const d = no as Declaration
          const categoria = categoriaDe(d.prop)
          if (!categoria) return
          const copia = d.clone()
          if (categoria !== 'copiar' && !(categoria === 'texto' && manterTexto)) {
            const novo = converterValor(d.value, categoria)
            if (novo) copia.value = novo
          }
          decls.push(copia)
        })
        if (!decls.length) continue
        const escura = regra.clone()
        escura.removeAll()
        escura.selectors = regra.selectors.map(prefixar)
        escura.append(...decls)
        regra.after(escura)
      }
    },
  }
}
