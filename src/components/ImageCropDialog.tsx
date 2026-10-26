import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Check, Crop, X } from 'lucide-react'
import { boardImageMaxDimension, imageQuality } from '../lib/backgroundLibrary'

type Rect = { x: number; y: number; w: number; h: number }
type Props = {
    src: string
    label: string
    remaining: number
    editing?: boolean
    onConfirm: (src: string) => void
    onSkip: () => void
    onCancel: () => void
}

const MIN_SIZE = 0.04
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function ImageCropDialog({ src, label, remaining, editing, onConfirm, onSkip, onCancel }: Props) {
    const frameRef = useRef<HTMLDivElement>(null)
    const imageRef = useRef<HTMLImageElement>(null)
    const dragRef = useRef<{ mode: 'new' | 'move' | string; startX: number; startY: number; origin: Rect } | null>(null)
    const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 })
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    function pointer(event: ReactPointerEvent) {
        const box = frameRef.current!.getBoundingClientRect()
        return { x: clamp((event.clientX - box.left) / box.width, 0, 1), y: clamp((event.clientY - box.top) / box.height, 0, 1) }
    }

    function begin(event: ReactPointerEvent, mode: string) {
        event.preventDefault()
        event.stopPropagation()
        frameRef.current?.setPointerCapture(event.pointerId)
        const point = pointer(event)
        dragRef.current = { mode, startX: point.x, startY: point.y, origin: rect }
        if (mode === 'new') setRect({ x: point.x, y: point.y, w: 0, h: 0 })
    }

    function move(event: ReactPointerEvent) {
        const drag = dragRef.current
        if (!drag) return
        const point = pointer(event)
        const { origin } = drag
        if (drag.mode === 'new') {
            setRect({ x: Math.min(drag.startX, point.x), y: Math.min(drag.startY, point.y), w: Math.abs(point.x - drag.startX), h: Math.abs(point.y - drag.startY) })
        } else if (drag.mode === 'move') {
            setRect({ ...origin, x: clamp(origin.x + point.x - drag.startX, 0, 1 - origin.w), y: clamp(origin.y + point.y - drag.startY, 0, 1 - origin.h) })
        } else {
            let left = origin.x, top = origin.y, right = origin.x + origin.w, bottom = origin.y + origin.h
            if (drag.mode.includes('w')) left = clamp(point.x, 0, right - MIN_SIZE)
            if (drag.mode.includes('e')) right = clamp(point.x, left + MIN_SIZE, 1)
            if (drag.mode.includes('n')) top = clamp(point.y, 0, bottom - MIN_SIZE)
            if (drag.mode.includes('s')) bottom = clamp(point.y, top + MIN_SIZE, 1)
            setRect({ x: left, y: top, w: right - left, h: bottom - top })
        }
    }

    function end() {
        dragRef.current = null
        setRect((current) => current.w < MIN_SIZE || current.h < MIN_SIZE ? { x: 0, y: 0, w: 1, h: 1 } : current)
    }

    function apply() {
        const image = imageRef.current
        if (!image || !image.naturalWidth) return
        setBusy(true)
        setError('')
        try {
            const sx = Math.round(rect.x * image.naturalWidth), sy = Math.round(rect.y * image.naturalHeight)
            const sw = Math.max(1, Math.round(rect.w * image.naturalWidth)), sh = Math.max(1, Math.round(rect.h * image.naturalHeight))
            if (sw === image.naturalWidth && sh === image.naturalHeight && src.startsWith('data:')) { onConfirm(src); return }
            const scale = Math.min(1, boardImageMaxDimension / Math.max(sw, sh))
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(sw * scale))
            canvas.height = Math.max(1, Math.round(sh * scale))
            const context = canvas.getContext('2d')!
            context.fillStyle = '#fff'
            context.fillRect(0, 0, canvas.width, canvas.height)
            context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
            onConfirm(canvas.toDataURL('image/jpeg', imageQuality))
        } catch {
            setError('This image cannot be cropped because its website blocks it. Close this dialog to keep the original.')
            setBusy(false)
        }
    }

    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

    return <div className="modal-scrim" onClick={onCancel}>
        <div className="share-modal crop-modal" role="dialog" aria-modal="true" aria-label="Crop image" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" onClick={onCancel} aria-label="Cancel crop" title="Cancel"><X size={18} /></button>
            <div className="share-modal-icon"><Crop size={20} /></div>
            <h2>Crop image</h2>
            <p>Drag on the picture to choose the part to keep{remaining > 0 ? ` (${remaining} more after this)` : ''}.</p>
            <div className="crop-stage">
                <div className="crop-frame" ref={frameRef} onPointerDown={(event) => begin(event, 'new')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                    <img ref={imageRef} src={src} alt={label} crossOrigin="anonymous" draggable={false} onError={() => setError('This image could not be loaded for cropping. Close this dialog to keep the original.')} />
                    <div className="crop-shade" aria-hidden="true"><div className="crop-shade-hole" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} /></div>
                    <div className="crop-selection" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} onPointerDown={(event) => begin(event, 'move')}>
                        {handles.map((handle) => <span key={handle} className={`crop-handle crop-handle-${handle}`} onPointerDown={(event) => begin(event, handle)} />)}
                    </div>
                </div>
            </div>
            {error && <p className="image-search-error" role="alert">{error}</p>}
            <div className="crop-actions">
                <button type="button" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>Reset</button>
                <button type="button" onClick={onSkip}>{editing ? 'Cancel' : 'Add without cropping'}</button>
                <button type="button" className="crop-confirm" disabled={busy} onClick={apply}><Check size={15} /> {editing ? 'Apply crop' : 'Crop and add'}</button>
            </div>
        </div>
    </div>
}
