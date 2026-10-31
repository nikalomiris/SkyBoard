import { describe, expect, it } from 'vitest'
import { applyItemsEdit, diffItems, isItemsEdit, PENDING_EDIT_TTL_MS, reconcileSnapshot, recordPendingEdit, type ItemsEdit, type PendingEdits } from './liveSync'
import type { BoardItem } from './workspaceTypes'

const stroke = (id: string, points = '0,0 10,10'): BoardItem => ({ id, type: 'stroke', points, color: '#000', width: 3, opacity: 1 })
const note = (id: string, text = 'hi'): BoardItem => ({ id, type: 'note', left: 10, top: 10, text })
const ids = (items: BoardItem[]) => items.map((item) => item.id)

describe('diffItems', () => {
    it('reports nothing when the lists are equal, even for fresh object copies', () => {
        const base = [stroke('a'), note('b')]
        expect(diffItems(base, structuredClone(base))).toEqual({ upserts: [], removed: [] })
    })
    it('reports added, changed and removed items', () => {
        const base = [stroke('a'), note('b', 'old'), stroke('c')]
        const current = [stroke('a'), note('b', 'new'), stroke('d')]
        const { upserts, removed } = diffItems(base, current)
        expect(ids(upserts)).toEqual(['b', 'd'])
        expect(removed).toEqual(['c'])
    })
    it('treats an empty base as all items being new', () => {
        expect(ids(diffItems([], [stroke('a'), stroke('b')]).upserts)).toEqual(['a', 'b'])
    })
    it('reports every removal when the page is cleared', () => {
        expect(diffItems([stroke('a'), stroke('b')], []).removed).toEqual(['a', 'b'])
    })
})

describe('isItemsEdit', () => {
    it('accepts the diff shape and rejects malformed payloads', () => {
        expect(isItemsEdit({ pageIndex: 0, upserts: [], removed: [] })).toBe(true)
        expect(isItemsEdit(null)).toBe(false)
        expect(isItemsEdit(undefined)).toBe(false)
        expect(isItemsEdit({ pageIndex: 0, items: [] })).toBe(false)
        expect(isItemsEdit({ pageIndex: '0', upserts: [], removed: [] })).toBe(false)
        expect(isItemsEdit({ pageIndex: 0, upserts: [], removed: 'a' })).toBe(false)
    })
})

describe('applyItemsEdit (teacher merge)', () => {
    it('appends new items and keeps existing ones in order', () => {
        const result = applyItemsEdit([stroke('a')], { upserts: [stroke('b')], removed: [] })
        expect(ids(result)).toEqual(['a', 'b'])
    })
    it('replaces items with the same id in place', () => {
        const result = applyItemsEdit([stroke('a'), stroke('b')], { upserts: [stroke('a', '1,1 2,2')], removed: [] })
        expect(ids(result)).toEqual(['a', 'b'])
        expect(result[0]).toMatchObject({ points: '1,1 2,2' })
    })
    it('removes items and ignores removals of unknown ids', () => {
        expect(ids(applyItemsEdit([stroke('a'), stroke('b')], { upserts: [], removed: ['a', 'zzz'] }))).toEqual(['b'])
    })
    it('does not resurrect an item that is both upserted and removed', () => {
        expect(ids(applyItemsEdit([], { upserts: [stroke('a')], removed: ['a'] }))).toEqual([])
    })
    it('does not mutate its input', () => {
        const existing = [stroke('a')]
        applyItemsEdit(existing, { upserts: [stroke('b')], removed: ['a'] })
        expect(ids(existing)).toEqual(['a'])
    })
    it('keeps teacher-only items a student never had (hidden storage images)', () => {
        const teacherImage: BoardItem = { id: 'img', type: 'image', left: 1, top: 1, src: 'storage://x', label: 'x' }
        expect(ids(applyItemsEdit([teacherImage], { upserts: [stroke('s1')], removed: [] }))).toEqual(['img', 's1'])
    })
})

