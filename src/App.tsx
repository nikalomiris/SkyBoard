import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
    ArrowLeft, AudioLines, BookOpen, Brush, Check, ChevronDown, ChevronLeft, ChevronRight,
    ArrowRight, Circle, ClipboardCopy, ClipboardPaste, Copy, Download, Eraser, FileImage, FileText, Folder, FolderPlus, Globe,
    Grid2X2, Highlighter, ImagePlus, LayoutGrid, List, LogOut, Minus, MoreHorizontal, MoveRight, Square, Triangle,
    MousePointer2, NotebookTabs, Pencil, Plus, Search, Settings2, Share2, Shapes, Sparkles,
    AlignLeft, AlignCenter, AlignRight, Crop, Layers, RotateCw, StickyNote, Tag, Trash2, Type, Undo2, Redo2, Users, UserX, X, Lock, Unlock
} from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import BlendingBoard from './components/BlendingBoard'
import CardDeck, { DECK_ITEM_PREFIX, buildDeckPageItems, emptyDeckSession } from './components/CardDeck'
import type { DeckSession } from './components/CardDeck'
import type { BlendDraft, BlendStroke, BlendTile } from './components/BlendingBoard'
import ImageCropDialog from './components/ImageCropDialog'
import LessonThumbnail from './components/LessonThumbnail'
import ProfileSettings from './components/ProfileSettings'
import { getItemBounds, getLineEndpoints, moveBoardItem, parsePoints, pointToSegmentDistance, smoothPath, polylinesWithinDistance, resizeBoardItem, getImageSize, registerImageAspect, TEXT_LINE_HEIGHT } from './lib/boardGeometry'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { addLibraryBackground, backgroundImageMaxDimension, coverImageMaxDimension, downscaleImage, loadBackgroundLibrary, removeLibraryBackground, type LibraryBackground } from './lib/backgroundLibrary'
import { createLessonInvite, deletePendingLessonInvite, endLessonShare, getActiveLessonShare, getSharedLesson, initializeWorkspace, listLessonInvites, listLiveLessonIds, loadWorkspace, saveWorkspace, setLessonInviteStatus, startLessonShare } from './lib/workspaceRepository'
import type { LessonInvite, SharedInvite } from './lib/workspaceRepository'
import {
    defaultTextFont, folderNamesInitial, folderIsWithin, getFolderName, getFolderParent, getOrderedFolders,
    folderSeparator, id, initialLessons, lessonCoverOptions, MAX_GRID_SIZE, MIN_GRID_SIZE,
    mockFolderNames, mockLessonIds, notePalette, palette, readStudentFolders, readStudentLessons, readStored,
    textFontOptions,
} from './lib/workspaceUtils'
import type { Tool } from './lib/workspaceUtils'
import type { ItemBounds, Point, ResizeHandle } from './lib/boardGeometry'
import type { BoardItem, ClipboardPage, DeckTile, GridCellStyle, Lesson, LessonCover, PageItems } from './lib/workspaceTypes'

type ItemGesture =
    | { mode: 'move'; item: BoardItem; startX: number; startY: number; bounds: ItemBounds }
    | { mode: 'resize'; item: BoardItem; startX: number; startY: number; bounds: ItemBounds; handle: ResizeHandle }
    | { mode: 'rotate'; item: Extract<BoardItem, { type: 'shape' }>; center: Point; startAngle: number; startRotation: number }
type DeleteConfirmation = { type: 'lesson'; lessonId: string } | { type: 'folder'; folder: string }

type SizedTool = 'pen' | 'brush' | 'highlighter' | 'eraser'
const sizedTools: SizedTool[] = ['pen', 'brush', 'highlighter', 'eraser']
const sizePresets: Record<SizedTool, number[]> = { pen: [1, 2, 3, 5, 8, 12], brush: [5, 8, 11, 16, 24, 34], highlighter: [12, 18, 24, 34, 46, 60], eraser: [14, 20, 28, 44, 64, 84] }
const toolOpacity: Record<SizedTool, number> = { pen: 1, brush: 0.76, highlighter: 0.42, eraser: 1 }
const studentToolIds: Tool[] = ['pen', 'brush', 'highlighter', 'eraser', 'text']
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
type LessonSortKey = 'edited-desc' | 'edited-asc' | 'name-asc' | 'name-desc'
const sortLabels: Record<LessonSortKey, string> = { 'edited-desc': 'Last edited', 'edited-asc': 'Oldest edited', 'name-asc': 'Name (A–Z)', 'name-desc': 'Name (Z–A)' }

type BackgroundFit = 'fill' | 'fit' | 'stretch' | 'center' | 'tile'

