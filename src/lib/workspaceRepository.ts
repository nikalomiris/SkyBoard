import { supabase } from './supabase'
import type { BoardItem, CardDeckConfig, Lesson, MatchGameConfig, WorkspaceData } from './workspaceTypes'

const folderSeparator = ' / '
const assetBucket = 'lesson-assets'

type StudentRow = { id: string; name: string; position: number; is_mock: boolean }
type FolderRow = { id: string; student_id: string; parent_id: string | null; name: string; position: number }
type LessonRow = { id: string; student_id: string | null; folder_id: string | null; title: string; position: number; cover: string | null; cover_image: string | null; color: string; tags: string[]; card_deck: CardDeckConfig | null; match_game: MatchGameConfig | null; is_mock: boolean; updated_at: string }
type PageMetadataRow = { id: string; lesson_id: string; name: string; position: number }
type PageRow = PageMetadataRow & { elements: BoardItem[]; background: string }
type LessonPreviewRow = { lesson_id: string; background: string; elements: BoardItem[] }
type AssetRow = { storage_path: string; lesson_id: string; page_id: string | null }
const defaultBackground = '#fffef9'
const pageNameSeparator = '\u0000'

// What the database is known to hold after the last load or save; used to send only changes.
type SaveBaseline = {
    ownerId: string
    foldersKey: string
    studentIdByName: Map<string, string>
    folderIdByPath: Map<string, string>
    lessonFingerprints: Map<string, string>
    pageStructures: Map<string, string>
    pages: Map<string, { items: BoardItem[] | undefined; background: string }>
}
let baseline: SaveBaseline | null = null

function foldersKeyOf(folders: string[], lessons: Lesson[]) {
    return JSON.stringify([folders, lessons.map((lesson) => [lesson.id, lesson.folder])])
}

function lessonFingerprint(lesson: Lesson, position: number) {
    return JSON.stringify([position, lesson.title, lesson.folder, lesson.color, lesson.cover ?? null, lesson.coverImage ?? null, lesson.tags ?? [], lesson.cardDeck ?? null, lesson.matchGame ?? null])
}

type AssetWriteRow = { owner_id: string; lesson_id: string; page_id: string; storage_path: string; file_name: string; content_type: string; size_bytes: number }

function getClient() {
    if (!supabase) throw new Error('Supabase is not configured.')
    return supabase
}

function getFolderParent(folder: string) {
    const separatorIndex = folder.lastIndexOf(folderSeparator)
    return separatorIndex < 0 ? null : folder.slice(0, separatorIndex)
}

function getFolderName(folder: string) {
    const separatorIndex = folder.lastIndexOf(folderSeparator)
    return separatorIndex < 0 ? folder : folder.slice(separatorIndex + folderSeparator.length)
}

function getFolderRoot(folder: string) {
    return folder.split(folderSeparator, 1)[0]
}

