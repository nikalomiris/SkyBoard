import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
    ArrowLeft, AudioLines, BookOpen, Brush, Check, ChevronDown, ChevronLeft, ChevronRight,
    Circle, Copy, Download, Eraser, FileImage, FileText, Folder, FolderPlus, Globe,
    Grid2X2, Highlighter, ImagePlus, LayoutGrid, List, Minus, MoreHorizontal, MoveRight,
    MousePointer2, NotebookTabs, Pencil, Plus, Search, Settings2, Share2, Shapes, Sparkles,
    RotateCw, StickyNote, Trash2, Type, Users, X,
} from 'lucide-react'

type Tool = 'select' | 'pen' | 'brush' | 'highlighter' | 'eraser' | 'element-eraser' | 'postit' | 'text' | 'shape' | 'grid' | 'laser'
type BoardItem = { id: string; scale?: number } & (
    | { type: 'stroke'; points: string; color: string; width: number; opacity: number }
    | { type: 'text'; left: number; top: number; text: string; color: string; size: number }
    | { type: 'note'; left: number; top: number; text: string }
    | { type: 'shape'; left: number; top: number; shape: 'circle' | 'rectangle' | 'line'; color: string; endX?: number; endY?: number; startArrow?: boolean; endArrow?: boolean; rotation?: number }
    | { type: 'grid'; left: number; top: number; values: string[] }
    | { type: 'image'; left: number; top: number; src: string; label: string }
    | { type: 'pdf'; left: number; top: number; src: string; label: string }
)
type Lesson = { id: string; title: string; folder: string; pages: string[]; updated: string; color: string; kind: 'lesson' }
type Point = [number, number]
type ItemBounds = { left: number; top: number; width: number; height: number }
type ItemGesture =
    | { mode: 'move' | 'resize'; item: BoardItem; startX: number; startY: number; bounds: ItemBounds }
    | { mode: 'rotate'; item: Extract<BoardItem, { type: 'shape' }>; center: Point; startAngle: number; startRotation: number }

type PageItems = Record<string, BoardItem[]>

const lessonColors = ['#daf0e9', '#fae7d9', '#e3e9fc', '#f5e8a8']
const initialLessons: Lesson[] = [
    { id: 'lesson-vowels', title: 'Short vowels · at family', folder: 'Phonics', pages: ['Warm up', 'Blend it', 'Read it'], updated: 'Today', color: lessonColors[0], kind: 'lesson' },
    { id: 'lesson-blends', title: 'Consonant blends', folder: 'Phonics', pages: ['Sound sort', 'Build a word'], updated: 'Yesterday', color: lessonColors[1], kind: 'lesson' },
    { id: 'lesson-syllables', title: 'Syllable safari', folder: 'Fluency', pages: ['Clap it out', 'Word hunt', 'Wrap up'], updated: 'Sep 24', color: lessonColors[2], kind: 'lesson' },
    { id: 'lesson-vce', title: 'Magic e · long a', folder: 'Phonics', pages: ['Notice', 'Practice'], updated: 'Sep 22', color: lessonColors[3], kind: 'lesson' },
]
const folderNamesInitial = ['Phonics', 'Fluency', 'Word study']
const toolList: { id: Tool; label: string; icon: typeof Pencil }[] = [
    { id: 'select', label: 'Select', icon: MousePointer2 },
    { id: 'pen', label: 'Pen', icon: Pencil },
    { id: 'brush', label: 'Brush', icon: Brush },
    { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
    { id: 'eraser', label: 'Eraser', icon: Eraser },
    { id: 'element-eraser', label: 'Element eraser', icon: Trash2 },
    { id: 'postit', label: 'Post-it', icon: StickyNote },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'shape', label: 'Shapes', icon: Shapes },
    { id: 'grid', label: 'Word grid', icon: Grid2X2 },
    { id: 'laser', label: 'Laser pointer', icon: Sparkles },
]
const palette = ['#253c37', '#ee7859', '#387c70', '#576fc2', '#e5ac37', '#bc6c9a']

function id() {
    return Math.random().toString(36).slice(2, 10)
}

function parsePoints(points: string): Point[] {
    return points.trim().split(/\s+/).filter(Boolean).map((point) => point.split(',').map(Number) as Point)
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
    const deltaX = end[0] - start[0]
    const deltaY = end[1] - start[1]
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1])
    const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared))
    return Math.hypot(point[0] - (start[0] + ratio * deltaX), point[1] - (start[1] + ratio * deltaY))
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
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

function polylinesWithinDistance(first: Point[], second: Point[], distance: number) {
    const firstSegments = first.length === 1 ? [[first[0], first[0]]] : first.slice(1).map((point, index) => [first[index], point])
    const secondSegments = second.length === 1 ? [[second[0], second[0]]] : second.slice(1).map((point, index) => [second[index], point])
    return firstSegments.some(([firstStart, firstEnd]) => secondSegments.some(([secondStart, secondEnd]) => segmentDistance(firstStart, firstEnd, secondStart, secondEnd) <= distance))
}

function readStored<T>(key: string, fallback: T): T {
    try {
        const value = window.localStorage.getItem(key)
        return value ? JSON.parse(value) as T : fallback
    } catch {
        return fallback
    }
}

function Thumb({ kind, tint }: { kind: string; tint: string }) {
    return (
        <div className={`lesson-thumb ${kind}`} style={{ backgroundColor: tint }} aria-hidden="true">
            {kind === 'blends' ? <><span className="thumb-line short" /><span className="thumb-chip">sh</span><span className="thumb-chip peach">i</span><span className="thumb-chip green">p</span><span className="thumb-line" /></> :
                kind === 'safari' ? <><div className="thumb-sun" /><span className="thumb-word">syllables</span><div className="thumb-hills" /></> :
                    kind === 'magic' ? <><span className="thumb-letter">a</span><span className="thumb-arrow">→</span><span className="thumb-letter accent">ā</span><span className="thumb-star">✳</span></> :
                        <><span className="thumb-title">at</span><span className="thumb-chip">c</span><span className="thumb-chip peach">a</span><span className="thumb-chip green">t</span><span className="thumb-underline" /></>}
        </div>
    )
}

