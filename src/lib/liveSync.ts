import type { BoardItem } from './workspaceTypes'

// Student edits are sent to the teacher as per-item changes so concurrent students never overwrite each other.
export type ItemsEdit = { pageIndex: number; upserts: BoardItem[]; removed: string[] }

export type PendingEdits = {
    pageIndex: number
    upserts: Map<string, { item: BoardItem; at: number }>
    removed: Map<string, number>
}

// Unconfirmed student edits are dropped after this long even if the teacher never echoes them.
export const PENDING_EDIT_TTL_MS = 5000

export function itemsEqual(a: BoardItem | undefined, b: BoardItem | undefined) {
    return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export function diffItems(base: BoardItem[], current: BoardItem[]): { upserts: BoardItem[]; removed: string[] } {
    const baseById = new Map(base.map((item) => [item.id, item]))
    const currentIds = new Set(current.map((item) => item.id))
    return {
        upserts: current.filter((item) => !itemsEqual(baseById.get(item.id), item)),
        removed: base.filter((item) => !currentIds.has(item.id)).map((item) => item.id),
    }
}

export function isItemsEdit(value: unknown): value is ItemsEdit {
    const edit = value as ItemsEdit | null
    return Boolean(edit) && typeof edit!.pageIndex === 'number' && Array.isArray(edit!.upserts) && Array.isArray(edit!.removed)
}

// Teacher side: merge one student's changes into the page by item id.
export function applyItemsEdit(existing: BoardItem[], edit: Pick<ItemsEdit, 'upserts' | 'removed'>): BoardItem[] {
    const removed = new Set(edit.removed)
    const upserts = new Map(edit.upserts.map((item) => [item.id, item]))
    const kept = existing.filter((item) => !removed.has(item.id)).map((item) => upserts.get(item.id) ?? item)
    const present = new Set(kept.map((item) => item.id))
    return [...kept, ...edit.upserts.filter((item) => !present.has(item.id) && !removed.has(item.id))]
}

export function recordPendingEdit(pending: PendingEdits | null, pageIndex: number, edit: Pick<ItemsEdit, 'upserts' | 'removed'>, now: number): PendingEdits {
    const next = pending?.pageIndex === pageIndex ? pending : { pageIndex, upserts: new Map(), removed: new Map() }
    for (const item of edit.upserts) { next.upserts.set(item.id, { item, at: now }); next.removed.delete(item.id) }
    for (const itemId of edit.removed) { next.removed.set(itemId, now); next.upserts.delete(itemId) }
    return next
}

// Student side: layer edits the teacher has not echoed yet over an incoming teacher snapshot.
// `visible` is the snapshot minus items the student cannot render; `all` is the full snapshot used to detect echoes.
export function reconcileSnapshot(pending: PendingEdits | null, pageIndex: number, all: BoardItem[], visible: BoardItem[], now: number): BoardItem[] {
    if (!pending || pending.pageIndex !== pageIndex) return visible
    const byId = new Map(all.map((item) => [item.id, item]))
    for (const [itemId, entry] of pending.upserts) {
        const echoed = byId.get(itemId)
        if ((echoed && itemsEqual(echoed, entry.item)) || now - entry.at > PENDING_EDIT_TTL_MS) pending.upserts.delete(itemId)
    }
    for (const [itemId, at] of pending.removed) if (!byId.has(itemId) || now - at > PENDING_EDIT_TTL_MS) pending.removed.delete(itemId)
    const merged = visible.filter((item) => !pending.removed.has(item.id)).map((item) => pending.upserts.get(item.id)?.item ?? item)
    const present = new Set(merged.map((item) => item.id))
    return [...merged, ...[...pending.upserts.values()].map((entry) => entry.item).filter((item) => !present.has(item.id))]
}
