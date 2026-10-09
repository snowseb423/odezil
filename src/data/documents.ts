// Préparation des documents avant mise en file : photos réduites (côté
// long ≤ 1600 px, JPEG qualité 0,7), PDF envoyés tels quels. Le Blob
// obtenu est conservé dans la file jusqu'à l'envoi : un document ajouté
// hors ligne ne se perd pas.
import { CommandError, type PreparedDocument } from './commands.ts'

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_SIDE = 1600
export const JPEG_QUALITY = 0.7
/** Types acceptés par le sélecteur de fichier (et par le bucket). */
export const ACCEPTED_TYPES = 'image/*,application/pdf'

const DIRECT_IMAGES: Record<string, PreparedDocument['extension']> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Dimensions réduites pour que le côté long ne dépasse pas `max` (jamais agrandies). */
export function fitWithin(width: number, height: number, max: number = MAX_IMAGE_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const ratio = max / longest
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}

export function isPdf(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name))
}

function tooLarge(): CommandError {
  return new CommandError('Fichier trop volumineux (10 Mo au maximum).')
}

async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas indisponible')
      context.drawImage(bitmap, 0, 0, width, height)
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas indisponible')
    context.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('compression impossible'))), 'image/jpeg', JPEG_QUALITY),
    )
  } finally {
    bitmap.close()
  }
}

/** Photo (appareil photo ou galerie), image ou PDF → document prêt à envoyer. */
export async function prepareDocument(file: File): Promise<PreparedDocument> {
  if (isPdf(file)) {
    if (file.size > MAX_DOCUMENT_BYTES) throw tooLarge()
    return { blob: file, contentType: 'application/pdf', extension: 'pdf' }
  }
  if (!file.type.startsWith('image/')) throw new CommandError('Format non pris en charge : photo, image ou PDF.')
  try {
    const blob = await compressImage(file)
    if (blob.size > MAX_DOCUMENT_BYTES) throw tooLarge()
    return { blob, contentType: 'image/jpeg', extension: 'jpg' }
  } catch (error) {
    if (error instanceof CommandError) throw error
    // Image illisible par le navigateur : envoyée telle quelle si son format est accepté.
    const extension = DIRECT_IMAGES[file.type]
    if (!extension) throw new CommandError('Cette image ne peut pas être lue : essayez une photo JPEG ou un PDF.')
    if (file.size > MAX_DOCUMENT_BYTES) throw tooLarge()
    return { blob: file, contentType: file.type, extension }
  }
}

/** Nom de fichier proposé au téléchargement (« bon-livraison-2026-10-14.jpg »). */
export function downloadName(kind: 'bon-livraison' | 'soa', label: string, path: string): string {
  const extension = /\.([a-z]+)$/.exec(path)?.[1] ?? 'pdf'
  return `${kind}-${label}.${extension}`
}
