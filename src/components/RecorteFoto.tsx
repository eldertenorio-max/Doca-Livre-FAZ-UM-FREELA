import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import './recorte-foto.css'

/** Lado do quadro de ajuste, em px de tela. A foto final sai quadrada, com SAIDA px. */
const QUADRO = 260
const SAIDA = 512
const ZOOM_MAX = 4

const TIPOS_ACEITOS = /^image\/(jpeg|png|webp)$/

/**
 * Lê a foto escolhida e reduz para no máximo 1600 px (fotos de celular têm 4000 px ou mais),
 * para o ajuste ficar leve. A orientação da câmera já vem aplicada pelo navegador.
 */
export function carregarFotoParaRecorte(file: File): Promise<string> {
  const tipoOk = TIPOS_ACEITOS.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)
  if (!tipoOk) return Promise.reject(new Error('Envie uma foto JPG, PNG ou WEBP.'))
  if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('A foto é grande demais (máximo 25 MB).'))
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Não foi possível ler a foto.'))
        return
      }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a foto. Tente outra imagem.'))
    }
    img.src = url
  })
}

type Ajuste = { zoom: number; giro: number; x: number; y: number }

function limitar(ajuste: Ajuste, largura: number, altura: number): Ajuste {
  const deitada = ajuste.giro % 180 !== 0
  const w = deitada ? altura : largura
  const h = deitada ? largura : altura
  const escala = (QUADRO / Math.min(w, h)) * ajuste.zoom
  const maxX = Math.max(0, (w * escala - QUADRO) / 2)
  const maxY = Math.max(0, (h * escala - QUADRO) / 2)
  return {
    ...ajuste,
    zoom: Math.min(ZOOM_MAX, Math.max(1, ajuste.zoom)),
    x: Math.min(maxX, Math.max(-maxX, ajuste.x)),
    y: Math.min(maxY, Math.max(-maxY, ajuste.y)),
  }
}

