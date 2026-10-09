import { useCallback, useState } from 'react'
import { MAX_IMAGES, readImage, type ImageAttachment } from './images'

// Each split pane keeps its own draft, attached images and error, keyed by pane id.
export function usePaneInputs() {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [images, setImages] = useState<Record<string, ImageAttachment[]>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  // other chats whose conversation goes along with this pane's next message
  const [contexts, setContexts] = useState<Record<string, string[]>>({})

  const setDraft = useCallback((pane: string, text: string) => setDrafts((d) => ({ ...d, [pane]: text })), [])
  const setError = useCallback((pane: string, msg: string | null) => setErrors((e) => ({ ...e, [pane]: msg })), [])
  const setPaneImages = useCallback(
    (pane: string, fn: (list: ImageAttachment[]) => ImageAttachment[]) =>
      setImages((all) => ({ ...all, [pane]: fn(all[pane] ?? []) })),
    [],
  )

  const addImages = useCallback(
    async (pane: string, files: File[], current: number) => {
      const room = MAX_IMAGES - current
      if (room <= 0) return setError(pane, `Up to ${MAX_IMAGES} images per message`)
      if (files.length > room) setError(pane, `Only the first ${room} images were attached (max ${MAX_IMAGES})`)
      const read = await Promise.allSettled(files.slice(0, room).map(readImage))
      const ok = read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      if (ok.length < read.length) setError(pane, "Some images couldn't be read")
      setPaneImages(pane, (list) => [...list, ...ok].slice(0, MAX_IMAGES))
    },
    [setError, setPaneImages],
  )

  const addContext = useCallback(
    (pane: string, sessionID: string) =>
      setContexts((all) => ({ ...all, [pane]: [...new Set([...(all[pane] ?? []), sessionID])].slice(0, 4) })),
    [],
  )
  const removeContext = useCallback(
    (pane: string, sessionID: string) => setContexts((all) => ({ ...all, [pane]: (all[pane] ?? []).filter((s) => s !== sessionID) })),
    [],
  )
  const clearContexts = useCallback((pane: string) => setContexts((all) => ({ ...all, [pane]: [] })), [])

  return {
    contextsOf: (pane: string) => contexts[pane] ?? [],
    addContext,
    removeContext,
    clearContexts,
    draftOf: (pane: string) => drafts[pane] ?? '',
    imagesOf: (pane: string) => images[pane] ?? [],
    errorOf: (pane: string) => errors[pane] ?? null,
    setDraft,
    setError,
    setPaneImages,
    addImages,
  }
}
