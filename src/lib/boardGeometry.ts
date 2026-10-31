import type { BoardItem } from './workspaceTypes'

export type Point = [number, number]
export type ItemBounds = { left: number; top: number; width: number; height: number }
export type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const BOARD_WIDTH = 1000
const BOARD_HEIGHT = 620
export const TEXT_LINE_HEIGHT = 1.2

export function parsePoints(points: string): Point[] {
    return points.trim().split(/\s+/).filter(Boolean).map((point) => point.split(',').map(Number) as Point)
}

// Quadratic curves through segment midpoints turn jagged polylines into smooth paths.
export function smoothPath(points: string): string {
    const pts = parsePoints(points).filter((point) => point.every(Number.isFinite))
    if (!pts.length) return ''
    const f = (n: number) => Math.round(n * 100) / 100
    if (pts.length === 1) return `M${f(pts[0][0])},${f(pts[0][1])}h0.01`
    if (pts.length === 2) return `M${f(pts[0][0])},${f(pts[0][1])}L${f(pts[1][0])},${f(pts[1][1])}`
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`
    for (let i = 1; i < pts.length - 1; i++) {
        const midX = (pts[i][0] + pts[i + 1][0]) / 2
        const midY = (pts[i][1] + pts[i + 1][1]) / 2
        d += `Q${f(pts[i][0])},${f(pts[i][1])} ${f(midX)},${f(midY)}`
    }
    const last = pts[pts.length - 1]
    return `${d}L${f(last[0])},${f(last[1])}`
}

export function pointToSegmentDistance(point: Point, start: Point, end: Point) {
    const deltaX = end[0] - start[0]
    const deltaY = end[1] - start[1]
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1])
    const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared))
    return Math.hypot(point[0] - (start[0] + ratio * deltaX), point[1] - (start[1] + ratio * deltaY))
}

export function rotatePoint(point: Point, center: Point, degrees: number): Point {
    const radians = degrees * Math.PI / 180
    const deltaX = point[0] - center[0]
    const deltaY = point[1] - center[1]
    return [center[0] + deltaX * Math.cos(radians) - deltaY * Math.sin(radians), center[1] + deltaX * Math.sin(radians) + deltaY * Math.cos(radians)]
}

function boundsForPoints(points: Point[]): ItemBounds {
    const xs = points.map(([pointX]) => pointX)
    const ys = points.map(([, pointY]) => pointY)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return { left, top, width: Math.max(1, Math.max(...xs) - left), height: Math.max(1, Math.max(...ys) - top) }
}

function segmentDistance(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point) {
    const orientation = (start: Point, end: Point, point: Point) => (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0])
    const firstSideA = orientation(firstStart, firstEnd, secondStart)
    const firstSideB = orientation(firstStart, firstEnd, secondEnd)
    const secondSideA = orientation(secondStart, secondEnd, firstStart)
    const secondSideB = orientation(secondStart, secondEnd, firstEnd)
    const onSegment = (start: Point, end: Point, point: Point) => point[0] >= Math.min(start[0], end[0]) && point[0] <= Math.max(start[0], end[0]) && point[1] >= Math.min(start[1], end[1]) && point[1] <= Math.max(start[1], end[1])
    if (firstSideA === 0 && onSegment(firstStart, firstEnd, secondStart) ||
        firstSideB === 0 && onSegment(firstStart, firstEnd, secondEnd) ||
        secondSideA === 0 && onSegment(secondStart, secondEnd, firstStart) ||
        secondSideB === 0 && onSegment(secondStart, secondEnd, firstEnd) ||
        (firstSideA < 0) !== (firstSideB < 0) && (secondSideA < 0) !== (secondSideB < 0)) return 0
    return Math.min(
        pointToSegmentDistance(firstStart, secondStart, secondEnd),
        pointToSegmentDistance(firstEnd, secondStart, secondEnd),
        pointToSegmentDistance(secondStart, firstStart, firstEnd),
        pointToSegmentDistance(secondEnd, firstStart, firstEnd),
    )
}

export function polylinesWithinDistance(first: Point[], second: Point[], distance: number) {
    const firstSegments = first.length === 1 ? [[first[0], first[0]]] : first.slice(1).map((point, index) => [first[index], point])
    const secondSegments = second.length === 1 ? [[second[0], second[0]]] : second.slice(1).map((point, index) => [second[index], point])
    return firstSegments.some(([firstStart, firstEnd]) => secondSegments.some(([secondStart, secondEnd]) => segmentDistance(firstStart, firstEnd, secondStart, secondEnd) <= distance))
}

export function getLineEndpoints(item: Extract<BoardItem, { type: 'shape' }>): { start: Point; end: Point } {
    const scale = item.scale ?? 1
    let start: Point
    let end: Point
    // Persisted item positions are percentages; the board SVG uses a 1000-by-620 coordinate space.
    if (item.endX === undefined || item.endY === undefined) {
        const centerX = item.left * 10
        const centerY = item.top * 6.2
        start = [centerX - 48 * scale, centerY]
        end = [centerX + 48 * scale, centerY]
    } else {
        start = [item.left * 10, item.top * 6.2]
        end = [start[0] + (item.endX - item.left) * 10 * scale, start[1] + (item.endY - item.top) * 6.2 * scale]
    }
    const center: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    return { start: rotatePoint(start, center, item.rotation ?? 0), end: rotatePoint(end, center, item.rotation ?? 0) }
}

export function getItemBounds(item: BoardItem): ItemBounds {
    const scale = item.scale ?? 1
    if (item.type === 'stroke') {
        const points = parsePoints(item.points)
        const xs = points.map(([pointX]) => pointX)
        const ys = points.map(([, pointY]) => pointY)
        const left = Math.min(...xs)
        const top = Math.min(...ys)
        return { left, top, width: Math.max(1, Math.max(...xs) - left), height: Math.max(1, Math.max(...ys) - top) }
    }
    const left = item.left * 10
    const top = item.top * 6.2
    if (item.type === 'shape' && item.shape === 'circle') return { left: left - 46 * scale, top: top - 46 * scale, width: 92 * scale, height: 92 * scale }
    if (item.type === 'shape' && (item.shape === 'line' || item.shape === 'arrow')) {
        const { start, end } = getLineEndpoints(item)
        const margin = 5 * scale
        const boundsLeft = Math.min(start[0], end[0]) - margin
        const boundsTop = Math.min(start[1], end[1]) - margin
        return { left: boundsLeft, top: boundsTop, width: Math.max(1, Math.abs(end[0] - start[0]) + margin * 2), height: Math.max(1, Math.abs(end[1] - start[1]) + margin * 2) }
    }
    if (item.type === 'shape') {
        const width = (item.shape === 'square' ? 92 : 125) * scale
        const height = (item.shape === 'square' ? 92 : 78) * scale
        const center: Point = [left + width / 2, top + height / 2]
        const corners: Point[] = [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
        return boundsForPoints(corners.map((point) => rotatePoint(point, center, item.rotation ?? 0)))
    }
    if (item.type === 'text') {
        const lines = item.text.split('\n')
        const longest = Math.max(...lines.map((line) => line.length))
        return { left, top: top - item.size * scale, width: Math.max(32, longest * item.size * 0.62) * scale, height: (1.5 + (lines.length - 1) * TEXT_LINE_HEIGHT) * item.size * scale }
    }
    if (item.type === 'image') {
        const size = getImageSize(item.src)
        return { left, top, width: size.width * scale, height: size.height * scale }
    }
    const width = item.type === 'grid' ? 294 : item.type === 'note' ? 190 : item.type === 'pdf' ? 300 : 230
    const height = item.type === 'grid' ? 184 : item.type === 'note' ? 170 : item.type === 'pdf' ? 220 : 180
    return { left, top, width: width * scale, height: height * scale }
}

const IMAGE_BOX = { width: 230, height: 180 }
const imageAspects = new Map<string, number>()

export function registerImageAspect(src: string, naturalWidth: number, naturalHeight: number) {
    if (!naturalWidth || !naturalHeight) return false
    const aspect = naturalWidth / naturalHeight
    if (imageAspects.get(src) === aspect) return false
    imageAspects.set(src, aspect)
    return true
}

// Fits the image inside the default box while keeping its natural aspect ratio.
export function getImageSize(src: string) {
    const aspect = imageAspects.get(src)
    if (!aspect) return IMAGE_BOX
    const width = Math.min(IMAGE_BOX.width, IMAGE_BOX.height * aspect)
    return { width, height: width / aspect }
}

export function moveBoardItem(item: BoardItem, deltaX: number, deltaY: number): BoardItem {
    if (item.type === 'stroke') return { ...item, points: parsePoints(item.points).map(([pointX, pointY]) => `${pointX + deltaX},${pointY + deltaY}`).join(' ') }
    if (item.type === 'shape' && (item.shape === 'line' || item.shape === 'arrow') && item.endX !== undefined && item.endY !== undefined) {
        return { ...item, left: item.left + deltaX / 10, top: item.top + deltaY / 6.2, endX: item.endX + deltaX / 10, endY: item.endY + deltaY / 6.2 }
    }
    return { ...item, left: item.left + deltaX / 10, top: item.top + deltaY / 6.2 }
}

export function resizeBoardItem(item: BoardItem, factor: number, handle?: ResizeHandle): BoardItem {
    const resizeAtFactor = (resizeFactor: number): BoardItem => {
        const bounds = getItemBounds(item)
        if (item.type === 'stroke') {
            const anchorX = handle?.endsWith('left') ? bounds.left + bounds.width : bounds.left
            const anchorY = handle?.startsWith('top') ? bounds.top + bounds.height : bounds.top
            const scaledStroke: BoardItem = {
                ...item,
                points: parsePoints(item.points).map(([pointX, pointY]) => `${anchorX + (pointX - anchorX) * resizeFactor},${anchorY + (pointY - anchorY) * resizeFactor}`).join(' '),
            }
            if (!handle) return scaledStroke
            const scaledBounds = getItemBounds(scaledStroke)
            return moveBoardItem(scaledStroke, anchorX - (handle.endsWith('left') ? scaledBounds.left + scaledBounds.width : scaledBounds.left), anchorY - (handle.startsWith('top') ? scaledBounds.top + scaledBounds.height : scaledBounds.top))
        }
        const scale = Math.max(item.type === 'image' ? 0.01 : 0.35, (item.scale ?? 1) * resizeFactor)
        const scaledItem = { ...item, scale }
        if (!handle) return scaledItem
        const anchorX = handle.endsWith('left') ? bounds.left + bounds.width : bounds.left
        const anchorY = handle.startsWith('top') ? bounds.top + bounds.height : bounds.top
        const scaledBounds = getItemBounds(scaledItem)
        const scaledAnchorX = handle.endsWith('left') ? scaledBounds.left + scaledBounds.width : scaledBounds.left
        const scaledAnchorY = handle.startsWith('top') ? scaledBounds.top + scaledBounds.height : scaledBounds.top
        return moveBoardItem(scaledItem, anchorX - scaledAnchorX, anchorY - scaledAnchorY)
    }

    let boundedFactor = factor
    if (factor > 1) {
        const fitsBoard = (resizeFactor: number) => {
            const bounds = getItemBounds(resizeAtFactor(resizeFactor))
            return bounds.left >= 0 && bounds.top >= 0
                && bounds.left + bounds.width <= BOARD_WIDTH
                && bounds.top + bounds.height <= BOARD_HEIGHT
        }
        if (!fitsBoard(factor)) {
            if (!fitsBoard(1)) {
                boundedFactor = 1
            } else {
                let low = 1
                let high = factor
                for (let attempt = 0; attempt < 24; attempt++) {
                    const middle = (low + high) / 2
                    if (fitsBoard(middle)) low = middle
                    else high = middle
                }
                boundedFactor = low
            }
        }
    }
    return resizeAtFactor(boundedFactor)
}
