import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
    ArrowLeft, AudioLines, BookOpen, Brush, Check, ChevronDown, ChevronLeft, ChevronRight,
    Circle, Copy, Download, Eraser, FileImage, FileText, Folder, FolderPlus, Globe,
    Grid2X2, Highlighter, ImagePlus, LayoutGrid, List, LogOut, Minus, MoreHorizontal, MoveRight,
    MousePointer2, NotebookTabs, Pencil, Plus, Search, Settings2, Share2, Shapes, Sparkles,
    RotateCw, StickyNote, Tag, Trash2, Type, Users, X,
} from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import ProfileSettings from './components/ProfileSettings'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { initializeWorkspace, loadWorkspace, saveWorkspace } from './lib/workspaceRepository'
import type { BoardItem, Lesson, LessonCover, PageItems } from './lib/workspaceTypes'

type Tool = 'select' | 'pen' | 'brush' | 'highlighter' | 'eraser' | 'element-eraser' | 'postit' | 'text' | 'shape' | 'grid' | 'laser'
type Point = [number, number]
type ItemBounds = { left: number; top: number; width: number; height: number }
type ItemGesture =
    | { mode: 'move' | 'resize'; item: BoardItem; startX: number; startY: number; bounds: ItemBounds }
    | { mode: 'rotate'; item: Extract<BoardItem, { type: 'shape' }>; center: Point; startAngle: number; startRotation: number }

const lessonColors = ['#daf0e9', '#fae7d9', '#e3e9fc', '#f5e8a8']
const lessonCoverOptions: { id: LessonCover; label: string; tint: string }[] = [
    { id: 'page', label: 'No thumbnail', tint: '#fffef9' },
    { id: 'vowels', label: 'Sound tiles', tint: lessonColors[0] },
    { id: 'blends', label: 'Word blends', tint: lessonColors[1] },
    { id: 'safari', label: 'Syllable safari', tint: lessonColors[2] },
    { id: 'magic', label: 'Magic e', tint: lessonColors[3] },
]
const initialLessons: Lesson[] = [
    { id: '11111111-1111-4111-8111-111111111111', title: 'Short vowels · at family', folder: 'Maya', pages: ['Warm up', 'Blend it', 'Read it'], updated: 'Today', color: lessonColors[0], kind: 'lesson' },
    { id: '22222222-2222-4222-8222-222222222222', title: 'Consonant blends', folder: 'Leo', pages: ['Sound sort', 'Build a word'], updated: 'Yesterday', color: lessonColors[1], kind: 'lesson' },
    { id: '33333333-3333-4333-8333-333333333333', title: 'Syllable safari', folder: 'Amira', pages: ['Clap it out', 'Word hunt', 'Wrap up'], updated: 'Sep 24', color: lessonColors[2], kind: 'lesson' },
    { id: '44444444-4444-4444-8444-444444444444', title: 'Magic e · long a', folder: 'Maya', pages: ['Notice', 'Practice'], updated: 'Sep 22', color: lessonColors[3], kind: 'lesson' },
    { id: '55555555-5555-4555-8555-555555555555', title: 'Sound mapping · short vowels', folder: 'Maya', pages: ['Listen', 'Map', 'Blend'], updated: 'This week', color: lessonColors[0], cover: 'vowels', kind: 'lesson' },
    { id: '66666666-6666-4666-8666-666666666666', title: 'Retell a story · beginning to end', folder: 'Leo', pages: ['Read', 'Retell'], updated: 'This week', color: lessonColors[1], cover: 'page', kind: 'lesson' },
    { id: '77777777-7777-4777-8777-777777777777', title: 'Open and closed syllables', folder: 'Amira', pages: ['Sort', 'Read'], updated: 'This week', color: lessonColors[2], cover: 'safari', kind: 'lesson' },
]
const folderNamesInitial = ['Maya', 'Leo', 'Amira']
const mockLessonIds = new Set(initialLessons.map((lesson) => lesson.id))
const mockFolderNames = new Set(folderNamesInitial)
const legacyFolderNames: Record<string, string> = { Phonics: 'Maya', Fluency: 'Leo', 'Word study': 'Amira' }
const folderSeparator = ' / '
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
    return crypto.randomUUID()
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

function readStudentFolders() {
    if (isSupabaseConfigured) return []
    return readStored<string[]>('skyboard:folders', folderNamesInitial).map((folder) => legacyFolderNames[folder] ?? folder)
}

function getFolderParent(folder: string) {
    const separatorIndex = folder.lastIndexOf(folderSeparator)
    return separatorIndex < 0 ? null : folder.slice(0, separatorIndex)
}

function getFolderName(folder: string) {
    const separatorIndex = folder.lastIndexOf(folderSeparator)
    return separatorIndex < 0 ? folder : folder.slice(separatorIndex + folderSeparator.length)
}

function folderIsWithin(folder: string, parent: string) {
    return folder === parent || folder.startsWith(`${parent}${folderSeparator}`)
}

function getOrderedFolders(folders: string[]) {
    return folders.filter((folder) => !getFolderParent(folder)).flatMap((parent) => [
        parent,
        ...folders.filter((folder) => getFolderParent(folder) === parent),
    ])
}

