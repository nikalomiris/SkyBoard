import { supabase } from './supabase'

export type LibraryBackground = { id: string; name: string; group: string; image: string }

const storageKey = 'skyboard:background-library'
const maxDimension = 1920

export function downscaleImage(file: File): Promise<string> {
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
            context.drawImage(img, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85))
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')) }
        img.src = url
    })
}

function readLocal(): LibraryBackground[] {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { return [] }
}

export async function loadBackgroundLibrary(ownerId: string | null): Promise<LibraryBackground[]> {
    if (!supabase || !ownerId) return readLocal()
    const { data, error } = await supabase.from('background_library').select('id,name,group_name,image').eq('owner_id', ownerId).order('created_at')
    if (error) throw error
    return data.map((row) => ({ id: row.id, name: row.name, group: row.group_name, image: row.image }))
}

export async function addLibraryBackground(ownerId: string | null, entry: Omit<LibraryBackground, 'id'>): Promise<LibraryBackground> {
    if (!supabase || !ownerId) {
        const saved = { ...entry, id: crypto.randomUUID() }
        localStorage.setItem(storageKey, JSON.stringify([...readLocal(), saved]))
        return saved
    }
    const { data, error } = await supabase.from('background_library').insert({ owner_id: ownerId, name: entry.name, group_name: entry.group, image: entry.image }).select('id').single()
    if (error) throw error
    return { ...entry, id: data.id }
}

export async function updateLibraryBackground(ownerId: string | null, id: string, changes: { group: string }) {
    if (!supabase || !ownerId) {
        localStorage.setItem(storageKey, JSON.stringify(readLocal().map((entry) => entry.id === id ? { ...entry, ...changes } : entry)))
        return
    }
    const { error } = await supabase.from('background_library').update({ group_name: changes.group }).eq('id', id).eq('owner_id', ownerId)
    if (error) throw error
}

export async function removeLibraryBackground(ownerId: string | null, id: string) {
    if (!supabase || !ownerId) {
        localStorage.setItem(storageKey, JSON.stringify(readLocal().filter((entry) => entry.id !== id)))
        return
    }
    const { error } = await supabase.from('background_library').delete().eq('id', id).eq('owner_id', ownerId)
    if (error) throw error
}
