// Remise d'un fichier généré à l'utilisateur (repris de Presence).
import { isIos } from '../lib/platform.ts'

export async function deliverFile(content: string, name: string, type = 'text/csv;charset=utf-8'): Promise<void> {
  const blob = new Blob([content], { type })
  // Sur iPhone, l'app installée gère mal les téléchargements : la feuille de
  // partage permet d'enregistrer dans Fichiers ou d'envoyer le fichier.
  const file = new File([blob], name, { type: blob.type })
  if (isIos() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
