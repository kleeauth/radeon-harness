export type ImageAttachment = {
  id: string
  name: string
  mime: string
  dataUrl: string
}

export const MAX_IMAGES = 8
const MAX_SIDE = 2048
const MAX_BYTES = 4 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function isAcceptedImage(file: File) {
  return ACCEPTED.includes(file.type)
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('could not read the image'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('not a readable image'))
    img.src = src
  })
}

// Models downscale large images anyway; sending a 12 MB photo only makes the request slow.
// Small images pass through untouched, big ones become a JPEG with the longest side at 2048px.
export async function readImage(file: File): Promise<ImageAttachment> {
  const original = await readAsDataUrl(file)
  const img = await loadImage(original)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = file.name || 'pasted-image.png'

  if (longest <= MAX_SIDE && file.size <= MAX_BYTES) {
    return { id, name, mime: file.type, dataUrl: original }
  }

  const scale = Math.min(1, MAX_SIDE / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not resize the image')
  ctx.fillStyle = '#ffffff' // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return {
    id,
    name: name.replace(/\.\w+$/, '') + '.jpg',
    mime: 'image/jpeg',
    dataUrl: canvas.toDataURL('image/jpeg', 0.9),
  }
}

// images from a paste or drop event, ignoring anything that isn't a picture
export function imagesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const entry of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null
    if (file && isAcceptedImage(file)) files.push(file)
  }
  return files
}
