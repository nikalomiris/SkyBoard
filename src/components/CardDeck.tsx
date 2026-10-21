import { useState } from 'react'
import { ChevronLeft, ChevronRight, Lock, Play, Unlock, X } from 'lucide-react'
import { advancedVowelGroups, affixRootGroups, digraphTiles, gluedSoundTiles, initialFinalBlendRows, letterTiles } from './BlendingBoard'
import type { BoardItem, CardDeckConfig, DeckTile } from '../lib/workspaceTypes'

export type DeckSession = { order: DeckTile[]; index: number }
export const emptyDeckSession: DeckSession = { order: [], index: -1 }

const vowels = new Set(['a', 'e', 'i', 'o', 'u'])

export function deckTileKey(tile: DeckTile) {
    return `${tile.kind ?? ''}:${tile.text}`
}

export const DECK_ITEM_PREFIX = 'deck-tile-'
const deckNoteColors: Record<string, string> = { 'deck-vowel': '#ffe94d', 'deck-prefix': '#ffe94d', 'deck-root': '#6fcf7a', 'deck-suffix': '#f26b6b', 'deck-consonant': '#ffffff' }

// Lays the selected tiles out as colour-coded notes, shrinking them until they all fit on the 1000x620 page.
export function buildDeckPageItems(tiles: DeckTile[]): BoardItem[] {
    const margin = 30
    const gap = 12
    let scale = 0.5
    const fits = (candidate: number) => {
        const columns = Math.floor((1000 - margin * 2 + gap) / (190 * candidate + gap))
        const rows = Math.floor((620 - margin * 2 + gap) / (170 * candidate + gap))
        return columns > 0 && columns * rows >= tiles.length
    }
    while (scale > 0.12 && !fits(scale)) scale -= 0.02
    const columns = Math.max(1, Math.floor((1000 - margin * 2 + gap) / (190 * scale + gap)))
    return tiles.map((tile, index) => ({
        id: `${DECK_ITEM_PREFIX}${index}`,
        type: 'note' as const,
        left: (margin + (index % columns) * (190 * scale + gap)) / 10,
        top: (margin + Math.floor(index / columns) * (170 * scale + gap)) / 6.2,
        text: tile.text,
        color: deckNoteColors[deckTileClass(tile)],
        fontSize: 56,
        scale,
    }))
}

function deckTileClass(tile: DeckTile) {
    if (tile.kind === 'prefix' || tile.kind === 'root' || tile.kind === 'suffix') return `deck-${tile.kind}`
    return vowels.has(tile.text.toLowerCase()) ? 'deck-vowel' : 'deck-consonant'
}

// Every distinct tile offered by the blending board, grouped the way the board groups them.
const catalog: { label: string; tiles: DeckTile[] }[] = [
    { label: 'Letters', tiles: letterTiles.map((text) => ({ text })) },
    { label: 'Digraphs', tiles: digraphTiles.map((text) => ({ text })) },
    { label: 'Glued sounds', tiles: gluedSoundTiles.map((text) => ({ text })) },
    { label: 'Advanced vowels', tiles: advancedVowelGroups.flat().map((text) => ({ text })) },
    { label: 'Initial and final blends', tiles: initialFinalBlendRows.flat().map((text) => ({ text })) },
    { label: 'Prefixes', tiles: affixRootGroups.filter((group) => group.kind === 'prefix').flatMap((group) => group.tiles).map((text) => ({ text, kind: 'prefix' })) },
    { label: 'Roots', tiles: affixRootGroups.filter((group) => group.kind === 'root').flatMap((group) => group.tiles).map((text) => ({ text, kind: 'root' })) },
    { label: 'Suffixes', tiles: affixRootGroups.filter((group) => group.kind === 'suffix').flatMap((group) => group.tiles).map((text) => ({ text, kind: 'suffix' })) },
    { label: 'Capital letters', tiles: letterTiles.map((text) => ({ text: text.toUpperCase() })) },
].map((group) => ({ ...group, tiles: group.tiles.filter((tile, index, all) => all.findIndex((other) => deckTileKey(other) === deckTileKey(tile)) === index) }))

function shuffle<T>(list: T[]) {
    const result = [...list]
    for (let index = result.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[result[index], result[swap]] = [result[swap], result[index]]
    }
    return result
}