function formatUpdated(value: string) {
    const updatedAt = new Date(value)
    const now = new Date()
    if (updatedAt.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (updatedAt.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return updatedAt.toLocaleDateString()
}

async function throwOnError<T>(result: { data: T | null; error: { message: string } | null }): Promise<T> {
    if (result.error) throw new Error(result.error.message)
    if (result.data === null) throw new Error('Supabase returned no data.')
    return result.data
}

async function resolveAssetUrls(items: BoardItem[], cache: Map<string, string>) {
    const client = getClient()
    return Promise.all(items.map(async (item) => {
        if ((item.type !== 'image' && item.type !== 'pdf') || !item.storagePath) return item
        let signedUrl = cache.get(item.storagePath)
        if (!signedUrl) {
            const result = await client.storage.from(assetBucket).createSignedUrl(item.storagePath, 60 * 60 * 24)
            if (result.error) {
                if (!/not found/i.test(result.error.message)) throw new Error(result.error.message)
                // The file is gone from storage; keep the item as an empty placeholder instead of blocking the whole workspace.
                console.warn(`Missing asset in storage: ${item.storagePath}`)
                return { ...item, src: '' }
            }
            signedUrl = result.data.signedUrl
            cache.set(item.storagePath, signedUrl)
        }
        return { ...item, src: signedUrl }
    }))
}

async function resolvePreviewAssetUrls(previews: LessonPreviewRow[]) {
    const client = getClient()
    const paths = [...new Set(previews.flatMap((preview) => preview.elements.flatMap((item) => (
        item.type === 'image' && item.storagePath ? [item.storagePath] : []
    ))))]
    if (!paths.length) return previews

    const result = await client.storage.from(assetBucket).createSignedUrls(paths, 60 * 60 * 24)
    if (result.error) throw new Error(result.error.message)
    const signedUrls = new Map(result.data.map((asset) => [asset.path, asset.signedUrl ?? '']))
    for (const asset of result.data) {
        if (asset.error) console.warn(`Could not create a preview URL for ${asset.path}: ${asset.error}`)
    }
    return previews.map((preview) => ({
        ...preview,
        elements: preview.elements.map((item) => item.type === 'image' && item.storagePath
            ? { ...item, src: signedUrls.get(item.storagePath) ?? '' }
            : item),
    }))
}

export async function loadWorkspace(ownerId: string): Promise<WorkspaceData> {
    const client = getClient()
    const [profileResult, studentsResult, foldersResult, lessonsResult, pagesResult, previewsResult] = await Promise.all([
        client.from('profiles').select('workspace_initialized').eq('id', ownerId).maybeSingle(),
        client.from('students').select('id,name,position,is_mock').eq('owner_id', ownerId).order('position'),
        client.from('student_folders').select('id,student_id,parent_id,name,position').eq('owner_id', ownerId).order('position'),
        client.from('lessons').select('id,student_id,folder_id,title,position,cover,cover_image,color,tags,card_deck,match_game,is_mock,updated_at').eq('owner_id', ownerId).order('position'),
        client.from('lesson_pages').select('id,lesson_id,name,position').eq('owner_id', ownerId).order('position'),
        client.rpc('get_lesson_previews'),
    ])
    if (profileResult.error) throw new Error(profileResult.error.message)
    const students = (await throwOnError(studentsResult)) as StudentRow[]
    const folderRows = (await throwOnError(foldersResult)) as FolderRow[]
    const lessonRows = (await throwOnError(lessonsResult)) as LessonRow[]
    const pageRows = (await throwOnError(pagesResult)) as PageMetadataRow[]
    const previewRows = await throwOnError(previewsResult) as LessonPreviewRow[]
    const resolvedPreviews = await resolvePreviewAssetUrls(previewRows)

    const studentById = new Map(students.map((student) => [student.id, student]))
    const folderById = new Map(folderRows.map((folder) => [folder.id, folder]))
    const childrenByParent = new Map<string, FolderRow[]>()
    for (const folder of folderRows) {
        const parentKey = `${folder.student_id}:${folder.parent_id ?? ''}`
        childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) ?? []), folder])
    }
    for (const children of childrenByParent.values()) children.sort((first, second) => first.position - second.position)
    const pathByFolderId = new Map<string, string>()
    const pathForFolder = (folderId: string, active = new Set<string>()): string => {
        const cached = pathByFolderId.get(folderId)
        if (cached) return cached
        if (active.has(folderId)) throw new Error('A cycle was found in the folder hierarchy.')
        const folder = folderById.get(folderId)
        if (!folder) throw new Error('A lesson points to a missing folder.')
        const student = studentById.get(folder.student_id)
        if (!student) throw new Error('A folder points to a missing student.')
        const nextActive = new Set(active).add(folderId)
        const parentPath = folder.parent_id ? pathForFolder(folder.parent_id, nextActive) : student.name
        const path = `${parentPath}${folderSeparator}${folder.name}`
        pathByFolderId.set(folderId, path)
        return path
    }

    const folders: string[] = []
    const addChildren = (student: StudentRow, parentId: string | null, parentPath: string) => {
        const children = childrenByParent.get(`${student.id}:${parentId ?? ''}`) ?? []
        for (const child of children) {
            const path = `${parentPath}${folderSeparator}${child.name}`
            folders.push(path)
            addChildren(student, child.id, path)
        }
    }
    for (const student of students) {
        folders.push(student.name)
        addChildren(student, null, student.name)
    }

    const pagesByLesson = new Map<string, PageMetadataRow[]>()
    for (const page of pageRows) pagesByLesson.set(page.lesson_id, [...(pagesByLesson.get(page.lesson_id) ?? []), page])
    const itemsByPage: WorkspaceData['itemsByPage'] = {}
    const backgroundsByPage: WorkspaceData['backgroundsByPage'] = {}
    const lessons: Lesson[] = lessonRows.map((row) => {
        const student = row.student_id ? studentById.get(row.student_id) : undefined
        const lessonPages = pagesByLesson.get(row.id) ?? []
        const pageNames = lessonPages.length ? lessonPages.map((page) => page.name) : ['Page 1']
        return {
            id: row.id,
            title: row.title,
            folder: row.folder_id ? pathForFolder(row.folder_id) : student?.name ?? 'Unfiled',
            pages: pageNames,
            updated: formatUpdated(row.updated_at),
            updatedAt: new Date(row.updated_at).getTime(),
            color: row.color,
            cover: row.cover as Lesson['cover'],
            coverImage: row.cover_image ?? undefined,
            tags: row.tags ?? [],
            cardDeck: row.card_deck ?? undefined,
            matchGame: row.match_game ?? undefined,
            isMock: row.is_mock,
            kind: 'lesson',
        }
    })
    for (const folder of folderRows) pathForFolder(folder.id)
    const pages = new Map<string, { items: BoardItem[] | undefined; background: string }>()
    const pageStructures = new Map<string, string>()
    for (const lesson of lessons) {
        const hasStoredPages = (pagesByLesson.get(lesson.id) ?? []).length > 0
        pageStructures.set(lesson.id, hasStoredPages ? lesson.pages.join(pageNameSeparator) : '')
    }
    baseline = {
        ownerId,
        foldersKey: foldersKeyOf(folders, lessons),
        studentIdByName: new Map(students.map((student) => [student.name.toLocaleLowerCase(), student.id])),
        folderIdByPath: new Map([...pathByFolderId.entries()].map(([folderId, path]) => [path, folderId])),
        lessonFingerprints: new Map(lessons.map((lesson, position) => [lesson.id, lessonFingerprint(lesson, position)])),
        pageStructures,
        pages,
    }

    return {
        folders,
        mockStudentFolders: students.filter((student) => student.is_mock).map((student) => student.name),
        lessons,
        itemsByPage,
        backgroundsByPage,
        previewItemsByLesson: Object.fromEntries(resolvedPreviews.map((preview) => [preview.lesson_id, preview.elements])),
        previewBackgroundsByLesson: Object.fromEntries(resolvedPreviews.map((preview) => [preview.lesson_id, preview.background])),
        initialized: profileResult.data?.workspace_initialized ?? false,
        hasData: students.length > 0 || lessonRows.length > 0,
    }
}