describe('recordPendingEdit', () => {
    it('tracks upserts and removals and lets the latest action win', () => {
        let pending = recordPendingEdit(null, 0, { upserts: [stroke('a')], removed: [] }, 100)
        pending = recordPendingEdit(pending, 0, { upserts: [], removed: ['a'] }, 200)
        expect(pending.upserts.has('a')).toBe(false)
        expect(pending.removed.get('a')).toBe(200)
        pending = recordPendingEdit(pending, 0, { upserts: [stroke('a')], removed: [] }, 300)
        expect(pending.removed.has('a')).toBe(false)
        expect(pending.upserts.get('a')?.at).toBe(300)
    })
    it('starts fresh when the page changes', () => {
        const first = recordPendingEdit(null, 0, { upserts: [stroke('a')], removed: [] }, 1)
        const second = recordPendingEdit(first, 1, { upserts: [stroke('b')], removed: [] }, 2)
        expect(second.pageIndex).toBe(1)
        expect([...second.upserts.keys()]).toEqual(['b'])
    })
})

describe('reconcileSnapshot (student)', () => {
    it('returns the visible snapshot untouched when nothing is pending or the page differs', () => {
        const snap = [stroke('a')]
        expect(reconcileSnapshot(null, 0, snap, snap, 0)).toBe(snap)
        const pending = recordPendingEdit(null, 1, { upserts: [stroke('x')], removed: [] }, 0)
        expect(reconcileSnapshot(pending, 0, snap, snap, 0)).toBe(snap)
    })
    it('keeps an unconfirmed stroke that a stale snapshot does not contain', () => {
        const pending = recordPendingEdit(null, 0, { upserts: [stroke('mine')], removed: [] }, 1000)
        const stale = [stroke('teacher')]
        expect(ids(reconcileSnapshot(pending, 0, stale, stale, 1500))).toEqual(['teacher', 'mine'])
    })
    it('clears a pending edit once the teacher echoes it', () => {
        const pending = recordPendingEdit(null, 0, { upserts: [stroke('mine')], removed: [] }, 1000)
        const echoed = [stroke('mine')]
        expect(ids(reconcileSnapshot(pending, 0, echoed, echoed, 1100))).toEqual(['mine'])
        expect(pending.upserts.size).toBe(0)
    })
    it('keeps a pending edit when the teacher holds an older version of the same item', () => {
        const pending = recordPendingEdit(null, 0, { upserts: [note('n', 'student text')], removed: [] }, 1000)
        const stale = [note('n', 'old text')]
        const result = reconcileSnapshot(pending, 0, stale, stale, 1100)
        expect(result[0]).toMatchObject({ text: 'student text' })
        expect(pending.upserts.size).toBe(1)
    })
    it('hides an item the student deleted until the teacher confirms the deletion', () => {
        const pending = recordPendingEdit(null, 0, { upserts: [], removed: ['gone'] }, 1000)
        const stale = [stroke('gone'), stroke('keep')]
        expect(ids(reconcileSnapshot(pending, 0, stale, stale, 1100))).toEqual(['keep'])
        const confirmed = [stroke('keep')]
        expect(ids(reconcileSnapshot(pending, 0, confirmed, confirmed, 1200))).toEqual(['keep'])
        expect(pending.removed.size).toBe(0)
    })
    it('gives up on unconfirmed edits after the TTL so the teacher stays the source of truth', () => {
        const pending = recordPendingEdit(null, 0, { upserts: [stroke('mine')], removed: ['old'] }, 1000)
        const snap = [stroke('old')]
        expect(ids(reconcileSnapshot(pending, 0, snap, snap, 1000 + PENDING_EDIT_TTL_MS + 1))).toEqual(['old'])
    })
    it('detects echoes against the full snapshot even when the student cannot render some items', () => {
        const hidden: BoardItem = { id: 'img', type: 'image', left: 1, top: 1, src: 'storage://x', label: 'x' }
        const pending = recordPendingEdit(null, 0, { upserts: [stroke('mine')], removed: [] }, 1000)
        const all = [hidden, stroke('mine')]
        const visible = [stroke('mine')]
        expect(ids(reconcileSnapshot(pending, 0, all, visible, 1100))).toEqual(['mine'])
        expect(pending.upserts.size).toBe(0)
    })
})

// End-to-end simulation of the protocol with an unreliable, reordering network.
class Teacher {
    items: BoardItem[] = []
    receive(edit: ItemsEdit) { this.items = applyItemsEdit(this.items, edit) }
    snapshot() { return structuredClone(this.items) }
}