export default function CardDeck({ readOnly = false, config, onConfigChange, session = emptyDeckSession, onSessionChange, tile, onClose }: {
    readOnly?: boolean
    config?: CardDeckConfig
    onConfigChange?: (config: CardDeckConfig) => void
    session?: DeckSession
    onSessionChange?: (session: DeckSession) => void
    tile?: DeckTile | null
    onClose: () => void
}) {
    const [draft, setDraft] = useState<DeckTile[]>(() => config?.tiles ?? [])
    const ready = Boolean(config?.ready)
    const current = readOnly ? tile ?? null : session.order[session.index] ?? null
    const selectedKeys = new Set((ready ? config?.tiles ?? [] : draft).map(deckTileKey))
    const shownKeys = new Set(session.order.slice(0, session.index + 1).map(deckTileKey))

    function toggle(target: DeckTile) {
        const key = deckTileKey(target)
        setDraft((previous) => previous.some((item) => deckTileKey(item) === key) ? previous.filter((item) => deckTileKey(item) !== key) : [...previous, target])
    }
    function start() {
        if (!config?.tiles.length) return
        onSessionChange?.({ order: shuffle(config.tiles), index: 0 })
    }
    const canGoNext = session.index >= 0 && session.index < session.order.length - 1
    const canGoBack = session.index > 0

    const stage = current
        ? <div className={`deck-card ${deckTileClass(current)}`} aria-live="polite" aria-label={`Card ${current.text}`}>{current.text}</div>
        : <p className="deck-empty">{readOnly ? 'Waiting for the next card…' : 'Press Start to show the first card'}</p>

    if (readOnly) return <div className="card-deck read-only" role="dialog" aria-modal="true" aria-label="Card deck"><div className="deck-stage">{stage}</div></div>

    return <div className="card-deck" role="dialog" aria-modal="true" aria-label="Card deck">
        <header className="deck-header">
            <strong>Card Deck</strong>
            <span>{ready ? 'Lesson ready' : 'Preparing the deck'}</span>
            <button className="icon-button" title="Close card deck" aria-label="Close card deck" onClick={onClose}><X size={18} /></button>
        </header>
        {ready ? <div className="deck-session">
            <aside className="deck-tiles" aria-label="Selected tiles">
                <div className="deck-tile-list">
                    {(config?.tiles ?? []).map((item) => <span key={deckTileKey(item)} className={`deck-chip ${deckTileClass(item)}${shownKeys.has(deckTileKey(item)) ? ' shown' : ''}`}>{item.text}</span>)}
                </div>
                <button className="deck-unlock" title="Unlock the deck to change the selected tiles" onClick={() => { onSessionChange?.(emptyDeckSession); onConfigChange?.({ tiles: config?.tiles ?? [], ready: false }) }}><Unlock size={14} /> Unlock to edit</button>
            </aside>
            <section className="deck-canvas" aria-label="Card canvas">
                <div className="deck-stage">{stage}</div>
                <div className="deck-controls">
                    <button disabled={!canGoBack} onClick={() => onSessionChange?.({ ...session, index: session.index - 1 })}><ChevronLeft size={17} /> Previous</button>
                    <button className="primary" onClick={start} disabled={!config?.tiles.length}><Play size={15} /> {session.index >= 0 ? 'Restart' : 'Start'}</button>
                    <button disabled={!canGoNext} onClick={() => onSessionChange?.({ ...session, index: session.index + 1 })}>Next <ChevronRight size={17} /></button>
                </div>
                {session.index >= 0 && <span className="deck-progress" role="status">Card {session.index + 1} of {session.order.length}</span>}
            </section>
        </div> : <div className="deck-prep">
            <div className="deck-prep-bar">
                <span role="status">{draft.length} tile{draft.length === 1 ? '' : 's'} selected</span>
                <button onClick={() => setDraft([])} disabled={!draft.length}>Clear</button>
                <button className="primary" disabled={!draft.length} onClick={() => onConfigChange?.({ tiles: draft, ready: true })}><Lock size={14} /> Confirm deck ready</button>
            </div>
            <div className="deck-prep-groups">
                {catalog.map((group) => <section key={group.label} className="deck-prep-group" aria-label={group.label}>
                    <h3>{group.label}</h3>
                    <div className="deck-prep-tiles">
                        {group.tiles.map((item) => <button key={deckTileKey(item)} className={`deck-chip ${deckTileClass(item)}${selectedKeys.has(deckTileKey(item)) ? ' selected' : ''}`} aria-pressed={selectedKeys.has(deckTileKey(item))} onClick={() => toggle(item)}>{item.text}</button>)}
                    </div>
                </section>)}
            </div>
        </div>}
    </div>
}
