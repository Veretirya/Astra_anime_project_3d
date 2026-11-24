import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Box, Check, FileBox, FolderOpen, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react'
import { commitAvatar, getActiveAvatar, inspectAvatar, type ImportedAvatar } from './importAvatar'

export function AvatarImport() {
  const current = getActiveAvatar(), input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [candidate, setCandidate] = useState<ImportedAvatar | null>(null)
  const [restore, setRestore] = useState(false), [dragging, setDragging] = useState(false), generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  async function check(files: File[]) {
    if (!files.length) return
    const token = ++generation.current; setLoading(true); setError(''); setCandidate(null); setRestore(false)
    try { const avatar = await inspectAvatar(files); if (token === generation.current) setCandidate(avatar) }
    catch (e) { if (token === generation.current) setError(e instanceof Error ? e.message : 'Этот файл не удалось прочитать. Текущая модель сохранена.') }
    finally { if (token === generation.current) setLoading(false) }
  }
  return <section className="avatar-import"><button className="avatar-import-title" onClick={() => setOpen(!open)} aria-expanded={open}><FileBox size={16} /><span><strong>Своя модель</strong><small>GLB / glTF 2.0</small></span><span className="import-plus">{open ? '−' : '+'}</span></button>
    {open && <div className="avatar-import-body"><p>Подойдёт гуманоид в A- или T-позе со скелетом VRoid, Mixamo или стандартными именами костей. До 48 МБ.</p>
      <input ref={input} aria-label="Файлы GLB или glTF и их ресурсы" type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" hidden onChange={e => { void check(Array.from(e.target.files || [])); e.target.value = '' }} />
      <button className={`avatar-drop ${dragging ? 'over' : ''}`} onClick={() => input.current?.click()} disabled={loading} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void check(Array.from(e.dataTransfer.files)) }}>
        {loading ? <LoaderCircle size={21} className="spin" /> : <Upload size={21} />}<strong>{loading ? 'Проверяем скелет…' : 'Выбрать файлы модели'}</strong><small>Для glTF добавьте .bin и текстуры вместе с ним</small></button>
      {error && <p role="alert" className="avatar-error">{error}</p>}
      {candidate && <div className="avatar-verified"><div><Check size={13} /><strong>{candidate.name}</strong><button aria-label="Отменить выбор модели" onClick={() => setCandidate(null)}><X size={12} /></button></div><p>{candidate.profile} · {candidate.bones} костей · {candidate.triangles.toLocaleString('ru-RU')} треугольников</p><p>{candidate.facial ? 'Найдены морфы лица.' : 'Морфов лица нет: сюжетные сцены используют жесты, голос и субтитры.'}</p><button className="btn amber" onClick={() => commitAvatar(candidate)}>Применить модель<ArrowRight size={13} /></button></div>}
      {current && <div className="avatar-restore"><button onClick={() => setRestore(true)}><RotateCcw size={12} />Вернуть Мику</button>{restore && <div><span>Вернуть встроенную модель?</span><button onClick={() => commitAvatar(null)}>Вернуть</button><button aria-label="Оставить свою модель" onClick={() => setRestore(false)}><X size={12} /></button></div>}</div>}
      <p className="avatar-local"><FolderOpen size={12} />Только на устройстве, до закрытия страницы. Смена модели начнёт новую сессию; результаты останутся в журнале.</p>
    </div>}
  </section>
}

export function AvatarIcon({ className = '' }: { className?: string }) {
  return <span className={`imported-avatar-icon ${className}`} aria-label="Пользовательская модель"><Box size={22} /></span>
}