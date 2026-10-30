import { describe, expect, it } from 'vitest'
import { getItemBounds, getLineEndpoints, moveBoardItem, parsePoints, pointToSegmentDistance, polylinesWithinDistance, registerImageAspect, resizeBoardItem, rotatePoint, smoothPath, type Point } from './boardGeometry'
import type { BoardItem } from './workspaceTypes'

const note: BoardItem = { id: 'n', type: 'note', left: 10, top: 10, text: 'hi' }
const shape = (overrides: Partial<Extract<BoardItem, { type: 'shape' }>> = {}): BoardItem => ({ id: 's', type: 'shape', shape: 'rectangle', left: 20, top: 20, color: '#000', ...overrides })

describe('parsePoints / smoothPath', () => {
    it('parses and ignores extra whitespace', () => {
        expect(parsePoints('  1,2   3,4 ')).toEqual([[1, 2], [3, 4]])
        expect(parsePoints('')).toEqual([])
    })
    it('handles 0, 1, 2 and many points', () => {
        expect(smoothPath('')).toBe('')
        expect(smoothPath('1,2')).toBe('M1,2h0.01')
        expect(smoothPath('1,2 3,4')).toBe('M1,2L3,4')
        expect(smoothPath('0,0 10,10 20,0')).toBe('M0,0Q10,10 15,5L20,0')
    })
    it('drops non-finite points', () => {
        expect(smoothPath('a,b')).toBe('')
    })
})

describe('distance helpers', () => {
    it('measures point to segment, including degenerate and clamped cases', () => {
        expect(pointToSegmentDistance([5, 5], [0, 0], [10, 0])).toBe(5)
        expect(pointToSegmentDistance([-3, 4], [0, 0], [10, 0])).toBe(5)
        expect(pointToSegmentDistance([3, 4], [0, 0], [0, 0])).toBe(5)
    })
    it('rotates around a center', () => {
        const [x, y] = rotatePoint([1, 0], [0, 0], 90)
        expect(x).toBeCloseTo(0)
        expect(y).toBeCloseTo(1)
    })
    it('detects crossing, near and far polylines', () => {
        const a: Point[] = [[0, 0], [10, 10]]
        expect(polylinesWithinDistance(a, [[0, 10], [10, 0]], 0)).toBe(true)
        expect(polylinesWithinDistance(a, [[20, 0], [30, 0]], 5)).toBe(false)
        expect(polylinesWithinDistance(a, [[12, 10]], 2)).toBe(true)
        expect(polylinesWithinDistance([[0, 0]], [[0, 0]], 0)).toBe(true)
    })
})

describe('getItemBounds', () => {
    it('computes stroke bounds with a minimum size of 1', () => {
        expect(getItemBounds({ id: 'a', type: 'stroke', points: '10,10 30,50', color: '#000', width: 2, opacity: 1 })).toEqual({ left: 10, top: 10, width: 20, height: 40 })
        expect(getItemBounds({ id: 'a', type: 'stroke', points: '5,5', color: '#000', width: 2, opacity: 1 })).toMatchObject({ width: 1, height: 1 })
    })
    it('converts percentages into the 1000x620 board space', () => {
        expect(getItemBounds(note)).toEqual({ left: 100, top: 62, width: 190, height: 170 })
    })
    it('applies scale', () => {
        expect(getItemBounds({ ...note, scale: 2 })).toMatchObject({ width: 380, height: 340 })
    })
    it('handles each shape kind', () => {
        expect(getItemBounds(shape({ shape: 'circle' }))).toMatchObject({ width: 92, height: 92 })
        expect(getItemBounds(shape({ shape: 'square' }))).toMatchObject({ width: 92, height: 92 })
        expect(getItemBounds(shape())).toMatchObject({ width: 125, height: 78 })
        expect(getItemBounds(shape({ shape: 'line' })).width).toBeGreaterThan(90)
    })
    it('expands a rotated rectangle', () => {
        expect(getItemBounds(shape({ rotation: 90 })).width).toBeCloseTo(78)
    })
    it('sizes multi-line text', () => {
        const single = getItemBounds({ id: 't', type: 'text', left: 0, top: 50, text: 'ab', color: '#000', size: 20 })
        const multi = getItemBounds({ id: 't', type: 'text', left: 0, top: 50, text: 'ab\ncd', color: '#000', size: 20 })
        expect(single.width).toBe(32)
        expect(multi.height).toBeGreaterThan(single.height)
    })
    it('handles every fixed-size item type', () => {
        const base = { id: 'x', left: 0, top: 0 }
        expect(getItemBounds({ ...base, type: 'grid', values: [] })).toMatchObject({ width: 294, height: 184 })
        expect(getItemBounds({ ...base, type: 'pdf', src: 's', label: 'l' })).toMatchObject({ width: 300, height: 220 })
        expect(getItemBounds({ ...base, type: 'web', url: 'u', title: 't' })).toMatchObject({ width: 640, height: 400 })
        expect(getItemBounds({ ...base, type: 'image', src: 'unknown-src', label: 'l' })).toMatchObject({ width: 230, height: 180 })
    })
    it('uses the registered image aspect ratio', () => {
        expect(registerImageAspect('wide.png', 400, 100)).toBe(true)
        expect(registerImageAspect('wide.png', 400, 100)).toBe(false)
        expect(registerImageAspect('bad.png', 0, 100)).toBe(false)
        expect(getItemBounds({ id: 'i', type: 'image', left: 0, top: 0, src: 'wide.png', label: 'l' })).toMatchObject({ width: 230, height: 57.5 })
    })
})