export async function loadLessonPages(ownerId: string, lessonId: string): Promise<Pick<WorkspaceData, 'itemsByPage' | 'backgroundsByPage'>> {
    const client = getClient()
    const result = await client.from('lesson_pages')
        .select('id,lesson_id,name,position,elements,background')
        .eq('owner_id', ownerId)
        .eq('lesson_id', lessonId)
        .order('position')
    const rows = (await throwOnError(result)) as PageRow[]
    const assetUrlCache = new Map<string, string>()
    const itemsByPage: WorkspaceData['itemsByPage'] = {}
    const backgroundsByPage: WorkspaceData['backgroundsByPage'] = {}
    const loadedPages = new Map<string, { items: BoardItem[] | undefined; background: string }>()
    for (const page of rows) {
        const key = `${lessonId}:${page.position}`
        const elements = await resolveAssetUrls(page.elements ?? [], assetUrlCache)
        if (elements.length) itemsByPage[key] = elements
        if (page.background) backgroundsByPage[key] = page.background
        loadedPages.set(key, { items: itemsByPage[key], background: backgroundsByPage[key] ?? defaultBackground })
    }

    if (baseline?.ownerId === ownerId) {
        const pages = new Map(baseline.pages)
        for (const [key, page] of loadedPages) pages.set(key, page)
        baseline = { ...baseline, pages }
    }
    return { itemsByPage, backgroundsByPage }
}

