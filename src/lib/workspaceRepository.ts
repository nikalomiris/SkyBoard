import { supabase } from './supabase'
import type { BoardItem, Lesson, WorkspaceData } from './workspaceTypes'

const folderSeparator = ' / '
const assetBucket = 'lesson-assets'

type StudentRow = { id: string; name: string; position: number }
type FolderRow = { id: string; student_id: string; parent_id: string | null; name: string; position: number }
type LessonRow = { id: string; student_id: string | null; folder_id: string | null; title: string; position: number; cover: string | null; color: string; tags: string[]; updated_at: string }
type PageRow = { id: string; lesson_id: string; name: string; position: number; elements: BoardItem[]; background: string }
type AssetRow = { storage_path: string }
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
            if (result.error) throw new Error(result.error.message)
            signedUrl = result.data.signedUrl
            cache.set(item.storagePath, signedUrl)
        }
        return { ...item, src: signedUrl }
    }))
}

export async function loadWorkspace(ownerId: string): Promise<WorkspaceData> {
    const client = getClient()
    const [profileResult, studentsResult, foldersResult, lessonsResult, pagesResult] = await Promise.all([
        client.from('profiles').select('workspace_initialized').eq('id', ownerId).maybeSingle(),
        client.from('students').select('id,name,position').eq('owner_id', ownerId).order('position'),
        client.from('student_folders').select('id,student_id,parent_id,name,position').eq('owner_id', ownerId).order('position'),
        client.from('lessons').select('id,student_id,folder_id,title,position,cover,color,tags,updated_at').eq('owner_id', ownerId).order('position'),
        client.from('lesson_pages').select('id,lesson_id,name,position,elements,background').eq('owner_id', ownerId).order('position'),
    ])
    if (profileResult.error) throw new Error(profileResult.error.message)
    const students = (await throwOnError(studentsResult)) as StudentRow[]
    const folderRows = (await throwOnError(foldersResult)) as FolderRow[]
    const lessonRows = (await throwOnError(lessonsResult)) as LessonRow[]
    const pageRows = (await throwOnError(pagesResult)) as PageRow[]

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

    const pagesByLesson = new Map<string, PageRow[]>()
    for (const page of pageRows) pagesByLesson.set(page.lesson_id, [...(pagesByLesson.get(page.lesson_id) ?? []), page])
    const assetUrlCache = new Map<string, string>()
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
            color: row.color,
            cover: row.cover as Lesson['cover'],
            tags: row.tags ?? [],
            kind: 'lesson',
        }
    })
    for (const row of lessonRows) {
        for (const page of pagesByLesson.get(row.id) ?? []) {
            const elements = await resolveAssetUrls(page.elements ?? [], assetUrlCache)
            if (elements.length) itemsByPage[`${row.id}:${page.position}`] = elements
            if (page.background) backgroundsByPage[`${row.id}:${page.position}`] = page.background
        }
    }

    return {
        folders,
        lessons,
        itemsByPage,
        backgroundsByPage,
        initialized: profileResult.data?.workspace_initialized ?? false,
        hasData: students.length > 0 || lessonRows.length > 0,
    }
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
            if (downloaded.error) throw new Error(downloaded.error.message)
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