function App() {
    const [studentView] = useState(() => new URLSearchParams(window.location.search).get('view') === 'student')
    const [lessons, setLessons] = useState(() => readStored('skyboard:lessons', initialLessons))
    const [folders, setFolders] = useState(() => readStored('skyboard:folders', folderNamesInitial))
    const [activeFolder, setActiveFolder] = useState('All lessons')
    const [search, setSearch] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [openLesson, setOpenLesson] = useState<Lesson | null>(() => {
        const params = new URLSearchParams(window.location.search)
        return params.get('view') === 'student' ? readStored<Lesson[]>('skyboard:lessons', initialLessons).find((lesson) => lesson.id === params.get('lesson')) ?? null : null
    })
    const [pages, setPages] = useState<string[]>(() => {
        const params = new URLSearchParams(window.location.search)
        return params.get('view') === 'student' ? readStored<Lesson[]>('skyboard:lessons', initialLessons).find((lesson) => lesson.id === params.get('lesson'))?.pages ?? [] : []
    })
    const [pageIndex, setPageIndex] = useState(() => {
        if (!studentView) return 0
        const active = readStored<{ lessonId: string; pageIndex: number } | null>('skyboard:active-page', null)
        return active && active.lessonId === openLesson?.id ? Math.min(active.pageIndex, Math.max(0, pages.length - 1)) : 0
    })
    const [itemsByPage, setItemsByPage] = useState<PageItems>(() => readStored('skyboard:items', {}))
    const [activeTool, setActiveTool] = useState<Tool>('select')
    const [selectedShape, setSelectedShape] = useState<'circle' | 'rectangle' | 'line'>('circle')
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
    const [ink, setInk] = useState(palette[0])
    const [background, setBackground] = useState('#fffef9')
    const [showBackgrounds, setShowBackgrounds] = useState(false)
    const [showBlend, setShowBlend] = useState(false)
    const [showShare, setShowShare] = useState(false)
    const [showImageSearch, setShowImageSearch] = useState(false)
    const [imageQuery, setImageQuery] = useState('')
    const [imageUrl, setImageUrl] = useState('')
    const [showFileMenu, setShowFileMenu] = useState<string | null>(null)
    const [isFollowing, setIsFollowing] = useState(false)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null)
    const [folderMenu, setFolderMenu] = useState<string | null>(null)
    const [printing, setPrinting] = useState(false)
    const [toast, setToast] = useState('')
    const [drawing, setDrawing] = useState(false)
    const [currentPoints, setCurrentPoints] = useState('')
    const [lineDraft, setLineDraft] = useState<{ start: Point; end: Point } | null>(null)
    const [showToolOptions, setShowToolOptions] = useState(false)
    const stageRef = useRef<HTMLDivElement>(null)
    const itemGestureRef = useRef<ItemGesture | null>(null)
    const imageInputRef = useRef<HTMLInputElement>(null)
    const backgroundInputRef = useRef<HTMLInputElement>(null)

    const currentPageKey = openLesson ? `${openLesson.id}:${pageIndex}` : ''
    const currentItems = itemsByPage[currentPageKey] ?? []
    const selectedItem = currentItems.find((item) => item.id === selectedItemId) ?? null
    const visibleLessons = lessons.filter((lesson) => {
        const matchesFolder = activeFolder === 'All lessons' || activeFolder === 'Shared with me' || lesson.folder === activeFolder
        return matchesFolder && lesson.title.toLowerCase().includes(search.toLowerCase())
    })

    useEffect(() => { window.localStorage.setItem('skyboard:lessons', JSON.stringify(lessons)) }, [lessons])
    useEffect(() => { window.localStorage.setItem('skyboard:folders', JSON.stringify(folders)) }, [folders])
    useEffect(() => { window.localStorage.setItem('skyboard:items', JSON.stringify(itemsByPage)) }, [itemsByPage])
    useLayoutEffect(() => {
        setSelectedItemId(null)
        itemGestureRef.current = null
    }, [currentPageKey])
    useEffect(() => {
        if (!openLesson) return
        const pageKey = 'skyboard:active-page'
        if (!studentView) {
            window.localStorage.setItem(pageKey, JSON.stringify({ lessonId: openLesson.id, pageIndex }))
            return
        }
        const syncPage = (event: StorageEvent) => {
            if (event.key !== pageKey || !event.newValue) return
            try {
                const active = JSON.parse(event.newValue) as { lessonId: string; pageIndex: number }
                if (active.lessonId !== openLesson.id) return
                const lesson = readStored<Lesson[]>('skyboard:lessons', initialLessons).find((candidate) => candidate.id === openLesson.id)
                if (lesson) {
                    setOpenLesson(lesson)
                    setPages(lesson.pages)
                }
                setPageIndex(Math.min(active.pageIndex, Math.max(0, (lesson?.pages ?? pages).length - 1)))
            } catch { return }
        }
        const syncItems = (event: StorageEvent) => {
            if (event.key === 'skyboard:items') setItemsByPage(readStored('skyboard:items', {}))
        }
        const syncLessons = (event: StorageEvent) => {
            if (event.key !== 'skyboard:lessons') return
            const lesson = readStored<Lesson[]>('skyboard:lessons', initialLessons).find((candidate) => candidate.id === openLesson.id)
            if (!lesson) return
            setOpenLesson(lesson)
            setPages(lesson.pages)
            setPageIndex((index) => Math.min(index, Math.max(0, lesson.pages.length - 1)))
        }
        window.addEventListener('storage', syncPage)
        window.addEventListener('storage', syncItems)
        window.addEventListener('storage', syncLessons)
        return () => {
            window.removeEventListener('storage', syncPage)
            window.removeEventListener('storage', syncItems)
            window.removeEventListener('storage', syncLessons)
        }
    }, [openLesson, pageIndex, pages.length, studentView])

    useEffect(() => {
        if (studentView) return
        const deleteSelected = (event: KeyboardEvent) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
            if (!selectedItemId) return
            event.preventDefault()
            updateCurrentItems((items) => items.filter((item) => item.id !== selectedItemId))
            setSelectedItemId(null)
        }
        window.addEventListener('keydown', deleteSelected)
        return () => window.removeEventListener('keydown', deleteSelected)
    }, [selectedItemId, currentPageKey, studentView])

    function notify(message: string) {
        setToast(message)
        window.setTimeout(() => setToast(''), 2400)
    }

    function updateCurrentItems(nextItems: BoardItem[] | ((items: BoardItem[]) => BoardItem[])) {
        setItemsByPage((previous) => ({
            ...previous,
            [currentPageKey]: typeof nextItems === 'function' ? nextItems(previous[currentPageKey] ?? []) : nextItems,
        }))
    }

    function getLineEndpoints(item: Extract<BoardItem, { type: 'shape' }>): { start: Point; end: Point } {
        const scale = item.scale ?? 1
        let start: Point
        let end: Point
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

    function getItemBounds(item: BoardItem): ItemBounds {
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
        if (item.type === 'shape' && item.shape === 'line') {
            const { start, end } = getLineEndpoints(item)
            const margin = 5 * scale
            const boundsLeft = Math.min(start[0], end[0]) - margin
            const boundsTop = Math.min(start[1], end[1]) - margin
            return { left: boundsLeft, top: boundsTop, width: Math.max(1, Math.abs(end[0] - start[0]) + margin * 2), height: Math.max(1, Math.abs(end[1] - start[1]) + margin * 2) }
        }
        if (item.type === 'shape') {
            const width = 125 * scale
            const height = 78 * scale
            const center: Point = [left + width / 2, top + height / 2]
            const corners: Point[] = [[left, top], [left + width, top], [left + width, top + height], [left, top + height]]
            return boundsForPoints(corners.map((point) => rotatePoint(point, center, item.rotation ?? 0)))
        }
        if (item.type === 'text') return { left, top: top - item.size * scale, width: Math.max(32, item.text.length * item.size * 0.62) * scale, height: item.size * 1.5 * scale }
        const width = item.type === 'grid' ? 294 : item.type === 'note' ? 190 : item.type === 'pdf' ? 300 : 230
        const height = item.type === 'grid' ? 184 : item.type === 'note' ? 170 : item.type === 'pdf' ? 220 : 180
        return { left, top, width: width * scale, height: height * scale }
    }

    function moveBoardItem(item: BoardItem, deltaX: number, deltaY: number): BoardItem {
        if (item.type === 'stroke') return { ...item, points: parsePoints(item.points).map(([pointX, pointY]) => `${pointX + deltaX},${pointY + deltaY}`).join(' ') }
        if (item.type === 'shape' && item.shape === 'line' && item.endX !== undefined && item.endY !== undefined) {
            return { ...item, left: item.left + deltaX / 10, top: item.top + deltaY / 6.2, endX: item.endX + deltaX / 10, endY: item.endY + deltaY / 6.2 }
        }
        return { ...item, left: item.left + deltaX / 10, top: item.top + deltaY / 6.2 }
    }

    function resizeBoardItem(item: BoardItem, factor: number): BoardItem {
        const scale = Math.max(0.35, Math.min(3, (item.scale ?? 1) * factor))
        if (item.type !== 'stroke') return { ...item, scale }
        const bounds = getItemBounds(item)
        return {
            ...item,
            points: parsePoints(item.points).map(([pointX, pointY]) => `${bounds.left + (pointX - bounds.left) * factor},${bounds.top + (pointY - bounds.top) * factor}`).join(' '),
        }
    }

    function addBoardItem(item: BoardItem) {
        updateCurrentItems((items) => [...items, item])
        setSelectedItemId(item.id)
        setActiveTool('select')
        setShowToolOptions(false)
    }

    function reorderPage(fromIndex: number, toIndex: number) {
        if (!openLesson || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
        const nextPages = [...pages]
        const [movedPage] = nextPages.splice(fromIndex, 1)
        nextPages.splice(toIndex, 0, movedPage)
        const nextPageIndex = pageIndex === fromIndex ? toIndex :
            fromIndex < pageIndex && toIndex >= pageIndex ? pageIndex - 1 :
                fromIndex > pageIndex && toIndex <= pageIndex ? pageIndex + 1 : pageIndex
        setItemsByPage((previous) => {
            const reordered = { ...previous }
            pages.forEach((_, oldIndex) => {
                const oldKey = `${openLesson.id}:${oldIndex}`
                const newIndex = oldIndex === fromIndex ? toIndex :
                    fromIndex < toIndex && oldIndex > fromIndex && oldIndex <= toIndex ? oldIndex - 1 :
                        fromIndex > toIndex && oldIndex >= toIndex && oldIndex < fromIndex ? oldIndex + 1 : oldIndex
                const newKey = `${openLesson.id}:${newIndex}`
                if (previous[oldKey]) reordered[newKey] = previous[oldKey]
                else delete reordered[newKey]
            })
            return reordered
        })
        updateLessonPages(nextPages)
        setPageIndex(nextPageIndex)
        setSelectedItemId(null)
    }

    function createLesson() {
        const lesson: Lesson = {
            id: id(), title: 'Untitled lesson', folder: folders[0] ?? 'My lessons', pages: ['Page 1'], updated: 'Just now',
            color: lessonColors[Math.floor(Math.random() * lessonColors.length)], kind: 'lesson',
        }
        setLessons((previous) => [lesson, ...previous])
        openBoard(lesson)
    }

    function openBoard(lesson: Lesson) {
        setOpenLesson(lesson)
        setPages(lesson.pages)
        setPageIndex(0)
        setActiveTool('select')
        setShowFileMenu(null)
        setItemsByPage((previous) => {
            if (previous[`${lesson.id}:0`]) return previous
            const starter: BoardItem[] = lesson.id === 'lesson-vowels' ? [
                { id: id(), type: 'text', left: 11, top: 18, text: 'Let’s build a word', color: '#253c37', size: 30 },
                { id: id(), type: 'text', left: 11, top: 26, text: 'Listen · tap each sound · blend', color: '#75837e', size: 15 },
                { id: id(), type: 'grid', left: 59, top: 25, values: ['sh', 'i', 'p', '', '', '', '', '', ''] },
                { id: id(), type: 'note', left: 13, top: 42, text: 'Say it slowly\nsh  ·  i  ·  p' },
            ] : []
            return { ...previous, [`${lesson.id}:0`]: starter }
        })
    }

    function duplicateLesson(lesson: Lesson) {
        const copy: Lesson = { ...lesson, id: id(), title: `${lesson.title} copy`, pages: [...lesson.pages], updated: 'Just now' }
        setLessons((previous) => [copy, ...previous])
        setShowFileMenu(null)
        notify('Lesson duplicated')
    }

    function deleteLesson(lessonId: string) {
        setLessons((previous) => previous.filter((lesson) => lesson.id !== lessonId))
        setShowFileMenu(null)
        notify('Lesson moved to trash')
    }

    function deleteFolder(folder: string) {
        const destination = folders.find((name) => name !== folder) ?? 'Unfiled'
        setLessons((previous) => previous.map((lesson) => lesson.folder === folder ? { ...lesson, folder: destination } : lesson))
        setFolders((previous) => previous.filter((name) => name !== folder))
        setFolderMenu(null)
        if (activeFolder === folder) setActiveFolder('All lessons')
        notify(`Folder deleted; lessons moved to ${destination}`)
    }

    function moveLesson(lessonId: string, folder: string) {
        setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, folder } : lesson))
        setDraggingId(null)
        setShowFileMenu(null)
        notify(`Moved to ${folder}`)
    }

    function createFolder() {
        const name = window.prompt('Name your folder')?.trim()
        if (!name) return
        if (folders.includes(name)) return notify('A folder with that name already exists')
        setFolders((previous) => [...previous, name])
        setActiveFolder(name)
    }

    function startNewFolder() {
        createFolder()
    }

    function addPage() {
        const nextPages = [...pages, `Page ${pages.length + 1}`]
        updateLessonPages(nextPages)
        setPageIndex(nextPages.length - 1)
    }

    function updateLessonPages(nextPages: string[]) {
        if (!openLesson) return
        const updatedLesson = { ...openLesson, pages: nextPages }
        setPages(nextPages)
        setOpenLesson(updatedLesson)
        setLessons((previous) => previous.map((lesson) => lesson.id === updatedLesson.id ? updatedLesson : lesson))
    }

    function duplicatePage() {
        const nextPages = [...pages.slice(0, pageIndex + 1), `${pages[pageIndex]} copy`, ...pages.slice(pageIndex + 1)]
        updateLessonPages(nextPages)
        setItemsByPage((previous) => ({ ...previous, [`${openLesson?.id}:${pageIndex + 1}`]: [...currentItems.map((item) => ({ ...item, id: id() }))] }))
        setPageIndex(pageIndex + 1)
        notify('Page duplicated')
    }

    function deletePage() {
        if (pages.length <= 1) return notify('A lesson needs at least one page')
        const nextPages = pages.filter((_, index) => index !== pageIndex)
        updateLessonPages(nextPages)
        const nextIndex = Math.max(0, pageIndex - 1)
        setPageIndex(nextIndex)
        notify('Page deleted')
    }

    function coordinates(event: { clientX: number; clientY: number }) {
        const rect = stageRef.current!.getBoundingClientRect()
        return { stageX: ((event.clientX - rect.left) / rect.width) * 1000, stageY: ((event.clientY - rect.top) / rect.height) * 620 }
    }

    function beginItemGesture(event: ReactPointerEvent<Element>, item: BoardItem, mode: 'move' | 'resize' = 'move') {
        if (studentView || activeTool !== 'select') return
        setSelectedItemId(item.id)
        event.stopPropagation()
        if (event.target instanceof HTMLInputElement) {
            return
        }
        const { stageX, stageY } = coordinates(event)
        itemGestureRef.current = { mode, item, startX: stageX, startY: stageY, bounds: getItemBounds(item) }
        stageRef.current?.setPointerCapture(event.pointerId)
    }

    function resizeFromHandle(event: ReactPointerEvent<SVGCircleElement>) {
        if (!selectedItem) return
        event.stopPropagation()
        const { stageX, stageY } = coordinates(event)
        itemGestureRef.current = { mode: 'resize', item: selectedItem, startX: stageX, startY: stageY, bounds: getItemBounds(selectedItem) }
        stageRef.current?.setPointerCapture(event.pointerId)
    }

    function rotateFromHandle(event: ReactPointerEvent<HTMLButtonElement>) {
        if (!selectedItem || selectedItem.type !== 'shape' || selectedItem.shape === 'circle') return
        event.stopPropagation()
        const { stageX, stageY } = coordinates(event)
        const bounds = getItemBounds(selectedItem)
        const center: Point = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2]
        itemGestureRef.current = {
            mode: 'rotate',
            item: selectedItem,
            center,
            startAngle: Math.atan2(stageY - center[1], stageX - center[0]) * 180 / Math.PI,
            startRotation: selectedItem.rotation ?? 0,
        }
        stageRef.current?.setPointerCapture(event.pointerId)
    }

    function scaleSelectedItem(factor: number) {
        if (!selectedItem) return
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id ? resizeBoardItem(item, factor) : item))
    }

    function deleteSelectedItem() {
        if (!selectedItemId) return
        updateCurrentItems((items) => items.filter((item) => item.id !== selectedItemId))
        setSelectedItemId(null)
    }

    function toggleLineArrow(end: 'start' | 'end') {
        if (!selectedItem || selectedItem.type !== 'shape' || selectedItem.shape !== 'line') return
        const property = end === 'start' ? 'startArrow' : 'endArrow'
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'shape' && item.shape === 'line'
            ? { ...item, [property]: !item[property] }
            : item))
    }

    function onStageDown(event: ReactPointerEvent<HTMLElement>) {
        if (studentView || !stageRef.current) return
        const { stageX, stageY } = coordinates(event)
        if (activeTool === 'element-eraser') {
            const hit = currentItems.find((item) => {
                if (item.type === 'stroke') return item.points.trim().split(/\s+/).some((point) => {
                    const [pointX, pointY] = point.split(',').map(Number)
                    return Math.hypot(pointX - stageX, pointY - stageY) < 28
                })
                if (!('left' in item)) return false
                const itemX = item.left * 10
                const itemY = item.top * 6.2
                if (item.type === 'shape') {
                    if (item.shape === 'circle') return Math.hypot(itemX - stageX, itemY - stageY) < 53
                    if (item.shape === 'line') {
                        const { start, end } = getLineEndpoints(item)
                        return pointToSegmentDistance([stageX, stageY], start, end) < 14
                    }
                    return stageX >= itemX - 12 && stageX <= itemX + 137 && stageY >= itemY - 12 && stageY <= itemY + 90
                }
                const width = item.type === 'grid' ? 294 : item.type === 'note' ? 190 : 230
                const height = item.type === 'grid' ? 184 : item.type === 'note' ? 170 : 180
                return stageX >= itemX - 10 && stageX <= itemX + width && stageY >= itemY - 10 && stageY <= itemY + height
            })
            if (hit) updateCurrentItems((items) => items.filter((item) => item.id !== hit.id))
            return
        }
        if (activeTool === 'postit') {
            const text = window.prompt('Add a note', 'Remember this sound!')
            if (text) addBoardItem({ id: id(), type: 'note', left: stageX / 10, top: stageY / 6.2, text })
            return
        }
        if (activeTool === 'text') {
            const text = window.prompt('Add text')
            if (text) addBoardItem({ id: id(), type: 'text', left: stageX / 10, top: stageY / 6.2, text, color: ink, size: 22 })
            return
        }
        if (activeTool === 'grid') {
            addBoardItem({ id: id(), type: 'grid', left: stageX / 10, top: stageY / 6.2, values: Array(9).fill('') })
            return
        }
        if (activeTool === 'shape') {
            if (selectedShape === 'line') {
                setSelectedItemId(null)
                setLineDraft({ start: [stageX, stageY], end: [stageX, stageY] })
                stageRef.current.setPointerCapture(event.pointerId)
                return
            }
            addBoardItem({ id: id(), type: 'shape', left: stageX / 10, top: stageY / 6.2, shape: selectedShape, color: ink })
            return
        }
        if (activeTool === 'select') {
            setSelectedItemId(null)
            return
        }
        if (activeTool === 'laser') {
            setCurrentPoints(`${stageX},${stageY}`)
            return
        }
        stageRef.current.setPointerCapture(event.pointerId)
        setDrawing(true)
        setCurrentPoints(`${stageX},${stageY}`)
    }

    function onStageMove(event: ReactPointerEvent<HTMLElement>) {
        if (!stageRef.current) return
        const { stageX, stageY } = coordinates(event)
        if (lineDraft) {
            setLineDraft({ ...lineDraft, end: [stageX, stageY] })
            return
        }
        const gesture = itemGestureRef.current
        if (gesture) {
            let updatedItem: BoardItem
            if (gesture.mode === 'rotate') {
                const pointerAngle = Math.atan2(stageY - gesture.center[1], stageX - gesture.center[0]) * 180 / Math.PI
                const rotation = (gesture.startRotation + pointerAngle - gesture.startAngle + 360) % 360
                updatedItem = { ...gesture.item, rotation }
            } else {
                const deltaX = stageX - gesture.startX
                const deltaY = stageY - gesture.startY
                if (gesture.mode === 'move') updatedItem = moveBoardItem(gesture.item, deltaX, deltaY)
                else {
                    const dimension = Math.max(1, gesture.bounds.width + gesture.bounds.height)
                    const factor = Math.max(0.35, Math.min(3, 1 + (deltaX + deltaY) / dimension))
                    updatedItem = resizeBoardItem(gesture.item, factor)
                }
            }
            updateCurrentItems((items) => items.map((item) => item.id === gesture.item.id ? updatedItem : item))
            return
        }
        if (!drawing) return
        setCurrentPoints((points) => `${points} ${stageX},${stageY}`)
    }

    function onStageUp(event: ReactPointerEvent<HTMLElement>) {
        if (itemGestureRef.current) {
            itemGestureRef.current = null
            return
        }
        if (lineDraft) {
            const { stageX, stageY } = coordinates(event)
            if (Math.hypot(stageX - lineDraft.start[0], stageY - lineDraft.start[1]) >= 3) {
                addBoardItem({
                    id: id(),
                    type: 'shape',
                    left: lineDraft.start[0] / 10,
                    top: lineDraft.start[1] / 6.2,
                    endX: stageX / 10,
                    endY: stageY / 6.2,
                    shape: 'line',
                    color: ink,
                })
            }
            setLineDraft(null)
            return
        }
        if (drawing && currentPoints && activeTool === 'eraser') {
            const eraserPoints = parsePoints(currentPoints)
            updateCurrentItems((items) => items.filter((item) => {
                if (item.type !== 'stroke') return true
                return !polylinesWithinDistance(parsePoints(item.points), eraserPoints, 22 + item.width / 2)
            }))
        } else if (drawing && currentPoints && activeTool !== 'eraser') {
            const style = activeTool === 'highlighter' ? { color: '#f1cd63', width: 24, opacity: 0.42 } :
                activeTool === 'brush' ? { color: ink, width: 11, opacity: 0.76 } :
                    { color: ink, width: 3, opacity: 1 }
            updateCurrentItems((items) => [...items, { id: id(), type: 'stroke', points: currentPoints, ...style }])
        }
        if (activeTool === 'laser') window.setTimeout(() => setCurrentPoints(''), 650)
        setDrawing(false)
        if (activeTool !== 'laser') setCurrentPoints('')
    }

    function handleImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) return
        const placeFile = (src?: string) => {
            if (file.type === 'application/pdf') {
                if (src) addBoardItem({ id: id(), type: 'pdf', left: 14, top: 27, src, label: file.name })
            } else if (src) {
                addBoardItem({ id: id(), type: 'image', left: 12, top: 25, src, label: file.name })
            }
            event.target.value = ''
        }
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = () => placeFile(String(reader.result))
            reader.readAsDataURL(file)
        }
    }

    function handleBackgroundImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file || !file.type.startsWith('image/')) return
        const reader = new FileReader()
        reader.onload = () => setBackground(`url("${String(reader.result)}") center / cover no-repeat`)
        reader.readAsDataURL(file)
        event.target.value = ''
    }

    function handleGridEnter(event: React.KeyboardEvent<HTMLInputElement>, index: number, itemId: string) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const nextIndex = index + 3 < 9 ? index + 3 : (index % 3 + 1) % 3
        const target = document.querySelector<HTMLInputElement>(`[data-grid-input="${itemId}-${nextIndex}"]`)
        target?.focus()
    }

    function setGridValue(itemId: string, valueIndex: number, value: string) {
        if (studentView) return
        updateCurrentItems((items) => items.map((item) => item.id === itemId && item.type === 'grid' ? { ...item, values: item.values.map((cell, index) => index === valueIndex ? value : cell) } : item))
    }

    function exportPdf() {
        setPrinting(true)
        window.setTimeout(() => window.print(), 80)
        window.addEventListener('afterprint', () => setPrinting(false), { once: true })
    }

    function addLessonFromToolbar() {
        createLesson()
    }

    function renderBoardItem(item: BoardItem): ReactNode {
        const scale = item.scale ?? 1
        if (item.type === 'stroke') return <polyline points={item.points} fill="none" stroke={item.color} strokeWidth={item.width} strokeOpacity={item.opacity} strokeLinecap="round" strokeLinejoin="round" />
        if (item.type === 'text') return <text x={item.left * 10} y={item.top * 6.2} fill={item.color} fontSize={item.size * scale} fontFamily="Century Gothic, sans-serif">{item.text}</text>
        if (item.type === 'note') return <foreignObject x={item.left * 10} y={item.top * 6.2} width={190 * scale} height={170 * scale}><div className="board-sticky">{item.text}</div></foreignObject>
        if (item.type === 'shape') {
            if (item.shape === 'circle') return <circle cx={item.left * 10} cy={item.top * 6.2} r={46 * scale} fill="none" stroke={item.color} strokeWidth="4" />
            if (item.shape === 'rectangle') return <rect x={item.left * 10} y={item.top * 6.2} width={125 * scale} height={78 * scale} rx="8" fill="none" stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${item.left * 10 + 62.5 * scale} ${item.top * 6.2 + 39 * scale})`} />
            const { start, end } = getLineEndpoints(item)
            const startMarkerId = `line-start-${item.id}`
            const endMarkerId = `line-end-${item.id}`
            return <g>
                <defs>
                    {item.startArrow && <marker id={startMarkerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={10 * scale} markerHeight={10 * scale} markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={item.color} /></marker>}
                    {item.endArrow && <marker id={endMarkerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={10 * scale} markerHeight={10 * scale} markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={item.color} /></marker>}
                </defs>
                <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={item.color} strokeWidth="4" markerStart={item.startArrow ? `url(#${startMarkerId})` : undefined} markerEnd={item.endArrow ? `url(#${endMarkerId})` : undefined} />
            </g>
        }
        if (item.type === 'grid') return (
            <foreignObject x={item.left * 10} y={item.top * 6.2} width={294 * scale} height={184 * scale}>
                <div className="board-grid" data-grid-id={item.id}>
                    {item.values.map((value, index) => <input key={index} data-grid-input={`${item.id}-${index}`} value={value} aria-label={`Grid cell ${index + 1}`} onChange={(event) => setGridValue(item.id, index, event.target.value)} onKeyDown={(event) => handleGridEnter(event, index, item.id)} />)}
                </div>
            </foreignObject>
        )
        if (item.type === 'image') return <foreignObject x={item.left * 10} y={item.top * 6.2} width={230 * scale} height={180 * scale}><img className="board-image" src={item.src} alt={item.label} /></foreignObject>
        return <foreignObject x={item.left * 10} y={item.top * 6.2} width={300 * scale} height={220 * scale}><object className="board-pdf" data={item.src} type="application/pdf" aria-label={item.label}><div className="pdf-tile"><FileText size={28} /><span>{item.label}</span></div></object></foreignObject>
    }

    return (
        <div className="app-shell">
            <header className="topbar">
                <button className="brand" onClick={() => !studentView && setOpenLesson(null)} aria-label="Go to SkyBoard home"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></button>
                <div className="topbar-center"><span className="workspace-dot" />{openLesson ? <>{!studentView && <><button className="crumb-link" onClick={() => setOpenLesson(null)}>My workspace</button><ChevronRight size={14} /></>}<span className="crumb-current">{openLesson.title}</span></> : <span className="crumb-current">My workspace</span>}</div>
                <div className="topbar-actions">
                    {openLesson ? <>
                        {!studentView && <button className={`follow-button ${isFollowing ? 'following' : ''}`} onClick={() => { setIsFollowing(!isFollowing); notify(isFollowing ? 'Student view ended' : 'Student is following your page') }}><Users size={16} />{isFollowing ? 'Student following' : 'Student view'}<span className="online-dot" /></button>}
                        {!studentView && <button className="icon-button" aria-label="Share lesson" title="Share lesson" onClick={() => setShowShare(true)}><Share2 size={17} /></button>}
                        <button className="export-button" onClick={exportPdf}><Download size={15} /> Export PDF</button>
                    </> : <><span className="avatar">AM</span><span className="profile-name">Alex Morgan</span><button className="more-button" aria-label="Account options"><MoreHorizontal size={19} /></button></>}
                </div>
            </header>

            {!openLesson ? (
                <div className="library-layout">
                    <aside className="sidebar">
                        <button className="create-primary" onClick={addLessonFromToolbar}><Plus size={17} /> New lesson <ChevronDown size={14} /></button>
                        <button className={`nav-item ${activeFolder === 'All lessons' ? 'active' : ''}`} onClick={() => setActiveFolder('All lessons')}><LayoutGrid size={17} /> All lessons <span className="nav-count">{lessons.length}</span></button>
                        <button className={`nav-item ${activeFolder === 'Shared with me' ? 'active' : ''}`} onClick={() => setActiveFolder('Shared with me')}><Users size={17} /> Shared with me</button>
                        <div className="nav-section-heading"><span>My folders</span><button onClick={startNewFolder} aria-label="Create folder" title="Create folder"><FolderPlus size={16} /></button></div>
                        <nav className="folder-list">
                            {folders.map((folder, index) => <div className="folder-row" key={folder} onDragOver={(event) => event.preventDefault()} onDrop={() => draggingId && moveLesson(draggingId, folder)}><button className={`nav-item ${activeFolder === folder ? 'active' : ''}`} onClick={() => setActiveFolder(folder)}><Folder size={17} className={`folder-color folder-${index % 4}`} /><span>{folder}</span></button><div className="folder-menu-anchor"><button className="folder-more" aria-label={`Options for ${folder}`} onClick={() => setFolderMenu(folderMenu === folder ? null : folder)}><MoreHorizontal size={16} /></button>{folderMenu === folder && <div className="folder-menu"><button className="danger-option" onClick={() => deleteFolder(folder)}><Trash2 size={14} /> Delete folder</button></div>}</div></div>)}
                        </nav>
                        <div className="sidebar-bottom"><div className="storage-icon"><BookOpen size={18} /></div><div><strong>Your teaching space</strong><span>All lessons, one calm place.</span></div></div>
                    </aside>
                    <main className="library-main">
                        <div className="library-heading-row"><div><p className="eyebrow">LESSON LIBRARY</p><h1>{activeFolder === 'All lessons' ? 'Your lessons' : activeFolder}</h1><p className="library-subtitle">A little structure makes room for big learning.</p></div><button className="folder-create-button" onClick={startNewFolder}><FolderPlus size={16} /> New folder</button></div>
                        <div className="library-controls"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your lessons" aria-label="Search your lessons" /><kbd>⌘ K</kbd></div><div className="control-right"><button className={`view-toggle ${viewMode === 'grid' ? 'selected' : ''}`} onClick={() => setViewMode('grid')} aria-label="Grid view" title="Grid view"><LayoutGrid size={17} /></button><button className={`view-toggle ${viewMode === 'list' ? 'selected' : ''}`} onClick={() => setViewMode('list')} aria-label="List view" title="List view"><List size={17} /></button><button className="sort-button"><span>Last edited</span><ChevronDown size={15} /></button></div></div>
                        <div className="library-label-row"><span>{visibleLessons.length} lessons</span><span>NAME <MoveRight size={13} /> LAST OPENED</span></div>
                        {visibleLessons.length > 0 ? <div className={`lesson-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                            {visibleLessons.map((lesson) => {
                                const cardKind = lesson.id.includes('blends') ? 'blends' : lesson.id.includes('syllables') ? 'safari' : lesson.id.includes('vce') ? 'magic' : 'vowels'
                                return <article className="lesson-card" key={lesson.id} draggable onDragStart={() => setDraggingId(lesson.id)} onDragEnd={() => setDraggingId(null)} onClick={() => openBoard(lesson)}>
                                    <Thumb kind={cardKind} tint={lesson.color} />
                                    <div className="lesson-info"><div className="lesson-name-line"><h2>{lesson.title}</h2><div className="menu-anchor"><button className="card-menu-button" aria-label={`Options for ${lesson.title}`} onClick={(event) => { event.stopPropagation(); setShowFileMenu(showFileMenu === lesson.id ? null : lesson.id) }}><MoreHorizontal size={18} /></button>{showFileMenu === lesson.id && <div className="file-menu" onClick={(event) => event.stopPropagation()}><button onClick={() => duplicateLesson(lesson)}><Copy size={15} /> Make a copy</button><div className="menu-divider" /><span className="menu-label">Move to</span>{folders.map((folder) => <button key={folder} onClick={() => moveLesson(lesson.id, folder)}><Folder size={14} /> {folder}</button>)}<div className="menu-divider" /><button className="danger-option" onClick={() => deleteLesson(lesson.id)}><Trash2 size={14} /> Move to trash</button></div>}</div></div><div className="lesson-meta"><span className="lesson-file-icon"><NotebookTabs size={14} /></span><span>{lesson.pages.length} pages</span><span className="meta-dot">·</span><span>{lesson.updated}</span></div></div>
                                </article>
                            })}
                            <button className="new-lesson-card" onClick={createLesson}><span className="new-lesson-icon"><Plus size={20} /></span><strong>Start with a blank lesson</strong><span>Build a new teaching moment</span></button>
                        </div> : <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>No lessons found</strong><span>Try a different search or choose another folder.</span></div>}
                        <div className="library-footer"><span>Made for the moments when it clicks.</span><span><span className="footer-sparkle">✳</span> SkyBoard for learning</span></div>
                    </main>
                </div>
            ) : (
                <div className="board-layout">
                    <aside className="tool-rail" aria-label="Whiteboard tools">
                        {!studentView && <><button className="rail-back" onClick={() => setOpenLesson(null)} title="Back to library"><ArrowLeft size={18} /></button>
                            <div className="rail-divider" />
                            {toolList.map(({ id: toolId, label, icon: Icon }) => <button key={toolId} className={`tool-button ${activeTool === toolId ? 'selected' : ''}`} aria-label={label} title={label} onClick={() => { setActiveTool(toolId); setShowToolOptions(toolId === 'shape' || toolId === 'pen' || toolId === 'brush' || toolId === 'highlighter') }}><Icon size={19} /></button>)}
                            <div className="rail-spacer" />
                            <button className={`tool-button ${showBackgrounds ? 'selected' : ''}`} aria-label="Set background" title="Set background" onClick={() => setShowBackgrounds(!showBackgrounds)}><Settings2 size={19} /></button></>}
                    </aside>
                    <main className="board-main">
                        <div className="board-toolbar">
                            <div className="board-title"><div className="board-title-icon"><NotebookTabs size={17} /></div><div><strong>{openLesson.title}</strong><span>{openLesson.folder} <span className="meta-dot">·</span> Saved just now</span></div><button className="title-dropdown" aria-label="Lesson options"><ChevronDown size={15} /></button></div>
                            {!studentView && <div className="board-toolbar-center">
                                <div className="ink-picker">{palette.map((color) => <button key={color} className={`color-swatch ${ink === color ? 'active' : ''}`} style={{ '--swatch': color } as React.CSSProperties} onClick={() => setInk(color)} aria-label={`Choose ${color} ink`} />)}</div>
                                {showToolOptions && <div className="tool-option-popover"><span>{activeTool === 'shape' ? 'Choose a shape' : 'Ink color'}</span>{activeTool === 'shape' ? <><button onClick={() => { setSelectedShape('circle'); setActiveTool('shape'); setShowToolOptions(false) }}><Circle size={15} /> Circle</button><button onClick={() => { setSelectedShape('rectangle'); setActiveTool('shape'); setShowToolOptions(false) }}><Shapes size={15} /> Rectangle</button><button onClick={() => { setSelectedShape('line'); setActiveTool('shape'); setShowToolOptions(false) }}><MoveRight size={15} /> Line</button></> : <div className="mini-swatches">{palette.map((color) => <button key={color} style={{ backgroundColor: color }} onClick={() => { setInk(color); setShowToolOptions(false) }} aria-label={`Choose ${color}`} />)}</div>}</div>}
                            </div>}
                            <div className="board-toolbar-right"><button className={`blend-button ${showBlend ? 'active' : ''}`} onClick={() => setShowBlend(!showBlend)}><AudioLines size={16} /> Blending board</button>{!studentView && <><button className="icon-button" title="Add image or PDF" aria-label="Add image or PDF" onClick={() => imageInputRef.current?.click()}><ImagePlus size={18} /></button><button className="google-image-button" title="Search Google Images" aria-label="Search Google Images" onClick={() => setShowImageSearch(true)}><Globe size={16} /></button><input ref={imageInputRef} type="file" accept="image/*,application/pdf" hidden onChange={handleImage} /><button className="icon-button" aria-label="Undo" title="Undo" onClick={() => updateCurrentItems((items) => items.slice(0, -1))}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Redo" title="Redo" onClick={() => notify('Nothing to redo yet')}><ChevronRight size={18} /></button></>}</div>
                        </div>
                        <div className="canvas-workspace">
                            {showBackgrounds && <div className="background-panel"><div className="panel-heading"><strong>Page background</strong><button onClick={() => setShowBackgrounds(false)} aria-label="Close background panel"><X size={16} /></button></div><div className="background-options"><button className="background-swatch blank" onClick={() => setBackground('#fffef9')}><span />Blank</button><button className="background-swatch lined" onClick={() => setBackground('repeating-linear-gradient(to bottom, #fffef9 0 34px, #e5ece8 35px 36px)')}><span />Lined</button><button className="background-swatch grid-bg" onClick={() => setBackground('radial-gradient(#cbd5d0 0.8px, transparent 0.8px)')}><span />Grid</button></div><div className="panel-divider" /><span className="panel-small-label">SOLID COLORS</span><div className="background-colors">{['#fffef9', '#fff2dd', '#e8f4ee', '#eff1fc', '#fcebe7', '#ffffff'].map((color) => <button key={color} style={{ background: color }} onClick={() => setBackground(color)} aria-label={`Set ${color} background`}><Check size={14} /></button>)}</div><button className="upload-background" onClick={() => backgroundInputRef.current?.click()}><FileImage size={16} /> Add image background</button><input ref={backgroundInputRef} type="file" accept="image/*" hidden onChange={handleBackgroundImage} /></div>}
                            {showBlend && <div className="blend-panel"><div className="panel-heading"><div><span className="panel-kicker">SOUND IT OUT</span><strong>Blending board</strong></div><button onClick={() => setShowBlend(false)} aria-label="Close blending board"><X size={16} /></button></div><div className="blend-track"><button className="blend-token consonant">sh</button><span className="blend-dot" /><button className="blend-token vowel">i</button><span className="blend-dot" /><button className="blend-token consonant">p</button></div><div className="blend-word"><span>sh</span><span>i</span><span>p</span><b>ship</b></div><div className="blend-controls"><button onClick={() => notify('Sound playback is ready for your student')}>▶ Play sounds</button><button onClick={() => notify('New sound row added')}>+ New row</button></div></div>}
                            {!studentView && selectedItem && <div className="selection-toolbar" onPointerDown={(event) => event.stopPropagation()}><span>Selected element</span>{selectedItem.type === 'shape' && selectedItem.shape === 'line' && <><button className={selectedItem.startArrow ? 'active' : ''} title="Toggle start arrowhead" aria-label="Toggle start arrowhead" aria-pressed={Boolean(selectedItem.startArrow)} onClick={() => toggleLineArrow('start')}><ArrowLeft size={15} /></button><button className={selectedItem.endArrow ? 'active' : ''} title="Toggle end arrowhead" aria-label="Toggle end arrowhead" aria-pressed={Boolean(selectedItem.endArrow)} onClick={() => toggleLineArrow('end')}><MoveRight size={15} /></button></>}<button title="Make smaller" aria-label="Make smaller" onClick={() => scaleSelectedItem(0.85)}><Minus size={15} /></button><button title="Make larger" aria-label="Make larger" onClick={() => scaleSelectedItem(1.15)}><Plus size={15} /></button><button className="delete-selection" title="Delete selected element" aria-label="Delete selected element" onClick={deleteSelectedItem}><Trash2 size={15} /></button></div>}
                            <div className="board-page-area">
                                <div className="page-paper" ref={stageRef} style={{ background }} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp} data-tool={activeTool} data-shape={activeTool === 'shape' ? selectedShape : undefined}>
                                    {isFollowing && <div className="student-cursor"><span className="student-cursor-dot" /> Student is here</div>}
                                    <svg className="drawing-layer" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="Lesson whiteboard content">
                                        {currentItems.map((item) => <g key={item.id} className="board-item" onPointerDown={(event) => beginItemGesture(event, item)}>{renderBoardItem(item)}</g>)}
                                        {selectedItem && (() => {
                                            const bounds = getItemBounds(selectedItem)
                                            const centerX = bounds.left + bounds.width / 2
                                            return <g className="selection-frame">
                                                <rect x={bounds.left - 5} y={bounds.top - 5} width={bounds.width + 10} height={bounds.height + 10} fill="none" stroke="#56866c" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />
                                                {selectedItem.type === 'shape' && selectedItem.shape !== 'circle' && <>
                                                    <line x1={centerX} y1={bounds.top - 5} x2={centerX} y2={bounds.top - 19} stroke="#56866c" strokeWidth="2" pointerEvents="none" />
                                                    <foreignObject x={centerX - 12} y={bounds.top - 43} width="24" height="24"><button type="button" className="selection-rotate-handle" title="Rotate shape" aria-label="Rotate shape" onPointerDown={rotateFromHandle}><RotateCw size={13} /></button></foreignObject>
                                                </>}
                                                <rect className="selection-move-handle" x={centerX - 17} y={bounds.top - 15} width="34" height="12" rx="4" onPointerDown={(event) => beginItemGesture(event, selectedItem)} />
                                                <circle className="selection-resize-handle" cx={bounds.left + bounds.width + 5} cy={bounds.top + bounds.height + 5} r="8" onPointerDown={resizeFromHandle} />
                                            </g>
                                        })()}
                                        {lineDraft && <line x1={lineDraft.start[0]} y1={lineDraft.start[1]} x2={lineDraft.end[0]} y2={lineDraft.end[1]} stroke={ink} strokeWidth="4" />}
                                        {currentPoints && (drawing || activeTool === 'laser') && <polyline className={activeTool === 'laser' ? 'laser-stroke' : ''} points={currentPoints} fill="none" stroke={activeTool === 'laser' ? '#ef6b58' : activeTool === 'highlighter' ? '#f1cd63' : activeTool === 'eraser' ? background : ink} strokeWidth={activeTool === 'highlighter' ? 24 : activeTool === 'brush' ? 11 : activeTool === 'eraser' ? 28 : 3} strokeOpacity={activeTool === 'highlighter' ? 0.42 : activeTool === 'brush' ? 0.76 : 1} strokeLinecap="round" strokeLinejoin="round" />}
                                    </svg>
                                    <div className="page-corner-label">{openLesson.folder.toUpperCase()} <span>✳</span></div>
                                </div>
                            </div>
                            <div className="page-dock"><div className="page-tabs">{!studentView && pages.map((page, index) => <button key={`${page}-${index}`} className={`page-tab ${index === pageIndex ? 'active' : ''}`} draggable={!studentView} onDragStart={(event) => { setDraggedPageIndex(index); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => { event.preventDefault(); if (draggedPageIndex !== null) reorderPage(draggedPageIndex, index); setDraggedPageIndex(null) }} onDragEnd={() => setDraggedPageIndex(null)} onClick={() => { setPageIndex(index); setSelectedItemId(null) }}><span className="page-number">{String(index + 1).padStart(2, '0')}</span>{page}</button>)}{!studentView && <button className="add-page-tab" onClick={addPage} aria-label="Add page" title="Add page"><Plus size={17} /></button>}{studentView && <span className="page-tab active"><span className="page-number">{String(pageIndex + 1).padStart(2, '0')}</span>{pages[pageIndex]}</span>}</div><div className="page-dock-actions">{!studentView && <><button title="Duplicate page" aria-label="Duplicate page" onClick={duplicatePage}><Copy size={16} /></button><button title="Delete page" aria-label="Delete page" onClick={deletePage}><Trash2 size={16} /></button></>}<span className="dock-separator" /><span>{pageIndex + 1} / {pages.length}</span></div></div>
                        </div>
                    </main>
                </div>
            )}
            {printing && openLesson && <div className="print-pages">{pages.map((_, index) => <div className="print-page" key={index} style={{ background }}><svg viewBox="0 0 1000 620" preserveAspectRatio="none">{(itemsByPage[`${openLesson.id}:${index}`] ?? []).map(renderBoardItem)}</svg></div>)}</div>}
            {showShare && openLesson && <div className="modal-scrim" onClick={() => setShowShare(false)}><div className="share-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowShare(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Users size={20} /></div><h2>Bring your student in</h2><p>Share a live lesson link. Your student will follow the page you’re teaching on.</p><div className="share-link"><span>{`${window.location.host}${window.location.pathname}?view=student&lesson=${openLesson.id}`}</span><button onClick={() => { const url = `${window.location.origin}${window.location.pathname}?view=student&lesson=${openLesson.id}`; void navigator.clipboard?.writeText(url); notify('Student link copied'); setShowShare(false) }}><Copy size={15} /> Copy</button></div><div className="share-permission"><Check size={14} /> Student view is read-only</div></div></div>}
            {showImageSearch && <div className="modal-scrim" onClick={() => setShowImageSearch(false)}><div className="share-modal image-search-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowImageSearch(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Globe size={20} /></div><h2>Find a teaching image</h2><p>Search Google Images, then copy an image address and add it to your page.</p><form className="image-search-form" onSubmit={(event) => { event.preventDefault(); window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageQuery)}`, '_blank', 'noopener,noreferrer') }}><input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder="Try: ship, shell, short i" aria-label="Search images" /><button type="submit"><Search size={15} /> Search</button></form><label className="image-url-label">IMAGE ADDRESS<input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." /></label><button className="insert-image-button" disabled={!imageUrl.trim()} onClick={() => { updateCurrentItems((items) => [...items, { id: id(), type: 'image', left: 14, top: 25, src: imageUrl.trim(), label: 'Web image' }]); setImageUrl(''); setShowImageSearch(false) }}><ImagePlus size={15} /> Add image to page</button></div></div>}
            {toast && <div className="toast-message"><Check size={15} />{toast}</div>}
        </div>
    )
}

export default App
