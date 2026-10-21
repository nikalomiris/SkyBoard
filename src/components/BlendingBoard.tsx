import { useEffect, useRef, useState } from 'react'
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
import { Check, Hand, Pen, Trash2, X } from 'lucide-react'

export type BlendTile = { id: string; text: string; x: number; y: number; kind?: string }

export type BlendStroke = { id: string; points: string; color: string; width: number; opacity: number }
export type BlendDraft = { kind: 'ink'; points: string; color: string; width: number; opacity: number }
const penColors = [
    { name: 'Black', color: '#111111' },
    { name: 'White', color: '#ffffff' },
    { name: 'Red', color: '#e03131' },
    { name: 'Green', color: '#2f9e44' },
]
const PEN_WIDTH = 4

const vowels = new Set(['a', 'e', 'i', 'o', 'u'])
export const letterTiles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'qu', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
export const digraphTiles = ['sh', 'th', 'ch', 'wh', 'ph', 'tch', 'dge', 'ff', 'll', 'ss', 'zz', 'ck']
export const gluedSoundTiles = ['ing', 'ang', 'ong', 'ung', 'ink', 'ank', 'onk', 'unk']
export const syllableLabels = ['closed', 'open', 'magic e', 'vowel teams', 'r-controlled', 'consonant LE']
const syllableLabelSet = new Set(syllableLabels)
const syllableLabelSizes: Record<string, { width: number; height: number }> = {
    closed: { width: 92, height: 38 },
    open: { width: 72, height: 38 },
    'magic e': { width: 104, height: 38 },
    'vowel teams': { width: 132, height: 38 },
    'r-controlled': { width: 140, height: 38 },
    'consonant LE': { width: 148, height: 38 },
}
export const advancedVowelGroups = [
    ['ee', 'ea', 'ai', 'ay', 'oa', 'ow', 'oe', 'oo', 'ie', 'igh', 'ou', 'oi', 'oy', 'au', 'aw', 'ue', 'eu'],
    ['ar', 'or', 'er', 'ir', 'ur', 'for', 'air', 'ear', 'oar', 'ore', 'our', 'oor'],
]
export const affixRootGroups = [
    { kind: 'prefix', tiles: ['re', 'de', 'pre', 'pro', 'un', 'in', 'mis', 'dis', 'con', 'sub', 'non', 'mid', 'trans', 'inter', 'anti'] },
    { kind: 'root', tiles: ['ject', 'tract', 'rupt', 'struct', 'sist', 'gress', 'sect', 'port', 'form', 'tort', 'cur', 'fer', 'mote', 'spect', 'vis', 'vid'] },
    { kind: 'suffix', tiles: ['s', 'es', 'ing', 'ed', 'er', 'est', 'ful', 'less', 'able', 'ible', 'ish', 'ive', 'ly', 'en', 'ness', 'ment', 'al'] },
    { kind: 'suffix', tiles: ['(t)ion', '(s)ion', '(c)ian', '(t)ious', '(c)ious', '(x)ious', '(t)ient', '(c)ient', '(t)iate', '(c)iate', 'ture'] },
] as const
export const initialFinalBlendRows = [
    ['bl', 'cl', 'fl', 'gl', 'pl', 'sl', 'spl'],
    ['br', 'cr', 'dr', 'fr', 'gr', 'pr', 'tr', 'scr'],
    ['sk', 'sn', 'sm', 'sp', 'sw', 'tw', 'str'],
    ['nd', 'nt', 'mp', 'ft', 'st', 'ct'],
]
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

type Drag = { tileId: string | null; text: string; kind?: string; offsetX: number; offsetY: number; clientX: number; clientY: number }

function tileClass(text: string) {
    return vowels.has(text) ? 'vowel' : 'consonant'
}

function tileSize(text: string) {
    return syllableLabelSizes[text] ?? { width: TILE_W, height: TILE_H }
}