function dataUrlToBlob(dataUrl: string) {
    const [header, payload] = dataUrl.split(',', 2)
    if (!header || !payload) throw new Error('The uploaded asset has an invalid data URL.')
    const contentType = header.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream'
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return { blob: new Blob([bytes], { type: contentType }), contentType }
}

async function storeAsset(ownerId: string, lessonId: string, pageId: string, item: BoardItem, desiredPaths: Set<string>, existingAssetPaths: Set<string>, pendingAssets: Map<string, AssetWriteRow>): Promise<BoardItem> {
    if ((item.type !== 'image' && item.type !== 'pdf')) return item
    const client = getClient()
    let storagePath = item.storagePath
    let fileSize = 0
    let contentType = item.type === 'pdf' ? 'application/pdf' : 'image/jpeg'
    if (storagePath) {
        desiredPaths.add(storagePath)
        if (!existingAssetPaths.has(storagePath)) {
            const downloaded = await client.storage.from(assetBucket).download(storagePath)
            if (downloaded.error) {
                // Keep the reference to a file that is currently missing so it can be restored later.
                if (/not found/i.test(downloaded.error.message)) return { ...item, src: '', storagePath }
                throw new Error(downloaded.error.message)
            }
            fileSize = downloaded.data.size
            contentType = downloaded.data.type || contentType
            pendingAssets.set(storagePath, { owner_id: ownerId, lesson_id: lessonId, page_id: pageId, storage_path: storagePath, file_name: item.label, content_type: contentType, size_bytes: Math.max(fileSize, 1) })
        }
        return { ...item, src: `storage://${storagePath}`, storagePath }
    }
    if (!storagePath && item.src.startsWith('data:')) {
        const { blob, contentType: detectedType } = dataUrlToBlob(item.src)
        contentType = detectedType
        fileSize = blob.size
        storagePath = `${ownerId}/${lessonId}/${pageId}/${item.id}`
        const result = await client.storage.from(assetBucket).upload(storagePath, blob, { upsert: true, contentType })
        if (result.error) throw new Error(result.error.message)
    }
    if (!storagePath) return item
    desiredPaths.add(storagePath)
    pendingAssets.set(storagePath, {
        owner_id: ownerId,
        lesson_id: lessonId,
        page_id: pageId,
        storage_path: storagePath,
        file_name: item.label,
        content_type: contentType,
        size_bytes: Math.max(fileSize, 1),
    })
    return { ...item, src: `storage://${storagePath}`, storagePath }
}

