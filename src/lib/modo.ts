/**
 * Modo do app:
 *  - real: só cadastros reais, vindos do banco, com login no servidor.
 *  - demo: dados fictícios (seed) só neste navegador, sem nenhum acesso ao banco.
 * Antes os dois se misturavam e as contas demo (com senha publicada) abriam os dados reais.
 *
 * A demonstração saiu do site em 20/11/2026: no site publicado o modo é sempre o real e não há mais link,
 * botão nem endereço que entre nela. Ela continua só no ambiente de desenvolvimento (`npm run dev`), para testar
 * e tirar prints das telas sem tocar em dados reais.
 */
export type Modo = 'real' | 'demo'

const CHAVE_MODO = 'mao-modo'
/** Dados fictícios que a demonstração guardava no navegador (mesma chave de storage.ts). */
const CHAVE_DADOS_DEMO = 'doca-livre-mao-de-obra-demo-v1'

/** Só existe demonstração no ambiente de desenvolvimento. No site publicado isto é sempre falso. */
export function demoDisponivel() {
  return import.meta.env.DEV
}

export function modoAtual(): Modo {
  if (!demoDisponivel()) return 'real'
  try {
    return localStorage.getItem(CHAVE_MODO) === 'demo' ? 'demo' : 'real'
  } catch {
    return 'real'
  }
}

export function emDemo() {
  return modoAtual() === 'demo'
}

function pediuDemoNoEndereco() {
  const { pathname, search } = window.location
  return pathname.replace(/\/+$/, '') === '/demo' || new URLSearchParams(search).has('demo')
}

/**
 * Chamado antes de o app montar.
 * - Desenvolvimento: abrir em /demo (ou com ?demo) já entra na demonstração.
 * - Site publicado: /demo e ?demo só voltam para o início, e o que a demonstração tinha deixado guardado neste
 *   navegador (o modo e os dados fictícios) é apagado.
 */
export function entrarNaDemoPeloLink() {
  try {
    const pediu = pediuDemoNoEndereco()
    if (!demoDisponivel()) {
      localStorage.removeItem(CHAVE_MODO)
      localStorage.removeItem(CHAVE_DADOS_DEMO)
      if (pediu) window.history.replaceState(null, '', '/')
      return
    }
    if (!pediu) return
    if (localStorage.getItem(CHAVE_MODO) !== 'demo') {
      localStorage.setItem(CHAVE_MODO, 'demo')
      sessionStorage.removeItem('mao-portal-ativo')
    }
    window.history.replaceState(null, '', '/')
  } catch {
    /* sem storage: segue no modo real */
  }
}

/** Troca de modo recarregando a página: estado, cliente do banco e sessão começam do zero. */
export function trocarModo(modo: Modo) {
  try {
    if (modo === 'demo' && demoDisponivel()) localStorage.setItem(CHAVE_MODO, 'demo')
    else localStorage.removeItem(CHAVE_MODO)
    sessionStorage.removeItem('mao-portal-ativo')
  } catch {
    /* sem storage: segue no modo real */
  }
  window.location.reload()
}
