import { BUILD, SUITE_FILE, type GameId } from '../release'

export function saveOfflineGame(start: GameId = 'theatre') {
  const filename = start === 'kinema' ? `KINEMA-${BUILD}.html` : SUITE_FILE
  if (import.meta.env.DEV) {
    const link = document.createElement('a'); link.href = start === 'kinema' ? '/downloads/kinema-studio.html' : `/downloads/${SUITE_FILE}`; link.download = filename; link.click(); return
  }
  // Keep the bundled entry scripts, not the current canvas or transient dialog state.
  const page = document.documentElement.cloneNode(true) as HTMLElement
  page.querySelector('#root')?.replaceChildren()
  page.querySelector('body')?.removeAttribute('style')
  page.dataset.start = start
  page.removeAttribute('data-game')
  page.dataset.build = BUILD
  const blob = new Blob(['<!doctype html>\n', page.outerHTML], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}