async function syncStudentsAndFolders(ownerId: string, folders: string[], lessons: Lesson[], known: SaveBaseline | null) {
    const client = getClient()
    const existingStudentsResult = await client.from('students').select('id,name,position').eq('owner_id', ownerId)
    const existingStudents = (await throwOnError(existingStudentsResult)) as StudentRow[]
    const studentsByName = new Map(existingStudents.map((student) => [student.name.toLocaleLowerCase(), student]))
    const rootNames = [...new Set([
        ...folders.map((folder) => getFolderRoot(folder)),
        ...lessons.map((lesson) => getFolderRoot(lesson.folder)),
    ])]
    for (const [position, name] of rootNames.entries()) {
        let student = studentsByName.get(name.toLocaleLowerCase())
        if (!student) {
            const inserted = await client.from('students').insert({ owner_id: ownerId, name, position }).select('id,name,position').single()
            student = await throwOnError(inserted) as StudentRow
            studentsByName.set(student.name.toLocaleLowerCase(), student)
        } else if (student.position !== position) {
            const updated = await client.from('students').update({ position }).eq('id', student.id)
            if (updated.error) throw new Error(updated.error.message)
        }
    }

    const existingFoldersResult = await client.from('student_folders').select('id,student_id,parent_id,name,position').eq('owner_id', ownerId)
    const existingFolders = (await throwOnError(existingFoldersResult)) as FolderRow[]
    const existingFolderById = new Map(existingFolders.map((folder) => [folder.id, folder]))
    const existingFolderPaths = new Map<string, FolderRow>()
    const resolveExistingPath = (folderId: string, active = new Set<string>()): string => {
        const cached = [...existingFolderPaths.entries()].find(([, folder]) => folder.id === folderId)?.[0]
        if (cached) return cached
        if (active.has(folderId)) throw new Error('A cycle was found in the folder hierarchy.')
        const folder = existingFolderById.get(folderId)
        if (!folder) throw new Error('A folder parent could not be found.')
        const student = existingStudents.find((candidate) => candidate.id === folder.student_id)
        if (!student) throw new Error('A folder student could not be found.')
        const nextActive = new Set(active).add(folderId)
        const parentPath = folder.parent_id ? resolveExistingPath(folder.parent_id, nextActive) : student.name
        const path = `${parentPath}${folderSeparator}${folder.name}`
        existingFolderPaths.set(path, folder)
        return path
    }
    for (const folder of existingFolders) resolveExistingPath(folder.id)

    const nestedPaths = [...new Set([
        ...folders.filter((folder) => getFolderParent(folder)),
        ...lessons.map((lesson) => lesson.folder).filter((folder) => getFolderParent(folder)),
    ])].sort((first, second) => first.split(folderSeparator).length - second.split(folderSeparator).length)
    const folderIdByPath = new Map([...existingFolderPaths.entries()].map(([path, folder]) => [path, folder.id]))
    for (const [position, path] of nestedPaths.entries()) {
        const parentPath = getFolderParent(path)
        const parentParts = path.split(folderSeparator)
        const root = parentParts[0]
        const student = studentsByName.get(root.toLocaleLowerCase())
        if (!student || !parentPath) throw new Error(`The parent student for ${path} could not be found.`)
        const parentId = folderIdByPath.get(parentPath) ?? null
        const name = getFolderName(path)
        let existing = existingFolderPaths.get(path)
        if (!existing) {
            const inserted = await client.from('student_folders').insert({ owner_id: ownerId, student_id: student.id, parent_id: parentId, name, position }).select('id,student_id,parent_id,name,position').single()
            existing = await throwOnError(inserted) as FolderRow
            existingFolderPaths.set(path, existing)
        } else if (existing.position !== position) {
            const updated = await client.from('student_folders').update({ position }).eq('id', existing.id)
            if (updated.error) throw new Error(updated.error.message)
        }
        folderIdByPath.set(path, existing.id)
    }

    // Only rows this client has loaded or saved may be removed; anything else in the database is left alone.
    const knownFolderIds = new Set(known?.folderIdByPath.values() ?? [])
    const knownStudentIds = new Set(known?.studentIdByName.values() ?? [])
    const desiredFolderIds = new Set(folderIdByPath.values())
    const staleFolders = existingFolders.filter((folder) => knownFolderIds.has(folder.id) && !desiredFolderIds.has(folder.id)).sort((first, second) => {
        const firstPath = [...existingFolderPaths.entries()].find(([, value]) => value.id === first.id)?.[0] ?? ''
        const secondPath = [...existingFolderPaths.entries()].find(([, value]) => value.id === second.id)?.[0] ?? ''
        return secondPath.split(folderSeparator).length - firstPath.split(folderSeparator).length
    })
    const desiredStudentIds = new Set(rootNames.map((name) => studentsByName.get(name.toLocaleLowerCase())?.id).filter((value): value is string => Boolean(value)))
    const staleStudents = existingStudents.filter((student) => knownStudentIds.has(student.id) && !desiredStudentIds.has(student.id))
    return {
        studentIdByName: new Map([...studentsByName.entries()].map(([name, student]) => [name, student.id])),
        folderIdByPath,
        async removeStale() {
            for (const folder of staleFolders) {
                const deleted = await client.from('student_folders').delete().eq('id', folder.id)
                if (deleted.error) throw new Error(deleted.error.message)
            }
            for (const student of staleStudents) {
                const deleted = await client.from('students').delete().eq('id', student.id)
                if (deleted.error) throw new Error(deleted.error.message)
            }
        },
    }
}

