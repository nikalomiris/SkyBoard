import { supabase } from './supabase'

export type LibraryBackground = { id: string; name: string; group: string; image: string }

const storageKey = 'skyboard:background-library'
const cloudCacheKey = `${storageKey}:cloud:`
export const boardImageMaxDimension = 1024
export const coverImageMaxDimension = 480
export const backgroundImageMaxDimension = 1280
export const imageQuality = 0.7

export function downscaleImage(file: File, maxDimension = boardImageMaxDimension): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
            URL.revokeObjectURL(url)
            const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight))
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
            const context = canvas.getContext('2d')
            if (!context) { reject(new Error('Canvas unavailable')); return }
            // JPEG has no alpha channel, so flatten transparency onto white.
            context.fillStyle = '#fff'
            context.fillRect(0, 0, canvas.width, canvas.height)
            context.drawImage(img, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/jpeg', imageQuality))
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')) }
        img.src = url
    })
}

function readLocal(): LibraryBackground[] {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { return [] }
}

function readCloudCache(ownerId: string): LibraryBackground[] | null {
    try {
        const cached = localStorage.getItem(`${cloudCacheKey}${ownerId}`)
        if (!cached) return null
        const entries: unknown = JSON.parse(cached)
        if (!Array.isArray(entries) || !entries.every((entry) => (
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.name === 'string' &&
            typeof entry.group === 'string' &&
            typeof entry.image === 'string'
        ))) return null
        return entries
    } catch (error) {
        console.warn('Could not read the cached background library.', error)
        return null
    }
}

function writeCloudCache(ownerId: string, entries: LibraryBackground[]) {
    try {
        localStorage.setItem(`${cloudCacheKey}${ownerId}`, JSON.stringify(entries))
    } catch (error) {
        console.warn('Could not cache the background library locally.', error)
    }
}

export async function loadBackgroundLibrary(ownerId: string | null): Promise<LibraryBackground[]> {
    if (!supabase || !ownerId) return readLocal()
    const cached = readCloudCache(ownerId)
    if (cached) {
        const { data: metadata, error: metadataError } = await supabase.from('background_library').select('id,name,group_name').eq('owner_id', ownerId).order('created_at')
        if (metadataError) throw metadataError
        const isCurrent = metadata.length === cached.length && metadata.every((row, index) => (
            row.id === cached[index].id &&
            row.name === cached[index].name &&
            row.group_name === cached[index].group
        ))
        if (isCurrent) return cached
    }
    const { data, error } = await supabase.from('background_library').select('id,name,group_name,image').eq('owner_id', ownerId).order('created_at')
    if (error) throw error
    const entries = data.map((row) => ({ id: row.id, name: row.name, group: row.group_name, image: row.image }))
    writeCloudCache(ownerId, entries)
    return entries
}

export async function addLibraryBackground(ownerId: string | null, entry: Omit<LibraryBackground, 'id'>): Promise<LibraryBackground> {
    if (!supabase || !ownerId) {
        const saved = { ...entry, id: crypto.randomUUID() }
        localStorage.setItem(storageKey, JSON.stringify([...readLocal(), saved]))
        return saved
    }
    const { data, error } = await supabase.from('background_library').insert({ owner_id: ownerId, name: entry.name, group_name: entry.group, image: entry.image }).select('id').single()
    if (error) throw error
    const saved = { ...entry, id: data.id }
    const cached = readCloudCache(ownerId)
    if (cached) writeCloudCache(ownerId, [...cached, saved])
    return saved
}

export async function updateLibraryBackground(ownerId: string | null, id: string, changes: { group: string }) {
    if (!supabase || !ownerId) {
        localStorage.setItem(storageKey, JSON.stringify(readLocal().map((entry) => entry.id === id ? { ...entry, ...changes } : entry)))
        return
    }
    const { error } = await supabase.from('background_library').update({ group_name: changes.group }).eq('id', id).eq('owner_id', ownerId)
    if (error) throw error
    const cached = readCloudCache(ownerId)
    if (cached) writeCloudCache(ownerId, cached.map((entry) => entry.id === id ? { ...entry, ...changes } : entry))
}

export async function removeLibraryBackground(ownerId: string | null, id: string) {
    if (!supabase || !ownerId) {
        localStorage.setItem(storageKey, JSON.stringify(readLocal().filter((entry) => entry.id !== id)))
        return
    }
    const { error } = await supabase.from('background_library').delete().eq('id', id).eq('owner_id', ownerId)
    if (error) throw error
    const cached = readCloudCache(ownerId)
    if (cached) writeCloudCache(ownerId, cached.filter((entry) => entry.id !== id))
}
