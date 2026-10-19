import { useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { Check, Trash2, X } from 'lucide-react'

export type BlendTile = { id: string; text: string; x: number; y: number }

const vowels = new Set(['a', 'e', 'i', 'o', 'u'])
const letterTiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'qu', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
const digraphTiles = ['sh', 'th', 'ch', 'wh', 'ph', 'tch', 'dge', 'ff', 'll', 'ss', 'zz', 'ck']
const gluedSoundTiles = ['ing', 'ang', 'ong', 'ung', 'ink', 'ank', 'onk', 'unk']
const tabs = ['Basic Tiles', 'Glued Sounds', 'Advanced Vowels', 'Prefixes, Roots & Suffixes', 'Capital Letters', 'Syllable Labels'] as const
const boardColors = [
    { name: 'Sky', color: '#81a6c6' },
    { name: 'Lavender', color: '#c9bce8' },
    { name: 'Rose', color: '#e9bfd0' },
    { name: 'Peach', color: '#f4c6b2' },
    { name: 'Butter', color: '#f2dfa4' },
    { name: 'Sage', color: '#bfd8c2' },
    { name: 'Aqua', color: '#b4d9d8' },
    { name: 'Periwinkle', color: '#c2c9e8' },
]
const colorStorageKey = 'skyboard:blending-board-color'
const TILE_W = 104
const TILE_H = 104
const SNAP_DISTANCE = 40

type Drag = { tileId: string | null; text: string; offsetX: number; offsetY: number; clientX: number; clientY: number }

function tileClass(text: string) {
    return vowels.has(text) ? 'vowel' : 'consonant'
}

export default function BlendingBoard({ tiles, setTiles, onClose }: {
    tiles: BlendTile[]
    setTiles: Dispatch<SetStateAction<BlendTile[]>>
    onClose: () => void
}) {
    const canvasRef = useRef<HTMLDivElement>(null)
    const [drag, setDrag] = useState<Drag | null>(null)
    const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Basic Tiles')
    const nextId = useRef(0)
    const [boardColor, setBoardColor] = useState(() => {
        const stored = window.localStorage.getItem(colorStorageKey)
        return boardColors.some((option) => option.color === stored) ? stored! : '#81a6c6'
    })
    const tilesRef = useRef(tiles)
    tilesRef.current = tiles

    function startDrag(event: ReactPointerEvent<HTMLElement>, text: string, tileId: string | null) {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        const fromCanvas = tileId !== null
        const current: Drag = {
            tileId,
            text,
            offsetX: fromCanvas ? event.clientX - rect.left : TILE_W / 2,
            offsetY: fromCanvas ? event.clientY - rect.top : TILE_H / 2,
            clientX: event.clientX,
            clientY: event.clientY,
        }
        setDrag(current)

        const onMove = (moveEvent: PointerEvent) => {
            current.clientX = moveEvent.clientX
            current.clientY = moveEvent.clientY
            if (fromCanvas) moveTile(tileId, moveEvent)
            else setDrag({ ...current })
        }
        const onUp = (upEvent: PointerEvent) => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
            const canvas = canvasRef.current?.getBoundingClientRect()
            const inside = !!canvas && upEvent.clientX >= canvas.left && upEvent.clientX <= canvas.right && upEvent.clientY >= canvas.top && upEvent.clientY <= canvas.bottom
            if (fromCanvas) {
                if (!inside) setTiles((previous) => previous.filter((tile) => tile.id !== tileId))
            } else if (inside && canvas) {
                const { x, y } = snapPosition(
                    clamp(upEvent.clientX - canvas.left - current.offsetX, 0, canvas.width - TILE_W),
                    clamp(upEvent.clientY - canvas.top - current.offsetY, 0, canvas.height - TILE_H),
                    tilesRef.current,
                )
                setTiles((previous) => [...previous, { id: `bt-${Date.now()}-${nextId.current++}`, text, x, y }])
            }
            setDrag(null)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)

        function moveTile(id: string, moveEvent: PointerEvent) {
            const canvas = canvasRef.current?.getBoundingClientRect()
            if (!canvas) return
            const { x, y } = snapPosition(
                clamp(moveEvent.clientX - canvas.left - current.offsetX, 0, canvas.width - TILE_W),
                clamp(moveEvent.clientY - canvas.top - current.offsetY, 0, canvas.height - TILE_H),
                tilesRef.current.filter((tile) => tile.id !== id),
            )
            setTiles((previous) => {
                const moved = previous.find((tile) => tile.id === id)
                if (!moved) return previous
                return [...previous.filter((tile) => tile.id !== id), { ...moved, x, y }]
            })
        }
    }

    return <div className="blending-board" style={{ ['--board-accent' as string]: boardColor }}>
        <div className="blending-tabs">
            {tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} disabled={tab !== 'Basic Tiles' && tab !== 'Glued Sounds'} onClick={() => setActiveTab(tab)}>{tab}</button>)}
            <button className="blending-close" onClick={onClose} aria-label="Close blending board" title="Close"><X size={16} /></button>
        </div>
        <div className="blending-tray">
            <div className="blending-letter-groups">
                <div className="blending-letters">
                    {letterTiles.map((text) => <button key={text} className={`tray-tile ${tileClass(text)}`} aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                </div>
                {activeTab === 'Glued Sounds' && <div className="blending-glued-sounds" role="group" aria-label="Glued sounds">
                    {gluedSoundTiles.map((text) => <button key={text} className="tray-tile consonant glued-sound-tile" aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                </div>}
            </div>
            <div className="blending-digraphs">
                {digraphTiles.map((text) => <button key={text} className="tray-tile consonant" aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
            </div>
        </div>
        <div className="blending-canvas" ref={canvasRef}>
            {tiles.map((tile) => <div key={tile.id} className={`canvas-tile ${tileClass(tile.text)} ${drag?.tileId === tile.id ? 'dragging' : ''}`} style={{ left: tile.x, top: tile.y, width: TILE_W, height: TILE_H }} title="Double-click to delete" onPointerDown={(event) => startDrag(event, tile.text, tile.id)} onDoubleClick={() => setTiles((previous) => previous.filter((item) => item.id !== tile.id))}>{tile.text}</div>)}
            {tiles.length === 0 && <span className="blending-hint">Drag tiles here to build words</span>}
        </div>
        <div className="blending-footer">
            <button onClick={() => setTiles([])} disabled={tiles.length === 0}><Trash2 size={15} /> Clear board</button>
            <span>Drag a tile off the board to remove it</span>
            <div className="accent-swatches" role="radiogroup" aria-label="Canvas color">{boardColors.map((option) => <button key={option.color} role="radio" aria-checked={boardColor === option.color} className={boardColor === option.color ? 'selected' : ''} style={{ background: option.color }} title={`${option.name} canvas`} aria-label={`${option.name} canvas`} onClick={() => { setBoardColor(option.color); window.localStorage.setItem(colorStorageKey, option.color) }}>{boardColor === option.color && <Check size={14} />}</button>)}</div>
        </div>
        {drag && drag.tileId === null && <div className={`canvas-tile ${tileClass(drag.text)} drag-ghost`} style={{ left: drag.clientX - drag.offsetX, top: drag.clientY - drag.offsetY, width: TILE_W, height: TILE_H }}>{drag.text}</div>}
    </div>
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), Math.max(min, max))
}

// Snaps a tile next to the closest neighbour (left, right, above or below) within range.
function snapPosition(x: number, y: number, others: BlendTile[]) {
    // Dropped mostly over another tile: align exactly on top of it so it covers it completely.
    const covered = others
        .filter((other) => Math.abs(other.x - x) < TILE_W / 2 && Math.abs(other.y - y) < TILE_H / 2)
        .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]
    if (covered) return { x: covered.x, y: covered.y }
    let best: { x: number; y: number; distance: number } | null = null
    for (const other of others) {
        const candidates = [
            { x: other.x + TILE_W, y: other.y },
            { x: other.x - TILE_W, y: other.y },
            { x: other.x, y: other.y + TILE_H },
            { x: other.x, y: other.y - TILE_H },
        ]
        for (const candidate of candidates) {
            const distance = Math.hypot(candidate.x - x, candidate.y - y)
            if (distance <= SNAP_DISTANCE && !others.some((tile) => tile.x === candidate.x && tile.y === candidate.y) && (!best || distance < best.distance)) {
                best = { ...candidate, distance }
            }
        }
    }
    return best ? { x: best.x, y: best.y } : { x, y }
}