/** Janela para encaixar a foto de perfil: arrastar, zoom (barra, rodinha ou pinça) e girar. */
export function RecorteFoto({
  src,
  onCancelar,
  onConfirmar,
}: {
  src: string
  onCancelar: () => void
  onConfirmar: (foto: string) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const quadroRef = useRef<HTMLDivElement>(null)
  const usarRef = useRef<HTMLButtonElement>(null)
  const [tamanho, setTamanho] = useState<{ w: number; h: number } | null>(null)
  const [ajuste, setAjuste] = useState<Ajuste>({ zoom: 1, giro: 0, x: 0, y: 0 })
  const [erro, setErro] = useState('')
  const toques = useRef(new Map<number, { x: number; y: number }>())
  const pinca = useRef<number | null>(null)

  function mudar(fn: (atual: Ajuste) => Ajuste) {
    setAjuste((atual) => (tamanho ? limitar(fn(atual), tamanho.w, tamanho.h) : atual))
  }

  useEffect(() => {
    usarRef.current?.focus()
    function tecla(evento: globalThis.KeyboardEvent) {
      if (evento.key === 'Escape') onCancelar()
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onCancelar])

  // Rodinha do mouse dá zoom. Precisa ser "não passivo" para a página não rolar junto.
  useEffect(() => {
    const quadro = quadroRef.current
    if (!quadro || !tamanho) return
    function roda(evento: WheelEvent) {
      evento.preventDefault()
      const fator = Math.exp(-evento.deltaY * 0.0015)
      setAjuste((atual) => limitar({ ...atual, zoom: atual.zoom * fator }, tamanho!.w, tamanho!.h))
    }
    quadro.addEventListener('wheel', roda, { passive: false })
    return () => quadro.removeEventListener('wheel', roda)
  }, [tamanho])

  function distancia() {
    const [a, b] = [...toques.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function apertar(evento: PointerEvent<HTMLDivElement>) {
    evento.currentTarget.setPointerCapture(evento.pointerId)
    toques.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY })
    pinca.current = toques.current.size === 2 ? distancia() : null
  }

  function mover(evento: PointerEvent<HTMLDivElement>) {
    const antes = toques.current.get(evento.pointerId)
    if (!antes) return
    toques.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY })
    if (toques.current.size >= 2) {
      const agora = distancia()
      if (pinca.current && agora) {
        const fator = agora / pinca.current
        mudar((atual) => ({ ...atual, zoom: atual.zoom * fator }))
      }
      pinca.current = agora
      return
    }
    const dx = evento.clientX - antes.x
    const dy = evento.clientY - antes.y
    mudar((atual) => ({ ...atual, x: atual.x + dx, y: atual.y + dy }))
  }

  function soltar(evento: PointerEvent<HTMLDivElement>) {
    toques.current.delete(evento.pointerId)
    pinca.current = toques.current.size === 2 ? distancia() : null
  }

  function teclas(evento: KeyboardEvent<HTMLDivElement>) {
    const passo = evento.shiftKey ? 30 : 10
    const acoes: Record<string, (atual: Ajuste) => Ajuste> = {
      ArrowLeft: (a) => ({ ...a, x: a.x - passo }),
      ArrowRight: (a) => ({ ...a, x: a.x + passo }),
      ArrowUp: (a) => ({ ...a, y: a.y - passo }),
      ArrowDown: (a) => ({ ...a, y: a.y + passo }),
      '+': (a) => ({ ...a, zoom: a.zoom * 1.1 }),
      '=': (a) => ({ ...a, zoom: a.zoom * 1.1 }),
      '-': (a) => ({ ...a, zoom: a.zoom / 1.1 }),
    }
    const acao = acoes[evento.key]
    if (!acao) return
    evento.preventDefault()
    mudar(acao)
  }

  function usar() {
    const img = imgRef.current
    if (!img || !tamanho) return
    const canvas = document.createElement('canvas')
    canvas.width = SAIDA
    canvas.height = SAIDA
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setErro('Não foi possível preparar a foto.')
      return
    }
    const deitada = ajuste.giro % 180 !== 0
    const escala = (QUADRO / Math.min(deitada ? tamanho.h : tamanho.w, deitada ? tamanho.w : tamanho.h)) * ajuste.zoom
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, SAIDA, SAIDA)
    ctx.translate(SAIDA / 2, SAIDA / 2)
    ctx.scale(SAIDA / QUADRO, SAIDA / QUADRO)
    ctx.translate(ajuste.x, ajuste.y)
    ctx.rotate((ajuste.giro * Math.PI) / 180)
    ctx.scale(escala, escala)
    ctx.drawImage(img, -tamanho.w / 2, -tamanho.h / 2, tamanho.w, tamanho.h)
    let foto = canvas.toDataURL('image/jpeg', 0.85)
    if (foto.length > 400_000) foto = canvas.toDataURL('image/jpeg', 0.7)
    if (foto.length > 400_000) {
      setErro('A foto ficou grande demais. Escolha outra imagem.')
      return
    }
    onConfirmar(foto)
  }

  const deitada = ajuste.giro % 180 !== 0
  const escala = tamanho
    ? (QUADRO / Math.min(deitada ? tamanho.h : tamanho.w, deitada ? tamanho.w : tamanho.h)) * ajuste.zoom
    : 1

  return createPortal(
    <div
      className="recorte-fundo"
      role="presentation"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onCancelar()
      }}
    >
      <div className="recorte-janela" role="dialog" aria-modal="true" aria-labelledby="recorte-titulo">
        <h2 id="recorte-titulo">Ajustar foto de perfil</h2>
        <p className="recorte-dica">Arraste a foto para encaixar o rosto no círculo. Use o zoom para aproximar.</p>
        <div
          ref={quadroRef}
          className="recorte-quadro"
          style={{ width: QUADRO, height: QUADRO }}
          tabIndex={0}
          role="application"
          aria-label="Área de ajuste da foto. Setas movem a foto; mais e menos mudam o zoom."
          onPointerDown={apertar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onKeyDown={teclas}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(evento) => {
              const alvo = evento.currentTarget
              setTamanho({ w: alvo.naturalWidth, h: alvo.naturalHeight })
            }}
            style={
              tamanho
                ? {
                    width: tamanho.w,
                    height: tamanho.h,
                    transform: `translate(-50%, -50%) translate(${ajuste.x}px, ${ajuste.y}px) rotate(${ajuste.giro}deg) scale(${escala})`,
                  }
                : { opacity: 0 }
            }
          />
          <span className="recorte-mascara" aria-hidden="true" />
        </div>
        <div className="recorte-controles">
          <label className="recorte-zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={ZOOM_MAX}
              step={0.01}
              value={ajuste.zoom}
              onChange={(evento) => {
                const zoom = Number(evento.target.value)
                mudar((atual) => ({ ...atual, zoom }))
              }}
            />
          </label>
          <button type="button" className="recorte-btn recorte-btn--leve" onClick={() => mudar((atual) => ({ ...atual, giro: (atual.giro + 90) % 360 }))}>
            Girar
          </button>
          <button type="button" className="recorte-btn recorte-btn--leve" onClick={() => mudar(() => ({ zoom: 1, giro: 0, x: 0, y: 0 }))}>
            Recomeçar
          </button>
        </div>
        {erro && <p className="recorte-erro">{erro}</p>}
        <div className="recorte-acoes">
          <button type="button" className="recorte-btn recorte-btn--leve" onClick={onCancelar}>
            Cancelar
          </button>
          <button ref={usarRef} type="button" className="recorte-btn" disabled={!tamanho} onClick={usar}>
            Usar foto
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