class Student {
    items: BoardItem[] = []
    private base: BoardItem[] = []
    private pending: PendingEdits | null = null
    constructor(private readonly pageIndex = 0) {}
    // Mirrors the app: local change, then diff against the last known teacher-aligned base.
    edit(change: (items: BoardItem[]) => BoardItem[], now: number): ItemsEdit | null {
        this.items = change(this.items)
        const { upserts, removed } = diffItems(this.base, this.items)
        this.base = this.items
        if (!upserts.length && !removed.length) return null
        this.pending = recordPendingEdit(this.pending, this.pageIndex, { upserts, removed }, now)
        return { pageIndex: this.pageIndex, upserts, removed }
    }
    receiveSnapshot(snapshot: BoardItem[], now: number) {
        this.items = reconcileSnapshot(this.pending, this.pageIndex, snapshot, snapshot, now)
        this.base = this.items
    }
}

describe('teacher and student protocol simulation', () => {
    it('keeps the first stroke of an "x" when a stale snapshot arrives between strokes', () => {
        const teacher = new Teacher()
        const student = new Student()
        const first = student.edit((items) => [...items, stroke('x1')], 0)!
        const staleSnapshot = teacher.snapshot()
        teacher.receive(first)
        student.edit((items) => [...items, stroke('x2')], 100)
        student.receiveSnapshot(staleSnapshot, 150)
        expect(ids(student.items)).toEqual(['x1', 'x2'])
    })

    it('keeps strokes from several students drawing at the same time', () => {
        const teacher = new Teacher()
        const students = [new Student(), new Student(), new Student()]
        const messages = students.flatMap((student, index) => [
            student.edit((items) => [...items, stroke(`s${index}-a`)], 0)!,
            student.edit((items) => [...items, stroke(`s${index}-b`)], 10)!,
        ])
        // Deliver in a scrambled order; interleaving must not lose anything.
        for (const message of [messages[3], messages[0], messages[5], messages[1], messages[4], messages[2]]) teacher.receive(message)
        expect(ids(teacher.items).sort()).toEqual(['s0-a', 's0-b', 's1-a', 's1-b', 's2-a', 's2-b'])
        for (const student of students) {
            student.receiveSnapshot(teacher.snapshot(), 200)
            expect(ids(student.items).sort()).toEqual(['s0-a', 's0-b', 's1-a', 's1-b', 's2-a', 's2-b'])
        }
    })

    it('does not let one student undo another student\'s work', () => {
        const teacher = new Teacher()
        const a = new Student()
        const b = new Student()
        teacher.receive(a.edit((items) => [...items, stroke('a1')], 0)!)
        b.receiveSnapshot(teacher.snapshot(), 10)
        teacher.receive(b.edit((items) => [...items, stroke('b1')], 20)!)
        const undoA = a.edit((items) => items.filter((item) => item.id !== 'a1'), 30)!
        teacher.receive(undoA)
        expect(ids(teacher.items)).toEqual(['b1'])
    })

    it('preserves teacher edits made while a student draws', () => {
        const teacher = new Teacher()
        const student = new Student()
        teacher.items = [note('teacher-note')]
        student.receiveSnapshot(teacher.snapshot(), 0)
        teacher.receive({ pageIndex: 0, upserts: [note('teacher-note-2')], removed: [] })
        teacher.receive(student.edit((items) => [...items, stroke('s1')], 10)!)
        student.receiveSnapshot(teacher.snapshot(), 20)
        expect(ids(student.items)).toEqual(['teacher-note', 'teacher-note-2', 's1'])
    })

    it('converges once all messages are delivered and edits are confirmed', () => {
        const teacher = new Teacher()
        const a = new Student()
        const b = new Student()
        teacher.receive(a.edit((items) => [...items, stroke('a1'), stroke('a2')], 0)!)
        teacher.receive(b.edit((items) => [...items, stroke('b1')], 5)!)
        teacher.receive(a.edit((items) => items.filter((item) => item.id !== 'a2'), 10)!)
        a.receiveSnapshot(teacher.snapshot(), 20)
        b.receiveSnapshot(teacher.snapshot(), 20)
        expect(ids(a.items)).toEqual(ids(teacher.items))
        expect(ids(b.items)).toEqual(ids(teacher.items))
        expect(ids(teacher.items).sort()).toEqual(['a1', 'b1'])
    })

    it('sends nothing when a snapshot is applied without a local edit', () => {
        const student = new Student()
        student.receiveSnapshot([stroke('t1')], 0)
        expect(student.edit((items) => items, 10)).toBeNull()
    })
})
