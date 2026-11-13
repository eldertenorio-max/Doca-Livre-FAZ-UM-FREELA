import { useEffect, useRef, useState } from 'react'
import { RecorteFoto, carregarFotoParaRecorte } from '../../components/RecorteFoto'
import { useStore } from '../../lib/store'

/**
 * Foto de perfil gravada na hora (painel do usuário no topo e botão sobre a capa do perfil):
 * escolher → ajustar no círculo → salvar; ou remover. No "Editar perfil" a foto entra no rascunho.
 */
export function useFotoPerfil(profissionalId: string | undefined) {
  const { atualizarFotoProfissional } = useStore()
  const arquivoRef = useRef<HTMLInputElement>(null)
  const [original, setOriginal] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null)

  useEffect(() => {
    if (!aviso) return
    const tempo = window.setTimeout(() => setAviso(null), aviso.erro ? 6000 : 3000)
    return () => window.clearTimeout(tempo)
  }, [aviso])

  function trocar() {
    setAviso(null)
    arquivoRef.current?.click()
  }

  async function escolher(file: File | undefined) {
    if (!file) return
    try {
      setOriginal(await carregarFotoParaRecorte(file))
    } catch (falha) {
      setAviso({ texto: falha instanceof Error ? falha.message : 'Não foi possível ler a foto.', erro: true })
    }
  }

  function salvar(foto: string | undefined, texto: string) {
    if (!profissionalId) return
    const res = atualizarFotoProfissional(profissionalId, foto)
    setAviso(res.ok ? { texto, erro: false } : { texto: res.error ?? 'Não foi possível salvar a foto.', erro: true })
  }

  function remover() {
    if (!window.confirm('Remover a sua foto de perfil?')) return
    salvar(undefined, 'Foto removida.')
  }

  const elementos = (
    <>
      <input
        ref={arquivoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(evento) => {
          void escolher(evento.target.files?.[0])
          evento.target.value = ''
        }}
      />
      {original && (
        <RecorteFoto
          src={original}
          onCancelar={() => setOriginal(null)}
          onConfirmar={(foto) => {
            setOriginal(null)
            salvar(foto, 'Foto de perfil atualizada.')
          }}
        />
      )}
      {aviso && (
        <p className={`foto-aviso${aviso.erro ? ' foto-aviso--erro' : ''}`} role={aviso.erro ? 'alert' : 'status'}>
          {aviso.texto}
        </p>
      )}
    </>
  )

  return { trocar, remover, elementos }
}