export async function saveWorkspace(ownerId: string, folders: string[], lessons: Lesson[], itemsByPage: WorkspaceData['itemsByPage'], backgroundsByPage: WorkspaceData['backgroundsByPage']) {
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

    const existingLessonsResult = await client.from('lessons').select('id').eq('owner_id', ownerId)
    const existingLessons = (await throwOnError(existingLessonsResult)) as { id: string }[]
    const lessonRows = lessons.map((lesson, position) => {
        const root = getFolderRoot(lesson.folder)
        const student = studentsByName.get(root.toLocaleLowerCase())
        if (!student) throw new Error(`The student for lesson ${lesson.title} could not be found.`)
        return {
            id: lesson.id,
            owner_id: ownerId,
            student_id: student.id,
            folder_id: getFolderParent(lesson.folder) ? folderIdByPath.get(lesson.folder) ?? null : null,
            title: lesson.title,
            position,
            cover: lesson.cover ?? null,
            color: lesson.color,
            tags: lesson.tags ?? [],
        }
    })
    if (lessonRows.length) {
        const upserted = await client.from('lessons').upsert(lessonRows, { onConflict: 'id' })
        if (upserted.error) throw new Error(upserted.error.message)
    }

    const existingPagesResult = await client.from('lesson_pages').select('id,lesson_id,position').eq('owner_id', ownerId)
    const existingPages = (await throwOnError(existingPagesResult)) as { id: string; lesson_id: string; position: number }[]
    const existingAssetsResult = await client.from('lesson_assets').select('storage_path').eq('owner_id', ownerId)
    const existingAssets = (await throwOnError(existingAssetsResult)) as AssetRow[]
    const existingAssetPaths = new Set(existingAssets.map((asset) => asset.storage_path))
    const existingPageIds = new Map(existingPages.map((page) => [`${page.lesson_id}:${page.position}`, page.id]))
    const desiredAssetPaths = new Set<string>()
    const pendingAssets = new Map<string, AssetWriteRow>()
    const pageRows = []
    for (const lesson of lessons) {
        for (const [position, name] of lesson.pages.entries()) {
            const pageId = existingPageIds.get(`${lesson.id}:${position}`) ?? crypto.randomUUID()
            const elements = await Promise.all((itemsByPage[`${lesson.id}:${position}`] ?? []).map((item) => storeAsset(ownerId, lesson.id, pageId, item, desiredAssetPaths, existingAssetPaths, pendingAssets)))
            const background = backgroundsByPage[`${lesson.id}:${position}`] ?? '#fffef9'
            pageRows.push({ id: pageId, owner_id: ownerId, lesson_id: lesson.id, name, position, elements, background })
        }
    }
    const savedPages = await client.rpc('save_lesson_pages', { p_pages: pageRows.map(({ id, lesson_id, name, position, elements, background }) => ({ id, lesson_id, name, position, elements, background })) })
    if (savedPages.error) throw new Error(savedPages.error.message)
    if (pendingAssets.size) {
        const upserted = await client.from('lesson_assets').upsert([...pendingAssets.values()], { onConflict: 'storage_path' })
        if (upserted.error) throw new Error(upserted.error.message)
    }

    const currentLessonIds = new Set(lessons.map((lesson) => lesson.id))
    for (const lesson of existingLessons) {
        if (!currentLessonIds.has(lesson.id)) {
            const deleted = await client.from('lessons').delete().eq('id', lesson.id)
            if (deleted.error) throw new Error(deleted.error.message)
        }
    }

    const staleAssetPaths = existingAssets.map((asset) => asset.storage_path).filter((path) => !desiredAssetPaths.has(path))
    if (staleAssetPaths.length) {
        const removed = await client.storage.from(assetBucket).remove(staleAssetPaths)
        if (removed.error) throw new Error(removed.error.message)
        const deleted = await client.from('lesson_assets').delete().in('storage_path', staleAssetPaths)
        if (deleted.error) throw new Error(deleted.error.message)
    }

    const desiredFolderIds = new Set(folderIdByPath.values())
    const staleFolders = existingFolders.filter((folder) => !desiredFolderIds.has(folder.id)).sort((first, second) => {
        const firstPath = [...existingFolderPaths.entries()].find(([, value]) => value.id === first.id)?.[0] ?? ''
        const secondPath = [...existingFolderPaths.entries()].find(([, value]) => value.id === second.id)?.[0] ?? ''
        return secondPath.split(folderSeparator).length - firstPath.split(folderSeparator).length
    })
    for (const folder of staleFolders) {
        const deleted = await client.from('student_folders').delete().eq('id', folder.id)
        if (deleted.error) throw new Error(deleted.error.message)
    }

    const desiredStudentIds = new Set(rootNames.map((name) => studentsByName.get(name.toLocaleLowerCase())?.id).filter((value): value is string => Boolean(value)))
    for (const student of existingStudents) {
        if (!desiredStudentIds.has(student.id)) {
            const deleted = await client.from('students').delete().eq('id', student.id)
            if (deleted.error) throw new Error(deleted.error.message)
        }
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