function readStudentLessons() {
    if (isSupabaseConfigured) return []
    const seedKey = 'skyboard:mock-lessons:v1'
    let lessons = readStored<Lesson[]>('skyboard:lessons', initialLessons)
    if (window.localStorage.getItem(seedKey) !== 'done') {
        const existingIds = new Set(lessons.map((lesson) => lesson.id))
        const missingMocks = initialLessons.filter((lesson) => lesson.id.startsWith('mock-') && !existingIds.has(lesson.id))
        lessons = [...lessons, ...missingMocks]
        if (missingMocks.length) window.localStorage.setItem('skyboard:lessons', JSON.stringify(lessons))
        window.localStorage.setItem(seedKey, 'done')
    }
    return lessons.map((lesson) => ({
        ...lesson,
        folder: legacyFolderNames[lesson.folder] ?? lesson.folder,
    }))
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
    const [authSession, setAuthSession] = useState<Session | null>(null)
    const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured || studentView)
    const [showProfileSettings, setShowProfileSettings] = useState(false)
    const [profileDisplayName, setProfileDisplayName] = useState('')
    const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null)
    const [workspaceReady, setWorkspaceReady] = useState(() => !isSupabaseConfigured || studentView)
    const [workspaceError, setWorkspaceError] = useState('')
    const [workspaceRetry, setWorkspaceRetry] = useState(0)
    const [cloudSaveStatus, setCloudSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
    const [cloudSaveError, setCloudSaveError] = useState('')
    const [lessons, setLessons] = useState(() => isSupabaseConfigured ? [] : readStudentLessons())
    const [folders, setFolders] = useState(() => isSupabaseConfigured ? [] : readStudentFolders())
    const [activeFolder, setActiveFolder] = useState('All lessons')
    const [search, setSearch] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [openLesson, setOpenLesson] = useState<Lesson | null>(() => {
        const params = new URLSearchParams(window.location.search)
        return params.get('view') === 'student' && !isSupabaseConfigured ? readStudentLessons().find((lesson) => lesson.id === params.get('lesson')) ?? null : null
    })
    const [pages, setPages] = useState<string[]>(() => {
        const params = new URLSearchParams(window.location.search)
        return params.get('view') === 'student' && !isSupabaseConfigured ? readStudentLessons().find((lesson) => lesson.id === params.get('lesson'))?.pages ?? [] : []
    })
    const [pageIndex, setPageIndex] = useState(() => {
        if (!studentView) return 0
        const active = readStored<{ lessonId: string; pageIndex: number } | null>('skyboard:active-page', null)
        return active && active.lessonId === openLesson?.id ? Math.min(active.pageIndex, Math.max(0, pages.length - 1)) : 0
    })
    const [itemsByPage, setItemsByPage] = useState<PageItems>(() => isSupabaseConfigured ? {} : readStored('skyboard:items', {}))
    const [activeTool, setActiveTool] = useState<Tool>('select')
    const [selectedShape, setSelectedShape] = useState<'circle' | 'rectangle' | 'line'>('circle')
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
    const [ink, setInk] = useState(palette[0])
    const [backgroundsByPage, setBackgroundsByPage] = useState<Record<string, string>>(() => isSupabaseConfigured ? {} : readStored('skyboard:backgrounds', {}))
    const [backgroundScope, setBackgroundScope] = useState<'current' | 'all'>('current')
    const [showBackgrounds, setShowBackgrounds] = useState(false)
    const [showPageDirectory, setShowPageDirectory] = useState(false)
    const [showBlend, setShowBlend] = useState(false)
    const [blendRows, setBlendRows] = useState<string[][]>([['sh', 'i', 'p']])
    const [showShare, setShowShare] = useState(false)
    const [showNewLesson, setShowNewLesson] = useState(false)
    const [tagEditorLessonId, setTagEditorLessonId] = useState<string | null>(null)
    const [newTagValue, setNewTagValue] = useState('')
    const [renamingLessonId, setRenamingLessonId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [coverEditorLessonId, setCoverEditorLessonId] = useState<string | null>(null)
    const [renamingTitle, setRenamingTitle] = useState(false)
    const [showStudentFolderDialog, setShowStudentFolderDialog] = useState(false)
    const [subfolderParent, setSubfolderParent] = useState<string | null>(null)
    const [subfolderName, setSubfolderName] = useState('')
    const [newLessonTitle, setNewLessonTitle] = useState('Untitled lesson')
    const [newLessonFolder, setNewLessonFolder] = useState('')
    const [creatingLessonFolder, setCreatingLessonFolder] = useState(false)
    const [newLessonFolderName, setNewLessonFolderName] = useState('')
    const [newLessonCover, setNewLessonCover] = useState<LessonCover>('page')
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
    const [editingTextId, setEditingTextId] = useState<string | null>(null)
    const [historyTick, setHistoryTick] = useState(0)
    const stageRef = useRef<HTMLDivElement>(null)
    const itemGestureRef = useRef<ItemGesture | null>(null)
    const historyRef = useRef<Record<string, { past: BoardItem[][]; future: BoardItem[][] }>>({})
    const imageInputRef = useRef<HTMLInputElement>(null)
    const backgroundInputRef = useRef<HTMLInputElement>(null)
    const coverInputRef = useRef<HTMLInputElement>(null)
    const workspaceSaveQueue = useRef<Promise<void>>(Promise.resolve())
    const workspaceSaveVersion = useRef(0)

    useEffect(() => {
        if (!supabase || studentView) {
            setAuthReady(true)
            return
        }
        let mounted = true
        const setSession = (session: Session | null) => {
            if (!mounted) return
            setAuthSession(session)
            setAuthReady(true)
        }
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
        void supabase.auth.getSession().then(({ data, error }) => {
            if (error) throw error
            setSession(data.session)
        }).catch(() => setSession(null))
        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [studentView])

    useEffect(() => {
        if (!supabase || !authSession || studentView) return
        let active = true
        const ownerId = authSession.user.id
        setWorkspaceReady(false)
        setWorkspaceError('')
        void (async () => {
            let workspace = await loadWorkspace(ownerId)
            if (!workspace.initialized) {
                await initializeWorkspace(folderNamesInitial, initialLessons)
                workspace = await loadWorkspace(ownerId)
            }
            if (!active) return
            setFolders(workspace.folders)
            setLessons(workspace.lessons)
            setItemsByPage(workspace.itemsByPage)
            setBackgroundsByPage(workspace.backgroundsByPage)
            setWorkspaceReady(true)
        })().catch((error: unknown) => {
            if (!active) return
            setWorkspaceError(error instanceof Error ? error.message : 'Unable to load your workspace.')
            setWorkspaceReady(true)
        })
        return () => { active = false }
    }, [authSession?.user.id, studentView, workspaceRetry])

    const currentPageKey = openLesson ? `${openLesson.id}:${pageIndex}` : ''
    const currentItems = itemsByPage[currentPageKey] ?? []
    const background = backgroundsByPage[currentPageKey] ?? '#fffef9'
    const selectedItem = currentItems.find((item) => item.id === selectedItemId) ?? null
    const currentHistory = historyTick >= 0 ? historyRef.current[currentPageKey] : undefined
    const canUndo = Boolean(currentHistory?.past.length)
    const canRedo = Boolean(currentHistory?.future.length)
    const isMockWorkspace = !isSupabaseConfigured && !studentView
    const tagEditorLesson = lessons.find((lesson) => lesson.id === tagEditorLessonId) ?? null
    const coverEditorLesson = lessons.find((lesson) => lesson.id === coverEditorLessonId) ?? null
    const isStudentFolderSelected = folders.includes(activeFolder) && !getFolderParent(activeFolder)
    const visibleSubfolders = isStudentFolderSelected ? folders.filter((folder) => getFolderParent(folder) === activeFolder) : []
    const visibleLessons = lessons.filter((lesson) => {
        const matchesFolder = activeFolder === 'All lessons' || activeFolder === 'Shared with me' || folderIsWithin(lesson.folder, activeFolder)
        return matchesFolder && lesson.title.toLowerCase().includes(search.toLowerCase())
    })

    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:lessons', JSON.stringify(lessons)) }, [lessons])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:folders', JSON.stringify(folders)) }, [folders])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:items', JSON.stringify(itemsByPage)) }, [itemsByPage])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:backgrounds', JSON.stringify(backgroundsByPage)) }, [backgroundsByPage])
    useEffect(() => {
        if (!supabase || !authSession || !workspaceReady || studentView) return
        const ownerId = authSession.user.id
        const version = ++workspaceSaveVersion.current
        const timeout = window.setTimeout(() => {
            setCloudSaveStatus('saving')
            setCloudSaveError('')
            workspaceSaveQueue.current = workspaceSaveQueue.current.catch(() => undefined).then(() => saveWorkspace(ownerId, folders, lessons, itemsByPage, backgroundsByPage))
            void workspaceSaveQueue.current.then(() => {
                if (workspaceSaveVersion.current === version) setCloudSaveStatus('saved')
            }).catch((error: unknown) => {
                if (workspaceSaveVersion.current !== version) return
                setCloudSaveStatus('error')
                setCloudSaveError(error instanceof Error ? error.message : 'Unable to save your workspace.')
            })
        }, 450)
        return () => window.clearTimeout(timeout)
    }, [authSession?.user.id, workspaceReady, studentView, folders, lessons, itemsByPage, backgroundsByPage])
    useEffect(() => {
        const client = supabase
        if (!client || !authSession || studentView) return
        let active = true
        const metadata = authSession.user.user_metadata ?? {}
        const fallbackName = authSession.user.email?.split('@')[0] ?? 'Therapist'
        setProfileDisplayName(String(metadata.display_name ?? metadata.full_name ?? fallbackName))
        setProfileAvatarUrl(null)
        void client.from('profiles').select('display_name,avatar_path').eq('id', authSession.user.id).maybeSingle().then(async ({ data, error }) => {
            if (!active || error || !data) return
            if (data.display_name) setProfileDisplayName(data.display_name)
            if (data.avatar_path) {
                const signed = await client.storage.from('profile-avatars').createSignedUrl(data.avatar_path, 60 * 60 * 24)
                if (active && !signed.error) setProfileAvatarUrl(signed.data.signedUrl)
            }
        })
        return () => { active = false }
    }, [authSession?.user.id, studentView])
    useEffect(() => {
        if (!folderMenu) return
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (event.target instanceof Element && !event.target.closest('.folder-menu-anchor')) setFolderMenu(null)
        }
        document.addEventListener('pointerdown', closeOnOutsidePointer)
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }, [folderMenu])
    useEffect(() => {
        if (!showFileMenu) return
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (event.target instanceof Element && !event.target.closest('.menu-anchor')) setShowFileMenu(null)
        }
        document.addEventListener('pointerdown', closeOnOutsidePointer)
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }, [showFileMenu])
    useEffect(() => {
        if (!showPageDirectory) return
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (event.target instanceof Element && !event.target.closest('.page-directory-anchor')) setShowPageDirectory(false)
        }
        document.addEventListener('pointerdown', closeOnOutsidePointer)
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }, [showPageDirectory])
    useLayoutEffect(() => {
        setSelectedItemId(null)
        setEditingTextId(null)
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
                const lesson = readStudentLessons().find((candidate) => candidate.id === openLesson.id)
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
        const syncBackgrounds = (event: StorageEvent) => {
            if (event.key === 'skyboard:backgrounds') setBackgroundsByPage(readStored('skyboard:backgrounds', {}))
        }
        const syncLessons = (event: StorageEvent) => {
            if (event.key !== 'skyboard:lessons') return
            const lesson = readStudentLessons().find((candidate) => candidate.id === openLesson.id)
            if (!lesson) return
            setOpenLesson(lesson)
            setPages(lesson.pages)
            setPageIndex((index) => Math.min(index, Math.max(0, lesson.pages.length - 1)))
        }
        window.addEventListener('storage', syncPage)
        window.addEventListener('storage', syncItems)
        window.addEventListener('storage', syncBackgrounds)
        window.addEventListener('storage', syncLessons)
        return () => {
            window.removeEventListener('storage', syncPage)
            window.removeEventListener('storage', syncItems)
            window.removeEventListener('storage', syncBackgrounds)
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

    async function signOut() {
        if (!supabase) return
        const { error } = await supabase.auth.signOut()
        if (error) notify(error.message)
    }

    function updateCurrentItems(nextItems: BoardItem[] | ((items: BoardItem[]) => BoardItem[]), options?: { recordHistory?: boolean }) {
        const recordHistory = options?.recordHistory ?? true
        setItemsByPage((previous) => {
            const existing = previous[currentPageKey] ?? []
            const resolved = typeof nextItems === 'function' ? nextItems(existing) : nextItems
            if (recordHistory) {
                const entry = historyRef.current[currentPageKey] ?? { past: [], future: [] }
                entry.past = [...entry.past.slice(-49), existing]
                entry.future = []
                historyRef.current[currentPageKey] = entry
                setHistoryTick((tick) => tick + 1)
            }
            return { ...previous, [currentPageKey]: resolved }
        })
    }

    function undo() {
        const entry = historyRef.current[currentPageKey]
        if (!entry || !entry.past.length) return
        const previousState = entry.past[entry.past.length - 1]
        entry.past = entry.past.slice(0, -1)
        entry.future = [...entry.future, currentItems]
        setItemsByPage((previous) => ({ ...previous, [currentPageKey]: previousState }))
        setSelectedItemId(null)
        setHistoryTick((tick) => tick + 1)
    }

    function redo() {
        const entry = historyRef.current[currentPageKey]
        if (!entry || !entry.future.length) return
        const nextState = entry.future[entry.future.length - 1]
        entry.future = entry.future.slice(0, -1)
        entry.past = [...entry.past, currentItems]
        setItemsByPage((previous) => ({ ...previous, [currentPageKey]: nextState }))
        setSelectedItemId(null)
        setHistoryTick((tick) => tick + 1)
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

    function openNewLessonDialog() {
        setNewLessonTitle('Untitled lesson')
        setNewLessonFolder(folders.includes(activeFolder) ? activeFolder : folders[0] ?? 'My lessons')
        setCreatingLessonFolder(false)
        setNewLessonFolderName('')
        setNewLessonCover('page')
        setShowNewLesson(true)
    }

    function createLesson() {
        const cover = lessonCoverOptions.find((option) => option.id === newLessonCover) ?? lessonCoverOptions[0]
        const lesson: Lesson = {
            id: id(), title: newLessonTitle.trim() || 'Untitled lesson', folder: newLessonFolder || folders[0] || 'My lessons', pages: ['Page 1'], updated: 'Just now',
            color: cover.tint, cover: cover.id, kind: 'lesson',
        }
        setLessons((previous) => [lesson, ...previous])
        setShowNewLesson(false)
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
            const starterItems: Record<string, BoardItem[]> = {
                '11111111-1111-4111-8111-111111111111': [
                    { id: id(), type: 'text', left: 11, top: 18, text: 'Let’s build a word', color: '#253c37', size: 30 },
                    { id: id(), type: 'text', left: 11, top: 26, text: 'Listen · tap each sound · blend', color: '#75837e', size: 15 },
                    { id: id(), type: 'grid', left: 59, top: 25, values: ['sh', 'i', 'p', '', '', '', '', '', ''] },
                    { id: id(), type: 'note', left: 13, top: 42, text: 'Say it slowly\nsh  ·  i  ·  p' },
                ],
                '55555555-5555-4555-8555-555555555555': [
                    { id: id(), type: 'text', left: 9, top: 15, text: 'Sound mapping', color: '#253c37', size: 28 },
                    { id: id(), type: 'text', left: 9, top: 22, text: 'Say it · tap it · map each sound', color: '#75837e', size: 15 },
                    { id: id(), type: 'grid', left: 58, top: 24, values: ['m', 'a', 'p', 's', 'i', 't', 'sh', 'o', 'p'] },
                    { id: id(), type: 'note', left: 10, top: 35, text: 'Stretch the word\nThen blend it fast' },
                    { id: id(), type: 'shape', left: 38, top: 54, endX: 55, endY: 49, shape: 'line', color: '#ee7859', endArrow: true },
                    { id: id(), type: 'shape', left: 22, top: 38, shape: 'circle', color: '#387c70' },
                    { id: id(), type: 'stroke', points: '110,470 185,448 260,470', color: '#f1cd63', width: 20, opacity: 0.42 },
                ],
                '66666666-6666-4666-8666-666666666666': [
                    { id: id(), type: 'text', left: 8, top: 14, text: 'Retell the story', color: '#253c37', size: 28 },
                    { id: id(), type: 'text', left: 8, top: 22, text: 'Beginning · middle · end', color: '#75837e', size: 15 },
                    { id: id(), type: 'note', left: 8, top: 30, text: 'Who is the main character?\nWhere does the story happen?' },
                    { id: id(), type: 'note', left: 34, top: 30, text: 'What changes?\nWhat does the character try?' },
                    { id: id(), type: 'note', left: 60, top: 30, text: 'How is the problem solved?\nWhat happens at the end?' },
                    { id: id(), type: 'shape', left: 17, top: 63, shape: 'rectangle', color: '#387c70', rotation: -4 },
                    { id: id(), type: 'shape', left: 47, top: 64, endX: 70, endY: 61, shape: 'line', color: '#ee7859', startArrow: true, endArrow: true },
                    { id: id(), type: 'stroke', points: '90,500 150,485 210,500', color: '#253c37', width: 3, opacity: 1 },
                ],
                '77777777-7777-4777-8777-777777777777': [
                    { id: id(), type: 'text', left: 8, top: 15, text: 'Open or closed?', color: '#253c37', size: 28 },
                    { id: id(), type: 'text', left: 8, top: 22, text: 'Sort each word by its final sound', color: '#75837e', size: 15 },
                    { id: id(), type: 'grid', left: 8, top: 30, values: ['sunset', 'rabbit', 'hotel', 'napkin', 'music', 'sun', 'picnic', 'tiger', 'sunset'] },
                    { id: id(), type: 'note', left: 57, top: 30, text: 'Open syllable\nEnds in a vowel sound' },
                    { id: id(), type: 'note', left: 57, top: 58, text: 'Closed syllable\nEnds in a consonant' },
                    { id: id(), type: 'shape', left: 42, top: 33, shape: 'circle', color: '#e5ac37' },
                    { id: id(), type: 'shape', left: 43, top: 61, shape: 'rectangle', color: '#576fc2', rotation: 3 },
                    { id: id(), type: 'stroke', points: '75,300 260,300 435,300', color: '#f1cd63', width: 24, opacity: 0.42 },
                ],
            }
            const starter: BoardItem[] = starterItems[lesson.id] ?? []
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

    function openTagEditor(lesson: Lesson) {
        setTagEditorLessonId(lesson.id)
        setNewTagValue('')
        setShowFileMenu(null)
    }

    function startRenameLesson(lesson: Lesson) {
        setRenamingLessonId(lesson.id)
        setRenameValue(lesson.title)
        setShowFileMenu(null)
    }

    function commitLessonRename(lessonId: string) {
        const title = renameValue.trim()
        setRenamingLessonId(null)
        if (!title) return
        setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, title } : lesson))
        if (openLesson?.id === lessonId) setOpenLesson((previous) => previous ? { ...previous, title } : previous)
    }

    function startRenameOpenLessonTitle() {
        if (!openLesson) return
        setRenameValue(openLesson.title)
        setRenamingTitle(true)
    }

    function commitOpenLessonTitleRename() {
        setRenamingTitle(false)
        if (!openLesson) return
        const title = renameValue.trim()
        if (!title) return
        setLessons((previous) => previous.map((lesson) => lesson.id === openLesson.id ? { ...lesson, title } : lesson))
        setOpenLesson((previous) => previous ? { ...previous, title } : previous)
    }

    function openCoverEditor(lesson: Lesson) {
        setCoverEditorLessonId(lesson.id)
        setShowFileMenu(null)
    }

    function handleCoverUpload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file || !file.type.startsWith('image/') || !coverEditorLessonId) return
        const reader = new FileReader()
        reader.onload = () => {
            const coverImage = String(reader.result)
            setLessons((previous) => previous.map((lesson) => lesson.id === coverEditorLessonId ? { ...lesson, cover: 'custom', coverImage } : lesson))
            setCoverEditorLessonId(null)
        }
        reader.readAsDataURL(file)
    }

    function addLessonTag() {
        if (!tagEditorLessonId) return
        const tag = newTagValue.trim()
        if (!tag) return
        setLessons((previous) => previous.map((lesson) => {
            if (lesson.id !== tagEditorLessonId || lesson.tags?.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return lesson
            return { ...lesson, tags: [...(lesson.tags ?? []), tag] }
        }))
        setNewTagValue('')
    }

    function removeLessonTag(tagToRemove: string) {
        if (!tagEditorLessonId) return
        setLessons((previous) => previous.map((lesson) => lesson.id === tagEditorLessonId
            ? { ...lesson, tags: (lesson.tags ?? []).filter((tag) => tag !== tagToRemove) }
            : lesson))
    }

    function deleteFolder(folder: string) {
        const parent = getFolderParent(folder)
        const deletedFolders = folders.filter((name) => folderIsWithin(name, folder))
        const destination = parent ?? folders.find((name) => !getFolderParent(name) && !deletedFolders.includes(name)) ?? 'Unfiled'
        setLessons((previous) => previous.map((lesson) => folderIsWithin(lesson.folder, folder) ? { ...lesson, folder: destination } : lesson))
        setFolders((previous) => previous.filter((name) => !deletedFolders.includes(name)))
        setFolderMenu(null)
        if (activeFolder !== 'All lessons' && activeFolder !== 'Shared with me' && folderIsWithin(activeFolder, folder)) setActiveFolder('All lessons')
        notify(`Folder deleted; lessons moved to ${destination}`)
    }

    function moveLesson(lessonId: string, folder: string) {
        setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, folder } : lesson))
        setDraggingId(null)
        setShowFileMenu(null)
        notify(`Moved to ${folder}`)
    }

    function createFolder(activate = true, requestedName: string) {
        const name = requestedName.trim()
        if (!name) return
        if (name.includes(folderSeparator)) return notify('Use Add subfolder to create a folder inside a student folder')
        if (folders.includes(name)) return notify('A folder with that name already exists')
        setFolders((previous) => [...previous, name])
        if (activate) setActiveFolder(name)
        return name
    }

    function startCreateSubfolder(parent: string) {
        setShowStudentFolderDialog(false)
        setSubfolderParent(parent)
        setSubfolderName('')
        setFolderMenu(null)
    }

    function createStudentFolder() {
        const folder = createFolder(true, subfolderName)
        if (!folder) return
        setShowStudentFolderDialog(false)
        setSubfolderName('')
    }

    function createSubfolder() {
        const parent = subfolderParent
        const name = subfolderName.trim()
        if (!parent || !name) return
        if (name.includes(folderSeparator)) return notify('Subfolders can’t contain another folder path')
        const path = `${parent}${folderSeparator}${name}`
        if (folders.includes(path)) return notify('A subfolder with that name already exists')
        setFolders((previous) => [...previous, path])
        setSubfolderParent(null)
        setSubfolderName('')
        notify(`Subfolder added to ${parent}`)
    }

    function addFolderToNewLesson() {
        const folder = createFolder(false, newLessonFolderName)
        if (!folder) return
        setNewLessonFolder(folder)
        setNewLessonFolderName('')
        setCreatingLessonFolder(false)
    }

    function startNewFolder() {
        setSubfolderParent(null)
        setSubfolderName('')
        setShowStudentFolderDialog(true)
    }

    function handleNewFolderButton() {
        if (isStudentFolderSelected) startCreateSubfolder(activeFolder)
        else startNewFolder()
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

    function setSelectedTextColor(color: string) {
        if (!selectedItem || selectedItem.type !== 'text') return
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'text' ? { ...item, color } : item))
    }

    function adjustSelectedTextSize(delta: number) {
        if (!selectedItem || selectedItem.type !== 'text') return
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'text' ? { ...item, size: Math.max(10, Math.min(96, item.size + delta)) } : item))
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
            const newItem: Extract<BoardItem, { type: 'text' }> = { id: id(), type: 'text', left: stageX / 10, top: stageY / 6.2, text: '', color: ink, size: 22 }
            addBoardItem(newItem)
            setEditingTextId(newItem.id)
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
            const style = activeTool === 'highlighter' ? { color: ink, width: 24, opacity: 0.42 } :
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

    function setBlendToken(rowIndex: number, tokenIndex: number, value: string) {
        setBlendRows((previous) => previous.map((row, index) => index === rowIndex ? row.map((token, tIndex) => tIndex === tokenIndex ? value : token) : row))
    }

    function addBlendToken(rowIndex: number) {
        setBlendRows((previous) => previous.map((row, index) => index === rowIndex ? [...row, ''] : row))
    }

    function removeBlendToken(rowIndex: number, tokenIndex: number) {
        setBlendRows((previous) => previous.map((row, index) => index === rowIndex ? row.filter((_, tIndex) => tIndex !== tokenIndex) : row))
    }

    function addBlendRow() {
        setBlendRows((previous) => [...previous, ['', '', '']])
    }

    function removeBlendRow(rowIndex: number) {
        setBlendRows((previous) => previous.length > 1 ? previous.filter((_, index) => index !== rowIndex) : previous)
    }

    function playBlendRow(rowIndex: number) {
        const row = blendRows[rowIndex]
        if (!row?.length) return
        if (!('speechSynthesis' in window)) {
            notify('Sound playback is not supported in this browser')
            return
        }
        window.speechSynthesis.cancel()
        const tokens = [...row.filter((token) => token.trim()), row.join('')]
        tokens.forEach((token) => {
            const utterance = new SpeechSynthesisUtterance(token)
            utterance.rate = 0.8
            window.speechSynthesis.speak(utterance)
        })
    }


    function setPageBackground(value: string) {
        if (!openLesson) return
        setBackgroundsByPage((previous) => {
            if (backgroundScope === 'all') {
                const next = { ...previous }
                pages.forEach((_, index) => { next[`${openLesson.id}:${index}`] = value })
                return next
            }
            return { ...previous, [currentPageKey]: value }
        })
    }

    function handleBackgroundImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file || !file.type.startsWith('image/')) return
        const reader = new FileReader()
        reader.onload = () => setPageBackground(`url("${String(reader.result)}") center / cover no-repeat`)
        reader.readAsDataURL(file)
        event.target.value = ''
    }

    function handleGridEnter(event: React.KeyboardEvent<HTMLInputElement>, index: number, itemId: string, cols: number, total: number) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const nextIndex = index + cols < total ? index + cols : (index % cols + 1) % cols
        const target = document.querySelector<HTMLInputElement>(`[data-grid-input="${itemId}-${nextIndex}"]`)
        target?.focus()
    }

    function setGridValue(itemId: string, valueIndex: number, value: string) {
        if (studentView) return
        updateCurrentItems((items) => items.map((item) => item.id === itemId && item.type === 'grid' ? { ...item, values: item.values.map((cell, index) => index === valueIndex ? value : cell) } : item))
    }

    function resizeGrid(itemId: string, nextRows: number, nextCols: number) {
        if (studentView) return
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== itemId || item.type !== 'grid') return item
            const rows = Math.max(1, Math.min(6, nextRows))
            const cols = Math.max(1, Math.min(6, nextCols))
            const total = rows * cols
            const values = Array.from({ length: total }, (_, index) => item.values[index] ?? '')
            return { ...item, rows, cols, values }
        }))
    }

    function exportPdf() {
        setPrinting(true)
        window.setTimeout(() => window.print(), 80)
        window.addEventListener('afterprint', () => setPrinting(false), { once: true })
    }

    function addLessonFromToolbar() {
        openNewLessonDialog()
    }

    function renderBoardItem(item: BoardItem): ReactNode {
        const scale = item.scale ?? 1
        if (item.type === 'stroke') return <polyline points={item.points} fill="none" stroke={item.color} strokeWidth={item.width} strokeOpacity={item.opacity} strokeLinecap="round" strokeLinejoin="round" />
        if (item.type === 'text') return <text x={item.left * 10} y={item.top * 6.2} fill={item.color} fontSize={item.size * scale} fontFamily="'Century Gothic', CenturyGothic, AppleGothic, sans-serif">{item.text}</text>
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
        if (item.type === 'grid') {
            const cols = item.cols ?? 3
            const rows = item.rows ?? 3
            const total = cols * rows
            return (
                <foreignObject x={item.left * 10} y={item.top * 6.2} width={294 * scale} height={184 * scale}>
                    <div className="board-grid" data-grid-id={item.id} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                        {item.values.map((value, index) => <input key={index} data-grid-input={`${item.id}-${index}`} value={value} aria-label={`Grid cell ${index + 1}`} onChange={(event) => setGridValue(item.id, index, event.target.value)} onKeyDown={(event) => handleGridEnter(event, index, item.id, cols, total)} />)}
                    </div>
                </foreignObject>
            )
        }
        if (item.type === 'image') return <foreignObject x={item.left * 10} y={item.top * 6.2} width={230 * scale} height={180 * scale}><img className="board-image" src={item.src} alt={item.label} draggable={false} /></foreignObject>
        return <foreignObject x={item.left * 10} y={item.top * 6.2} width={300 * scale} height={220 * scale}><object className="board-pdf" data={item.src} type="application/pdf" aria-label={item.label}><div className="pdf-tile"><FileText size={28} /><span>{item.label}</span></div></object></foreignObject>
    }

    if (isSupabaseConfigured && !studentView) {
        if (!authReady) return <AuthScreen loading />
        if (!authSession) return <AuthScreen />
        if (workspaceError) return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">THERAPIST WORKSPACE</p><h1>Couldn’t load your workspace</h1><p className="auth-intro">{workspaceError}</p><button className="auth-submit" onClick={() => setWorkspaceRetry((retry) => retry + 1)}>Try again</button><button className="auth-mode-toggle" onClick={() => void signOut()}>Sign out</button></section></main>
        if (!workspaceReady) return <AuthScreen loading loadingTitle="Loading your workspace" loadingMessage="Fetching your students and lessons from Supabase." />
    }
    if (isSupabaseConfigured && studentView) return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">STUDENT VIEW</p><h1>Student links aren’t connected yet</h1><p className="auth-intro">This lesson is saved in Supabase, but secure student sessions are part of the next integration step.</p></section></main>

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
                    </> : authSession && !studentView ? <button className="profile-account" onClick={() => setShowProfileSettings(true)} aria-label="Edit profile settings" title="Profile settings"><span className="avatar">{profileAvatarUrl ? <img src={profileAvatarUrl} alt="" /> : profileDisplayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span className="profile-name">{profileDisplayName || authSession.user.email}</span><MoreHorizontal size={18} /></button> : <><span className="avatar">AM</span><span className="profile-name">Alex Morgan</span><button className="more-button" aria-label="Account options"><MoreHorizontal size={19} /></button></>}
                    {authSession && !studentView && <button className="icon-button auth-signout-button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>}
                </div>
            </header>
            {authSession && !studentView && <div className={`cloud-storage-notice ${cloudSaveStatus === 'error' ? 'error' : ''}`} role="status">{cloudSaveStatus === 'saving' ? 'Saving your workspace…' : cloudSaveStatus === 'error' ? `Cloud save failed: ${cloudSaveError}` : `Saved to Supabase · ${authSession.user.email}`}</div>}

            {!openLesson ? (
                <div className="library-layout">
                    <aside className="sidebar">
                        <button className="create-primary" onClick={addLessonFromToolbar}><Plus size={17} /> New lesson <ChevronDown size={14} /></button>
                        <button className={`nav-item ${activeFolder === 'All lessons' ? 'active' : ''}`} onClick={() => setActiveFolder('All lessons')}><LayoutGrid size={17} /> All lessons <span className="nav-count">{lessons.length}</span></button>
                        <button className={`nav-item ${activeFolder === 'Shared with me' ? 'active' : ''}`} onClick={() => setActiveFolder('Shared with me')}><Users size={17} /> Shared with me</button>
                        <div className="nav-section-heading"><span>My Students</span><button onClick={startNewFolder} aria-label="Create student folder" title="Create student folder"><FolderPlus size={16} /></button></div>
                        <nav className="folder-list">
                            {getOrderedFolders(folders).map((folder, index) => {
                                const parent = getFolderParent(folder)
                                const isMockFolder = isMockWorkspace && !parent && mockFolderNames.has(folder)
                                return <div className={`folder-row ${parent ? 'subfolder-row' : ''}`} key={folder} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggingId) moveLesson(draggingId, folder) }}>
                                    <button className={`nav-item ${activeFolder === folder ? 'active' : ''}`} onClick={() => setActiveFolder(folder)}><Folder size={parent ? 14 : 17} className={`folder-color folder-${index % 4}`} /><span>{getFolderName(folder)}</span>{isMockFolder && <span className="demo-tag" title="Sample student">Demo</span>}</button>
                                    <div className="folder-menu-anchor"><button className="folder-more" aria-label={`Options for ${folder}`} onClick={() => setFolderMenu(folderMenu === folder ? null : folder)}><MoreHorizontal size={16} /></button>{folderMenu === folder && <div className="folder-menu">{!parent && <button onClick={() => startCreateSubfolder(folder)}><FolderPlus size={14} /> Add subfolder</button>}<button className="danger-option" onClick={() => deleteFolder(folder)}><Trash2 size={14} /> Delete folder</button></div>}</div>
                                </div>
                            })}
                        </nav>
                        <div className="sidebar-bottom"><div className="storage-icon"><BookOpen size={18} /></div><div><strong>Your teaching space</strong><span>All lessons, one calm place.</span></div></div>
                    </aside>
                    <main className="library-main">
                        {isMockWorkspace && <div className="demo-banner"><Sparkles size={15} /><span>You're viewing <strong>sample students and lessons</strong> so you can explore SkyBoard. Connect Supabase to replace this demo data with your own.</span></div>}
                        <div className="library-heading-row"><div><p className="eyebrow">LESSON LIBRARY</p>{activeFolder === 'All lessons' ? <h1>Your lessons</h1> : activeFolder === 'Shared with me' ? <h1>{activeFolder}</h1> : <nav className="library-breadcrumbs" aria-label="Breadcrumb"><button onClick={() => setActiveFolder('All lessons')}>Your lessons</button><ChevronRight size={14} aria-hidden="true" />{getFolderParent(activeFolder) && <><button onClick={() => setActiveFolder(getFolderParent(activeFolder)!)}>{getFolderParent(activeFolder)}</button><ChevronRight size={14} aria-hidden="true" /></>}<span aria-current="page">{getFolderName(activeFolder)}</span></nav>}<p className="library-subtitle">A little structure makes room for big learning.</p></div><button className="folder-create-button" onClick={handleNewFolderButton}><FolderPlus size={16} /> New folder</button></div>
                        <div className="library-controls"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your lessons" aria-label="Search your lessons" /><kbd>⌘ K</kbd></div><div className="control-right"><button className={`view-toggle ${viewMode === 'grid' ? 'selected' : ''}`} onClick={() => setViewMode('grid')} aria-label="Grid view" title="Grid view"><LayoutGrid size={17} /></button><button className={`view-toggle ${viewMode === 'list' ? 'selected' : ''}`} onClick={() => setViewMode('list')} aria-label="List view" title="List view"><List size={17} /></button><button className="sort-button"><span>Last edited</span><ChevronDown size={15} /></button></div></div>
                        {visibleSubfolders.length > 0 && <section className="subfolder-section" aria-label={`${activeFolder} subfolders`}>
                            <div className="subfolder-section-heading"><span>Subfolders</span><span>{visibleSubfolders.length}</span></div>
                            <div className="subfolder-grid">
                                {visibleSubfolders.map((folder) => {
                                    const lessonCount = lessons.filter((lesson) => folderIsWithin(lesson.folder, folder)).length
                                    return <button type="button" className="subfolder-card" key={folder} onClick={() => setActiveFolder(folder)}>
                                        <span className="subfolder-card-icon"><Folder size={16} /></span>
                                        <span className="subfolder-card-copy"><strong>{getFolderName(folder)}</strong><span>{lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}</span></span>
                                        <ChevronRight size={15} />
                                    </button>
                                })}
                            </div>
                        </section>}
                        <div className="library-label-row"><span>{visibleLessons.length} lessons</span><span>NAME <MoveRight size={13} /> LAST OPENED</span></div>
                        {visibleLessons.length > 0 ? <div className={`lesson-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                            {visibleLessons.map((lesson) => {
                                const legacyCover = lesson.id.includes('blends') ? 'blends' : lesson.id.includes('syllables') ? 'safari' : lesson.id.includes('vce') ? 'magic' : 'vowels'
                                const cover = lesson.cover ?? legacyCover
                                return <article className={`lesson-card ${showFileMenu === lesson.id ? 'menu-open' : ''}`} key={lesson.id} draggable onDragStart={(event) => { setDraggingId(lesson.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', lesson.id) }} onDragEnd={() => setDraggingId(null)} onClick={() => openBoard(lesson)}>
                                    {cover === 'page' ? <div className="lesson-thumb page-preview" aria-hidden="true"><svg viewBox="0 0 1000 620" preserveAspectRatio="none">{(itemsByPage[`${lesson.id}:0`] ?? []).map((item) => <g key={item.id}>{renderBoardItem(item)}</g>)}</svg></div> : cover === 'custom' && lesson.coverImage ? <div className="lesson-thumb custom-cover" aria-hidden="true"><img src={lesson.coverImage} alt="" /></div> : <Thumb kind={cover} tint={lesson.color} />}
                                    <div className="lesson-info">
                                        <div className="lesson-name-line">
                                            {renamingLessonId === lesson.id ? (
                                                <input
                                                    className="lesson-rename-input"
                                                    autoFocus
                                                    value={renameValue}
                                                    onClick={(event) => event.stopPropagation()}
                                                    onChange={(event) => setRenameValue(event.target.value)}
                                                    onBlur={() => commitLessonRename(lesson.id)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') { event.preventDefault(); commitLessonRename(lesson.id) }
                                                        if (event.key === 'Escape') { event.stopPropagation(); setRenamingLessonId(null) }
                                                    }}
                                                />
                                            ) : <h2>{lesson.title}{isMockWorkspace && mockLessonIds.has(lesson.id) && <span className="demo-tag" title="Sample lesson">Demo</span>}</h2>}
                                            <div className="menu-anchor">
                                                <button className="card-menu-button" aria-label={`Options for ${lesson.title}`} onClick={(event) => { event.stopPropagation(); setShowFileMenu(showFileMenu === lesson.id ? null : lesson.id) }}><MoreHorizontal size={18} /></button>
                                                {showFileMenu === lesson.id && <div className="file-menu" onClick={(event) => event.stopPropagation()}>
                                                    <button onClick={() => startRenameLesson(lesson)}><Pencil size={14} /> Rename</button>
                                                    <button onClick={() => duplicateLesson(lesson)}><Copy size={15} /> Make a copy</button>
                                                    <button onClick={() => openTagEditor(lesson)}><Tag size={14} /> Edit tags</button>
                                                    <button onClick={() => openCoverEditor(lesson)}><FileImage size={14} /> Edit cover</button>
                                                    <div className="menu-divider" />
                                                    <span className="menu-label">Move to</span>
                                                    {getOrderedFolders(folders).map((folder) => <button key={folder} onClick={() => moveLesson(lesson.id, folder)}><Folder size={14} /> {folder}</button>)}
                                                    <div className="menu-divider" />
                                                    <button className="danger-option" onClick={() => deleteLesson(lesson.id)}><Trash2 size={14} /> Move to trash</button>
                                                </div>}
                                            </div>
                                        </div>
                                        <div className="lesson-meta"><span className="lesson-file-icon"><NotebookTabs size={14} /></span><span>{lesson.pages.length} pages</span><span className="meta-dot">·</span><span>{lesson.updated}</span><span className="lesson-folder" title={`Folder: ${lesson.folder}`}><Folder size={13} /><span>{lesson.folder}</span></span></div>
                                        {Boolean(lesson.tags?.length) && <div className="lesson-tags" aria-label={`Tags for ${lesson.title}`}>{lesson.tags?.map((tag) => <span className="lesson-tag" key={tag}>{tag}</span>)}</div>}
                                    </div>
                                </article>
                            })}
                            <button className="new-lesson-card" onClick={openNewLessonDialog}><span className="new-lesson-icon"><Plus size={20} /></span><strong>Start with a blank lesson</strong><span>Build a new teaching moment</span></button>
                        </div> : search.trim() ? <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>No lessons found</strong><span>Try a different search or choose another folder.</span></div> : <div className="lesson-grid"><button className="new-lesson-card empty-folder-card" onClick={openNewLessonDialog}><span className="new-lesson-icon"><Plus size={20} /></span><strong>Create new</strong><span>{activeFolder === 'All lessons' || activeFolder === 'Shared with me' ? 'Start your first lesson' : 'This folder is empty — start a lesson here'}</span></button></div>}
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
                            <div className="board-title"><div className="board-title-icon"><NotebookTabs size={17} /></div><div>{renamingTitle ? <input className="board-title-input" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={commitOpenLessonTitleRename} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitOpenLessonTitleRename() } if (event.key === 'Escape') setRenamingTitle(false) }} /> : <strong onDoubleClick={startRenameOpenLessonTitle}>{openLesson.title}</strong>}<span>{openLesson.folder} <span className="meta-dot">·</span> Saved just now</span></div>{!studentView && <button className="title-dropdown" aria-label="Rename lesson" title="Rename lesson" onClick={startRenameOpenLessonTitle}><Pencil size={15} /></button>}</div>
                            <div className="page-directory-anchor">
                                <button className="page-directory-button" aria-label="Browse pages" title="Browse pages" onClick={() => setShowPageDirectory(!showPageDirectory)}><List size={15} /> Pages <ChevronDown size={13} /></button>
                                {showPageDirectory && <div className="page-directory-menu">{pages.map((page, index) => <button key={`${page}-${index}`} className={index === pageIndex ? 'active' : ''} onClick={() => { setPageIndex(index); setSelectedItemId(null); setShowPageDirectory(false) }}><span className="page-number">{String(index + 1).padStart(2, '0')}</span>{page}</button>)}</div>}
                            </div>
                            {!studentView && <div className="board-toolbar-center">
                                <div className="ink-picker">{palette.map((color) => <button key={color} className={`color-swatch ${ink === color ? 'active' : ''}`} style={{ '--swatch': color } as React.CSSProperties} onClick={() => setInk(color)} aria-label={`Choose ${color} ink`} title={`Choose ${color} ink`} />)}</div>
                                {showToolOptions && <div className="tool-option-popover"><span>{activeTool === 'shape' ? 'Choose a shape' : 'Ink color'}</span>{activeTool === 'shape' ? <><button onClick={() => { setSelectedShape('circle'); setActiveTool('shape'); setShowToolOptions(false) }}><Circle size={15} /> Circle</button><button onClick={() => { setSelectedShape('rectangle'); setActiveTool('shape'); setShowToolOptions(false) }}><Shapes size={15} /> Rectangle</button><button onClick={() => { setSelectedShape('line'); setActiveTool('shape'); setShowToolOptions(false) }}><MoveRight size={15} /> Line</button></> : <div className="mini-swatches">{palette.map((color) => <button key={color} style={{ backgroundColor: color }} onClick={() => { setInk(color); setShowToolOptions(false) }} aria-label={`Choose ${color}`} title={`Choose ${color}`} />)}</div>}</div>}
                            </div>}
                            <div className="board-toolbar-right"><button className={`blend-button ${showBlend ? 'active' : ''}`} onClick={() => setShowBlend(!showBlend)}><AudioLines size={16} /> Blending board</button>{!studentView && <><button className="icon-button" title="Add image or PDF" aria-label="Add image or PDF" onClick={() => imageInputRef.current?.click()}><ImagePlus size={18} /></button><button className="google-image-button" title="Search Google Images" aria-label="Search Google Images" onClick={() => setShowImageSearch(true)}><Globe size={16} /></button><input ref={imageInputRef} type="file" accept="image/*,application/pdf" hidden onChange={handleImage} /><button className="icon-button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}><ChevronRight size={18} /></button></>}</div>
                        </div>
                        <div className="canvas-workspace">
                            {showBackgrounds && <div className="background-panel"><div className="panel-heading"><strong>Page background</strong><button onClick={() => setShowBackgrounds(false)} aria-label="Close background panel"><X size={16} /></button></div><div className="background-options"><button className="background-swatch blank" onClick={() => setPageBackground('#fffef9')}><span />Blank</button><button className="background-swatch lined" onClick={() => setPageBackground('repeating-linear-gradient(to bottom, #fffef9 0 34px, #e5ece8 35px 36px)')}><span />Lined</button><button className="background-swatch grid-bg" onClick={() => setPageBackground('radial-gradient(#cbd5d0 0.8px, transparent 0.8px)')}><span />Grid</button></div><div className="panel-divider" /><span className="panel-small-label">PASTEL COLORS</span><div className="background-colors">{['#fdeef2', '#fff4da', '#eaf6e6', '#e3f1fb', '#f1ebfa', '#fce8e8'].map((color) => <button key={color} style={{ background: color }} onClick={() => setPageBackground(color)} aria-label={`Set ${color} background`} title={`Set ${color} background`}><Check size={14} /></button>)}</div><span className="panel-small-label">SOLID COLORS</span><div className="background-colors">{['#fffef9', '#fff2dd', '#e8f4ee', '#eff1fc', '#fcebe7', '#ffffff'].map((color) => <button key={color} style={{ background: color }} onClick={() => setPageBackground(color)} aria-label={`Set ${color} background`} title={`Set ${color} background`}><Check size={14} /></button>)}</div><button className="upload-background" onClick={() => backgroundInputRef.current?.click()}><FileImage size={16} /> Add image background</button><input ref={backgroundInputRef} type="file" accept="image/*" hidden onChange={handleBackgroundImage} /><div className="panel-divider" /><span className="panel-small-label">APPLY TO</span><div className="background-scope"><button className={backgroundScope === 'current' ? 'active' : ''} onClick={() => setBackgroundScope('current')}>Current page</button><button className={backgroundScope === 'all' ? 'active' : ''} onClick={() => setBackgroundScope('all')}>All pages in lesson</button></div></div>}
                            {showBlend && <div className="blend-panel"><div className="panel-heading"><div><span className="panel-kicker">SOUND IT OUT</span><strong>Blending board</strong></div><button onClick={() => setShowBlend(false)} aria-label="Close blending board"><X size={16} /></button></div>{blendRows.map((row, rowIndex) => <div className="blend-row" key={rowIndex}><div className="blend-track">{row.map((token, tokenIndex) => <div className={`blend-token-wrap ${tokenIndex > 0 ? 'with-dot' : ''}`} key={tokenIndex}><input className="blend-token" value={token} onChange={(event) => setBlendToken(rowIndex, tokenIndex, event.target.value)} aria-label={`Row ${rowIndex + 1} sound ${tokenIndex + 1}`} />{row.length > 1 && <button className="blend-token-remove" aria-label={`Remove sound ${tokenIndex + 1}`} title="Remove sound" onClick={() => removeBlendToken(rowIndex, tokenIndex)}><X size={10} /></button>}</div>)}<button className="blend-add-token" aria-label="Add a sound" title="Add a sound" onClick={() => addBlendToken(rowIndex)}><Plus size={13} /></button></div><div className="blend-word">{row.map((token, tokenIndex) => <span key={tokenIndex}>{token}</span>)}<b>{row.join('')}</b></div><div className="blend-controls"><button onClick={() => playBlendRow(rowIndex)}><AudioLines size={14} /> Play sounds</button>{blendRows.length > 1 && <button onClick={() => removeBlendRow(rowIndex)}><Trash2 size={14} /> Remove row</button>}</div></div>)}<button className="blend-add-row" onClick={addBlendRow}><Plus size={14} /> New row</button></div>}
                            {!studentView && selectedItem && <div className="selection-toolbar" onPointerDown={(event) => event.stopPropagation()}><span>Selected element</span>{selectedItem.type === 'shape' && selectedItem.shape === 'line' && <><button className={selectedItem.startArrow ? 'active' : ''} title="Toggle start arrowhead" aria-label="Toggle start arrowhead" aria-pressed={Boolean(selectedItem.startArrow)} onClick={() => toggleLineArrow('start')}><ArrowLeft size={15} /></button><button className={selectedItem.endArrow ? 'active' : ''} title="Toggle end arrowhead" aria-label="Toggle end arrowhead" aria-pressed={Boolean(selectedItem.endArrow)} onClick={() => toggleLineArrow('end')}><MoveRight size={15} /></button></>}{selectedItem.type === 'text' && <><div className="selection-text-colors">{palette.map((color) => <button key={color} className={selectedItem.color === color ? 'active' : ''} style={{ backgroundColor: color }} title={`Text color ${color}`} aria-label={`Text color ${color}`} onClick={() => setSelectedTextColor(color)} />)}</div><button title="Decrease font size" aria-label="Decrease font size" onClick={() => adjustSelectedTextSize(-2)}>A-</button><button title="Increase font size" aria-label="Increase font size" onClick={() => adjustSelectedTextSize(2)}>A+</button></>}{selectedItem.type === 'grid' && <><span className="grid-size-label">{selectedItem.cols ?? 3}×{selectedItem.rows ?? 3}</span><button title="Remove a column" aria-label="Remove a column" onClick={() => resizeGrid(selectedItem.id, selectedItem.rows ?? 3, (selectedItem.cols ?? 3) - 1)}>Cols-</button><button title="Add a column" aria-label="Add a column" onClick={() => resizeGrid(selectedItem.id, selectedItem.rows ?? 3, (selectedItem.cols ?? 3) + 1)}>Cols+</button><button title="Remove a row" aria-label="Remove a row" onClick={() => resizeGrid(selectedItem.id, (selectedItem.rows ?? 3) - 1, selectedItem.cols ?? 3)}>Rows-</button><button title="Add a row" aria-label="Add a row" onClick={() => resizeGrid(selectedItem.id, (selectedItem.rows ?? 3) + 1, selectedItem.cols ?? 3)}>Rows+</button></>}<button title="Make smaller" aria-label="Make smaller" onClick={() => scaleSelectedItem(0.85)}><Minus size={15} /></button><button title="Make larger" aria-label="Make larger" onClick={() => scaleSelectedItem(1.15)}><Plus size={15} /></button><button className="delete-selection" title="Delete selected element" aria-label="Delete selected element" onClick={deleteSelectedItem}><Trash2 size={15} /></button></div>}
                            <div className="board-page-area">
                                <div className="page-paper" ref={stageRef} style={{ background }} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp} data-tool={activeTool} data-shape={activeTool === 'shape' ? selectedShape : undefined}>
                                    {isFollowing && <div className="student-cursor"><span className="student-cursor-dot" /> Student is here</div>}
                                    <svg className="drawing-layer" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="Lesson whiteboard content">
                                        {currentItems.map((item) => <g key={item.id} className="board-item" onPointerDown={(event) => { if (item.type === 'text' && item.id === editingTextId) { event.stopPropagation(); return } beginItemGesture(event, item) }} onDoubleClick={() => { if (item.type === 'text') { setSelectedItemId(item.id); setEditingTextId(item.id) } }}>{item.type === 'text' && item.id === editingTextId ? <foreignObject x={item.left * 10 - 6} y={item.top * 6.2 - item.size * (item.scale ?? 1)} width={Math.max(220, item.text.length * item.size * 0.62 + 40)} height={(item.size * (item.scale ?? 1)) * 2.2}><input
                                            className="board-text-input"
                                            autoFocus
                                            value={item.text}
                                            placeholder="Type here…"
                                            style={{ color: item.color, fontSize: `${item.size * (item.scale ?? 1)}px`, fontFamily: "'Century Gothic', CenturyGothic, AppleGothic, sans-serif" }}
                                            onChange={(event) => updateCurrentItems((items) => items.map((candidate) => candidate.id === item.id && candidate.type === 'text' ? { ...candidate, text: event.target.value } : candidate), { recordHistory: false })}
                                            onBlur={() => { setEditingTextId(null); if (!item.text.trim()) updateCurrentItems((items) => items.filter((candidate) => candidate.id !== item.id)) }}
                                            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') { event.currentTarget.blur() } }}
                                        /></foreignObject> : renderBoardItem(item)}</g>)}
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
                                        {currentPoints && drawing && activeTool === 'eraser' && (() => {
                                            const erasePoints = parsePoints(currentPoints)
                                            const [lastX, lastY] = erasePoints[erasePoints.length - 1]
                                            return <circle className="eraser-cursor" cx={lastX} cy={lastY} r={14} pointerEvents="none" />
                                        })()}
                                        {currentPoints && (drawing || activeTool === 'laser') && activeTool !== 'eraser' && <polyline className={activeTool === 'laser' ? 'laser-stroke' : ''} points={currentPoints} fill="none" stroke={activeTool === 'laser' ? '#ef6b58' : ink} strokeWidth={activeTool === 'highlighter' ? 24 : activeTool === 'brush' ? 11 : 3} strokeOpacity={activeTool === 'highlighter' ? 0.42 : activeTool === 'brush' ? 0.76 : 1} strokeLinecap="round" strokeLinejoin="round" />}
                                    </svg>
                                    <div className="page-corner-label">{openLesson.folder.toUpperCase()} <span>✳</span></div>
                                </div>
                            </div>
                            <div className="page-dock"><div className="page-tabs">{!studentView && pages.map((page, index) => <button key={`${page}-${index}`} className={`page-tab ${index === pageIndex ? 'active' : ''}`} draggable={!studentView} onDragStart={(event) => { setDraggedPageIndex(index); event.dataTransfer.effectAllowed = 'move' }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => { event.preventDefault(); if (draggedPageIndex !== null) reorderPage(draggedPageIndex, index); setDraggedPageIndex(null) }} onDragEnd={() => setDraggedPageIndex(null)} onClick={() => { setPageIndex(index); setSelectedItemId(null) }}><span className="page-number">{String(index + 1).padStart(2, '0')}</span>{page}</button>)}{!studentView && <button className="add-page-tab" onClick={addPage} aria-label="Add page" title="Add page"><Plus size={17} /></button>}{studentView && <span className="page-tab active"><span className="page-number">{String(pageIndex + 1).padStart(2, '0')}</span>{pages[pageIndex]}</span>}</div><div className="page-dock-actions">{!studentView && <><button title="Duplicate page" aria-label="Duplicate page" onClick={duplicatePage}><Copy size={16} /></button><button title="Delete page" aria-label="Delete page" onClick={deletePage}><Trash2 size={16} /></button></>}<span className="dock-separator" /><span>{pageIndex + 1} / {pages.length}</span></div></div>
                        </div>
                    </main>
                </div>
            )}
            {showNewLesson && (
                <div className="modal-scrim" onClick={() => setShowNewLesson(false)}>
                    <form
                        className="share-modal new-lesson-modal"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => { if (event.key === 'Escape') setShowNewLesson(false) }}
                        onSubmit={(event) => { event.preventDefault(); createLesson() }}
                    >
                        <button type="button" className="modal-close" onClick={() => setShowNewLesson(false)} aria-label="Close"><X size={18} /></button>
                        <div className="share-modal-icon"><NotebookTabs size={20} /></div>
                        <h2>New lesson</h2>
                        <p>Give your lesson a name and choose how it appears in your library.</p>
                        <label className="new-lesson-field">
                            Lesson name
                            <input autoFocus required value={newLessonTitle} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setNewLessonTitle(event.target.value)} />
                        </label>
                        <label className="new-lesson-field">
                            Folder
                            <select
                                value={newLessonFolder}
                                onChange={(event) => {
                                    const value = event.target.value
                                    if (value === '__create-folder__') {
                                        setNewLessonFolderName('')
                                        setCreatingLessonFolder(true)
                                        return
                                    }
                                    setNewLessonFolder(value)
                                }}
                            >
                                {folders.length ? getOrderedFolders(folders).map((folder) => <option key={folder} value={folder}>{getFolderParent(folder) ? `  ${getFolderParent(folder)} / ${getFolderName(folder)}` : folder}</option>) : <option value="My lessons">My lessons</option>}
                                <option value="__create-folder__">Create new folder...</option>
                            </select>
                        </label>
                        {creatingLessonFolder && (
                            <div className="new-folder-entry">
                                <label className="new-lesson-field">
                                    New folder name
                                    <input
                                        autoFocus
                                        value={newLessonFolderName}
                                        onChange={(event) => setNewLessonFolderName(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault()
                                                addFolderToNewLesson()
                                            }
                                            if (event.key === 'Escape') {
                                                event.stopPropagation()
                                                setCreatingLessonFolder(false)
                                            }
                                        }}
                                    />
                                </label>
                                <div className="new-folder-entry-actions">
                                    <button type="button" className="cancel-button" onClick={() => setCreatingLessonFolder(false)}>Cancel</button>
                                    <button type="button" className="add-folder-button" disabled={!newLessonFolderName.trim()} onClick={addFolderToNewLesson}>Add folder</button>
                                </div>
                            </div>
                        )}
                        <fieldset className="cover-picker">
                            <legend>Thumbnail</legend>
                            <p>Choose a cover, or select No thumbnail to use the first page as the card preview.</p>
                            <div className="cover-options">
                                {lessonCoverOptions.map((option) => (
                                    <button key={option.id} type="button" className={`cover-option ${newLessonCover === option.id ? 'selected' : ''}`} aria-pressed={newLessonCover === option.id} onClick={() => setNewLessonCover(option.id)}>
                                        {option.id === 'page' ? <div className="lesson-thumb page-preview cover-option-preview" aria-hidden="true"><svg viewBox="0 0 1000 620" preserveAspectRatio="none" /></div> : <Thumb kind={option.id} tint={option.tint} />}
                                        <span>{option.label}</span>
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <div className="new-lesson-actions">
                            <button type="button" className="cancel-button" onClick={() => setShowNewLesson(false)}>Cancel</button>
                            <button type="submit" className="confirm-button" disabled={!newLessonTitle.trim()}><Plus size={15} /> Create lesson</button>
                        </div>
                    </form>
                </div>
            )}
            {showStudentFolderDialog && <div className="modal-scrim" onClick={() => setShowStudentFolderDialog(false)}><form className="share-modal subfolder-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); createStudentFolder() }}><button type="button" className="modal-close" onClick={() => setShowStudentFolderDialog(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><FolderPlus size={20} /></div><h2>New student folder</h2><p>Create a folder to organize one student.</p><label className="new-lesson-field">Student name<input autoFocus required value={subfolderName} onChange={(event) => setSubfolderName(event.target.value)} placeholder="e.g. Maya" /></label><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setShowStudentFolderDialog(false)}>Cancel</button><button type="submit" className="confirm-button" disabled={!subfolderName.trim()}><FolderPlus size={15} /> Create folder</button></div></form></div>}
            {subfolderParent && <div className="modal-scrim" onClick={() => setSubfolderParent(null)}><form className="share-modal subfolder-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); createSubfolder() }}><button type="button" className="modal-close" onClick={() => setSubfolderParent(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><FolderPlus size={20} /></div><h2>New subfolder</h2><p>Inside {subfolderParent}</p><label className="new-lesson-field">Subfolder name<input autoFocus required value={subfolderName} onChange={(event) => setSubfolderName(event.target.value)} placeholder="e.g. Reading goals" /></label><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setSubfolderParent(null)}>Cancel</button><button type="submit" className="confirm-button" disabled={!subfolderName.trim()}><FolderPlus size={15} /> Create subfolder</button></div></form></div>}
            {tagEditorLesson && <div className="modal-scrim" onClick={() => setTagEditorLessonId(null)}><form className="share-modal tag-editor-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); addLessonTag() }}><button type="button" className="modal-close" onClick={() => setTagEditorLessonId(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Tag size={20} /></div><h2>Lesson tags</h2><p>{tagEditorLesson.title}</p><label className="new-lesson-field">Add a tag<input autoFocus value={newTagValue} onChange={(event) => setNewTagValue(event.target.value)} placeholder="e.g. articulation" /></label><div className="tag-editor-actions"><button type="submit" className="confirm-button" disabled={!newTagValue.trim()}><Plus size={15} /> Add tag</button></div>{tagEditorLesson.tags?.length ? <div className="tag-editor-list" aria-label="Current tags">{tagEditorLesson.tags.map((tag) => <span className="lesson-tag removable" key={tag}>{tag}<button type="button" onClick={() => removeLessonTag(tag)} aria-label={`Remove ${tag} tag`}><X size={12} /></button></span>)}</div> : <p className="tag-empty-state">No tags yet</p>}</form></div>}
            {coverEditorLesson && <div className="modal-scrim" onClick={() => setCoverEditorLessonId(null)}><div className="share-modal tag-editor-modal" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setCoverEditorLessonId(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><FileImage size={20} /></div><h2>Lesson cover</h2><p>{coverEditorLesson.title}</p>{coverEditorLesson.cover === 'custom' && coverEditorLesson.coverImage && <div className="cover-editor-preview"><img src={coverEditorLesson.coverImage} alt="Current cover" /></div>}<input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverUpload} /><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setCoverEditorLessonId(null)}>Cancel</button><button type="button" className="confirm-button" onClick={() => coverInputRef.current?.click()}><ImagePlus size={15} /> Upload cover image</button></div></div></div>}
            {showProfileSettings && authSession && !studentView && <ProfileSettings userId={authSession.user.id} email={authSession.user.email ?? ''} initialDisplayName={profileDisplayName} onClose={() => setShowProfileSettings(false)} onSaved={(displayName, avatarUrl) => { setProfileDisplayName(displayName); setProfileAvatarUrl(avatarUrl) }} />}
            {printing && openLesson && <div className="print-pages">{pages.map((_, index) => <div className="print-page" key={index} style={{ background: backgroundsByPage[`${openLesson.id}:${index}`] ?? '#fffef9' }}><svg viewBox="0 0 1000 620" preserveAspectRatio="none">{(itemsByPage[`${openLesson.id}:${index}`] ?? []).map(renderBoardItem)}</svg></div>)}</div>}
            {showShare && openLesson && <div className="modal-scrim" onClick={() => setShowShare(false)}><div className="share-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowShare(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Users size={20} /></div><h2>Bring your student in</h2><p>Share a live lesson link. Your student will follow the page you’re teaching on.</p><div className="share-link"><span>{`${window.location.host}${window.location.pathname}?view=student&lesson=${openLesson.id}`}</span><button onClick={() => { const url = `${window.location.origin}${window.location.pathname}?view=student&lesson=${openLesson.id}`; void navigator.clipboard?.writeText(url); notify('Student link copied'); setShowShare(false) }}><Copy size={15} /> Copy</button></div><div className="share-permission"><Check size={14} /> Student view is read-only</div></div></div>}
            {showImageSearch && <div className="modal-scrim" onClick={() => setShowImageSearch(false)}><div className="share-modal image-search-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowImageSearch(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Globe size={20} /></div><h2>Find a teaching image</h2><p>Search Google Images, then copy an image address and add it to your page.</p><form className="image-search-form" onSubmit={(event) => { event.preventDefault(); window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageQuery)}`, '_blank', 'noopener,noreferrer') }}><input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder="Try: ship, shell, short i" aria-label="Search images" /><button type="submit"><Search size={15} /> Search</button></form><label className="image-url-label">IMAGE ADDRESS<input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." /></label><button type="button" className="insert-image-button" disabled={!imageUrl.trim()} onClick={() => { addBoardItem({ id: id(), type: 'image', left: 14, top: 25, src: imageUrl.trim(), label: 'Web image' }); setImageUrl(''); setShowImageSearch(false) }}><ImagePlus size={15} /> Add image to page</button></div></div>}
            {toast && <div className="toast-message"><Check size={15} />{toast}</div>}
        </div>
    )
}

export default App