export async function saveWorkspace(ownerId: string, folders: string[], lessons: Lesson[], itemsByPage: WorkspaceData['itemsByPage'], backgroundsByPage: WorkspaceData['backgroundsByPage'], loadedLessonIds: ReadonlySet<string>) {
    const client = getClient()
    const known = baseline?.ownerId === ownerId ? baseline : null
    const foldersKey = foldersKeyOf(folders, lessons)
    let studentIdByName = known?.studentIdByName ?? new Map<string, string>()
    let folderIdByPath = known?.folderIdByPath ?? new Map<string, string>()
    let removeStaleHierarchy: (() => Promise<void>) | null = null
    if (!known || known.foldersKey !== foldersKey) {
        const synced = await syncStudentsAndFolders(ownerId, folders, lessons, known)
        studentIdByName = synced.studentIdByName
        folderIdByPath = synced.folderIdByPath
        removeStaleHierarchy = synced.removeStale
    }

    const lessonFingerprints = new Map(lessons.map((lesson, position) => [lesson.id, lessonFingerprint(lesson, position)]))
    const lessonRows = lessons.map((lesson, position) => {
        const root = getFolderRoot(lesson.folder)
        const studentId = studentIdByName.get(root.toLocaleLowerCase())
        if (!studentId) throw new Error(`The student for lesson ${lesson.title} could not be found.`)
        return {
            id: lesson.id,
            owner_id: ownerId,
            student_id: studentId,
            folder_id: getFolderParent(lesson.folder) ? folderIdByPath.get(lesson.folder) ?? null : null,
            title: lesson.title,
            position,
            cover: lesson.cover ?? null,
            cover_image: lesson.coverImage ?? null,
            color: lesson.color,
            tags: lesson.tags ?? [],
            card_deck: lesson.cardDeck ?? null,
            match_game: lesson.matchGame ?? null,
        }
    })
    const changedLessonRows = lessonRows.filter((row) => known?.lessonFingerprints.get(row.id) !== lessonFingerprints.get(row.id))
    if (changedLessonRows.length) {
        const upserted = await client.from('lessons').upsert(changedLessonRows, { onConflict: 'id' })
        if (upserted.error) throw new Error(upserted.error.message)
    }

    // A lesson is "complete" when its page list changed, so the server may drop its pages missing from the payload.
    const completeLessonIds = new Set<string>()
    const pagesToSave: { lessonId: string; position: number; name: string }[] = []
    for (const lesson of lessons) {
        const pageStructure = lesson.pages.join(pageNameSeparator)
        const lessonIsNew = !known || !known.pageStructures.has(lesson.id)
        const complete = lessonIsNew || (loadedLessonIds.has(lesson.id) && known?.pageStructures.get(lesson.id) !== pageStructure)
        if (complete) completeLessonIds.add(lesson.id)
        for (const [position, name] of lesson.pages.entries()) {
            const key = `${lesson.id}:${position}`
            const previous = known?.pages.get(key)
            if (complete || (loadedLessonIds.has(lesson.id) && (!previous || previous.items !== itemsByPage[key] || previous.background !== (backgroundsByPage[key] ?? defaultBackground)))) pagesToSave.push({ lessonId: lesson.id, position, name })
        }
    }
    const currentLessonIds = new Set(lessons.map((lesson) => lesson.id))
    const deletedLessonIds = new Set([...(known?.lessonFingerprints.keys() ?? [])].filter((lessonId) => !currentLessonIds.has(lessonId)))

    const desiredAssetPaths = new Set<string>()
    let existingAssets: AssetRow[] = []
    if (pagesToSave.length || completeLessonIds.size || deletedLessonIds.size) {
        const involvedLessonIds = [...new Set([...pagesToSave.map((page) => page.lessonId), ...completeLessonIds])]
        const existingPages: { id: string; lesson_id: string; position: number }[] = involvedLessonIds.length
            ? (await throwOnError(await client.from('lesson_pages').select('id,lesson_id,position').eq('owner_id', ownerId).in('lesson_id', involvedLessonIds))) as { id: string; lesson_id: string; position: number }[]
            : []
        const existingAssetsResult = await client.from('lesson_assets').select('storage_path,lesson_id,page_id').eq('owner_id', ownerId)
        existingAssets = (await throwOnError(existingAssetsResult)) as AssetRow[]
        const existingAssetPaths = new Set(existingAssets.map((asset) => asset.storage_path))
        const existingPageIds = new Map(existingPages.map((page) => [`${page.lesson_id}:${page.position}`, page.id]))
        const pendingAssets = new Map<string, AssetWriteRow>()
        const pageRows = []
        for (const { lessonId, position, name } of pagesToSave) {
            const key = `${lessonId}:${position}`
            const pageId = existingPageIds.get(key) ?? crypto.randomUUID()
            const elements = await Promise.all((itemsByPage[key] ?? []).map((item) => storeAsset(ownerId, lessonId, pageId, item, desiredAssetPaths, existingAssetPaths, pendingAssets)))
            pageRows.push({ id: pageId, lesson_id: lessonId, name, position, elements, background: backgroundsByPage[key] ?? defaultBackground })
        }
        if (pageRows.length || completeLessonIds.size) {
            const savedPages = await client.rpc('save_lesson_pages_delta', { p_pages: pageRows, p_complete_lesson_ids: [...completeLessonIds] })
            if (savedPages.error) throw new Error(savedPages.error.message)
        }
        if (pendingAssets.size) {
            const upserted = await client.from('lesson_assets').upsert([...pendingAssets.values()], { onConflict: 'storage_path' })
            if (upserted.error) throw new Error(upserted.error.message)
        }
    }

    for (const lessonId of deletedLessonIds) {
        const deleted = await client.from('lessons').delete().eq('id', lessonId)
        if (deleted.error) throw new Error(deleted.error.message)
    }

    // Assets are intentionally never deleted here: orphaned files are cheap, while a wrongly deleted file is unrecoverable data loss.

    await removeStaleHierarchy?.()

    const pages = new Map(known?.pages ?? [])
    for (const lesson of lessons) {
        if (!loadedLessonIds.has(lesson.id)) continue
        for (const key of pages.keys()) {
            if (key.startsWith(`${lesson.id}:`)) pages.delete(key)
        }
        for (let position = 0; position < lesson.pages.length; position += 1) {
            const key = `${lesson.id}:${position}`
            pages.set(key, { items: itemsByPage[key], background: backgroundsByPage[key] ?? defaultBackground })
        }
    }
    for (const lessonId of deletedLessonIds) {
        for (const key of pages.keys()) {
            if (key.startsWith(`${lessonId}:`)) pages.delete(key)
        }
    }
    baseline = {
        ownerId,
        foldersKey,
        studentIdByName,
        folderIdByPath,
        lessonFingerprints,
        pageStructures: new Map(lessons.map((lesson) => [lesson.id, lesson.pages.join(pageNameSeparator)])),
        pages,
    }
}