function App() {
    const [, setImageSizeVersion] = useState(0)
    const [studentView] = useState(() => new URLSearchParams(window.location.search).get('view') === 'student')
    const [sharedLessonStatus, setSharedLessonStatus] = useState<'loading' | 'ready' | 'error' | 'removed' | 'waiting'>(() => isSupabaseConfigured && studentView ? 'loading' : 'ready')
    const [sharedLessonError, setSharedLessonError] = useState('')
    const studentAccessRef = useRef('')
    const [teacherAway, setTeacherAway] = useState(false)
    const teacherAwayTimerRef = useRef(0)
    const [liveLessonIds, setLiveLessonIds] = useState<string[]>([])
    const studentInviteRef = useRef<SharedInvite | null>(null)
    const [studentSessionId, setStudentSessionId] = useState('')
    const reloadSharedLessonRef = useRef<() => void>(() => undefined)
    const [removedReason, setRemovedReason] = useState<'removed' | 'ended'>('removed')
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
    const [mockStudentFolders, setMockStudentFolders] = useState<string[]>([])
    const [activeFolder, setActiveFolder] = useState('All lessons')
    const [search, setSearch] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [sortKey, setSortKey] = useState<LessonSortKey>('edited-desc')
    const [sortMenuOpen, setSortMenuOpen] = useState(false)
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
    const [selectedShape, setSelectedShape] = useState<'circle' | 'square' | 'triangle' | 'line' | 'arrow'>('circle')
    const [shapeFillEnabled, setShapeFillEnabled] = useState(false)
    const [shapeFillColor, setShapeFillColor] = useState(palette[2])
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
    const [gridScope, setGridScope] = useState<'cell' | 'row' | 'column'>('cell')
    const [activeGridCell, setActiveGridCell] = useState<{ itemId: string; index: number } | null>(null)
    const [ink, setInk] = useState(palette[0])
    const [toolSizes, setToolSizes] = useState<Record<SizedTool, number>>({ pen: 3, brush: 11, highlighter: 24, eraser: 28 })
    const [hoverVisible, setHoverVisible] = useState(false)
    const hoverPosRef = useRef<[number, number]>([0, 0])
    const hoverCursorRef = useRef<SVGCircleElement | null>(null)
    const [backgroundsByPage, setBackgroundsByPage] = useState<Record<string, string>>(() => isSupabaseConfigured ? {} : readStored('skyboard:backgrounds', {}))
    const [backgroundScope, setBackgroundScope] = useState<'current' | 'all'>('current')
    const [showBackgrounds, setShowBackgrounds] = useState(false)
    const [showPageDirectory, setShowPageDirectory] = useState(false)
    const laserFadeRef = useRef(0)
    const [laserFading, setLaserFading] = useState(false)
    const [renamingPageIndex, setRenamingPageIndex] = useState<number | null>(null)
    const [pageRenameValue, setPageRenameValue] = useState('')
    const [pageSelectionMode, setPageSelectionMode] = useState(false)
    const [selectedPageIndices, setSelectedPageIndices] = useState<number[]>([])
    const [showBlend, setShowBlend] = useState(false)
    const [blendTiles, setBlendTiles] = useState<BlendTile[]>([])
    const [blendStrokes, setBlendStrokes] = useState<BlendStroke[]>([])
    const [remoteBlendDraft, setRemoteBlendDraft] = useState<BlendDraft | null>(null)

    // The blending board is a scratch space: reset it whenever a lesson is opened, switched or closed.
    const [blendColor, setBlendColor] = useState<string | null>(null)
    useEffect(() => {
        if (studentView) return
        setBlendTiles([])
        setBlendStrokes([])
        setShowBlend(false)
        setShowDeck(false)
        setDeckSession(emptyDeckSession)
        setPageSelectionMode(false)
        setSelectedPageIndices([])
    }, [openLesson?.id])
    // The deck selection is saved with the lesson; the session (random order and position) is transient.
    const [showDeck, setShowDeck] = useState(false)
    const [deckSession, setDeckSession] = useState<DeckSession>(emptyDeckSession)
    const [remoteDeckTile, setRemoteDeckTile] = useState<DeckTile | null>(null)
    const deckConfig = lessons.find((lesson) => lesson.id === openLesson?.id)?.cardDeck
    const [showShare, setShowShare] = useState(false)
    const [shareLinkUrl, setShareLinkUrl] = useState('')
    const [shareLinkLoading, setShareLinkLoading] = useState(false)
    const [shareSessionId, setShareSessionId] = useState('')
    const [shareExpiresAt, setShareExpiresAt] = useState('')
    const [invites, setInvites] = useState<LessonInvite[]>([])
    const [onlineInviteIds, setOnlineInviteIds] = useState<string[]>([])
    const [lockedInviteIds, setLockedInviteIds] = useState<string[]>([])
    const [requireApproval, setRequireApproval] = useState(true)
    const [newInviteName, setNewInviteName] = useState('')
    const [copiedInviteId, setCopiedInviteId] = useState('')
    const [studentCursors, setStudentCursors] = useState<Record<string, { x: number; y: number; name: string; color: string; pageIndex: number }>>({})
    const cursorTimersRef = useRef<Record<string, number>>({})
    const lastCursorSentRef = useRef(0)
    const liveReceivedRef = useRef(false)
    const [shareLinkError, setShareLinkError] = useState('')
    const [showNewLesson, setShowNewLesson] = useState(false)
    const [copyingLessonId, setCopyingLessonId] = useState<string | null>(null)
    const [copyDestinationFolder, setCopyDestinationFolder] = useState('')
    const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
    const [postitDraft, setPostitDraft] = useState<{ id?: string; left: number; top: number; text: string } | null>(null)
    const lastItemTapRef = useRef<{ id: string; time: number } | null>(null)
    const [tagEditorLessonId, setTagEditorLessonId] = useState<string | null>(null)
    const [newTagValue, setNewTagValue] = useState('')
    const [renamingLessonId, setRenamingLessonId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const renameCancelledRef = useRef(false)
    const [coverEditorLessonId, setCoverEditorLessonId] = useState<string | null>(null)
    const [renamingTitle, setRenamingTitle] = useState(false)
    const [showStudentFolderDialog, setShowStudentFolderDialog] = useState(false)
    const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
    const [folderRenameValue, setFolderRenameValue] = useState('')
    const [folderRenameError, setFolderRenameError] = useState('')
    const [clipboardPages, setClipboardPages] = useState<ClipboardPage[]>(() => readStored<ClipboardPage[]>('skyboard:page-clipboard', []))
    const [showPasteDialog, setShowPasteDialog] = useState(false)
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
    const [cropQueue, setCropQueue] = useState<{ src: string; label: string; left: number; top: number; itemId?: string }[]>([])
    const [imageResults, setImageResults] = useState<{ id: string; thumb: string; src: string; title: string }[]>([])
    const [imageSearching, setImageSearching] = useState(false)
    const [imageSearchError, setImageSearchError] = useState('')
    const [showFileMenu, setShowFileMenu] = useState<string | null>(null)
    const [studentLocked, setStudentLocked] = useState(false)
    const [showStudentMenu, setShowStudentMenu] = useState(false)
    const connectedInvites = invites.filter((invite) => invite.status === 'admitted' && onlineInviteIds.includes(invite.id))
    const waitingInvites = invites.filter((invite) => invite.status === 'pending' && onlineInviteIds.includes(invite.id))
    const studentCount = connectedInvites.length
    const isFollowing = studentCount > 0
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null)
    const [folderMenu, setFolderMenu] = useState<string | null>(null)
    const [printing, setPrinting] = useState(false)
    const [drawing, setDrawing] = useState(false)
    const [currentPoints, setCurrentPoints] = useState('')
    const [lineDraft, setLineDraft] = useState<{ start: Point; end: Point } | null>(null)
    const [showToolOptions, setShowToolOptions] = useState(false)
    const [editingTextId, setEditingTextId] = useState<string | null>(null)
    const [, setHistoryTick] = useState(0)
    const stageRef = useRef<HTMLDivElement>(null)
    const workspaceRef = useRef<HTMLDivElement>(null)
    const [toolOptionsTop, setToolOptionsTop] = useState(10)
    const itemGestureRef = useRef<ItemGesture | null>(null)
    const historyRef = useRef<Record<string, { past: BoardItem[][]; future: BoardItem[][] }>>({})
    const imageInputRef = useRef<HTMLInputElement>(null)
    const [backgroundDraft, setBackgroundDraft] = useState<{ src: string; fit: BackgroundFit; scope: 'current' | 'all'; libraryId?: string; name: string; group: string; newGroup: string; busy?: boolean; error?: string } | null>(null)
    const [backgroundLibrary, setBackgroundLibrary] = useState<LibraryBackground[]>([])
    const [backgroundLibraryError, setBackgroundLibraryError] = useState('')
    const backgroundOwnerId = authSession?.user.id ?? null
    useEffect(() => {
        if (studentView || (isSupabaseConfigured && !backgroundOwnerId)) { setBackgroundLibrary([]); return }
        let active = true
        loadBackgroundLibrary(backgroundOwnerId).then((entries) => { if (active) { setBackgroundLibrary(entries); setBackgroundLibraryError('') } }).catch(() => { if (active) setBackgroundLibrary([]) })
        return () => { active = false }
    }, [backgroundOwnerId, studentView])
    const backgroundInputRef = useRef<HTMLInputElement>(null)
    const coverInputRef = useRef<HTMLInputElement>(null)
    const workspaceSaveQueue = useRef<Promise<void>>(Promise.resolve())
    const workspaceSaveVersion = useRef(0)

    useLayoutEffect(() => {
        const button = document.querySelector<HTMLElement>(`.tool-rail [data-tool-id="${activeTool}"]`)
        const workspace = workspaceRef.current
        if (!button || !workspace) return
        const top = button.getBoundingClientRect().top - workspace.getBoundingClientRect().top
        setToolOptionsTop(Math.max(10, Math.round(top)))
    })

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
            setMockStudentFolders(workspace.mockStudentFolders)
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

    useEffect(() => {
        if (!isSupabaseConfigured || !studentView) return
        let active = true
        const token = new URLSearchParams(window.location.search).get('token')
        if (!token) {
            setSharedLessonError('This student link is missing its access token.')
            setSharedLessonStatus('error')
            return
        }
        const load = () => void getSharedLesson(token).then((shared) => {
            if (!active) return
            studentInviteRef.current = shared.invite
            studentAccessRef.current = shared.access
            setStudentSessionId(shared.sessionId)
            if (shared.access === 'pending') return setSharedLessonStatus('waiting')
            if (shared.access === 'removed' || !shared.lesson || !shared.pages) {
                setRemovedReason('removed')
                return setSharedLessonStatus('removed')
            }
            setInk(shared.invite.color)
            const pageNames = shared.pages.length ? shared.pages.map((page) => page.name) : ['Page 1']
            const liveStarted = liveReceivedRef.current
            const lesson = shared.lesson
            setOpenLesson((previous) => ({ id: lesson.id, title: lesson.title, folder: '', pages: liveStarted && previous ? previous.pages : pageNames, updated: '', color: lesson.color, kind: 'lesson' }))
            if (!liveStarted) {
                setPages(pageNames)
                setPageIndex(0)
            }
            const sharedItems: PageItems = {}
            const sharedBackgrounds: Record<string, string> = {}
            for (const page of shared.pages) {
                sharedItems[`${lesson.id}:${page.position}`] = page.elements.filter((item) => !((item.type === 'image' || item.type === 'pdf') && item.src.startsWith('storage://')))
                sharedBackgrounds[`${lesson.id}:${page.position}`] = page.background
            }
            setItemsByPage((previous) => ({ ...sharedItems, ...previous }))
            setBackgroundsByPage((previous) => ({ ...sharedBackgrounds, ...previous }))
            setSharedLessonStatus('ready')
        }).catch((error: unknown) => {
            if (!active) return
            if (error instanceof Error && error.message.includes('LESSON_ENDED')) {
                studentAccessRef.current = 'ended'
                setRemovedReason('ended')
                setSharedLessonStatus('removed')
                return
            }
            setSharedLessonError(error instanceof Error ? error.message : 'Unable to load this student link.')
            setSharedLessonStatus('error')
        })
        reloadSharedLessonRef.current = load
        load()
        return () => { active = false }
    }, [studentView])

    const currentPageKey = openLesson ? `${openLesson.id}:${pageIndex}` : ''
    const currentItems = itemsByPage[currentPageKey] ?? []
    const background = backgroundsByPage[currentPageKey] ?? '#fffef9'
    const selectedItem = currentItems.find((item) => item.id === selectedItemId) ?? null
    const selectedGridCellStyle = selectedItem?.type === 'grid' && activeGridCell?.itemId === selectedItem.id
        ? selectedItem.cellStyles?.[activeGridCell.index]
        : undefined
    const currentHistory = historyRef.current[currentPageKey]
    const canUndo = Boolean(currentHistory?.past.length)
    const canRedo = Boolean(currentHistory?.future.length)
    const isMockWorkspace = !isSupabaseConfigured && !studentView

    const liveStateRef = useRef({ pageIndex, pages, items: currentItems, background })
    liveStateRef.current = { pageIndex, pages, items: currentItems, background }
    const liveChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
    const liveSubscribedRef = useRef(false)
    const studentEditPendingRef = useRef(false)
    type LiveDraft = { kind: 'ink' | 'eraser' | 'laser'; pageIndex: number; points: string; color: string; width: number; opacity: number }
    const [remoteDraft, setRemoteDraft] = useState<LiveDraft | null>(null)
    const handleRemoteDraft = ({ payload }: { payload: unknown }) => {
        const draft = payload as (LiveDraft & { blend?: boolean }) | null
        if (draft?.blend) { setRemoteBlendDraft(draft.kind === 'ink' && draft.points ? { ...draft, kind: 'ink' } : null); return }
        setRemoteDraft(draft && draft.points && draft.pageIndex === liveStateRef.current.pageIndex ? draft : null)
    }
    const openLessonIdRef = useRef<string | null>(null)
    openLessonIdRef.current = openLesson?.id ?? null
    const blendStateRef = useRef({ open: showBlend, tiles: blendTiles, strokes: blendStrokes, color: blendColor })
    blendStateRef.current = { open: showBlend, tiles: blendTiles, strokes: blendStrokes, color: blendColor }
    const deckStateRef = useRef<{ open: boolean; tile: DeckTile | null }>({ open: false, tile: null })
    deckStateRef.current = { open: showDeck, tile: deckSession.order[deckSession.index] ?? null }
    const studentLockedRef = useRef(studentLocked)
    studentLockedRef.current = studentLocked
    const lockedInviteIdsRef = useRef(lockedInviteIds)
    lockedInviteIdsRef.current = lockedInviteIds
    const broadcastLock = () => {
        const channel = liveChannelRef.current
        if (!channel || !liveSubscribedRef.current) return
        void channel.send({ type: 'broadcast', event: 'lock', payload: { all: studentLockedRef.current, ids: lockedInviteIdsRef.current } })
    }
    const broadcastBlendState = () => {
        const channel = liveChannelRef.current
        if (!channel || !liveSubscribedRef.current) return
        void channel.send({ type: 'broadcast', event: 'blend', payload: blendStateRef.current })
    }
    const broadcastDeckState = () => {
        const channel = liveChannelRef.current
        if (!channel || !liveSubscribedRef.current) return
        void channel.send({ type: 'broadcast', event: 'deck', payload: deckStateRef.current })
    }
    const broadcastLiveState = () => {
        const channel = liveChannelRef.current
        if (!channel || !liveSubscribedRef.current) return
        void channel.send({ type: 'broadcast', event: 'state', payload: liveStateRef.current })
        broadcastBlendState()
        broadcastDeckState()
        broadcastLock()
    }

    // Teacher: publish the current page (and its content) to every student on the shared link.
    useEffect(() => {
        if (!supabase || studentView || !shareSessionId) return
        const channel = supabase.channel(`lesson-live:${shareSessionId}`)
        liveChannelRef.current = channel
        liveSubscribedRef.current = false
        channel.on('broadcast', { event: 'hello' }, () => broadcastLiveState())
        channel.on('presence', { event: 'sync' }, () => {
            const members = Object.values(channel.presenceState()).flat() as unknown as { role?: string; inviteId?: string }[]
            setOnlineInviteIds([...new Set(members.filter((member) => member.role === 'student' && member.inviteId).map((member) => member.inviteId as string))])
        })
        channel.on('broadcast', { event: 'draft' }, handleRemoteDraft)
        channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
            const cursor = payload as { inviteId: string; x: number; y: number; name: string; color: string; pageIndex: number }
            if (!cursor?.inviteId) return
            setStudentCursors((previous) => ({ ...previous, [cursor.inviteId]: cursor }))
            window.clearTimeout(cursorTimersRef.current[cursor.inviteId])
            cursorTimersRef.current[cursor.inviteId] = window.setTimeout(() => setStudentCursors((previous) => {
                const { [cursor.inviteId]: _gone, ...rest } = previous
                return rest
            }), 2500)
        })
        // Student edits arrive for the page the student was viewing; apply them to that page.
        channel.on('broadcast', { event: 'items' }, ({ payload }) => {
            const edit = payload as { pageIndex: number; items: BoardItem[] }
            setRemoteDraft(null)
            const lessonId = openLessonIdRef.current
            if (!lessonId || !edit || !Array.isArray(edit.items) || edit.pageIndex !== liveStateRef.current.pageIndex) return
            setItemsByPage((previous) => ({ ...previous, [`${lessonId}:${edit.pageIndex}`]: edit.items }))
        })
        channel.subscribe((status) => {
            liveSubscribedRef.current = status === 'SUBSCRIBED'
            if (status === 'SUBSCRIBED') {
                void channel.track({ role: 'teacher' })
                broadcastLiveState()
            }
        })
        return () => {
            liveSubscribedRef.current = false
            liveChannelRef.current = null
            setOnlineInviteIds([])
            setStudentCursors({})
            void supabase?.removeChannel(channel)
        }
    }, [shareSessionId, studentView])
    useEffect(() => {
        if (!shareSessionId || studentView) return
        const timeout = window.setTimeout(broadcastLiveState, 120)
        return () => window.clearTimeout(timeout)
    }, [shareSessionId, studentView, pageIndex, pages, currentItems, background])

    useEffect(() => {
        if (!shareSessionId || studentView) return
        broadcastLock()
    }, [shareSessionId, studentView, studentLocked, lockedInviteIds])
    useEffect(() => {
        if (!shareSessionId || studentView) return
        broadcastBlendState()
    }, [shareSessionId, studentView, showBlend, blendTiles, blendStrokes, blendColor])
    useEffect(() => {
        if (!shareSessionId || studentView) return
        broadcastDeckState()
    }, [shareSessionId, studentView, showDeck, deckSession])

    // Both sides: stream the stroke being drawn so the other side sees it while it is written.
    const lastDraftSentRef = useRef(0)
    const draftActive = Boolean(currentPoints) && (activeTool === 'laser' || (drawing && ['pen', 'brush', 'highlighter', 'eraser'].includes(activeTool)))
    useEffect(() => {
        if (!shareSessionId && !studentView) return
        const send = (payload: LiveDraft | null) => {
            const channel = liveChannelRef.current
            if (channel && liveSubscribedRef.current) void channel.send({ type: 'broadcast', event: 'draft', payload })
        }
        if (!draftActive) {
            if (lastDraftSentRef.current) { lastDraftSentRef.current = 0; send(null) }
            return
        }
        const style = sizedTools.includes(activeTool as SizedTool) ? { width: toolSizes[activeTool as SizedTool], opacity: toolOpacity[activeTool as SizedTool] } : { width: 3, opacity: 1 }
        const delay = Math.max(0, 40 - (Date.now() - lastDraftSentRef.current))
        const timeout = window.setTimeout(() => {
            lastDraftSentRef.current = Date.now()
            send({ kind: activeTool === 'eraser' ? 'eraser' : activeTool === 'laser' ? 'laser' : 'ink', pageIndex, points: currentPoints, color: ink, ...style })
        }, delay)
        return () => window.clearTimeout(timeout)
    }, [draftActive, currentPoints, shareSessionId, studentView])

    // Student: send local edits back to the teacher.
    useEffect(() => {
        if (!studentView || !studentEditPendingRef.current) return
        studentEditPendingRef.current = false
        const channel = liveChannelRef.current
        if (!channel || !liveSubscribedRef.current) return
        void channel.send({ type: 'broadcast', event: 'items', payload: { pageIndex, items: currentItems } })
    }, [studentView, currentItems, pageIndex])

    // Student: follow the teacher's page and show its live content.
    useEffect(() => {
        const client = supabase
        if (!client || !studentView || !studentSessionId) return
        const channel = client.channel(`lesson-live:${studentSessionId}`)
        liveChannelRef.current = channel
        liveSubscribedRef.current = false
        const admitted = () => studentAccessRef.current === 'admitted'
        const forMe = (ids?: string[] | null) => !ids || ids.includes(studentInviteRef.current?.id ?? '')
        // A short grace period avoids flashing the away screen while the teacher's presence is still arriving.
        channel.on('presence', { event: 'sync' }, () => {
            const members = Object.values(channel.presenceState()).flat() as unknown as { role?: string }[]
            window.clearTimeout(teacherAwayTimerRef.current)
            if (members.some((member) => member.role === 'teacher')) setTeacherAway(false)
            else teacherAwayTimerRef.current = window.setTimeout(() => setTeacherAway(true), 3000)
        })
        channel.on('broadcast', { event: 'draft' }, ({ payload }) => { if (admitted()) handleRemoteDraft({ payload }) })
        channel.on('broadcast', { event: 'state' }, ({ payload }) => {
            if (!admitted()) return
            const live = payload as { pageIndex: number; pages: string[]; items: BoardItem[]; background: string }
            if (!live || !Array.isArray(live.pages) || !Array.isArray(live.items)) return
            liveReceivedRef.current = true
            setRemoteDraft(null)
            const visible = live.items.filter((item) => !((item.type === 'image' || item.type === 'pdf') && item.src.startsWith('storage://')))
            setPages(live.pages)
            setOpenLesson((previous) => previous ? { ...previous, pages: live.pages } : previous)
            setPageIndex(live.pageIndex)
            setLiveLessonPage({ index: live.pageIndex, items: visible, background: live.background })
            setSelectedItemId(null)
        })
        channel.on('broadcast', { event: 'kick' }, ({ payload }) => {
            const kick = payload as { ids?: string[] | null; reason?: string }
            if (!forMe(kick?.ids)) return
            studentAccessRef.current = kick?.reason === 'ended' ? 'ended' : 'removed'
            setRemovedReason(kick?.reason === 'ended' ? 'ended' : 'removed')
            setSharedLessonStatus('removed')
        })
        channel.on('broadcast', { event: 'admit' }, ({ payload }) => {
            if ((payload as { inviteId?: string })?.inviteId === studentInviteRef.current?.id && studentAccessRef.current !== 'ended') reloadSharedLessonRef.current()
        })
        channel.on('broadcast', { event: 'lock' }, ({ payload }) => {
            const lock = payload as { all?: boolean; ids?: string[] }
            setStudentLocked(Boolean(lock?.all) || (lock?.ids ?? []).includes(studentInviteRef.current?.id ?? ''))
        })
        channel.on('broadcast', { event: 'blend' }, ({ payload }) => {
            if (!admitted()) return
            const blend = payload as { open: boolean; tiles: BlendTile[]; strokes?: BlendStroke[]; color: string | null }
            if (!blend || !Array.isArray(blend.tiles)) return
            setBlendTiles(blend.tiles)
            setBlendStrokes(Array.isArray(blend.strokes) ? blend.strokes : [])
            setRemoteBlendDraft(null)
            setBlendColor(blend.color ?? null)
            setShowBlend(Boolean(blend.open))
        })
        channel.on('broadcast', { event: 'deck' }, ({ payload }) => {
            if (!admitted()) return
            const deck = payload as { open?: boolean; tile?: DeckTile | null }
            setRemoteDeckTile(deck?.tile && typeof deck.tile.text === 'string' ? deck.tile : null)
            setShowDeck(Boolean(deck?.open))
        })
        channel.subscribe((status) => {
            liveSubscribedRef.current = status === 'SUBSCRIBED'
            if (status !== 'SUBSCRIBED') return
            const invite = studentInviteRef.current
            void channel.track({ role: 'student', inviteId: invite?.id, name: invite?.label, color: invite?.color })
            void channel.send({ type: 'broadcast', event: 'hello', payload: {} })
        })
        return () => {
            window.clearTimeout(teacherAwayTimerRef.current)
            liveSubscribedRef.current = false
            liveChannelRef.current = null
            void client.removeChannel(channel)
        }
    }, [studentView, studentSessionId])
    const [liveLessonPage, setLiveLessonPage] = useState<{ index: number; items: BoardItem[]; background: string } | null>(null)
    useEffect(() => {
        if (!liveLessonPage || !openLesson) return
        const key = `${openLesson.id}:${liveLessonPage.index}`
        setItemsByPage((previous) => ({ ...previous, [key]: liveLessonPage.items }))
        setBackgroundsByPage((previous) => ({ ...previous, [key]: liveLessonPage.background }))
    }, [liveLessonPage, openLesson?.id])
    const tagEditorLesson = lessons.find((lesson) => lesson.id === tagEditorLessonId) ?? null
    const coverEditorLesson = lessons.find((lesson) => lesson.id === coverEditorLessonId) ?? null
    const copyingLesson = lessons.find((lesson) => lesson.id === copyingLessonId) ?? null
    const copyDestinationFolders = getOrderedFolders([...new Set([...folders, ...(copyingLesson ? [copyingLesson.folder] : [])])])
    const isStudentFolderSelected = folders.includes(activeFolder) && !getFolderParent(activeFolder)
    const orderedFolders = getOrderedFolders(folders)
    const visibleSubfolders = isStudentFolderSelected ? folders.filter((folder) => getFolderParent(folder) === activeFolder) : []
    const searchQuery = search.trim().toLocaleLowerCase()
    const visibleLessons = lessons.filter((lesson) => {
        const matchesFolder = activeFolder === 'All lessons' || activeFolder === 'Shared with me' || folderIsWithin(lesson.folder, activeFolder)
        const matchesSearch = !searchQuery || lesson.title.toLocaleLowerCase().includes(searchQuery) || lesson.folder.toLocaleLowerCase().includes(searchQuery)
        return matchesFolder && matchesSearch
    }).sort((first, second) => {
        if (sortKey === 'name-asc') return first.title.localeCompare(second.title, undefined, { numeric: true, sensitivity: 'base' })
        if (sortKey === 'name-desc') return second.title.localeCompare(first.title, undefined, { numeric: true, sensitivity: 'base' })
        const difference = (second.updatedAt ?? 0) - (first.updatedAt ?? 0)
        return sortKey === 'edited-asc' ? -difference : difference
    })

    useEffect(() => {
        try { window.localStorage.setItem('skyboard:page-clipboard', JSON.stringify(clipboardPages)) } catch { /* clipboard stays in memory only */ }
    }, [clipboardPages])
    useEffect(() => {
        function syncClipboard(event: StorageEvent) {
            if (event.key === 'skyboard:page-clipboard') setClipboardPages(readStored<ClipboardPage[]>('skyboard:page-clipboard', []))
        }
        window.addEventListener('storage', syncClipboard)
        return () => window.removeEventListener('storage', syncClipboard)
    }, [])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:lessons', JSON.stringify(lessons)) }, [lessons])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:folders', JSON.stringify(folders)) }, [folders])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:items', JSON.stringify(itemsByPage)) }, [itemsByPage])
    useEffect(() => { if (!isSupabaseConfigured) window.localStorage.setItem('skyboard:backgrounds', JSON.stringify(backgroundsByPage)) }, [backgroundsByPage])
    useEffect(() => {
        if (!supabase || !authSession || !workspaceReady || workspaceError || studentView) return
        const ownerId = authSession.user.id
        const version = ++workspaceSaveVersion.current
        const timeout = window.setTimeout(() => {
            setCloudSaveStatus('saving')
            setCloudSaveError('')
            // Serialize writes so an older save cannot finish after and overwrite a newer workspace snapshot.
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
    }, [authSession?.user.id, workspaceReady, workspaceError, studentView, folders, lessons, itemsByPage, backgroundsByPage])
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
        const duplicateShortcut = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'd') return
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
            if (!selectedItemId) return
            event.preventDefault()
            duplicateSelectedItem()
        }
        window.addEventListener('keydown', deleteSelected)
        window.addEventListener('keydown', duplicateShortcut)
        return () => {
            window.removeEventListener('keydown', deleteSelected)
            window.removeEventListener('keydown', duplicateShortcut)
        }
    }, [selectedItemId, currentPageKey, studentView])

    async function signOut() {
        if (!supabase) return
        const { error } = await supabase.auth.signOut()
        if (error) console.error(error.message)
    }

    function touchOpenLesson() {
        if (!openLesson || studentView) return
        const lessonId = openLesson.id
        const updatedAt = Date.now()
        setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, updated: 'Just now', updatedAt } : lesson))
    }

    function updateCurrentItems(nextItems: BoardItem[] | ((items: BoardItem[]) => BoardItem[]), options?: { recordHistory?: boolean }) {
        const recordHistory = options?.recordHistory ?? true
        if (studentView) studentEditPendingRef.current = true
        touchOpenLesson()
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
        if (studentView) studentEditPendingRef.current = true
        touchOpenLesson()
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
        if (studentView) studentEditPendingRef.current = true
        touchOpenLesson()
        setItemsByPage((previous) => ({ ...previous, [currentPageKey]: nextState }))
        setSelectedItemId(null)
        setHistoryTick((tick) => tick + 1)
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
        const movedIndex = (oldIndex: number) => oldIndex === fromIndex ? toIndex :
            fromIndex < toIndex && oldIndex > fromIndex && oldIndex <= toIndex ? oldIndex - 1 :
                fromIndex > toIndex && oldIndex >= toIndex && oldIndex < fromIndex ? oldIndex + 1 : oldIndex
        const remapByPage = <T,>(previous: Record<string, T>) => {
            const reordered = { ...previous }
            pages.forEach((_, oldIndex) => {
                const oldKey = `${openLesson.id}:${oldIndex}`
                const newKey = `${openLesson.id}:${movedIndex(oldIndex)}`
                if (previous[oldKey] !== undefined) reordered[newKey] = previous[oldKey]
                else delete reordered[newKey]
            })
            return reordered
        }
        setItemsByPage(remapByPage)
        setBackgroundsByPage(remapByPage)
        updateLessonPages(renumberDefaultPages(nextPages))
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
            id: id(), title: newLessonTitle.trim() || 'Untitled lesson', folder: newLessonFolder || folders[0] || 'My lessons', pages: ['Page 1'], updated: 'Just now', updatedAt: Date.now(),
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

    function openDuplicateLessonDialog(lesson: Lesson) {
        setCopyingLessonId(lesson.id)
        setCopyDestinationFolder(lesson.folder)
        setShowFileMenu(null)
    }

    function duplicateLesson(lesson: Lesson, destinationFolder: string) {
        const copy: Lesson = { ...lesson, id: id(), title: `${lesson.title} copy`, folder: destinationFolder, pages: [...lesson.pages], updated: 'Just now', updatedAt: Date.now() }
        const copiedItems: PageItems = {}
        const copiedBackgrounds: Record<string, string> = {}
        lesson.pages.forEach((_, index) => {
            const sourceKey = `${lesson.id}:${index}`
            const targetKey = `${copy.id}:${index}`
            if (itemsByPage[sourceKey]) copiedItems[targetKey] = structuredClone(itemsByPage[sourceKey])
            if (backgroundsByPage[sourceKey]) copiedBackgrounds[targetKey] = backgroundsByPage[sourceKey]
        })
        setItemsByPage((previous) => ({ ...previous, ...copiedItems }))
        setBackgroundsByPage((previous) => ({ ...previous, ...copiedBackgrounds }))
        setLessons((previous) => [copy, ...previous])
        setCopyingLessonId(null)
    }

    function deleteLesson(lessonId: string) {
        setLessons((previous) => previous.filter((lesson) => lesson.id !== lessonId))
        setShowFileMenu(null)
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
        setRenamingLessonId(null)
        if (renameCancelledRef.current) { renameCancelledRef.current = false; return }
        const title = renameValue.trim()
        if (!title) return
        setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, title } : lesson))
        if (openLesson?.id === lessonId) setOpenLesson((previous) => previous ? { ...previous, title } : previous)
    }

    function cancelLessonRename() {
        renameCancelledRef.current = true
        setRenamingLessonId(null)
    }

    function startRenameOpenLessonTitle() {
        if (!openLesson) return
        setRenameValue(openLesson.title)
        setRenamingTitle(true)
    }

    const inviteLink = (invite: LessonInvite) => `${window.location.origin}${window.location.pathname}?view=student&token=${invite.token}`

    function sendLive(event: string, payload: unknown) {
        const channel = liveChannelRef.current
        if (channel && liveSubscribedRef.current) void channel.send({ type: 'broadcast', event, payload })
    }

    async function setInviteState(invite: LessonInvite, status: LessonInvite['status']) {
        try {
            await setLessonInviteStatus(invite.id, status)
        } catch (error) {
            setShareLinkError(error instanceof Error ? error.message : 'Unable to update this student.')
            return
        }
        setInvites((previous) => previous.map((item) => item.id === invite.id ? { ...item, status } : item))
        if (status === 'admitted') sendLive('admit', { inviteId: invite.id })
        else if (status === 'removed') {
            setLockedInviteIds((previous) => previous.filter((id) => id !== invite.id))
            sendLive('kick', { ids: [invite.id], reason: 'removed' })
        }
    }

    async function deleteInvite(invite: LessonInvite) {
        try {
            await deletePendingLessonInvite(invite.id)
        } catch (error) {
            setShareLinkError(error instanceof Error ? error.message : 'Unable to delete this student link.')
            return
        }
        setInvites((previous) => previous.filter((item) => item.id !== invite.id))
        setOnlineInviteIds((previous) => previous.filter((id) => id !== invite.id))
        setShareLinkError('')
    }

    async function removeAllStudents() {
        const targets = invites.filter((invite) => invite.status === 'admitted')
        if (!targets.length || !window.confirm(`Remove ${targets.length === 1 ? 'the student' : 'all students'}? They will lose access until you let them back in.`)) return
        await Promise.all(targets.map((invite) => setInviteState(invite, 'removed')))
    }

    async function endLesson() {
        if (!shareSessionId || !openLesson || !window.confirm('End the lesson? Everyone will be disconnected and all student links will stop working.')) return
        sendLive('kick', { ids: null, reason: 'ended' })
        try {
            await endLessonShare(openLesson.id)
        } catch (error) {
            console.error(error)
        }
        setShareSessionId('')
        setInvites([])
        setLockedInviteIds([])
        setStudentLocked(false)
        setLiveLessonIds((previous) => previous.filter((lessonId) => lessonId !== openLesson.id))
        setShowShare(false)
    }

    async function addInvite() {
        if (!shareSessionId) return
        try {
            const invite = await createLessonInvite(shareSessionId, newInviteName, requireApproval)
            setInvites((previous) => [...previous, invite])
            setNewInviteName('')
            setShareLinkError('')
        } catch (error) {
            setShareLinkError(error instanceof Error ? error.message : 'Unable to create a student link.')
        }
    }

    function copyInviteLink(invite: LessonInvite) {
        void navigator.clipboard?.writeText(inviteLink(invite))
        setCopiedInviteId(invite.id)
        window.setTimeout(() => setCopiedInviteId((current) => current === invite.id ? '' : current), 1800)
    }

    function openShareDialog() {
        if (!openLesson) return
        setShowShare(true)
        setShareLinkError('')
        if (!isSupabaseConfigured) {
            setShareLinkUrl(`${window.location.origin}${window.location.pathname}?view=student&lesson=${openLesson.id}`)
            return
        }
        if (shareSessionId) return
        setShareLinkLoading(true)
        void startLessonShare(openLesson.id).then(async (share) => {
            setShareSessionId(share.sessionId)
            setShareExpiresAt(share.expiresAt)
            setInvites(await listLessonInvites(share.sessionId))
        }).catch((error: unknown) => {
            setShareLinkError(error instanceof Error ? error.message : 'Unable to start sharing this lesson.')
        }).finally(() => setShareLinkLoading(false))
    }

    useEffect(() => {
        if (!supabase || studentView || !authSession || !workspaceReady || openLesson) return
        let active = true
        void listLiveLessonIds().then((ids) => { if (active) setLiveLessonIds(ids) }).catch(() => undefined)
        return () => { active = false }
    }, [openLesson, authSession?.user.id, studentView, workspaceReady])

    // Teacher: pick an already-live room back up after a reload or when returning to the lesson.
    useEffect(() => {
        setShareSessionId('')
        setInvites([])
        setLockedInviteIds([])
        if (!supabase || studentView || !authSession || !openLesson?.id) return
        let active = true
        void getActiveLessonShare(openLesson.id).then(async (share) => {
            if (!active || !share) return
            const existing = await listLessonInvites(share.sessionId)
            if (!active) return
            setShareSessionId(share.sessionId)
            setShareExpiresAt(share.expiresAt)
            setInvites(existing)
        }).catch(() => undefined)
        return () => { active = false }
    }, [openLesson?.id, authSession?.user.id, studentView])

    function commitOpenLessonTitleRename() {
        setRenamingTitle(false)
        if (renameCancelledRef.current) { renameCancelledRef.current = false; return }
        if (!openLesson) return
        const title = renameValue.trim()
        if (!title) return
        setLessons((previous) => previous.map((lesson) => lesson.id === openLesson.id ? { ...lesson, title } : lesson))
        setOpenLesson((previous) => previous ? { ...previous, title } : previous)
    }

    function cancelOpenLessonTitleRename() {
        renameCancelledRef.current = true
        setRenamingTitle(false)
    }

    function openCoverEditor(lesson: Lesson) {
        setCoverEditorLessonId(lesson.id)
        setShowFileMenu(null)
    }

    function handleCoverUpload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file || !file.type.startsWith('image/') || !coverEditorLessonId) return
        const lessonId = coverEditorLessonId
        void downscaleImage(file, coverImageMaxDimension).then((coverImage) => {
            setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, cover: 'custom', coverImage } : lesson))
            setCoverEditorLessonId(null)
        }).catch(() => undefined)
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
        const deletedLessons = lessons.filter((lesson) => folderIsWithin(lesson.folder, folder))
        if (parent) {
            setLessons((previous) => previous.map((lesson) => folderIsWithin(lesson.folder, folder) ? { ...lesson, folder: parent } : lesson))
        } else {
            const deletedLessonIds = new Set(deletedLessons.map((lesson) => lesson.id))
            setLessons((previous) => previous.filter((lesson) => !deletedLessonIds.has(lesson.id)))
            setItemsByPage((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !deletedLessonIds.has(key.slice(0, key.lastIndexOf(':'))))))
            setBackgroundsByPage((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !deletedLessonIds.has(key.slice(0, key.lastIndexOf(':'))))))
        }
        setFolders((previous) => previous.filter((name) => !deletedFolders.includes(name)))
        setFolderMenu(null)
        if (activeFolder !== 'All lessons' && activeFolder !== 'Shared with me' && folderIsWithin(activeFolder, folder)) setActiveFolder('All lessons')
    }

    function confirmDelete() {
        if (!deleteConfirmation) return
        if (deleteConfirmation.type === 'lesson') deleteLesson(deleteConfirmation.lessonId)
        else deleteFolder(deleteConfirmation.folder)
        setDeleteConfirmation(null)
    }

    function moveLesson(lessonId: string, folder: string) {
        setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, folder } : lesson))
        setDraggingId(null)
        setShowFileMenu(null)
    }

    function createFolder(activate = true, requestedName: string) {
        const name = requestedName.trim()
        if (!name) return
        if (name.includes(folderSeparator)) return
        if (folders.includes(name)) return
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

    function startRenameFolder(folder: string) {
        setRenamingFolder(folder)
        setFolderRenameValue(getFolderName(folder))
        setFolderRenameError('')
        setFolderMenu(null)
    }

    function commitFolderRename() {
        if (!renamingFolder) return
        const name = folderRenameValue.trim()
        if (!name || name.includes(folderSeparator)) {
            setFolderRenameError(name ? 'Folder names cannot contain “ / ”.' : 'Enter a name.')
            return
        }
        const parent = getFolderParent(renamingFolder)
        const currentName = getFolderName(renamingFolder)
        if (name.toLocaleLowerCase() === currentName.toLocaleLowerCase()) {
            setRenamingFolder(null)
            setFolderRenameError('')
            return
        }
        const existingPaths = [...folders, ...lessons.map((lesson) => lesson.folder)]
        const duplicate = existingPaths.some((folder) =>
            folder !== renamingFolder
            && getFolderParent(folder) === parent
            && getFolderName(folder).toLocaleLowerCase() === name.toLocaleLowerCase())
        if (duplicate) {
            setFolderRenameError('A student or folder with that name already exists here.')
            return
        }

        const renamedFolder = parent ? `${parent}${folderSeparator}${name}` : name
        const renamePath = (path: string) => folderIsWithin(path, renamingFolder)
            ? `${renamedFolder}${path.slice(renamingFolder.length)}`
            : path
        setFolders((previous) => previous.map(renamePath))
        setLessons((previous) => previous.map((lesson) => ({ ...lesson, folder: renamePath(lesson.folder) })))
        setOpenLesson((previous) => previous ? { ...previous, folder: renamePath(previous.folder) } : previous)
        setActiveFolder((previous) => renamePath(previous))
        setNewLessonFolder((previous) => renamePath(previous))
        setCopyDestinationFolder((previous) => renamePath(previous))
        if (!parent) setMockStudentFolders((previous) => previous.map(renamePath))
        setRenamingFolder(null)
        setFolderRenameError('')
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
        if (name.includes(folderSeparator)) return
        const path = `${parent}${folderSeparator}${name}`
        if (folders.includes(path)) return
        setFolders((previous) => [...previous, path])
        setSubfolderParent(null)
        setSubfolderName('')
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
        insertPage(pages.length, `Page ${pages.length + 1}`, [])
    }

    // Default "Page N" names follow the page's actual position; custom names are kept.
    function renumberDefaultPages(names: string[]) {
        return names.map((name, index) => /^Page \d+$/.test(name) ? `Page ${index + 1}` : name)
    }

    function updateLessonPages(nextPages: string[]) {
        if (!openLesson) return
        const updatedLesson = { ...openLesson, pages: nextPages, updated: 'Just now', updatedAt: Date.now() }
        setPages(nextPages)
        setOpenLesson(updatedLesson)
        setLessons((previous) => previous.map((lesson) => lesson.id === updatedLesson.id ? { ...lesson, pages: updatedLesson.pages, updated: updatedLesson.updated, updatedAt: updatedLesson.updatedAt } : lesson))
    }

    function startRenamePage(index: number) {
        setRenamingPageIndex(index)
        setPageRenameValue(pages[index] ?? '')
    }

    function commitPageRename() {
        if (renamingPageIndex === null) return
        const name = pageRenameValue.trim()
        if (name && name !== pages[renamingPageIndex]) updateLessonPages(pages.map((page, index) => index === renamingPageIndex ? name : page))
        setRenamingPageIndex(null)
    }

    function insertPage(index: number, name: string, items: BoardItem[], pageBackground?: string) {
        if (!openLesson) return
        const lessonId = openLesson.id
        const shiftKeys = <T,>(map: Record<string, T>) => {
            const next = { ...map }
            for (let i = pages.length - 1; i >= index; i--) {
                const from = `${lessonId}:${i}`
                const to = `${lessonId}:${i + 1}`
                if (from in map) next[to] = map[from]
                else delete next[to]
            }
            delete next[`${lessonId}:${index}`]
            return next
        }
        for (let i = index; i <= pages.length; i++) delete historyRef.current[`${lessonId}:${i}`]
        const newKey = `${lessonId}:${index}`
        updateLessonPages(renumberDefaultPages([...pages.slice(0, index), name, ...pages.slice(index)]))
        setItemsByPage((previous) => ({ ...shiftKeys(previous), [newKey]: items.map((item) => ({ ...item, id: id() })) }))
        setBackgroundsByPage((previous) => {
            const next = shiftKeys(previous)
            if (pageBackground) next[newKey] = pageBackground
            return next
        })
        setPageIndex(index)
        setSelectedItemId(null)
    }

    // Writes the confirmed deck onto a lesson page, creating the page the first time and refreshing it afterwards.
    function syncDeckPage(tiles: DeckTile[]) {
        if (!openLesson) return
        const lessonId = openLesson.id
        const items = buildDeckPageItems(tiles)
        const existing = pages.findIndex((_, index) => (itemsByPage[`${lessonId}:${index}`] ?? []).some((item) => item.id.startsWith(DECK_ITEM_PREFIX)))
        const index = existing >= 0 ? existing : pages.length
        delete historyRef.current[`${lessonId}:${index}`]
        if (existing < 0) updateLessonPages([...pages, 'Card Deck'])
        setItemsByPage((previous) => ({ ...previous, [`${lessonId}:${index}`]: items }))
        setSelectedItemId(null)
    }

    function removeDeckPage() {
        if (!openLesson) return
        const lessonId = openLesson.id
        const existing = pages.findIndex((_, index) => (itemsByPage[`${lessonId}:${index}`] ?? []).some((item) => item.id.startsWith(DECK_ITEM_PREFIX)))
        if (existing < 0) return
        if (pages.length > 1) return removePageAt(existing)
        // A lesson always keeps one page, so an only page is emptied instead.
        delete historyRef.current[`${lessonId}:${existing}`]
        setItemsByPage((previous) => ({ ...previous, [`${lessonId}:${existing}`]: [] }))
    }

    function duplicatePage() {
        const sourceName = pages[pageIndex]
        const isDefaultName = /^Page \d+$/.test(sourceName)
        insertPage(pageIndex + 1, isDefaultName ? `Page ${pageIndex + 2}` : `${sourceName} copy`, currentItems, backgroundsByPage[currentPageKey])
    }

    function copyPage() {
        if (!openLesson) return
        const entry: ClipboardPage = {
            id: id(), name: pages[pageIndex], sourceLesson: openLesson.title, copiedAt: new Date().toISOString(),
            items: structuredClone(currentItems), background: backgroundsByPage[currentPageKey],
        }
        setClipboardPages((previous) => [entry, ...previous].slice(0, 20))
    }

    function pasteClipboardPage(entry: ClipboardPage) {
        insertPage(pageIndex + 1, entry.name, entry.items, entry.background)
        setShowPasteDialog(false)
    }

    function deletePage() {
        removePageAt(pageIndex)
    }

    function togglePageSelection(index: number) {
        setSelectedPageIndices((selected) => selected.includes(index)
            ? selected.filter((selectedIndex) => selectedIndex !== index)
            : [...selected, index])
    }

    function startPageSelection() {
        setRenamingPageIndex(null)
        setSelectedPageIndices([pageIndex])
        setPageSelectionMode(true)
    }

    function cancelPageSelection() {
        setSelectedPageIndices([])
        setPageSelectionMode(false)
    }

    function deleteSelectedPages() {
        if (selectedPageIndices.length === 0 || selectedPageIndices.length >= pages.length) return
        if (!window.confirm(`Delete ${selectedPageIndices.length} selected ${selectedPageIndices.length === 1 ? 'page' : 'pages'}? This action cannot be undone.`)) return
        removePagesAt(selectedPageIndices)
        cancelPageSelection()
    }

    function removePageAt(removeIndex: number) {
        removePagesAt([removeIndex])
    }

    function removePagesAt(removeIndices: number[]) {
        const removedIndices = new Set(removeIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < pages.length))
        if (removedIndices.size === 0 || pages.length - removedIndices.size < 1) return
        if (!openLesson) return
        const lessonId = openLesson.id
        const nextPages = pages.filter((_, index) => !removedIndices.has(index))
        const reindexPages = <T,>(map: Record<string, T>) => {
            const next = { ...map }
            const prefix = `${lessonId}:`
            Object.keys(next).forEach((key) => {
                if (key.startsWith(prefix)) delete next[key]
            })
            let nextIndex = 0
            pages.forEach((_, oldIndex) => {
                if (removedIndices.has(oldIndex)) return
                const oldKey = `${lessonId}:${oldIndex}`
                const newKey = `${lessonId}:${nextIndex}`
                if (oldKey in map) next[newKey] = map[oldKey]
                nextIndex += 1
            })
            return next
        }
        const earliestRemovedIndex = Math.min(...removedIndices)
        for (let i = earliestRemovedIndex; i < pages.length; i++) {
            delete historyRef.current[`${lessonId}:${i}`]
        }
        const removedBeforeCurrent = [...removedIndices].filter((index) => index < pageIndex).length
        const nextPageIndex = removedIndices.has(pageIndex)
            ? Math.max(0, pageIndex - removedBeforeCurrent - 1)
            : pageIndex - removedBeforeCurrent
        setItemsByPage(reindexPages)
        setBackgroundsByPage(reindexPages)
        updateLessonPages(renumberDefaultPages(nextPages))
        setPageIndex(nextPageIndex)
        setSelectedItemId(null)
        setSelectedPageIndices([])
        setPageSelectionMode(false)
    }

    function coordinates(event: { clientX: number; clientY: number }) {
        const rect = stageRef.current!.getBoundingClientRect()
        return { stageX: ((event.clientX - rect.left) / rect.width) * 1000, stageY: ((event.clientY - rect.top) / rect.height) * 620 }
    }

    function beginItemGesture(event: ReactPointerEvent<Element>, item: BoardItem) {
        if (activeTool !== 'select' || studentView) return
        setSelectedItemId(item.id)
        event.stopPropagation()
        if (event.target instanceof HTMLInputElement) {
            return
        }
        const { stageX, stageY } = coordinates(event)
        itemGestureRef.current = { mode: 'move', item, startX: stageX, startY: stageY, bounds: getItemBounds(item) }
        stageRef.current?.setPointerCapture(event.pointerId)
    }

    function resizeFromHandle(event: ReactPointerEvent<SVGCircleElement>, handle: ResizeHandle) {
        if (!selectedItem) return
        event.stopPropagation()
        const { stageX, stageY } = coordinates(event)
        itemGestureRef.current = { mode: 'resize', item: selectedItem, startX: stageX, startY: stageY, bounds: getItemBounds(selectedItem), handle }
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

    function duplicateSelectedItem() {
        if (!selectedItemId || studentView) return
        const copyId = id()
        updateCurrentItems((items) => {
            const source = items.find((item) => item.id === selectedItemId)
            if (!source) return items
            return [...items, { ...moveBoardItem(structuredClone(source), 30, 30), id: copyId } as BoardItem]
        })
        setSelectedItemId(copyId)
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
        if (!selectedItem || (selectedItem.type !== 'text' && selectedItem.type !== 'grid')) return
        if (selectedItem.type === 'grid') {
            if (activeGridCell?.itemId === selectedItem.id) {
                updateSelectedGridCellStyle((style) => ({ ...style, color }))
            } else {
                updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'grid' ? { ...item, color } : item))
            }
            return
        }
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== selectedItem.id) return item
            return item.type === 'text' ? { ...item, color } : item
        }))
    }

    function setSelectedItemColor(color: string) {
        if (!selectedItem) {
            setInk(color)
            return
        }
        if (selectedItem.type === 'text' || selectedItem.type === 'grid') {
            setSelectedTextColor(color)
            return
        }
        if (selectedItem.type !== 'stroke' && selectedItem.type !== 'shape' && selectedItem.type !== 'note') return
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && (item.type === 'stroke' || item.type === 'shape' || item.type === 'note') ? { ...item, color } : item))
    }

    function setSelectedShapeFill(enabled: boolean) {
        if (!selectedItem || selectedItem.type !== 'shape' || selectedItem.shape === 'line' || selectedItem.shape === 'arrow') return
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== selectedItem.id || item.type !== 'shape') return item
            if (enabled) return { ...item, fillColor: item.fillColor ?? shapeFillColor }
            const { fillColor: _fillColor, ...shape } = item
            return shape
        }))
    }

    function setSelectedShapeFillColor(color: string) {
        if (!selectedItem || selectedItem.type !== 'shape') return
        setShapeFillColor(color)
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'shape' ? { ...item, fillColor: color } : item))
    }

    function renderColorPicker(label: string, selectedColor: string, onSelect: (color: string) => void, colors: string[] = palette): ReactNode {
        return <div className="selection-text-colors" aria-label={`${label} color`}>
            {colors.map((color) => <button key={color} className={selectedColor === color ? 'active' : ''} style={{ backgroundColor: color }} title={`${label} color ${color}`} aria-label={`${label} color ${color}`} onClick={() => onSelect(color)} />)}
        </div>
    }

    function renderShapeFillControls(enabled: boolean, color: string, onToggle: (enabled: boolean) => void, onColorChange: (color: string) => void): ReactNode {
        return <div className="shape-fill-controls">
            <label><input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />Fill shape</label>
            {enabled && renderColorPicker('Fill', color, onColorChange)}
        </div>
    }

    function updateSelectedGridCellStyle(transform: (style: GridCellStyle, grid: Extract<BoardItem, { type: 'grid' }>) => GridCellStyle) {
        if (!selectedItem || selectedItem.type !== 'grid' || activeGridCell?.itemId !== selectedItem.id) return
        const cellIndex = activeGridCell.index
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== selectedItem.id || item.type !== 'grid') return item
            const cellStyles = [...(item.cellStyles ?? [])]
            const before = cellStyles[cellIndex] ?? {}
            const after = transform(before, item)
            const patch = Object.fromEntries(Object.entries(after).filter(([key, value]) => before[key as keyof GridCellStyle] !== value))
            for (const index of getGridScopeIndices(item, cellIndex)) cellStyles[index] = { ...(cellStyles[index] ?? {}), ...patch }
            return { ...item, cellStyles }
        }))
    }

    function adjustSelectedTextSize(delta: number) {
        if (!selectedItem || (selectedItem.type !== 'text' && selectedItem.type !== 'grid' && selectedItem.type !== 'note')) return
        if (selectedItem.type === 'note') {
            updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'note' ? { ...item, fontSize: Math.max(8, Math.min(48, (item.fontSize ?? 14) + delta)) } : item))
            return
        }
        if (selectedItem.type === 'grid') {
            updateSelectedGridCellStyle((style, grid) => ({ ...style, fontSize: Math.max(10, Math.min(96, (style.fontSize ?? grid.fontSize ?? 20) + delta)) }))
            return
        }
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== selectedItem.id) return item
            return item.type === 'text' ? { ...item, size: Math.max(10, Math.min(96, item.size + delta)) } : item
        }))
    }

    function setSelectedTextAlign(align: 'left' | 'center' | 'right') {
        if (!selectedItem || selectedItem.type !== 'text') return
        updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'text' ? { ...item, align } : item))
    }

    function setSelectedFontFamily(fontFamily: string) {
        if (!selectedItem || (selectedItem.type !== 'text' && selectedItem.type !== 'grid' && selectedItem.type !== 'note')) return
        if (selectedItem.type === 'note') {
            updateCurrentItems((items) => items.map((item) => item.id === selectedItem.id && item.type === 'note' ? { ...item, fontFamily } : item))
            return
        }
        if (selectedItem.type === 'grid') {
            updateSelectedGridCellStyle((style) => ({ ...style, fontFamily }))
            return
        }
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== selectedItem.id) return item
            return item.type === 'text' ? { ...item, fontFamily } : item
        }))
    }

    function onStageDown(event: ReactPointerEvent<HTMLElement>) {
        if (!stageRef.current) return
        const { stageX, stageY } = coordinates(event)
        if (editingTextId) {
            // The input may have lost focus to the toolbar, so its blur never ended the edit.
            const editedId = editingTextId
            setEditingTextId(null)
            if (currentItems.some((item) => item.id === editedId && item.type === 'text' && !item.text.trim())) updateCurrentItems((items) => items.filter((item) => item.id !== editedId))
        }
        if (activeTool === 'text' || activeTool === 'postit') return
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
                    if (item.shape === 'line' || item.shape === 'arrow') {
                        const { start, end } = getLineEndpoints(item)
                        return pointToSegmentDistance([stageX, stageY], start, end) < 14
                    }
                    const width = item.shape === 'square' ? 92 : 125
                    const height = item.shape === 'square' ? 92 : 78
                    return stageX >= itemX - 12 && stageX <= itemX + width + 12 && stageY >= itemY - 12 && stageY <= itemY + height + 12
                }
                const imageSize = item.type === 'image' ? getImageSize(item.src) : null
                const width = imageSize ? imageSize.width : item.type === 'grid' ? 294 : item.type === 'note' ? 190 : 230
                const height = imageSize ? imageSize.height : item.type === 'grid' ? 184 : item.type === 'note' ? 170 : 180
                return stageX >= itemX - 10 && stageX <= itemX + width && stageY >= itemY - 10 && stageY <= itemY + height
            })
            if (hit) updateCurrentItems((items) => items.filter((item) => item.id !== hit.id))
            return
        }
        if (activeTool === 'grid') {
            addBoardItem({ id: id(), type: 'grid', left: stageX / 10, top: stageY / 6.2, values: Array(9).fill(''), color: '#000000' })
            return
        }
        if (activeTool === 'shape') {
            if (selectedShape === 'line' || selectedShape === 'arrow') {
                setSelectedItemId(null)
                setLineDraft({ start: [stageX, stageY], end: [stageX, stageY] })
                stageRef.current.setPointerCapture(event.pointerId)
                return
            }
            addBoardItem({ id: id(), type: 'shape', left: stageX / 10, top: stageY / 6.2, shape: selectedShape, color: ink, ...(shapeFillEnabled ? { fillColor: shapeFillColor } : {}) })
            return
        }
        if (activeTool === 'select') {
            setSelectedItemId(null)
            return
        }
        if (activeTool === 'laser') { window.clearTimeout(laserFadeRef.current); setLaserFading(false) }
        stageRef.current.setPointerCapture(event.pointerId)
        setDrawing(true)
        setCurrentPoints(`${stageX},${stageY}`)
    }

    function onStageMove(event: ReactPointerEvent<HTMLElement>) {
        if (!stageRef.current) return
        if (event.pointerType !== 'touch' && sizedTools.includes(activeTool as SizedTool)) {
            const { stageX: hoverX, stageY: hoverY } = coordinates(event)
            hoverPosRef.current = [hoverX, hoverY]
            hoverCursorRef.current?.setAttribute('cx', String(hoverX))
            hoverCursorRef.current?.setAttribute('cy', String(hoverY))
            if (!hoverVisible) setHoverVisible(true)
        }
        if (studentView && studentInviteRef.current && Date.now() - lastCursorSentRef.current > 50) {
            const rect = stageRef.current.getBoundingClientRect()
            if (rect.width && rect.height) {
                lastCursorSentRef.current = Date.now()
                sendLive('cursor', { inviteId: studentInviteRef.current.id, name: studentInviteRef.current.label, color: studentInviteRef.current.color, x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height, pageIndex })
            }
        }
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
                    const horizontalDirection = gesture.handle.endsWith('right') ? 1 : -1
                    const verticalDirection = gesture.handle.startsWith('bottom') ? 1 : -1
                    const factor = Math.max(0.35, 1 + (deltaX * horizontalDirection + deltaY * verticalDirection) / dimension)
                    updatedItem = resizeBoardItem(gesture.item, factor, gesture.handle)
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
                    shape: selectedShape,
                    color: ink,
                    ...(shapeFillEnabled && selectedShape !== 'line' && selectedShape !== 'arrow' ? { fillColor: shapeFillColor } : {}),
                    ...(selectedShape === 'arrow' ? { endArrow: true } : {}),
                })
            }
            setLineDraft(null)
            return
        }
        if (drawing && currentPoints && activeTool === 'eraser') {
            const eraserPoints = parsePoints(currentPoints)
            updateCurrentItems((items) => items.filter((item) => {
                if (item.type !== 'stroke') return true
                return !polylinesWithinDistance(parsePoints(item.points), eraserPoints, toolSizes.eraser / 2 + 8 + item.width / 2)
            }))
        } else if (drawing && currentPoints && activeTool !== 'eraser' && activeTool !== 'laser') {
            const style = { color: ink, width: toolSizes[activeTool as SizedTool] ?? 3, opacity: toolOpacity[activeTool as SizedTool] ?? 1 }
            updateCurrentItems((items) => [...items, { id: id(), type: 'stroke', points: currentPoints, ...style }])
        }
        if (activeTool === 'laser') { setLaserFading(true); laserFadeRef.current = window.setTimeout(() => { setCurrentPoints(''); setLaserFading(false) }, 1500) }
        setDrawing(false)
        if (activeTool !== 'laser') setCurrentPoints('')
    }

    function handleImage(event: ChangeEvent<HTMLInputElement>) {
        const input = event.target
        const files = Array.from(input.files ?? []).filter((file) => file.type === 'application/pdf' || file.type.startsWith('image/'))
        input.value = ''
        if (!files.length) return
        const readFile = (file: File) => file.type.startsWith('image/') && file.type !== 'image/svg+xml'
            ? downscaleImage(file).catch(() => readOriginal(file))
            : readOriginal(file)
        const readOriginal = (file: File) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
        })
        void Promise.allSettled(files.map(readFile)).then((results) => {
            // Cascade each file so the items partially overlap.
            const newItems: BoardItem[] = []
            const toCrop: { src: string; label: string; left: number; top: number }[] = []
            results.forEach((result, index) => {
                if (result.status !== 'fulfilled') return
                const file = files[index]
                const step = newItems.length + toCrop.length
                const left = 8 + step * 6
                const top = 14 + step * 7
                if (file.type === 'application/pdf') newItems.push({ id: id(), type: 'pdf', left, top, src: result.value, label: file.name })
                else toCrop.push({ src: result.value, label: file.name, left, top })
            })
            if (toCrop.length) setCropQueue((queue) => [...queue, ...toCrop])
            if (!newItems.length) return
            updateCurrentItems((items) => [...items, ...newItems])
            setSelectedItemId(newItems[newItems.length - 1].id)
            setActiveTool('select')
            setShowToolOptions(false)
        })
    }

    function onStageClick(event: ReactMouseEvent<HTMLElement>) {
        if (!stageRef.current) return
        const { stageX, stageY } = coordinates(event)
        if (activeTool === 'postit') {
            setPostitDraft({ left: stageX / 10, top: stageY / 6.2, text: 'Remember this sound!' })
            return
        }
        if (activeTool !== 'text') return
        const newItem: Extract<BoardItem, { type: 'text' }> = { id: id(), type: 'text', left: stageX / 10, top: stageY / 6.2, text: '', color: ink, size: 22, fontFamily: defaultTextFont }
        addBoardItem(newItem)
        setEditingTextId(newItem.id)
    }

    function setPageBackground(value: string, scope: 'current' | 'all' = backgroundScope) {
        if (!openLesson) return
        touchOpenLesson()
        setBackgroundsByPage((previous) => {
            if (scope === 'all') {
                const next = { ...previous }
                pages.forEach((_, index) => { next[`${openLesson.id}:${index}`] = value })
                return next
            }
            return { ...previous, [currentPageKey]: value }
        })
    }

    function backgroundImageCss(src: string, fit: BackgroundFit) {
        const layout = { fill: 'center / cover no-repeat', fit: 'center / contain no-repeat', stretch: '0 0 / 100% 100% no-repeat', center: 'center / auto no-repeat', tile: '0 0 / auto repeat' }[fit]
        return `url("${src}") ${layout} #fffef9`
    }

    async function handleBackgroundImage(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file || !file.type.startsWith('image/')) return
        try {
            const src = await downscaleImage(file, backgroundImageMaxDimension)
            setBackgroundDraft({ src, fit: 'fill', scope: backgroundScope, name: file.name.replace(/\.[^.]+$/, '') || 'Background', group: '', newGroup: '' })
            setShowBackgrounds(false)
        } catch (error) {
            setBackgroundLibraryError(error instanceof Error ? error.message : 'Could not read that image.')
        }
    }

    async function applyBackgroundDraft() {
        if (!backgroundDraft) return
        const draft = backgroundDraft
        const group = (draft.group === '__new__' ? draft.newGroup : draft.group).trim()
        if (!draft.libraryId) {
            setBackgroundDraft({ ...draft, busy: true, error: undefined })
            try {
                const saved = await addLibraryBackground(backgroundOwnerId, { name: draft.name.trim() || 'Background', group, image: draft.src })
                setBackgroundLibrary((previous) => [...previous, saved])
            } catch {
                setBackgroundDraft({ ...draft, busy: false, error: 'Could not save this image to your library.' })
                return
            }
        }
        setPageBackground(backgroundImageCss(draft.src, draft.fit), draft.scope)
        setBackgroundDraft(null)
    }

    async function deleteLibraryBackground(entry: LibraryBackground) {
        try {
            await removeLibraryBackground(backgroundOwnerId, entry.id)
            setBackgroundLibrary((previous) => previous.filter((candidate) => candidate.id !== entry.id))
        } catch {
            setBackgroundLibraryError('Could not remove that background.')
        }
    }

    function handleGridEnter(event: React.KeyboardEvent<HTMLInputElement>, index: number, itemId: string, cols: number, total: number) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const nextIndex = index + cols < total ? index + cols : (index % cols + 1) % cols
        const target = document.querySelector<HTMLInputElement>(`[data-grid-input="${itemId}-${nextIndex}"]`)
        target?.focus()
    }

    function getGridScopeIndices(grid: Extract<BoardItem, { type: 'grid' }>, cellIndex: number) {
        const cols = grid.cols ?? 3
        const rows = grid.rows ?? 3
        if (gridScope === 'row') return Array.from({ length: cols }, (_, col) => Math.floor(cellIndex / cols) * cols + col)
        if (gridScope === 'column') return Array.from({ length: rows }, (_, row) => row * cols + (cellIndex % cols))
        return [cellIndex]
    }

    function setGridScopeAlign(align: 'left' | 'center' | 'right') {
        if (studentView || !selectedItem || selectedItem.type !== 'grid' || activeGridCell?.itemId !== selectedItem.id) return
        const cellIndex = activeGridCell.index
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== selectedItem.id || item.type !== 'grid') return item
            const cellStyles = [...(item.cellStyles ?? [])]
            for (const index of getGridScopeIndices(item, cellIndex)) cellStyles[index] = { ...(cellStyles[index] ?? {}), align }
            return { ...item, cellStyles }
        }))
    }

    function setGridValue(itemId: string, valueIndex: number, value: string) {
        if (studentView) return
        updateCurrentItems((items) => items.map((item) => item.id === itemId && item.type === 'grid' ? { ...item, values: item.values.map((cell, index) => index === valueIndex ? value : cell) } : item))
    }

    function resizeGrid(itemId: string, nextRows: number, nextCols: number) {
        if (studentView) return
        const rows = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, nextRows))
        const cols = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, nextCols))
        setActiveGridCell((current) => current?.itemId === itemId ? { ...current, index: Math.min(current.index, rows * cols - 1) } : current)
        updateCurrentItems((items) => items.map((item) => {
            if (item.id !== itemId || item.type !== 'grid') return item
            const oldCols = item.cols ?? 3
            const oldRows = item.rows ?? 3
            const values = Array.from({ length: rows * cols }, (_, index) => {
                const row = Math.floor(index / cols)
                const col = index % cols
                if (col >= oldCols || row >= oldRows) return ''
                return item.values[row * oldCols + col] ?? ''
            })
            const cellStyles = item.cellStyles && Array.from({ length: rows * cols }, (_, index) => {
                const row = Math.floor(index / cols)
                const col = index % cols
                if (col >= oldCols || row >= oldRows) return {}
                return item.cellStyles?.[row * oldCols + col] ?? {}
            })
            return { ...item, rows, cols, values, ...(cellStyles ? { cellStyles } : {}) }
        }))
    }

    function exportPdf() {
        const originalTitle = document.title
        if (openLesson?.title.trim()) document.title = openLesson.title.trim()
        setPrinting(true)
        window.setTimeout(() => window.print(), 80)
        window.addEventListener('afterprint', () => {
            document.title = originalTitle
            setPrinting(false)
        }, { once: true })
    }

    function addLessonFromToolbar() {
        openNewLessonDialog()
    }

    function renderSelectedItemToolbar(): ReactNode {
        if (!selectedItem) return null
        let colorControls: ReactNode = null
        if (selectedItem.type === 'text') colorControls = renderColorPicker('Text', selectedItem.color, setSelectedTextColor)
        else if (selectedItem.type === 'grid') {
            const hasActiveCell = activeGridCell?.itemId === selectedItem.id
            colorControls = renderColorPicker(hasActiveCell ? 'Cell text' : 'Grid text', hasActiveCell ? selectedGridCellStyle?.color ?? selectedItem.color ?? '#000000' : selectedItem.color ?? '#000000', setSelectedTextColor)
        } else if (selectedItem.type === 'note') {
            colorControls = renderColorPicker('Note', selectedItem.color ?? notePalette[0], setSelectedItemColor, notePalette)
        } else if (selectedItem.type === 'stroke' || selectedItem.type === 'shape') {
            colorControls = renderColorPicker('Selected item', selectedItem.color ?? '#253c37', setSelectedItemColor)
        }

        const isGrid = selectedItem.type === 'grid'
        return <div className={`selection-toolbar selected-element-toolbar${isGrid ? ' grid-selection-toolbar' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
            <span>Selected element</span>
            {colorControls}
            {selectedItem.type === 'shape' && selectedItem.shape !== 'line' && selectedItem.shape !== 'arrow' && renderShapeFillControls(Boolean(selectedItem.fillColor), selectedItem.fillColor ?? shapeFillColor, setSelectedShapeFill, setSelectedShapeFillColor)}
            {selectedItem.type === 'shape' && selectedItem.shape === 'line' && <><button className={selectedItem.startArrow ? 'active' : ''} title="Toggle start arrowhead" aria-label="Toggle start arrowhead" aria-pressed={Boolean(selectedItem.startArrow)} onClick={() => toggleLineArrow('start')}><ArrowLeft size={15} /></button><button className={selectedItem.endArrow ? 'active' : ''} title="Toggle end arrowhead" aria-label="Toggle end arrowhead" aria-pressed={Boolean(selectedItem.endArrow)} onClick={() => toggleLineArrow('end')}><MoveRight size={15} /></button></>}
            {selectedItem.type === 'grid' && <>
                <span className="grid-size-label">{selectedItem.cols ?? 3}×{selectedItem.rows ?? 3}</span>
                <div className="grid-size-row">
                    <button title="Remove a column" aria-label="Remove a column" onClick={() => resizeGrid(selectedItem.id, selectedItem.rows ?? 3, (selectedItem.cols ?? 3) - 1)}>Cols-</button>
                    <button title="Add a column" aria-label="Add a column" onClick={() => resizeGrid(selectedItem.id, selectedItem.rows ?? 3, (selectedItem.cols ?? 3) + 1)}>Cols+</button>
                </div>
                <div className="grid-size-row">
                    <button title="Remove a row" aria-label="Remove a row" onClick={() => resizeGrid(selectedItem.id, (selectedItem.rows ?? 3) - 1, selectedItem.cols ?? 3)}>Rows-</button>
                    <button title="Add a row" aria-label="Add a row" onClick={() => resizeGrid(selectedItem.id, (selectedItem.rows ?? 3) + 1, selectedItem.cols ?? 3)}>Rows+</button>
                </div>
            </>}
            {!isGrid && <>
                <button title="Make smaller" aria-label="Make smaller" onClick={() => scaleSelectedItem(0.85)}><Minus size={15} /></button>
                <button title="Make larger" aria-label="Make larger" onClick={() => scaleSelectedItem(1.15)}><Plus size={15} /></button>
            </>}
            <button title="Duplicate selected element (Ctrl/Cmd+D)" aria-label="Duplicate selected element" onClick={duplicateSelectedItem}><Copy size={15} /></button>
            <button className="delete-selection" title="Delete selected element" aria-label="Delete selected element" onClick={deleteSelectedItem}><Trash2 size={15} /></button>
        </div>
    }

    function renderSizePicker(tool: SizedTool): ReactNode {
        const label = tool === 'eraser' ? 'Eraser size' : 'Stroke thickness'
        return <div className="stroke-size-options" role="radiogroup" aria-label={label}>
            {sizePresets[tool].map((size, index) => <button key={size} type="button" role="radio" aria-checked={toolSizes[tool] === size} className={toolSizes[tool] === size ? 'active' : ''} aria-label={`${label} ${index + 1} of 6`} title={`${label} ${index + 1}`} onClick={() => setToolSizes((sizes) => ({ ...sizes, [tool]: size }))}>
                <span style={{ width: Math.min(18, Math.max(2, size / (tool === 'eraser' ? 3.5 : tool === 'highlighter' ? 2.6 : 1.4))), height: Math.min(18, Math.max(2, size / (tool === 'eraser' ? 3.5 : tool === 'highlighter' ? 2.6 : 1.4))) }} />
            </button>)}
        </div>
    }

    function renderToolColorToolbar(): ReactNode {
        if (selectedItem || !['pen', 'brush', 'highlighter', 'eraser', 'shape', 'text'].includes(activeTool)) return null
        if (activeTool === 'eraser') {
            return <div className="selection-toolbar color-only-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                <span>Eraser</span>
                {renderSizePicker('eraser')}
            </div>
        }
        const sizedTool = sizedTools.includes(activeTool as SizedTool) ? activeTool as SizedTool : null
        const toolLabel = activeTool === 'shape' ? 'New shape' : activeTool === 'text' ? 'New text' : 'Ink'
        if (activeTool === 'shape' && showToolOptions) {
            const shapes = [
                { id: 'circle', label: 'Circle', icon: Circle },
                { id: 'square', label: 'Square', icon: Square },
                { id: 'triangle', label: 'Triangle', icon: Triangle },
                { id: 'line', label: 'Line', icon: Minus },
                { id: 'arrow', label: 'Arrow', icon: ArrowRight },
            ] as const
            return <div className="selection-toolbar shape-tool-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                <span>New shape</span>
                <div className="shape-tool-columns">
                    <div className="shape-tool-column">
                        <span>Shape</span>
                        <div className="shape-tool-shapes" aria-label="Choose a shape">
                            {shapes.map(({ id: shape, label, icon: Icon }) => <button key={shape} className={selectedShape === shape ? 'active' : ''} aria-label={`${label} shape`} title={label} aria-pressed={selectedShape === shape} onClick={() => setSelectedShape(shape)}><Icon size={16} /></button>)}
                        </div>
                    </div>
                    <div className="shape-tool-column">
                        <span>Color</span>
                        {renderColorPicker('Ink', ink, setInk)}
                    </div>
                </div>
                {selectedShape !== 'line' && selectedShape !== 'arrow' && renderShapeFillControls(shapeFillEnabled, shapeFillColor, setShapeFillEnabled, setShapeFillColor)}
            </div>
        }
        return <div className="selection-toolbar color-only-toolbar" onPointerDown={(event) => event.stopPropagation()}>
            <span>{toolLabel}</span>
            {renderColorPicker('Ink', ink, setInk)}
            {sizedTool && renderSizePicker(sizedTool)}
        </div>
    }

    function renderBoardItem(item: BoardItem): ReactNode {
        const scale = item.scale ?? 1
        if (item.type === 'stroke') return <path d={smoothPath(item.points)} fill="none" stroke={item.color} strokeWidth={item.width} strokeOpacity={item.opacity} strokeLinecap="round" strokeLinejoin="round" />
        if (item.type === 'text') {
            const bounds = getItemBounds(item)
            const lineSize = item.size * scale
            const align = item.align ?? 'center'
            const anchorX = align === 'left' ? bounds.left : align === 'right' ? bounds.left + bounds.width : bounds.left + bounds.width / 2
            return <>{item.text.split('\n').map((line, index) => <text key={index} x={anchorX} y={bounds.top + lineSize * 0.75 + index * lineSize * TEXT_LINE_HEIGHT} textAnchor={align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'} dominantBaseline="central" fill={item.color} fontSize={lineSize} fontFamily={item.fontFamily ?? defaultTextFont}>{line}</text>)}</>
        }
        if (item.type === 'note') return <foreignObject x={item.left * 10} y={item.top * 6.2} width={190 * scale} height={170 * scale}><div className={`board-sticky${item.id.startsWith(DECK_ITEM_PREFIX) ? ' deck-sticky' : ''}`} style={{ backgroundColor: item.color ?? notePalette[0], fontSize: `${(item.fontSize ?? 14) * scale}px`, fontFamily: item.fontFamily ?? defaultTextFont }}>{item.text}</div></foreignObject>
        if (item.type === 'shape') {
            if (item.shape === 'circle') return <circle cx={item.left * 10} cy={item.top * 6.2} r={46 * scale} fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" />
            if (item.shape === 'rectangle') return <rect x={item.left * 10} y={item.top * 6.2} width={125 * scale} height={78 * scale} rx="8" fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${item.left * 10 + 62.5 * scale} ${item.top * 6.2 + 39 * scale})`} />
            if (item.shape === 'square') return <rect x={item.left * 10} y={item.top * 6.2} width={92 * scale} height={92 * scale} rx="8" fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${item.left * 10 + 46 * scale} ${item.top * 6.2 + 46 * scale})`} />
            if (item.shape === 'triangle') return <polygon points={`${item.left * 10 + 62.5 * scale},${item.top * 6.2} ${item.left * 10 + 125 * scale},${item.top * 6.2 + 78 * scale} ${item.left * 10},${item.top * 6.2 + 78 * scale}`} fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${item.left * 10 + 62.5 * scale} ${item.top * 6.2 + 39 * scale})`} />
            const { start, end } = getLineEndpoints(item)
            const startMarkerId = `line-start-${item.id}`
            const endMarkerId = `line-end-${item.id}`
            return <g>
                <defs>
                    {item.startArrow && <marker id={startMarkerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={10 * scale} markerHeight={10 * scale} markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={item.color} /></marker>}
                    {(item.endArrow || item.shape === 'arrow') && <marker id={endMarkerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={10 * scale} markerHeight={10 * scale} markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={item.color} /></marker>}
                </defs>
                <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={item.color} strokeWidth="4" markerStart={item.startArrow ? `url(#${startMarkerId})` : undefined} markerEnd={item.endArrow || item.shape === 'arrow' ? `url(#${endMarkerId})` : undefined} />
            </g>
        }
        if (item.type === 'grid') {
            const cols = item.cols ?? 3
            const rows = item.rows ?? 3
            const total = cols * rows
            return (
                <foreignObject x={item.left * 10} y={item.top * 6.2} width={294 * scale} height={184 * scale}>
                    <div className="board-grid" data-grid-id={item.id} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                        {item.values.map((value, index) => {
                            const cellStyle = item.cellStyles?.[index]
                            return <input key={index} data-grid-input={`${item.id}-${index}`} value={value} aria-label={`Grid cell ${index + 1}`} style={{ textAlign: cellStyle?.align ?? 'center', color: cellStyle?.color ?? item.color ?? '#405f51', fontSize: `${(cellStyle?.fontSize ?? item.fontSize ?? 20) * scale}px`, fontFamily: cellStyle?.fontFamily ?? item.fontFamily ?? defaultTextFont }} onFocus={() => { setSelectedItemId(item.id); setActiveGridCell({ itemId: item.id, index }) }} onChange={(event) => setGridValue(item.id, index, event.target.value)} onKeyDown={(event) => handleGridEnter(event, index, item.id, cols, total)} />
                        })}
                    </div>
                </foreignObject>
            )
        }
        if (item.type === 'image') return <foreignObject x={item.left * 10} y={item.top * 6.2} width={getImageSize(item.src).width * scale} height={getImageSize(item.src).height * scale}><img className="board-image" src={item.src || undefined} alt={item.label} draggable={false} onLoad={(event) => { if (registerImageAspect(item.src, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)) setImageSizeVersion((version) => version + 1) }} /></foreignObject>
        return <foreignObject x={item.left * 10} y={item.top * 6.2} width={300 * scale} height={220 * scale}><object className="board-pdf" data={item.src} type="application/pdf" aria-label={item.label}><div className="pdf-tile"><FileText size={28} /><span>{item.label}</span></div></object></foreignObject>
    }

    if (isSupabaseConfigured && !studentView) {
        if (!authReady) return <AuthScreen loading />
        if (!authSession) return <AuthScreen />
        if (workspaceError) return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">THERAPIST WORKSPACE</p><h1>Couldn’t load your workspace</h1><p className="auth-intro">{workspaceError}</p><button className="auth-submit" onClick={() => setWorkspaceRetry((retry) => retry + 1)}>Try again</button><button className="auth-mode-toggle" onClick={() => void signOut()}>Sign out</button></section></main>
        if (!workspaceReady) return <AuthScreen loading loadingTitle="Loading your workspace" loadingMessage="Fetching your students and lessons from Supabase." />
    }
    if (isSupabaseConfigured && studentView) {
        if (sharedLessonStatus === 'loading') return <AuthScreen loading loadingTitle="Loading your lesson" loadingMessage="Fetching this lesson from your teacher's link." />
        if (sharedLessonStatus === 'ready' && teacherAway) return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">STUDENT VIEW</p><h1>Your teacher stepped away</h1><p className="auth-intro">The lesson is still open, but your teacher has left the room for a moment, so the board is paused. Keep this page open — the lesson will continue on its own as soon as they’re back.</p></section></main>
        if (sharedLessonStatus === 'waiting') return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">STUDENT VIEW</p><h1>Waiting for your teacher</h1><p className="auth-intro">Hang tight — your teacher will let you in shortly. This page will open the lesson automatically.</p><button className="auth-submit" onClick={() => reloadSharedLessonRef.current()}>Check again</button></section></main>
        if (sharedLessonStatus === 'removed') return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">STUDENT VIEW</p><h1>{removedReason === 'ended' ? 'This lesson has ended' : 'You’ve been removed from this lesson'}</h1><p className="auth-intro">{removedReason === 'ended' ? 'Your teacher has ended the lesson. Thanks for joining! Ask them for a new link to join another session.' : 'Your teacher ended your access. If this was a mistake, ask them to let you back in — this page will reopen automatically.'}</p>{removedReason === 'removed' && <button className="auth-submit" onClick={() => reloadSharedLessonRef.current()}>Check again</button>}</section></main>
        if (sharedLessonStatus === 'error') return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">STUDENT VIEW</p><h1>This link isn’t working</h1><p className="auth-intro">{sharedLessonError}</p></section></main>
        if (!openLesson) return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div><p className="eyebrow">STUDENT VIEW</p><h1>This link isn’t working</h1><p className="auth-intro">We couldn’t find a lesson for this link.</p></section></main>
    }

    return (
        <div className="app-shell">
            <header className="topbar">
                <button className="brand" onClick={() => !studentView && setOpenLesson(null)} aria-label="Go to SkyBoard home"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></button>
                <div className="topbar-center"><span className={`workspace-dot ${authSession && !studentView ? cloudSaveStatus : 'saved'}`} role="status" title={authSession && !studentView ? (cloudSaveStatus === 'saving' ? 'Saving…' : cloudSaveStatus === 'error' ? `Not saved: ${cloudSaveError}` : 'All changes saved') : 'All changes saved'} aria-label="Save status" />{openLesson ? <>{!studentView && <><button className="crumb-link" onClick={() => setOpenLesson(null)}>My workspace</button><ChevronRight size={14} /></>}<span className="crumb-current">{openLesson.title}</span></> : <span className="crumb-current">My workspace</span>}</div>
                <div className="topbar-actions">
                    {openLesson ? <>
                        {!studentView && <div className="student-status-wrap"><button className={`icon-button student-status-button ${isFollowing ? 'connected' : ''} ${isFollowing && (studentLocked || lockedInviteIds.length > 0) ? 'locked' : ''} ${waitingInvites.length ? 'waiting' : ''}`} aria-haspopup="menu" aria-expanded={showStudentMenu} aria-label={isFollowing ? 'Student connected' : 'No student connected'} title={waitingInvites.length ? `${waitingInvites.length} waiting to join` : isFollowing ? `${studentCount} student${studentCount === 1 ? '' : 's'} connected` : 'No student connected'} onClick={() => setShowStudentMenu((open) => !open)}><Users size={17} /><span className="student-status-dot" /></button>{showStudentMenu && <><div className="student-menu-scrim" onClick={() => setShowStudentMenu(false)} /><div className="student-menu" role="menu"><div className="student-menu-status">{!shareSessionId && isSupabaseConfigured ? 'Lesson not shared yet' : isFollowing ? `${studentCount} student${studentCount === 1 ? '' : 's'} connected` : 'No student connected'}</div>
                            {waitingInvites.length > 0 && <div className="student-menu-section"><div className="student-menu-label">Waiting to join</div>{waitingInvites.map((invite) => <div className="student-menu-row" key={invite.id}><span className="invite-dot" style={{ background: invite.color }} /><span className="student-menu-name">{invite.label}</span><button className="mini primary" onClick={() => void setInviteState(invite, 'admitted')}>Admit</button><button className="mini" onClick={() => void setInviteState(invite, 'removed')}>Decline</button></div>)}</div>}
                            {connectedInvites.length > 0 && <div className="student-menu-section">{connectedInvites.map((invite) => { const locked = studentLocked || lockedInviteIds.includes(invite.id); return <div className="student-menu-row" key={invite.id}><span className="invite-dot" style={{ background: invite.color }} /><span className="student-menu-name">{invite.label}</span><button className="mini icon" disabled={studentLocked} aria-label={locked ? `Unlock ${invite.label}` : `Lock ${invite.label}`} title={locked ? 'Unlock' : 'Lock'} onClick={() => setLockedInviteIds((previous) => previous.includes(invite.id) ? previous.filter((id) => id !== invite.id) : [...previous, invite.id])}>{locked ? <Lock size={14} /> : <Unlock size={14} />}</button><button className="mini icon danger" aria-label={`Remove ${invite.label}`} title="Remove" onClick={() => void setInviteState(invite, 'removed')}><UserX size={14} /></button></div> })}</div>}
                            <button role="menuitem" onClick={() => { setShowStudentMenu(false); openShareDialog() }}><Share2 size={15} />Students &amp; links…</button>
                            <button role="menuitem" disabled={!isFollowing} onClick={() => setStudentLocked(!studentLocked)}>{studentLocked ? <Unlock size={15} /> : <Lock size={15} />}{studentCount > 1 ? (studentLocked ? 'Unlock students' : 'Lock students') : (studentLocked ? 'Unlock student' : 'Lock student')}</button><button role="menuitem" className="danger" disabled={!isFollowing} onClick={() => { setShowStudentMenu(false); void removeAllStudents() }}><UserX size={15} />{studentCount > 1 ? 'Remove students' : 'Remove student'}</button><button role="menuitem" className="danger" disabled={!shareSessionId} onClick={() => { setShowStudentMenu(false); void endLesson() }}><LogOut size={15} />End lesson</button></div></>}</div>}
                        {!studentView && <button className="icon-button" aria-label="Share lesson" title="Share lesson" onClick={openShareDialog}><Share2 size={17} /></button>}
                        {!studentView && <button className="export-button" onClick={exportPdf}><Download size={15} /> Export PDF</button>}
                    </> : authSession && !studentView ? <button className="profile-account" onClick={() => setShowProfileSettings(true)} aria-label="Edit profile settings" title="Profile settings"><span className="avatar">{profileAvatarUrl ? <img src={profileAvatarUrl} alt="" /> : profileDisplayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span className="profile-name">{profileDisplayName || authSession.user.email}</span><MoreHorizontal size={18} /></button> : <><span className="avatar">AM</span><span className="profile-name">Alex Morgan</span><button className="more-button" aria-label="Account options"><MoreHorizontal size={19} /></button></>}
                    {authSession && !studentView && <button className="icon-button auth-signout-button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>}
                </div>
            </header>

            {!studentView && openLesson && waitingInvites.length > 0 && (
                <section className="admission-banner" aria-label="Student admission requests" aria-live="polite">
                    <div className="admission-banner-summary">
                        <span className="admission-banner-icon"><Users size={18} /></span>
                        <div>
                            <strong>Waiting for admission</strong>
                            <span>{waitingInvites.length} student{waitingInvites.length === 1 ? ' is' : 's are'} waiting to join</span>
                        </div>
                    </div>
                    <div className="admission-banner-requests">
                        {waitingInvites.map((invite) => (
                            <div className="admission-request" key={invite.id}>
                                <span className="invite-dot" style={{ background: invite.color }} />
                                <strong className="admission-request-name">{invite.label}</strong>
                                <div className="admission-request-actions">
                                    <button type="button" className="admission-admit" aria-label={`Admit ${invite.label}`} onClick={() => void setInviteState(invite, 'admitted')}>Admit</button>
                                    <button type="button" className="admission-deny" aria-label={`Deny ${invite.label}`} onClick={() => void setInviteState(invite, 'removed')}>Deny</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {!openLesson ? (
                <div className="library-layout">
                    <aside className="sidebar">
                        <button className="create-primary" onClick={addLessonFromToolbar}><Plus size={17} /> New lesson <ChevronDown size={14} /></button>
                        <button className={`nav-item ${activeFolder === 'All lessons' ? 'active' : ''}`} onClick={() => setActiveFolder('All lessons')}><LayoutGrid size={17} /> All lessons <span className="nav-count">{lessons.length}</span></button>
                        <button className={`nav-item ${activeFolder === 'Shared with me' ? 'active' : ''}`} onClick={() => setActiveFolder('Shared with me')}><Users size={17} /> Shared with me</button>
                        <div className="nav-section-heading"><span>My Students</span><button onClick={startNewFolder} aria-label="Create student folder" title="Create student folder"><FolderPlus size={16} /></button></div>
                        <nav className="folder-list">
                            {orderedFolders.map((folder, index) => {
                                const parent = getFolderParent(folder)
                                const isMockFolder = (!parent && mockStudentFolders.includes(folder)) || (isMockWorkspace && !parent && mockFolderNames.has(folder))
                                return <div className={`folder-row ${parent ? 'subfolder-row' : ''}`} key={folder} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggingId) moveLesson(draggingId, folder) }}>
                                    <button className={`nav-item ${activeFolder === folder ? 'active' : ''}`} onClick={() => setActiveFolder(folder)}><Folder size={parent ? 14 : 17} className={`folder-color folder-${index % 4}`} /><span>{getFolderName(folder)}</span>{isMockFolder && <span className="demo-tag" title="Sample student">Demo</span>}</button>
                                    <div className="folder-menu-anchor"><button className="folder-more" aria-label={`Options for ${folder}`} onClick={() => setFolderMenu(folderMenu === folder ? null : folder)}><MoreHorizontal size={16} /></button>{folderMenu === folder && <div className="folder-menu">{!parent && <button onClick={() => startCreateSubfolder(folder)}><FolderPlus size={14} /> Add subfolder</button>}<button onClick={() => startRenameFolder(folder)}><Pencil size={14} /> Rename {parent ? 'folder' : 'student'}</button><button className="danger-option" onClick={() => { setDeleteConfirmation({ type: 'folder', folder }); setFolderMenu(null) }}><Trash2 size={14} /> Delete {parent ? 'folder' : 'student'}</button></div>}</div>
                                </div>
                            })}
                        </nav>
                        <div className="sidebar-bottom"><div className="storage-icon"><BookOpen size={18} /></div><div><strong>Your teaching space</strong><span>All lessons, one calm place.</span></div></div>
                    </aside>
                    <main className="library-main">
                        {isMockWorkspace && <div className="demo-banner"><Sparkles size={15} /><span>You're viewing <strong>sample students and lessons</strong> so you can explore SkyBoard. Connect Supabase to replace this demo data with your own.</span></div>}
                        <div className="library-heading-row"><div><p className="eyebrow">LESSON LIBRARY</p>{activeFolder === 'All lessons' ? <h1>Your lessons</h1> : activeFolder === 'Shared with me' ? <h1>{activeFolder}</h1> : <nav className="library-breadcrumbs" aria-label="Breadcrumb"><button onClick={() => setActiveFolder('All lessons')}>Your lessons</button><ChevronRight size={14} aria-hidden="true" />{getFolderParent(activeFolder) && <><button onClick={() => setActiveFolder(getFolderParent(activeFolder)!)}>{getFolderParent(activeFolder)}</button><ChevronRight size={14} aria-hidden="true" /></>}<span aria-current="page">{getFolderName(activeFolder)}</span></nav>}<p className="library-subtitle">A little structure makes room for big learning.</p></div><button className="folder-create-button" onClick={handleNewFolderButton}><FolderPlus size={16} /> {isStudentFolderSelected ? 'New folder' : 'New student'}</button></div>
                        <div className="library-controls"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lessons or students" aria-label="Search lessons or students" /><kbd>⌘ K</kbd></div><div className="control-right"><button className={`view-toggle ${viewMode === 'grid' ? 'selected' : ''}`} onClick={() => setViewMode('grid')} aria-label="Grid view" title="Grid view"><LayoutGrid size={17} /></button><button className={`view-toggle ${viewMode === 'list' ? 'selected' : ''}`} onClick={() => setViewMode('list')} aria-label="List view" title="List view"><List size={17} /></button><div className="sort-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSortMenuOpen(false) }}><button className="sort-button" aria-haspopup="listbox" aria-expanded={sortMenuOpen} onClick={() => setSortMenuOpen((open) => !open)}><span>{sortLabels[sortKey]}</span><ChevronDown size={15} /></button>{sortMenuOpen && <div className="sort-menu" role="listbox" aria-label="Sort lessons">{(Object.keys(sortLabels) as LessonSortKey[]).map((key) => <button key={key} role="option" aria-selected={sortKey === key} className={sortKey === key ? 'selected' : ''} onClick={() => { setSortKey(key); setSortMenuOpen(false) }}><span>{sortLabels[key]}</span>{sortKey === key && <Check size={14} />}</button>)}</div>}</div></div></div>
                        <div className="library-scroll">
                            {liveLessonIds.length > 0 && !isMockWorkspace && <section className="live-section" aria-label="Live lessons"><div className="subfolder-section-heading"><span className="live-heading"><span className="live-pulse" />Live now</span><span>{liveLessonIds.length}</span></div><div className="live-grid">{lessons.filter((lesson) => liveLessonIds.includes(lesson.id)).map((lesson) => <button type="button" className="live-card" key={lesson.id} onClick={() => openBoard(lesson)}><span className="live-badge"><span className="live-pulse" />LIVE</span><span className="live-card-copy"><strong>{lesson.title}</strong><span>{lesson.folder.split(folderSeparator, 1)[0]}</span></span><span className="live-card-action">Rejoin <ChevronRight size={15} /></span></button>)}</div></section>}
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
                            <div className="library-label-row"><span>{visibleLessons.length} lessons</span><span>Sorted by {sortLabels[sortKey]}</span></div>
                            {visibleLessons.length > 0 ? <div className={`lesson-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                                {visibleLessons.map((lesson) => {
                                    const legacyCover = lesson.id.includes('blends') ? 'blends' : lesson.id.includes('syllables') ? 'safari' : lesson.id.includes('vce') ? 'magic' : 'vowels'
                                    const cover = lesson.cover ?? legacyCover
                                    const studentFolder = lesson.folder.split(folderSeparator, 1)[0]
                                    const studentFolderIndex = orderedFolders.indexOf(studentFolder)
                                    return <article className={`lesson-card ${showFileMenu === lesson.id ? 'menu-open' : ''}`} key={lesson.id} draggable onDragStart={(event) => { setDraggingId(lesson.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', lesson.id) }} onDragEnd={() => setDraggingId(null)} onClick={() => openBoard(lesson)}>
                                        {cover === 'page' ? <div className="lesson-thumb page-preview" aria-hidden="true" style={{ background: backgroundsByPage[`${lesson.id}:0`] ?? '#fffef9' }}><svg viewBox="0 0 1000 620" preserveAspectRatio="xMidYMin slice">{(itemsByPage[`${lesson.id}:0`] ?? []).map((item) => <g key={item.id}>{renderBoardItem(item)}</g>)}</svg></div> : cover === 'custom' && lesson.coverImage ? <div className="lesson-thumb custom-cover" aria-hidden="true"><img src={lesson.coverImage} alt="" /></div> : <LessonThumbnail kind={cover} tint={lesson.color} />}
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
                                                            if (event.key === 'Escape') { event.stopPropagation(); cancelLessonRename() }
                                                        }}
                                                    />
                                                ) : <h2>{lesson.title}{(lesson.isMock || isMockWorkspace && mockLessonIds.has(lesson.id)) && <span className="demo-tag" title="Sample lesson">Demo</span>}</h2>}
                                                <div className="menu-anchor">
                                                    <button className="card-menu-button" aria-label={`Options for ${lesson.title}`} onClick={(event) => { event.stopPropagation(); setShowFileMenu(showFileMenu === lesson.id ? null : lesson.id) }}><MoreHorizontal size={18} /></button>
                                                    {showFileMenu === lesson.id && <div className="file-menu" onClick={(event) => event.stopPropagation()}>
                                                        <button onClick={() => startRenameLesson(lesson)}><Pencil size={14} /> Rename</button>
                                                        <button onClick={() => openDuplicateLessonDialog(lesson)}><Copy size={15} /> Make a copy</button>
                                                        <button onClick={() => openTagEditor(lesson)}><Tag size={14} /> Edit tags</button>
                                                        <button onClick={() => openCoverEditor(lesson)}><FileImage size={14} /> Edit cover</button>
                                                        <div className="menu-divider" />
                                                        <span className="menu-label">Move to</span>
                                                        {getOrderedFolders(folders).map((folder) => <button key={folder} onClick={() => moveLesson(lesson.id, folder)}><Folder size={14} /> {folder}</button>)}
                                                        <div className="menu-divider" />
                                                        <button className="danger-option" onClick={() => { setDeleteConfirmation({ type: 'lesson', lessonId: lesson.id }); setShowFileMenu(null) }}><Trash2 size={14} /> Delete lesson</button>
                                                    </div>}
                                                </div>
                                            </div>
                                            <div className="lesson-meta"><span className="lesson-file-icon"><NotebookTabs size={14} /></span><span>{lesson.pages.length} pages</span><span className="meta-dot">·</span><span>{lesson.updated}</span><span className={`lesson-folder${studentFolderIndex >= 0 ? ` student-folder-${studentFolderIndex % 4}` : ''}`} title={`Student: ${studentFolder}`}><Folder size={13} className={studentFolderIndex >= 0 ? `folder-color folder-${studentFolderIndex % 4}` : ''} /><span>{studentFolder}</span></span></div>
                                            {Boolean(lesson.tags?.length) && <div className="lesson-tags" aria-label={`Tags for ${lesson.title}`}>{lesson.tags?.map((tag) => <span className="lesson-tag" key={tag}>{tag}</span>)}</div>}
                                        </div>
                                    </article>
                                })}
                                <button className="new-lesson-card" onClick={openNewLessonDialog}><span className="new-lesson-icon"><Plus size={20} /></span><strong>Start with a blank lesson</strong><span>Build a new teaching moment</span></button>
                            </div> : search.trim() ? <div className="empty-state"><div className="empty-icon"><Search size={22} /></div><strong>No lessons found</strong><span>Try a different search or choose another folder.</span></div> : <div className="lesson-grid"><button className="new-lesson-card empty-folder-card" onClick={openNewLessonDialog}><span className="new-lesson-icon"><Plus size={20} /></span><strong>Create new</strong><span>{activeFolder === 'All lessons' || activeFolder === 'Shared with me' ? 'Start your first lesson' : 'This folder is empty — start a lesson here'}</span></button></div>}
                            <div className="library-footer"><span>Made for the moments when it clicks.</span><span><span className="footer-sparkle">✳</span> SkyBoard for learning</span></div>
                        </div>
                    </main>
                </div>
            ) : (
                <div className="board-layout">
                    <aside className="tool-rail" aria-label="Whiteboard tools">
                        {!studentView && <><button className="rail-back" onClick={() => setOpenLesson(null)} title="Back to library"><ArrowLeft size={18} /></button>
                            <div className="rail-divider" /></>}
                        {<>
                            {toolList.filter(({ id: toolId }) => !studentView || studentToolIds.includes(toolId)).map(({ id: toolId, label, icon: Icon }) => <button key={toolId} data-tool-id={toolId} disabled={studentView && studentLocked} className={`tool-button ${activeTool === toolId ? 'selected' : ''}`} aria-label={label} title={label} onClick={() => { if (studentView && activeTool === toolId) { setActiveTool('select'); return } setActiveTool(toolId); if (toolId !== 'select') { setSelectedItemId(null); setActiveGridCell(null) } setShowToolOptions(toolId === 'shape') }}><Icon size={19} /></button>)}
                            {!studentView && <><div className="rail-spacer" />
                                <button className={`tool-button ${showBackgrounds ? 'selected' : ''}`} aria-label="Set background" title="Set background" onClick={() => setShowBackgrounds(!showBackgrounds)}><Settings2 size={19} /></button></>}</>}
                    </aside>
                    <main className="board-main">
                        <div className={`board-toolbar ${studentView ? 'student-view-toolbar' : ''}`}>
                            <div className="board-title"><div className="board-title-icon"><NotebookTabs size={17} /></div><div>{renamingTitle ? <input className="board-title-input" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={commitOpenLessonTitleRename} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitOpenLessonTitleRename() } if (event.key === 'Escape') cancelOpenLessonTitleRename() }} /> : <strong onDoubleClick={startRenameOpenLessonTitle}>{openLesson.title}</strong>}<span>{openLesson.folder} <span className="meta-dot">·</span> Saved just now</span></div>{!studentView && <button className="title-dropdown" aria-label="Rename lesson" title="Rename lesson" onClick={startRenameOpenLessonTitle}><Pencil size={15} /></button>}</div>
                            {!studentView ? <div className="page-directory-anchor">
                                <div className="page-nav">
                                    <button className="page-nav-step" aria-label="Previous page" title="Previous page" disabled={pageIndex <= 0} onClick={() => { setPageIndex(pageIndex - 1); setSelectedItemId(null) }}><ChevronLeft size={16} /></button>
                                    <button className="page-directory-button" aria-label="Browse and manage pages" title="Browse and manage pages" aria-expanded={showPageDirectory} onClick={() => setShowPageDirectory(!showPageDirectory)}>{pageIndex + 1}/{pages.length}</button>
                                    <button className="page-nav-step" aria-label="Next page" title="Next page" disabled={pageIndex >= pages.length - 1} onClick={() => { setPageIndex(pageIndex + 1); setSelectedItemId(null) }}><ChevronRight size={16} /></button>
                                </div>
                                {showPageDirectory && openLesson && <div className="page-directory-menu" onDragOver={(event) => {
                                    if (draggedPageIndex === null) return
                                    const menu = event.currentTarget
                                    const rect = menu.getBoundingClientRect()
                                    const actionsHeight = menu.querySelector('.page-directory-actions')?.getBoundingClientRect().height ?? 0
                                    const zone = 48
                                    const topEdge = rect.top + actionsHeight
                                    if (event.clientY < topEdge + zone) menu.scrollBy({ top: -Math.ceil((topEdge + zone - event.clientY) / 3) - 4 })
                                    else if (event.clientY > rect.bottom - zone) menu.scrollBy({ top: Math.ceil((event.clientY - (rect.bottom - zone)) / 3) + 4 })
                                }}>
                                    <div className="page-directory-actions">
                                        {pageSelectionMode
                                            ? <>
                                                <span>{selectedPageIndices.length} selected</span>
                                                <button className="page-selection-action" type="button" onClick={cancelPageSelection}>Cancel</button>
                                                <button className="page-selection-action delete-selected-pages" type="button" onClick={deleteSelectedPages} disabled={selectedPageIndices.length === 0 || selectedPageIndices.length >= pages.length} title={selectedPageIndices.length >= pages.length ? 'At least one page must remain' : 'Delete selected pages'}><Trash2 size={15} /> Delete</button>
                                            </>
                                            : <>
                                                <button type="button" title="Select pages" aria-label="Select pages" onClick={startPageSelection}><Check size={16} /></button>
                                                <button type="button" title="Rename page" aria-label="Rename page" onClick={() => startRenamePage(pageIndex)}><Pencil size={16} /></button>
                                                <button type="button" title="Duplicate page" aria-label="Duplicate page" onClick={duplicatePage}><Copy size={16} /></button>
                                                <button type="button" title="Copy page to clipboard" aria-label="Copy page to clipboard" onClick={copyPage}><ClipboardCopy size={16} /></button>
                                                <button type="button" title="Paste page from clipboard" aria-label="Paste page from clipboard" onClick={() => setShowPasteDialog(true)}><ClipboardPaste size={16} /></button>
                                                <button type="button" title="Delete page" aria-label="Delete page" onClick={deletePage}><Trash2 size={16} /></button>
                                                <button type="button" className="page-selection-action" title="Add page" aria-label="Add page" onClick={addPage}><Plus size={15} /> Add page</button>
                                            </>}
                                    </div>
                                    <div className="page-directory-grid">{pages.map((page, index) => {
                                        const key = `${openLesson.id}:${index}`
                                        const selected = pageSelectionMode && selectedPageIndices.includes(index)
                                        return <div key={`${page}-${index}`} className={`page-directory-item${index === pageIndex ? ' active' : ''}${selected ? ' selected-for-deletion' : ''}${draggedPageIndex === index ? ' dragging' : ''}`}
                                            draggable={!pageSelectionMode && renamingPageIndex !== index}
                                            onDragStart={(event) => { setDraggedPageIndex(index); event.dataTransfer.effectAllowed = 'move' }}
                                            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
                                            onDrop={(event) => { event.preventDefault(); if (!pageSelectionMode && draggedPageIndex !== null) reorderPage(draggedPageIndex, index); setDraggedPageIndex(null) }}
                                            onDragEnd={() => setDraggedPageIndex(null)}>
                                            <button type="button" className="page-directory-main" title={pageSelectionMode ? `${selected ? 'Deselect' : 'Select'} ${page}` : `${page} — double-click to rename, drag to reorder`}
                                                aria-current={index === pageIndex ? 'page' : undefined}
                                                aria-pressed={pageSelectionMode ? selected : undefined}
                                                onDoubleClick={() => { if (!pageSelectionMode) startRenamePage(index) }}
                                                onClick={() => { if (pageSelectionMode) togglePageSelection(index); else { setPageIndex(index); setSelectedItemId(null) } }}>
                                                <span className="page-directory-thumb" aria-hidden="true" style={{ background: backgroundsByPage[key] ?? '#fffef9' }}><svg viewBox="0 0 1000 620" preserveAspectRatio="none">{(itemsByPage[key] ?? []).map((item) => <g key={item.id}>{renderBoardItem(item)}</g>)}</svg></span>
                                                {renamingPageIndex !== index && <span className="page-directory-label">{pageSelectionMode && <span className="page-selection-indicator" aria-hidden="true">{selected && <Check size={12} />}</span>}<span className="page-number">{String(index + 1).padStart(2, '0')}</span><span className="page-directory-name">{page}</span></span>}
                                            </button>
                                            {renamingPageIndex === index && <div className="page-directory-label page-directory-rename"><span className="page-number">{String(index + 1).padStart(2, '0')}</span><input className="page-rename-input" autoFocus value={pageRenameValue} onFocus={(event) => event.target.select()} onChange={(event) => setPageRenameValue(event.target.value)} onBlur={commitPageRename} onKeyDown={(event) => { if (event.key === 'Enter') commitPageRename(); if (event.key === 'Escape') setRenamingPageIndex(null) }} /></div>}
                                            {!pageSelectionMode && <>
                                                <button type="button" className="page-insert-before" onClick={() => insertPage(index, `Page ${index + 1}`, [])} aria-label={`Insert page before ${page}`} title={`Insert page before ${page}`}><Plus size={13} /></button>
                                                <button type="button" className="page-insert-after" onClick={() => insertPage(index + 1, `Page ${index + 2}`, [])} aria-label={`Insert page after ${page}`} title={`Insert page after ${page}`}><Plus size={13} /></button>
                                            </>}
                                        </div>
                                    })}</div>
                                </div>}
                            </div> : <div />}
                            <div className="board-toolbar-right">{!studentView && <button className={`blend-button ${showBlend ? 'active' : ''}`} onClick={() => { setShowBlend(!showBlend); setShowDeck(false) }}><AudioLines size={16} /> Blending board</button>}{!studentView && <button className={`blend-button ${showDeck ? 'active' : ''}`} aria-pressed={showDeck} onClick={() => { setShowDeck(!showDeck); setShowBlend(false) }}><Layers size={16} /> Card deck</button>}{!studentView && <><button className="icon-button" title="Add image or PDF" aria-label="Add image or PDF" onClick={() => imageInputRef.current?.click()}><ImagePlus size={18} /></button><button className="google-image-button" title="Search Google Images" aria-label="Search Google Images" onClick={() => setShowImageSearch(true)}><Globe size={16} /></button><input ref={imageInputRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={handleImage} /><button className="icon-button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}><Undo2 size={18} /></button><button className="icon-button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}><Redo2 size={18} /></button></>}</div>
                        </div>
                        <div className="canvas-workspace" ref={workspaceRef}>
                            {studentView && studentLocked && <div className="student-lock-overlay" role="status"><Lock size={16} /> Your teacher has paused interaction</div>}
                            {showBackgrounds && <div className="background-panel"><div className="panel-heading"><strong>Page background</strong><button onClick={() => setShowBackgrounds(false)} aria-label="Close background panel"><X size={16} /></button></div><div className="background-options"><button className={`background-swatch blank${background === '#fffef9' ? ' selected' : ''}`} onClick={() => setPageBackground('#fffef9')}><span />Blank</button><button className={`background-swatch lined${background === 'repeating-linear-gradient(to bottom, #fffef9 0 34px, #e5ece8 35px 36px)' ? ' selected' : ''}`} onClick={() => setPageBackground('repeating-linear-gradient(to bottom, #fffef9 0 34px, #e5ece8 35px 36px)')}><span />Lined</button><button className={`background-swatch grid-bg${background === 'radial-gradient(#b9c5bf 1.2px, transparent 1.4px) 0 0 / 24px 24px, #fffef9' ? ' selected' : ''}`} onClick={() => setPageBackground('radial-gradient(#b9c5bf 1.2px, transparent 1.4px) 0 0 / 24px 24px, #fffef9')}><span />Grid</button></div><div className="panel-divider" /><span className="panel-small-label">PASTEL COLORS</span><div className="background-colors">{['#fdeef2', '#fff4da', '#eaf6e6', '#e3f1fb', '#f1ebfa', '#fce8e8'].map((color) => <button key={color} className={background === color ? 'selected' : ''} aria-pressed={background === color} style={{ background: color }} onClick={() => setPageBackground(color)} aria-label={`Set ${color} background`} title={`Set ${color} background`}><Check size={14} /></button>)}</div><span className="panel-small-label">SOLID COLORS</span><div className="background-colors">{['#f4a6b8', '#f7c948', '#8fd19e', '#7fb8e6', '#b79ae0', '#d9dedb'].map((color) => <button key={color} className={background === color ? 'selected' : ''} aria-pressed={background === color} style={{ background: color }} onClick={() => setPageBackground(color)} aria-label={`Set ${color} background`} title={`Set ${color} background`}><Check size={14} /></button>)}</div><button className="upload-background" onClick={() => backgroundInputRef.current?.click()}><FileImage size={16} /> Upload image background</button><input ref={backgroundInputRef} type="file" accept="image/*" hidden onChange={(event) => void handleBackgroundImage(event)} />{backgroundLibraryError && <p className="form-error" role="alert">{backgroundLibraryError}</p>}{backgroundLibrary.length > 0 && <div className="background-library"><span className="panel-small-label">YOUR BACKGROUNDS</span>{[...new Set(backgroundLibrary.map((entry) => entry.group))].sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || a.localeCompare(b)).map((group) => <div key={group} className="background-library-group" role="group" aria-label={group || 'Ungrouped'}>{group && <span className="background-library-group-name">{group}</span>}<div className="background-library-grid">{backgroundLibrary.filter((entry) => entry.group === group).map((entry) => <div key={entry.id} className="background-library-item"><button type="button" title={`Use ${entry.name}`} aria-label={`Use ${entry.name} background`} style={{ backgroundImage: `url("${entry.image}")` }} onClick={() => { setBackgroundDraft({ src: entry.image, fit: 'fill', scope: backgroundScope, libraryId: entry.id, name: entry.name, group: entry.group, newGroup: '' }); setShowBackgrounds(false) }} /><button type="button" className="background-library-remove" title={`Remove ${entry.name} from library`} aria-label={`Remove ${entry.name} from library`} onClick={() => void deleteLibraryBackground(entry)}><X size={12} /></button></div>)}</div></div>)}</div>}<div className="panel-divider" /><span className="panel-small-label">APPLY TO</span><div className="background-scope"><button className={backgroundScope === 'current' ? 'active' : ''} onClick={() => setBackgroundScope('current')}>Current page</button><button className={backgroundScope === 'all' ? 'active' : ''} onClick={() => setBackgroundScope('all')}>All pages in lesson</button></div></div>}
                            {showDeck && <CardDeck readOnly={studentView} tile={remoteDeckTile} config={deckConfig} session={deckSession} onSessionChange={setDeckSession} onConfigChange={(cardDeck) => { if (cardDeck.ready) syncDeckPage(cardDeck.tiles); else if (!cardDeck.tiles.length) removeDeckPage(); const lessonId = openLesson?.id; if (lessonId) setLessons((previous) => previous.map((lesson) => lesson.id === lessonId ? { ...lesson, cardDeck } : lesson)) }} onClose={() => setShowDeck(false)} />}
                            {showBlend && <BlendingBoard tiles={blendTiles} setTiles={setBlendTiles} strokes={blendStrokes} setStrokes={setBlendStrokes} onDraft={(draft) => sendLive('draft', draft ? { ...draft, blend: true } : { blend: true, points: '' })} remoteDraft={remoteBlendDraft} onClose={() => setShowBlend(false)} readOnly={studentView} color={blendColor} onColorChange={studentView ? undefined : setBlendColor} />}
                            <div className="tool-options-stack" style={{ top: toolOptionsTop }}>
                                {renderSelectedItemToolbar()}
                                {renderToolColorToolbar()}
                                {!studentView && selectedItem?.type === 'grid' && activeGridCell && activeGridCell.itemId === selectedItem.id && <div className="grid-text-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                                    <span>Cell {activeGridCell.index + 1}</span>
                                    <div className="grid-scope-group" role="radiogroup" aria-label="Apply text and alignment to">
                                        {(['cell', 'row', 'column'] as const).map((scope) => <button key={scope} type="button" role="radio" aria-checked={gridScope === scope} className={gridScope === scope ? 'active' : ''} title={`Apply to ${scope}`} aria-label={`Apply to ${scope}`} onClick={() => setGridScope(scope)}>{scope[0].toUpperCase() + scope.slice(1)}</button>)}
                                    </div>
                                    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([align, Icon]) => <button key={align} type="button" className={(selectedGridCellStyle?.align ?? 'center') === align ? 'active' : ''} title={`Align ${gridScope} ${align}`} aria-label={`Align ${gridScope} ${align}`} onClick={() => setGridScopeAlign(align)}><Icon size={14} /></button>)}
                                    <button type="button" title="Decrease cell text size" aria-label="Decrease cell text size" onClick={() => adjustSelectedTextSize(-2)}><Minus size={14} /></button>
                                    <span className="size-readout">{selectedGridCellStyle?.fontSize ?? selectedItem.fontSize ?? 20}px</span>
                                    <button type="button" title="Increase cell text size" aria-label="Increase cell text size" onClick={() => adjustSelectedTextSize(2)}><Plus size={14} /></button>
                                    <select className="selection-font-picker" value={selectedGridCellStyle?.fontFamily ?? selectedItem.fontFamily ?? defaultTextFont} onChange={(event) => setSelectedFontFamily(event.target.value)} aria-label="Cell text font" title="Cell text font">{textFontOptions.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}</select>
                                </div>}
                                {!studentView && selectedItem?.type === 'note' && <div className="grid-text-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                                    <span>Note text</span>
                                    <button type="button" title="Decrease note text size" aria-label="Decrease note text size" onClick={() => adjustSelectedTextSize(-2)}><Minus size={14} /></button>
                                    <span className="size-readout">{selectedItem.fontSize ?? 14}px</span>
                                    <button type="button" title="Increase note text size" aria-label="Increase note text size" onClick={() => adjustSelectedTextSize(2)}><Plus size={14} /></button>
                                    <select className="selection-font-picker" value={selectedItem.fontFamily ?? defaultTextFont} onChange={(event) => setSelectedFontFamily(event.target.value)} aria-label="Note text font" title="Note text font">{textFontOptions.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}</select>
                                </div>}
                                {!studentView && selectedItem?.type === 'text' && <div className="text-font-toolbar" onPointerDown={(event) => event.stopPropagation()}><label htmlFor="selected-text-font">Font</label><select id="selected-text-font" className="selection-font-picker" value={selectedItem.fontFamily ?? defaultTextFont} onChange={(event) => setSelectedFontFamily(event.target.value)} aria-label="Text font">{textFontOptions.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}</select>{([['left', 'Align left', AlignLeft], ['center', 'Align center', AlignCenter], ['right', 'Align right', AlignRight]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="radio" aria-checked={(selectedItem.align ?? 'center') === value} className={(selectedItem.align ?? 'center') === value ? 'active' : ''} aria-label={label} title={label} onClick={() => setSelectedTextAlign(value)}><Icon size={15} /></button>)}</div>}
                            </div>
                            <div className="board-page-area">
                                <div className="page-paper" ref={stageRef} style={{ background }} onClick={onStageClick} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp} onPointerLeave={() => setHoverVisible(false)} data-tool={activeTool} data-shape={activeTool === 'shape' ? selectedShape : undefined}>
                                    <svg className="drawing-layer" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-label="Lesson whiteboard content">
                                        {currentItems.map((item) => <g key={item.id} className="board-item" onPointerDown={(event) => { if (item.type === 'text' && item.id === editingTextId) { event.stopPropagation(); return } if (activeTool === 'select' && !studentView && (item.type === 'text' || item.type === 'note')) { const last = lastItemTapRef.current; const now = Date.now(); if (last && last.id === item.id && now - last.time < 450) { lastItemTapRef.current = null; event.stopPropagation(); itemGestureRef.current = null; setSelectedItemId(item.id); if (item.type === 'text') window.setTimeout(() => setEditingTextId(item.id), 0); else setPostitDraft({ id: item.id, left: item.left, top: item.top, text: item.text }); return } lastItemTapRef.current = { id: item.id, time: now } } beginItemGesture(event, item) }}>{item.type === 'text' && item.id === editingTextId ? (() => {
                                            const b = getItemBounds(item); const ls = item.size * (item.scale ?? 1); const w = Math.max(220, b.width + 40); const a = item.align ?? 'center'; const x = a === 'left' ? b.left - 5 : a === 'right' ? b.left + b.width + 5 - w : b.left + b.width / 2 - w / 2; return <foreignObject x={x} y={b.top + ls * 0.15 - 3} width={w} height={item.text.split('\n').length * ls * TEXT_LINE_HEIGHT + 6}><textarea
                                                className="board-text-input"
                                                autoFocus
                                                value={item.text}
                                                placeholder="Type here…"
                                                style={{ color: item.color, fontSize: `${item.size * (item.scale ?? 1)}px`, fontFamily: item.fontFamily ?? defaultTextFont, lineHeight: TEXT_LINE_HEIGHT, textAlign: item.align ?? 'center' }}
                                                onChange={(event) => updateCurrentItems((items) => items.map((candidate) => candidate.id === item.id && candidate.type === 'text' ? { ...candidate, text: event.target.value } : candidate), { recordHistory: false })}
                                                onBlur={(event) => {
                                                    const nextFocus = event.relatedTarget
                                                    if (nextFocus instanceof HTMLElement && nextFocus.closest('.selection-toolbar, .text-font-toolbar')) return
                                                    setEditingTextId(null)
                                                    if (!item.text.trim()) updateCurrentItems((items) => items.filter((candidate) => candidate.id !== item.id))
                                                }}
                                                onKeyDown={(event) => { if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) { event.preventDefault(); event.currentTarget.blur() } }}
                                            /></foreignObject>
                                        })() : renderBoardItem(item)}</g>)}
                                        {selectedItem && selectedItem.id !== editingTextId && (() => {
                                            const bounds = getItemBounds(selectedItem)
                                            const centerX = bounds.left + bounds.width / 2
                                            return <g className="selection-frame">
                                                <rect x={bounds.left - 5} y={bounds.top - 5} width={bounds.width + 10} height={bounds.height + 10} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />
                                                {selectedItem.type === 'shape' && selectedItem.shape !== 'circle' && <>
                                                    <line x1={centerX} y1={bounds.top - 5} x2={centerX} y2={bounds.top - 19} stroke="var(--accent)" strokeWidth="2" pointerEvents="none" />
                                                    <foreignObject x={centerX - 12} y={bounds.top - 43} width="24" height="24"><button type="button" className="selection-rotate-handle" title="Rotate shape" aria-label="Rotate shape" onPointerDown={rotateFromHandle}><RotateCw size={13} /></button></foreignObject>
                                                </>}
                                                {selectedItem.type === 'image' && !studentView && <foreignObject x={bounds.left + bounds.width - 19} y={bounds.top - 43} width="24" height="24"><button type="button" className="selection-rotate-handle" title="Crop image" aria-label="Crop image" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCropQueue([{ src: selectedItem.src, label: selectedItem.label, left: selectedItem.left, top: selectedItem.top, itemId: selectedItem.id }])}><Crop size={13} /></button></foreignObject>}
                                                <rect className="selection-move-handle" x={centerX - 17} y={bounds.top - 15} width="34" height="12" rx="4" onPointerDown={(event) => beginItemGesture(event, selectedItem)} />
                                                {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((handle) => {
                                                    const cx = handle.endsWith('right') ? bounds.left + bounds.width + 5 : bounds.left - 5
                                                    const cy = handle.startsWith('bottom') ? bounds.top + bounds.height + 5 : bounds.top - 5
                                                    const cursor = handle === 'top-left' || handle === 'bottom-right' ? '' : ' selection-resize-handle-nesw'
                                                    return <circle key={handle} className={`selection-resize-handle${cursor}`} cx={cx} cy={cy} r="8" aria-label={`Resize from ${handle.replace('-', ' ')}`} onPointerDown={(event) => resizeFromHandle(event, handle)} />
                                                })}
                                            </g>
                                        })()}
                                        {lineDraft && <line x1={lineDraft.start[0]} y1={lineDraft.start[1]} x2={lineDraft.end[0]} y2={lineDraft.end[1]} stroke={ink} strokeWidth="4" />}
                                        {hoverVisible && !drawing && sizedTools.includes(activeTool as SizedTool) && (activeTool === 'eraser'
                                            ? <circle className="eraser-cursor" ref={hoverCursorRef} cx={hoverPosRef.current[0]} cy={hoverPosRef.current[1]} r={toolSizes.eraser / 2} pointerEvents="none" />
                                            : <circle className="brush-cursor" ref={hoverCursorRef} cx={hoverPosRef.current[0]} cy={hoverPosRef.current[1]} r={toolSizes[activeTool as SizedTool] / 2} fill={ink} fillOpacity={toolOpacity[activeTool as SizedTool]} pointerEvents="none" />)}
                                        {currentPoints && drawing && activeTool === 'eraser' && (() => {
                                            const erasePoints = parsePoints(currentPoints)
                                            const [lastX, lastY] = erasePoints[erasePoints.length - 1]
                                            return <circle className="eraser-cursor" cx={lastX} cy={lastY} r={toolSizes.eraser / 2} pointerEvents="none" />
                                        })()}
                                        {currentPoints && (drawing || activeTool === 'laser') && activeTool !== 'eraser' && <path className={activeTool === 'laser' ? `laser-stroke${laserFading ? ' fading' : ''}` : ''} d={smoothPath(currentPoints)} fill="none" stroke={activeTool === 'laser' ? '#ef6b58' : ink} strokeWidth={toolSizes[activeTool as SizedTool] ?? 3} strokeOpacity={toolOpacity[activeTool as SizedTool] ?? 1} strokeLinecap="round" strokeLinejoin="round" />}
                                        {remoteDraft && remoteDraft.pageIndex === pageIndex && remoteDraft.kind !== 'ink' && (() => {
                                            const remotePoints = parsePoints(remoteDraft.points)
                                            const [lastX, lastY] = remotePoints[remotePoints.length - 1]
                                            return remoteDraft.kind === 'eraser'
                                                ? <circle className="eraser-cursor" cx={lastX} cy={lastY} r={remoteDraft.width / 2} pointerEvents="none" />
                                                : <circle cx={lastX} cy={lastY} r={9} fill="#ef6b58" fillOpacity={0.85} pointerEvents="none" />
                                        })()}
                                        {remoteDraft && remoteDraft.pageIndex === pageIndex && remoteDraft.kind === 'ink' && <path d={smoothPath(remoteDraft.points)} fill="none" stroke={remoteDraft.color} strokeWidth={remoteDraft.width} strokeOpacity={remoteDraft.opacity} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
                                    </svg>
                                    {!studentView && Object.entries(studentCursors).filter(([, cursor]) => cursor.pageIndex === pageIndex).map(([inviteId, cursor]) => <div key={inviteId} className="live-student-cursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, color: cursor.color }}><MousePointer2 size={18} fill="currentColor" /><span>{cursor.name}</span></div>)}
                                    <div className="page-corner-label">{openLesson.folder.toUpperCase()} <span>✳</span></div>
                                </div>
                            </div>
                        </div>
                    </main>
                </div>
            )}
            {showPasteDialog && openLesson && !studentView && (
                <div className="modal-scrim" onClick={() => setShowPasteDialog(false)}>
                    <div className="share-modal paste-modal" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setShowPasteDialog(false) }}>
                        <button type="button" className="modal-close" onClick={() => setShowPasteDialog(false)} aria-label="Close"><X size={18} /></button>
                        <div className="share-modal-icon"><ClipboardPaste size={20} /></div>
                        <h2>Paste a page</h2>
                        <p>Choose a copied page to insert after page {pageIndex + 1}.</p>
                        {clipboardPages.length === 0 ? <p className="paste-empty">No copied pages yet. Use the copy button on a page first.</p> : (
                            <ul className="paste-list">
                                {clipboardPages.map((entry) => (
                                    <li key={entry.id}>
                                        <button type="button" className="paste-entry" onClick={() => pasteClipboardPage(entry)}>
                                            <div className="paste-thumb" aria-hidden="true" style={{ background: entry.background ?? '#fffef9' }}><svg viewBox="0 0 1000 620" preserveAspectRatio="none">{entry.items.map((item) => <g key={item.id}>{renderBoardItem(item)}</g>)}</svg></div>
                                            <div className="paste-info">
                                                <strong>{entry.name}</strong>
                                                <span>{entry.sourceLesson} · {entry.items.length} item{entry.items.length === 1 ? '' : 's'} · {new Date(entry.copiedAt).toLocaleString()}</span>
                                            </div>
                                        </button>
                                        <button type="button" className="paste-remove" aria-label={`Remove ${entry.name} from clipboard`} onClick={() => setClipboardPages((previous) => previous.filter((item) => item.id !== entry.id))}><Trash2 size={14} /></button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="new-lesson-actions">
                            {clipboardPages.length > 0 && <button type="button" className="cancel-button" onClick={() => setClipboardPages([])}>Clear clipboard</button>}
                            <button type="button" className="cancel-button" onClick={() => setShowPasteDialog(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
            {backgroundDraft && openLesson && <div className="modal-scrim" onClick={() => setBackgroundDraft(null)}><form className="share-modal background-image-modal" role="dialog" aria-modal="true" aria-label="Image background" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setBackgroundDraft(null) } }} onSubmit={(event) => { event.preventDefault(); void applyBackgroundDraft() }}>
                <button type="button" className="modal-close" onClick={() => setBackgroundDraft(null)} aria-label="Cancel image background"><X size={18} /></button>
                <div className="share-modal-icon"><FileImage size={20} /></div>
                <h2>Image background</h2>
                <p>Choose how the image fits the page.</p>
                <div className="background-image-body"><div className="background-image-main">
                    <div className="background-image-preview" aria-label="Background preview" style={{ background: backgroundImageCss(backgroundDraft.src, backgroundDraft.fit) }} />
                    <div className="new-lesson-field"><span>Image fit</span><div className="background-scope background-fit" role="radiogroup" aria-label="Image fit">{([['fill', 'Fill'], ['fit', 'Fit'], ['stretch', 'Stretch'], ['center', 'Center'], ['tile', 'Tile']] as const).map(([fit, label]) => <button type="button" key={fit} role="radio" aria-checked={backgroundDraft.fit === fit} className={backgroundDraft.fit === fit ? 'active' : ''} onClick={() => setBackgroundDraft({ ...backgroundDraft, fit })}>{label}</button>)}</div></div>
                </div><div className="background-image-side">
                        {!backgroundDraft.libraryId && <><label className="new-lesson-field">Save to library as<input value={backgroundDraft.name} onChange={(event) => setBackgroundDraft({ ...backgroundDraft, name: event.target.value })} maxLength={80} /></label>
                            <label className="new-lesson-field">Group<select value={backgroundDraft.group} onChange={(event) => setBackgroundDraft({ ...backgroundDraft, group: event.target.value })}><option value="">No group</option>{[...new Set(backgroundLibrary.map((entry) => entry.group).filter(Boolean))].map((group) => <option key={group} value={group}>{group}</option>)}<option value="__new__">New group…</option></select></label>
                            {backgroundDraft.group === '__new__' && <label className="new-lesson-field">New group name<input value={backgroundDraft.newGroup} onChange={(event) => setBackgroundDraft({ ...backgroundDraft, newGroup: event.target.value })} maxLength={60} /></label>}</>}
                        <div className="new-lesson-field"><span>Apply to</span><div className="background-scope background-fit" role="radiogroup" aria-label="Apply to"><button type="button" role="radio" aria-checked={backgroundDraft.scope === 'current'} className={backgroundDraft.scope === 'current' ? 'active' : ''} onClick={() => setBackgroundDraft({ ...backgroundDraft, scope: 'current' })}>Current page</button><button type="button" role="radio" aria-checked={backgroundDraft.scope === 'all'} className={backgroundDraft.scope === 'all' ? 'active' : ''} onClick={() => setBackgroundDraft({ ...backgroundDraft, scope: 'all' })}>All pages in lesson</button></div></div>
                    </div></div>
                {backgroundDraft.error && <p className="form-error" role="alert">{backgroundDraft.error}</p>}
                <div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setBackgroundDraft(null)}>Cancel</button><button type="submit" className="confirm-button" disabled={backgroundDraft.busy || (backgroundDraft.group === '__new__' && !backgroundDraft.newGroup.trim())}>{backgroundDraft.busy ? 'Saving…' : 'Set background'}</button></div>
            </form></div>}
            {postitDraft && <div className="modal-scrim" onClick={() => setPostitDraft(null)}><form className="share-modal postit-editor-modal" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setPostitDraft(null) } }} onSubmit={(event) => { event.preventDefault(); const text = postitDraft.text.trim(); if (!text) return; if (postitDraft.id) { const noteId = postitDraft.id; updateCurrentItems((items) => items.map((candidate) => candidate.id === noteId && candidate.type === 'note' ? { ...candidate, text } : candidate)); setPostitDraft(null); return } addBoardItem({ id: id(), type: 'note', left: postitDraft.left, top: postitDraft.top, text }); setPostitDraft(null) }}><button type="button" className="modal-close" onClick={() => setPostitDraft(null)} aria-label="Close note editor"><X size={18} /></button><div className="share-modal-icon"><StickyNote size={20} /></div><h2>{postitDraft.id ? 'Edit sticky note' : 'Add a sticky note'}</h2><p>Write a reminder for this lesson page.</p><label className="new-lesson-field">Note text<textarea className="postit-textarea" autoFocus value={postitDraft.text} onChange={(event) => setPostitDraft((draft) => draft ? { ...draft, text: event.target.value } : draft)} /></label><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setPostitDraft(null)}>Cancel</button><button type="submit" className="confirm-button" disabled={!postitDraft.text.trim()}><StickyNote size={15} /> {postitDraft.id ? 'Save note' : 'Add note'}</button></div></form></div>}
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
                                        {option.id === 'page' ? <div className="lesson-thumb page-preview cover-option-preview" aria-hidden="true"><svg viewBox="0 0 1000 620" preserveAspectRatio="none" /></div> : <LessonThumbnail kind={option.id} tint={option.tint} />}
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
            {copyingLesson && (
                <div className="modal-scrim" onClick={() => setCopyingLessonId(null)}>
                    <form
                        className="share-modal new-lesson-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="copy-lesson-title"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => { if (event.key === 'Escape') setCopyingLessonId(null) }}
                        onSubmit={(event) => { event.preventDefault(); duplicateLesson(copyingLesson, copyDestinationFolder) }}
                    >
                        <button type="button" className="modal-close" onClick={() => setCopyingLessonId(null)} aria-label="Close"><X size={18} /></button>
                        <div className="share-modal-icon"><Copy size={20} /></div>
                        <h2 id="copy-lesson-title">Make a copy</h2>
                        <p>Choose where to create a copy of “{copyingLesson.title}”.</p>
                        <label className="new-lesson-field">
                            Student or folder
                            <select value={copyDestinationFolder} onChange={(event) => setCopyDestinationFolder(event.target.value)}>
                                {copyDestinationFolders.map((folder) => <option key={folder} value={folder}>{getFolderParent(folder) ? `${'  '.repeat(folder.split(' / ').length - 1)}${getFolderName(folder)}` : folder}</option>)}
                            </select>
                        </label>
                        <div className="new-lesson-actions">
                            <button type="button" className="cancel-button" onClick={() => setCopyingLessonId(null)}>Cancel</button>
                            <button type="submit" className="confirm-button" disabled={!copyDestinationFolder}><Copy size={15} /> Make a copy</button>
                        </div>
                    </form>
                </div>
            )}
            {deleteConfirmation && (() => {
                const isStudentDeletion = deleteConfirmation.type === 'folder' && !getFolderParent(deleteConfirmation.folder)
                const deleteName = deleteConfirmation.type === 'lesson'
                    ? lessons.find((lesson) => lesson.id === deleteConfirmation.lessonId)?.title ?? 'this lesson'
                    : getFolderName(deleteConfirmation.folder)
                const affectedLessons = deleteConfirmation.type === 'folder'
                    ? lessons.filter((lesson) => folderIsWithin(lesson.folder, deleteConfirmation.folder)).length
                    : 0
                const description = deleteConfirmation.type === 'lesson'
                    ? `“${deleteName}” will be deleted.`
                    : isStudentDeletion
                        ? `Deleting ${deleteName} will also delete ${affectedLessons} ${affectedLessons === 1 ? 'lesson' : 'lessons'} belonging to this student.`
                        : `“${deleteName}” will be deleted${affectedLessons ? ` and its ${affectedLessons} ${affectedLessons === 1 ? 'lesson will' : 'lessons will'} be moved to the parent folder` : ''}.`
                return <div className="modal-scrim" onClick={() => setDeleteConfirmation(null)}>
                    <section className="share-modal delete-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description" onClick={(event) => event.stopPropagation()}>
                        <div className="share-modal-icon delete-confirmation-icon"><Trash2 size={20} /></div>
                        <h2 id="delete-confirmation-title">Delete {deleteConfirmation.type === 'lesson' ? 'lesson' : isStudentDeletion ? 'student' : 'folder'}?</h2>
                        <p id="delete-confirmation-description">{description} This action cannot be undone.</p>
                        <div className="new-lesson-actions">
                            <button type="button" className="cancel-button" autoFocus onClick={() => setDeleteConfirmation(null)}>Cancel</button>
                            <button type="button" className="delete-confirm-button" onClick={confirmDelete}><Trash2 size={14} /> Delete</button>
                        </div>
                    </section>
                </div>
            })()}
            {showStudentFolderDialog && <div className="modal-scrim" onClick={() => setShowStudentFolderDialog(false)}><form className="share-modal subfolder-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); createStudentFolder() }}><button type="button" className="modal-close" onClick={() => setShowStudentFolderDialog(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><FolderPlus size={20} /></div><h2>New student folder</h2><p>Create a folder to organize one student.</p><label className="new-lesson-field">Student name<input autoFocus required value={subfolderName} onChange={(event) => setSubfolderName(event.target.value)} placeholder="e.g. Maya" /></label><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setShowStudentFolderDialog(false)}>Cancel</button><button type="submit" className="confirm-button" disabled={!subfolderName.trim()}><FolderPlus size={15} /> Create folder</button></div></form></div>}
            {renamingFolder && <div className="modal-scrim" onClick={() => setRenamingFolder(null)}><form className="share-modal subfolder-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); commitFolderRename() }}><button type="button" className="modal-close" onClick={() => setRenamingFolder(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Pencil size={20} /></div><h2>Rename {getFolderParent(renamingFolder) ? 'folder' : 'student'}</h2><p>{getFolderParent(renamingFolder) ? `Inside ${getFolderParent(renamingFolder)}` : 'Update this student name and keep their folders and lessons together.'}</p><label className="new-lesson-field">{getFolderParent(renamingFolder) ? 'Folder name' : 'Student name'}<input autoFocus required value={folderRenameValue} onChange={(event) => { setFolderRenameValue(event.target.value); setFolderRenameError('') }} /></label>{folderRenameError && <p className="form-error" role="alert">{folderRenameError}</p>}<div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setRenamingFolder(null)}>Cancel</button><button type="submit" className="confirm-button" disabled={!folderRenameValue.trim()}><Pencil size={15} /> Rename</button></div></form></div>}
            {subfolderParent && <div className="modal-scrim" onClick={() => setSubfolderParent(null)}><form className="share-modal subfolder-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); createSubfolder() }}><button type="button" className="modal-close" onClick={() => setSubfolderParent(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><FolderPlus size={20} /></div><h2>New subfolder</h2><p>Inside {subfolderParent}</p><label className="new-lesson-field">Subfolder name<input autoFocus required value={subfolderName} onChange={(event) => setSubfolderName(event.target.value)} placeholder="e.g. Reading goals" /></label><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setSubfolderParent(null)}>Cancel</button><button type="submit" className="confirm-button" disabled={!subfolderName.trim()}><FolderPlus size={15} /> Create subfolder</button></div></form></div>}
            {tagEditorLesson && <div className="modal-scrim" onClick={() => setTagEditorLessonId(null)}><form className="share-modal tag-editor-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); addLessonTag() }}><button type="button" className="modal-close" onClick={() => setTagEditorLessonId(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Tag size={20} /></div><h2>Lesson tags</h2><p>{tagEditorLesson.title}</p><label className="new-lesson-field">Add a tag<input autoFocus value={newTagValue} onChange={(event) => setNewTagValue(event.target.value)} placeholder="e.g. articulation" /></label><div className="tag-editor-actions"><button type="submit" className="confirm-button" disabled={!newTagValue.trim()}><Plus size={15} /> Add tag</button></div>{tagEditorLesson.tags?.length ? <div className="tag-editor-list" aria-label="Current tags">{tagEditorLesson.tags.map((tag) => <span className="lesson-tag removable" key={tag}>{tag}<button type="button" onClick={() => removeLessonTag(tag)} aria-label={`Remove ${tag} tag`}><X size={12} /></button></span>)}</div> : <p className="tag-empty-state">No tags yet</p>}</form></div>}
            {coverEditorLesson && <div className="modal-scrim" onClick={() => setCoverEditorLessonId(null)}><div className="share-modal tag-editor-modal" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setCoverEditorLessonId(null)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><FileImage size={20} /></div><h2>Lesson cover</h2><p>{coverEditorLesson.title}</p>{coverEditorLesson.cover === 'custom' && coverEditorLesson.coverImage && <div className="cover-editor-preview"><img src={coverEditorLesson.coverImage} alt="Current cover" /></div>}<input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverUpload} /><div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setCoverEditorLessonId(null)}>Cancel</button><button type="button" className="confirm-button" onClick={() => coverInputRef.current?.click()}><ImagePlus size={15} /> Upload cover image</button></div></div></div>}
            {showProfileSettings && authSession && !studentView && <ProfileSettings userId={authSession.user.id} email={authSession.user.email ?? ''} initialDisplayName={profileDisplayName} onClose={() => setShowProfileSettings(false)} onSaved={(displayName, avatarUrl) => { setProfileDisplayName(displayName); setProfileAvatarUrl(avatarUrl) }} />}
            {printing && openLesson && <div className="print-pages">{pages.map((_, index) => <div className="print-page" key={index} style={{ background: backgroundsByPage[`${openLesson.id}:${index}`] ?? '#fffef9' }}><svg viewBox="0 0 1000 620" preserveAspectRatio="none">{(itemsByPage[`${openLesson.id}:${index}`] ?? []).map(renderBoardItem)}</svg></div>)}</div>}
            {showShare && openLesson && <div className="modal-scrim" onClick={() => setShowShare(false)}><div className="share-modal invite-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowShare(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Users size={20} /></div><h2>Bring your students in</h2><p>Give each student a personal link. They follow the page you’re teaching on.</p>
                {!isSupabaseConfigured ? <div className="share-link"><span>{shareLinkUrl}</span><button onClick={() => { void navigator.clipboard?.writeText(shareLinkUrl); setShowShare(false) }}><Copy size={15} /> Copy</button></div> : shareLinkLoading ? <p className="share-link-status">Starting your lesson room…</p> : <>
                    {shareLinkError && <p className="share-link-status error">{shareLinkError}</p>}
                    {shareSessionId && <>
                        <div className="share-live-status"><span className="live-dot" />Lesson room is live{shareExpiresAt ? ` · links expire ${new Date(shareExpiresAt).toLocaleDateString()}` : ''}</div>
                        <form className="invite-form" onSubmit={(event) => { event.preventDefault(); void addInvite() }}><input value={newInviteName} onChange={(event) => setNewInviteName(event.target.value)} placeholder="Student name, e.g. Maya" aria-label="Student name" maxLength={40} /><button type="submit"><Plus size={15} /> Add</button></form>
                        <label className="invite-approval"><input type="checkbox" checked={requireApproval} onChange={(event) => setRequireApproval(event.target.checked)} /> Ask me before a new student joins</label>
                        <div className="invite-list">{invites.length === 0 ? <p className="share-link-status">Add a student to get their personal link.</p> : invites.map((invite) => { const online = onlineInviteIds.includes(invite.id); const state = invite.status === 'removed' ? 'Removed' : invite.status === 'pending' ? (online ? 'Waiting to join' : 'Not joined yet') : online ? 'Connected' : 'Offline'; return <div className={`invite-row ${invite.status}`} key={invite.id}><span className="invite-dot" style={{ background: invite.color }} /><div className="invite-info"><strong>{invite.label}</strong><small className={online && invite.status !== 'removed' ? 'online' : ''}>{state}</small></div><button className="invite-copy" onClick={() => copyInviteLink(invite)}>{copiedInviteId === invite.id ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>{invite.status === 'pending' && online && <button className="invite-action" onClick={() => void setInviteState(invite, 'admitted')}>Admit</button>}{invite.status === 'pending' && !online && <button className="invite-action danger invite-delete" aria-label={`Delete ${invite.label}'s link`} title="Delete link" onClick={() => void deleteInvite(invite)}><Trash2 size={14} /> Delete</button>}{invite.status === 'admitted' && <button className="invite-action danger" onClick={() => void setInviteState(invite, 'removed')}>Remove</button>}{invite.status === 'removed' && <button className="invite-action" onClick={() => void setInviteState(invite, 'admitted')}>Let back in</button>}</div> })}</div>
                        <button className="end-lesson-button" onClick={() => void endLesson()}><LogOut size={15} /> End lesson for everyone</button>
                    </>}
                </>}
            </div></div>}
            {cropQueue[0] && <ImageCropDialog key={cropQueue[0].src + cropQueue.length} src={cropQueue[0].src} label={cropQueue[0].label} remaining={cropQueue.length - 1} editing={Boolean(cropQueue[0].itemId)}
                onCancel={() => setCropQueue([])}
                onSkip={() => { const pending = cropQueue[0]; if (!pending.itemId) addBoardItem({ id: id(), type: 'image', left: pending.left, top: pending.top, src: pending.src, label: pending.label }); setCropQueue((queue) => queue.slice(1)) }}
                onConfirm={(cropped) => { const pending = cropQueue[0]; if (pending.itemId) { updateCurrentItems((items) => items.map((candidate) => candidate.id === pending.itemId && candidate.type === 'image' ? { ...candidate, src: cropped, storagePath: undefined } : candidate)); setCropQueue((queue) => queue.slice(1)); return } const item: BoardItem = { id: id(), type: 'image', left: pending.left, top: pending.top, src: cropped, label: pending.label }; addBoardItem(item); setSelectedItemId(item.id); setActiveTool('select'); setShowToolOptions(false); setCropQueue((queue) => queue.slice(1)) }} />}
            {showImageSearch && <div className="modal-scrim" onClick={() => setShowImageSearch(false)}><div className="share-modal image-search-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowImageSearch(false)} aria-label="Close"><X size={18} /></button><div className="share-modal-icon"><Globe size={20} /></div><h2>Find a teaching image</h2><p>Search the web for pictures and click one to add it to your page.</p><form className="image-search-form" onSubmit={async (event) => { event.preventDefault(); const q = imageQuery.trim(); if (!q) return; setImageSearching(true); setImageSearchError(''); try { const response = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&gsrlimit=30&prop=imageinfo&iiprop=url|mime&iiurlwidth=240&format=json&origin=*`); if (!response.ok) throw new Error('search failed'); const data = await response.json(); const pages = Object.values(data.query?.pages ?? {}) as { pageid: number; index?: number; title: string; imageinfo?: { thumburl?: string; url: string; mime?: string }[] }[]; const results = pages.sort((x, y) => (x.index ?? 0) - (y.index ?? 0)).filter((page) => page.imageinfo?.[0] && /^image\/(jpeg|png|webp|gif)$/.test(page.imageinfo[0].mime ?? '')).map((page) => ({ id: String(page.pageid), thumb: page.imageinfo![0].thumburl || page.imageinfo![0].url, src: page.imageinfo![0].url, title: page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '') })); setImageResults(results); if (!results.length) setImageSearchError('No pictures found. Try another word.') } catch { setImageResults([]); setImageSearchError('Could not search right now. Check your connection or paste an image address below.') } finally { setImageSearching(false) } }}><input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder="Try: ship, shell, short i" aria-label="Search images" autoFocus /><button type="submit" disabled={imageSearching}><Search size={15} /> {imageSearching ? 'Searching' : 'Search'}</button></form>{imageSearchError && <p className="image-search-error">{imageSearchError}</p>}{imageResults.length > 0 && <div className="image-results">{imageResults.map((result) => <button type="button" key={result.id} className="image-result" title={result.title} onClick={() => { setCropQueue((queue) => [...queue, { src: result.src, label: result.title, left: 14, top: 25 }]); setShowImageSearch(false) }}><img src={result.thumb} alt={result.title} loading="lazy" /></button>)}</div>}<label className="image-url-label">OR PASTE AN IMAGE ADDRESS<input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." /></label><button type="button" className="insert-image-button" disabled={!imageUrl.trim()} onClick={() => { setCropQueue((queue) => [...queue, { src: imageUrl.trim(), label: 'Web image', left: 14, top: 25 }]); setImageUrl(''); setShowImageSearch(false) }}><ImagePlus size={15} /> Add image to page</button></div></div>}
        </div>
    )
}

export default App
