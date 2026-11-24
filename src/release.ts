export const BUILD = '1.4.1'
export const MODEL_REVISION = 'MIKA-R12'
export const SUITE_FILE = `MIKA-DUO-${BUILD}.html`
export type GameId = 'theatre' | 'kinema'

export function openGame(game: GameId) {
  const hash = '#' + game
  if (window.location.hash !== hash) window.location.hash = hash
}