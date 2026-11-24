import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { getAvatarRevision, subscribeAvatar } from './studio/importAvatar'
import TheatreGame from './surgery/TheatreGame'
import PhysicsStudio from './legacy/PhysicsStudio'
import { BUILD, type GameId } from './release'
import './legacy/studio.css'

function initialGame(): GameId {
  if (location.hash === '#kinema') return 'kinema'
  if (location.hash === '#theatre') return 'theatre'
  return document.documentElement.dataset.start === 'kinema' ? 'kinema' : 'theatre'
}

export default function Suite() {
  const [game, setGame] = useState<GameId>(initialGame)
  const avatarRevision = useSyncExternalStore(subscribeAvatar, getAvatarRevision)
  useEffect(() => {
    const change = () => setGame(initialGame())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useLayoutEffect(() => {
    document.documentElement.dataset.game = game
    document.documentElement.dataset.build = BUILD
    document.title = game === 'kinema' ? `Kinema Lab · Студия физики ${BUILD}` : 'THEATRE · Операционная'
    window.scrollTo(0, 0)
  }, [game])
  // Only the selected game owns a WebGL context. Both import exactly the same GLB and rig.
  return game === 'kinema' ? <PhysicsStudio key={avatarRevision} /> : <TheatreGame key={avatarRevision} />
}