export async function markWorkspaceInitialized(ownerId: string) {
    const result = await getClient().from('profiles').update({ workspace_initialized: true }).eq('id', ownerId)
    if (result.error) throw new Error(result.error.message)
}

export async function initializeWorkspace(folders: string[], lessons: Lesson[]) {
    const studentNames = [...new Set([
        ...folders.map((folder) => getFolderRoot(folder)),
        ...lessons.map((lesson) => getFolderRoot(lesson.folder)),
    ])]
    const result = await getClient().rpc('initialize_workspace', {
        p_students: studentNames.map((name, position) => ({ name, position })),
        p_lessons: lessons.map((lesson, position) => ({
            id: lesson.id,
            title: lesson.title,
            folder: getFolderRoot(lesson.folder),
            pages: lesson.pages,
            position,
            cover: lesson.cover,
            color: lesson.color,
            tags: lesson.tags ?? [],
        })),
    })
    if (result.error) throw new Error(result.error.message)
}

export type SharedLessonPage = { name: string; position: number; elements: BoardItem[]; background: string }
export type SharedInvite = { id: string; label: string; color: string }
export type SharedLessonData = {
    access: 'pending' | 'admitted' | 'removed'
    sessionId: string
    invite: SharedInvite
    lesson?: { id: string; title: string; color: string }
    pages?: SharedLessonPage[]
}
export type LessonInvite = SharedInvite & { token: string; status: 'pending' | 'admitted' | 'removed' }