describe('getLineEndpoints', () => {
    it('defaults to a horizontal line centred on the item', () => {
        const { start, end } = getLineEndpoints(shape({ shape: 'line', left: 50, top: 50 }) as Extract<BoardItem, { type: 'shape' }>)
        expect(start).toEqual([452, 310])
        expect(end).toEqual([548, 310])
    })
    it('uses explicit end coordinates', () => {
        const { start, end } = getLineEndpoints(shape({ shape: 'arrow', left: 10, top: 10, endX: 20, endY: 20 }) as Extract<BoardItem, { type: 'shape' }>)
        expect(start).toEqual([100, 62])
        expect(end[0]).toBeCloseTo(200)
        expect(end[1]).toBeCloseTo(124)
    })
})

describe('moveBoardItem', () => {
    it('moves positioned items in percentage space', () => {
        expect(moveBoardItem(note, 100, 62)).toMatchObject({ left: 20, top: 20 })
    })
    it('moves stroke points in pixel space', () => {
        expect(moveBoardItem({ id: 's', type: 'stroke', points: '0,0 1,1', color: '#000', width: 1, opacity: 1 }, 5, 5)).toMatchObject({ points: '5,5 6,6' })
    })
    it('moves both ends of a line', () => {
        expect(moveBoardItem(shape({ shape: 'line', left: 10, top: 10, endX: 30, endY: 30 }), 100, 0)).toMatchObject({ left: 20, endX: 40, endY: 30 })
    })
    it('does not mutate the input', () => {
        const copy = structuredClone(note)
        moveBoardItem(note, 10, 10)
        expect(note).toEqual(copy)
    })
})

describe('resizeBoardItem', () => {
    it('scales and enforces the minimum scale', () => {
        expect(resizeBoardItem(note, 1.5).scale).toBeCloseTo(1.5)
        expect(resizeBoardItem(note, 0.01).scale).toBe(0.35)
    })
    it('refuses to grow past the board edge', () => {
        const nearEdge: BoardItem = { ...note, left: 79, top: 10 }
        const grown = resizeBoardItem(nearEdge, 5)
        const bounds = getItemBounds(grown)
        expect(bounds.left + bounds.width).toBeLessThanOrEqual(1000.0001)
    })
    it('keeps the anchor corner fixed when using a handle', () => {
        const before = getItemBounds(note)
        const after = getItemBounds(resizeBoardItem(note, 0.5, 'bottom-right'))
        expect(after.left).toBeCloseTo(before.left)
        expect(after.top).toBeCloseTo(before.top)
        const topLeft = getItemBounds(resizeBoardItem(note, 0.5, 'top-left'))
        expect(topLeft.left + topLeft.width).toBeCloseTo(before.left + before.width)
        expect(topLeft.top + topLeft.height).toBeCloseTo(before.top + before.height)
    })
    it('scales strokes by moving points', () => {
        const stroke: BoardItem = { id: 's', type: 'stroke', points: '100,100 200,200', color: '#000', width: 1, opacity: 1 }
        const bounds = getItemBounds(resizeBoardItem(stroke, 0.5))
        expect(bounds).toMatchObject({ left: 100, top: 100, width: 50, height: 50 })
    })
})