export default function BlendingBoard({ tiles, setTiles, strokes, setStrokes, onDraft, remoteDraft, onClose, readOnly = false, color, onColorChange }: {
    tiles: BlendTile[]
    setTiles: Dispatch<SetStateAction<BlendTile[]>>
    strokes: BlendStroke[]
    setStrokes: Dispatch<SetStateAction<BlendStroke[]>>
    onDraft?: (draft: BlendDraft | null) => void
    remoteDraft?: BlendDraft | null
    onClose: () => void
    readOnly?: boolean
    color?: string | null
    onColorChange?: (color: string) => void
}) {
    const canvasRef = useRef<HTMLDivElement>(null)
    const [drag, setDrag] = useState<Drag | null>(null)
    const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Basic Tiles')
    const [showInitialFinalBlends, setShowInitialFinalBlends] = useState(false)
    const nextId = useRef(0)
    const [boardColor, setBoardColor] = useState(() => {
        const stored = window.localStorage.getItem(colorStorageKey)
        return boardColors.some((option) => option.color === stored) ? stored! : '#81a6c6'
    })
    const tilesRef = useRef(tiles)
    tilesRef.current = tiles
    const accentColor = readOnly && color ? color : boardColor
    useEffect(() => { onColorChange?.(boardColor) }, [boardColor])
    const [draftPoints, setDraftPoints] = useState('')
    const draftPointsRef = useRef('')
    const lastDraftSentRef = useRef(0)
    const [mode, setMode] = useState<'hand' | 'pen'>('hand')
    const [penColor, setPenColor] = useState(penColors[0].color)
    const drawTool = !readOnly && mode === 'pen' ? 'pen' : null
    const ink = penColor
    const penStyle = { width: PEN_WIDTH, opacity: 1 }

    function canvasPoint(event: ReactPointerEvent<Element>) {
        const rect = canvasRef.current!.getBoundingClientRect()
        return `${((event.clientX - rect.left) / rect.width) * 1000},${((event.clientY - rect.top) / rect.height) * 620}`
    }
    function updateDraft(points: string) {
        draftPointsRef.current = points
        setDraftPoints(points)
        if (!points) { lastDraftSentRef.current = 0; onDraft?.(null); return }
        if (Date.now() - lastDraftSentRef.current >= 40) {
            lastDraftSentRef.current = Date.now()
            onDraft?.({ kind: 'ink', points, color: ink, ...penStyle })
        }
    }
    function onDrawDown(event: ReactPointerEvent<SVGSVGElement>) {
        if (!drawTool || !canvasRef.current) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        updateDraft(canvasPoint(event))
    }
    function onDrawMove(event: ReactPointerEvent<SVGSVGElement>) {
        if (!draftPointsRef.current || !canvasRef.current) return
        updateDraft(`${draftPointsRef.current} ${canvasPoint(event)}`)
    }
    function onDrawUp() {
        const points = draftPointsRef.current
        if (!points || !drawTool) return
        setStrokes((previous) => [...previous, { id: `bs-${Date.now()}-${nextId.current++}`, points, color: ink, ...penStyle }])
        updateDraft('')
    }

    function startDrag(event: ReactPointerEvent<HTMLElement>, text: string, tileId: string | null, kind?: string) {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        const fromCanvas = tileId !== null
        const size = tileSize(text)
        const current: Drag = {
            tileId,
            text,
            kind,
            offsetX: fromCanvas ? event.clientX - rect.left : size.width / 2,
            offsetY: fromCanvas ? event.clientY - rect.top : size.height / 2,
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
                    clamp(upEvent.clientX - canvas.left - current.offsetX, 0, canvas.width - size.width),
                    clamp(upEvent.clientY - canvas.top - current.offsetY, 0, canvas.height - size.height),
                    tilesRef.current,
                    text,
                )
                setTiles((previous) => [...previous, { id: `bt-${Date.now()}-${nextId.current++}`, text, x, y, kind }])
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
                clamp(moveEvent.clientX - canvas.left - current.offsetX, 0, canvas.width - size.width),
                clamp(moveEvent.clientY - canvas.top - current.offsetY, 0, canvas.height - size.height),
                tilesRef.current.filter((tile) => tile.id !== id),
                text,
            )
            setTiles((previous) => {
                const moved = previous.find((tile) => tile.id === id)
                if (!moved) return previous
                return [...previous.filter((tile) => tile.id !== id), { ...moved, x, y }]
            })
        }
    }

    return <div className={`blending-board${readOnly ? ' read-only' : ''}${drawTool ? ' drawing-mode' : ''}`} style={{ ['--board-accent' as string]: accentColor }}>
        {!readOnly && <div className="blending-tabs">
            {tabs.map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} disabled={tab !== 'Basic Tiles' && tab !== 'Glued Sounds' && tab !== 'Advanced Vowels' && tab !== 'Prefixes, Roots & Suffixes' && tab !== 'Capital Letters' && tab !== 'Syllable Labels'} onClick={() => setActiveTab(tab)}>{tab}</button>)}
            <button className="blending-close" onClick={onClose} aria-label="Close blending board" title="Close"><X size={16} /></button>
        </div>}
        {!readOnly && <div className="blending-tray">
            {tabs.filter((tab) => tab === 'Basic Tiles' || tab === 'Glued Sounds' || tab === 'Advanced Vowels' || tab === 'Prefixes, Roots & Suffixes' || tab === 'Capital Letters' || tab === 'Syllable Labels').map((tab) => <div key={tab} className={`blending-tray-panel ${tab === activeTab ? 'active' : ''}`} aria-hidden={tab !== activeTab}>
            {tab === 'Syllable Labels' ? <div className="blending-syllable-labels" role="group" aria-label="Syllable labels">
                {syllableLabels.map((text) => {
                    const size = tileSize(text)
                    return <button key={text} className="tray-tile syllable-label-tile" style={{ width: size.width, height: size.height }} aria-label={`Drag ${text} syllable label`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>
                })}
            </div> : tab === 'Capital Letters' ? <div className="blending-capital-letters" role="group" aria-label="Capital letters">
                {letterTiles.map((text) => {
                    const capital = text.toUpperCase()
                    return <button key={text} className={`tray-tile ${tileClass(text)}`} aria-label={`Drag tile ${capital}`} onPointerDown={(event) => startDrag(event, capital, null)}>{capital}</button>
                })}
            </div> : tab === 'Prefixes, Roots & Suffixes' ? <div className="blending-affix-groups">
                {affixRootGroups.map((group, index) => <div className={`blending-affix-group ${group.kind}`} role="group" aria-label={`${group.kind} tiles`} key={`${group.kind}-${index}`}>
                    {group.tiles.map((text) => <button key={text} className={`tray-tile affix-root-tile ${group.kind}`} aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null, group.kind)}>{text}</button>)}
                </div>)}
            </div> : tab === 'Advanced Vowels' ? <div className="blending-vowel-groups">
                {advancedVowelGroups.map((group, index) => <div className="blending-vowel-group" role="group" aria-label={`Advanced vowel group ${index + 1}`} key={index}>
                    {group.map((text) => <button key={text} className="tray-tile consonant advanced-vowel-tile" aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                </div>)}
            </div> : <>
                <div className="blending-letter-groups">
                    <div className="blending-letters">
                        {letterTiles.map((text) => <button key={text} className={`tray-tile ${tileClass(text)}`} aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                    </div>
                    {tab === 'Glued Sounds' && <div className="blending-glued-sounds" role="group" aria-label="Glued sounds">
                        {gluedSoundTiles.map((text) => <button key={text} className="tray-tile consonant glued-sound-tile" aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                    </div>}
                </div>
                <div className="blending-digraphs">
                    {digraphTiles.map((text) => <button key={text} className="tray-tile consonant" aria-label={`Drag tile ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                </div>
            </>}
            </div>)}
        </div>}
        <div className="blending-canvas" ref={canvasRef}>
            {readOnly ? null : activeTab === 'Syllable Labels' ? <aside className="syllable-instructions" aria-label="Instructions">
                <strong>Instructions</strong>
                <ol>
                    <li>Write or build a word</li>
                    <li>Code the word</li>
                    <li>Select the syllable type for each part of the word</li>
                </ol>
            </aside> : <div className="initial-final-blends">
                <button className="initial-final-blends-toggle" aria-expanded={showInitialFinalBlends} onClick={() => setShowInitialFinalBlends((show) => !show)}>Initial and Final Blends</button>
                {showInitialFinalBlends && <div className="initial-final-blends-tiles" role="group" aria-label="Initial and final blends">
                    {initialFinalBlendRows.map((row, index) => <div className="initial-final-blend-row" key={index}>
                        {row.map((text) => <button key={text} className="initial-final-blend-tile" aria-label={`Drag blend ${text}`} onPointerDown={(event) => startDrag(event, text, null)}>{text}</button>)}
                    </div>)}
                </div>}
            </div>}
            {tiles.map((tile) => {
                const size = tileSize(tile.text)
                return <div key={tile.id} className={`canvas-tile ${tileClass(tile.text)} ${tile.kind ? `affix-${tile.kind}` : ''} ${syllableLabelSet.has(tile.text) ? 'canvas-syllable-label' : ''} ${drag?.tileId === tile.id ? 'dragging' : ''}`} style={{ left: tile.x, top: tile.y, width: size.width, height: size.height }} title={readOnly ? undefined : 'Double-click to delete'} onPointerDown={readOnly ? undefined : (event) => startDrag(event, tile.text, tile.id, tile.kind)} onDoubleClick={readOnly ? undefined : () => setTiles((previous) => previous.filter((item) => item.id !== tile.id))}>{tile.text}</div>
            })}
            <svg className="blending-ink-layer" data-tool={drawTool ?? undefined} viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="Blending board annotations" onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawUp} onPointerCancel={onDrawUp}>
                {strokes.map((stroke) => <polyline key={stroke.id} points={stroke.points} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeOpacity={stroke.opacity} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
                {[drawTool && draftPoints ? { points: draftPoints, color: ink, ...penStyle } : null, remoteDraft ?? null].map((draft, index) => {
                    if (!draft) return null
                    return <polyline key={index} points={draft.points} fill="none" stroke={draft.color} strokeWidth={draft.width} strokeOpacity={draft.opacity} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                })}
            </svg>
            {!readOnly && tiles.length === 0 && activeTab !== 'Syllable Labels' && <span className="blending-hint">Drag tiles here to build words</span>}
        </div>
        {!readOnly && <div className="blending-footer">
            <div className="blend-mode-tools" role="radiogroup" aria-label="Blending board tool">
                <button role="radio" aria-checked={mode === 'hand'} className={mode === 'hand' ? 'selected' : ''} title="Move tiles" aria-label="Move tiles" onClick={() => setMode('hand')}><Hand size={17} /></button>
                <button role="radio" aria-checked={mode === 'pen'} className={mode === 'pen' ? 'selected' : ''} title="Pen" aria-label="Pen" onClick={() => setMode('pen')}><Pen size={17} /></button>
                {mode === 'pen' && penColors.map((option) => <button key={option.color} role="radio" aria-checked={penColor === option.color} className={`pen-color${penColor === option.color ? ' selected' : ''}`} style={{ background: option.color }} title={`${option.name} pen`} aria-label={`${option.name} pen`} onClick={() => setPenColor(option.color)} />)}
            </div>
            <div className="blending-footer-center">
                <button onClick={() => { setTiles([]); setStrokes([]) }} disabled={tiles.length === 0 && strokes.length === 0}><Trash2 size={15} /> Clear board</button>
                <span>Drag a tile off the board to remove it</span>
            </div>
            <div className="accent-swatches" role="radiogroup" aria-label="Canvas color">{boardColors.map((option) => <button key={option.color} role="radio" aria-checked={boardColor === option.color} className={boardColor === option.color ? 'selected' : ''} style={{ background: option.color }} title={`${option.name} canvas`} aria-label={`${option.name} canvas`} onClick={() => { setBoardColor(option.color); window.localStorage.setItem(colorStorageKey, option.color) }}>{boardColor === option.color && <Check size={14} />}</button>)}</div>
        </div>}
        {drag && drag.tileId === null && (() => {
            const size = tileSize(drag.text)
            return <div className={`canvas-tile ${tileClass(drag.text)} ${drag.kind ? `affix-${drag.kind}` : ''} ${syllableLabelSet.has(drag.text) ? 'canvas-syllable-label' : ''} drag-ghost`} style={{ left: drag.clientX - drag.offsetX, top: drag.clientY - drag.offsetY, width: size.width, height: size.height }}>{drag.text}</div>
        })()}
    </div>
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), Math.max(min, max))
}

// Snaps a tile next to the closest neighbour (left, right, above or below) within range.
function snapPosition(x: number, y: number, others: BlendTile[], text: string) {
    const size = tileSize(text)
    // Dropped mostly over another tile: align exactly on top of it so it covers it completely.
    const covered = others
        .filter((other) => Math.abs(other.x - x) < Math.max(size.width, tileSize(other.text).width) / 2 && Math.abs(other.y - y) < Math.max(size.height, tileSize(other.text).height) / 2)
        .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]
    if (covered) return { x: covered.x, y: covered.y }
    let best: { x: number; y: number; distance: number } | null = null
    for (const other of others) {
        const otherSize = tileSize(other.text)
        const candidates = [
            { x: other.x + otherSize.width, y: other.y },
            { x: other.x - size.width, y: other.y },
            { x: other.x, y: other.y + otherSize.height },
            { x: other.x, y: other.y - size.height },
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