export async function getSharedLesson(token: string): Promise<SharedLessonData> {
    if (!supabase) throw new Error('Supabase is not configured.')
    const result = await supabase.rpc('get_shared_lesson', { p_token: token })
    if (result.error) throw new Error(result.error.message)
    if (!result.data) throw new Error('This student link is invalid or has expired.')
    return result.data as SharedLessonData
}

export async function endLessonShare(lessonId: string): Promise<void> {
    const result = await getClient().rpc('end_lesson_share', { p_lesson_id: lessonId })
    if (result.error) throw new Error(result.error.message)
}

export async function startLessonShare(lessonId: string): Promise<{ sessionId: string; expiresAt: string }> {
    const result = await getClient().rpc('start_lesson_share', { p_lesson_id: lessonId })
    if (result.error) throw new Error(result.error.message)
    return result.data as { sessionId: string; expiresAt: string }
}

export async function getActiveLessonShare(lessonId: string): Promise<{ sessionId: string; expiresAt: string } | null> {
    const result = await getClient().from('lesson_sessions').select('id,expires_at').eq('lesson_id', lessonId).eq('status', 'active').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1)
    if (result.error) throw new Error(result.error.message)
    const row = (result.data as { id: string; expires_at: string }[])[0]
    return row ? { sessionId: row.id, expiresAt: row.expires_at } : null
}

export async function listLessonInvites(sessionId: string): Promise<LessonInvite[]> {
    const result = await getClient().from('lesson_invites').select('id,label,color,token,status').eq('session_id', sessionId).order('created_at')
    if (result.error) throw new Error(result.error.message)
    return result.data as LessonInvite[]
}

export async function createLessonInvite(sessionId: string, label: string, requiresApproval: boolean): Promise<LessonInvite> {
    const result = await getClient().rpc('create_lesson_invite', { p_session_id: sessionId, p_label: label, p_requires_approval: requiresApproval })
    if (result.error) throw new Error(result.error.message)
    return result.data as LessonInvite
}

export async function setLessonInviteStatus(inviteId: string, status: LessonInvite['status']): Promise<void> {
    const result = await getClient().rpc('set_lesson_invite_status', { p_invite_id: inviteId, p_status: status })
    if (result.error) throw new Error(result.error.message)
}

export async function deletePendingLessonInvite(inviteId: string): Promise<void> {
    const result = await getClient().rpc('delete_pending_lesson_invite', { p_invite_id: inviteId })
    if (result.error) throw new Error(result.error.message)
}

export async function listLiveLessonIds(): Promise<string[]> {
    const result = await getClient().from('lesson_sessions').select('lesson_id').eq('status', 'active').gt('expires_at', new Date().toISOString())
    if (result.error) throw new Error(result.error.message)
    return [...new Set((result.data as { lesson_id: string }[]).map((row) => row.lesson_id))]
}
