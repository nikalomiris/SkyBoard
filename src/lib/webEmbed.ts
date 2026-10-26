import { supabase } from './supabase'

export type EmbedStatus = 'allowed' | 'blocked' | 'unknown'
export type EmbedCheck = { status: EmbedStatus; reason: string }

// Returns a safe https URL or null. Used both when adding and when rendering shared data.
export function parseWebUrl(input: string): URL | null {
    const trimmed = input.trim()
    if (!trimmed || /\s/.test(trimmed)) return null
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
        const url = new URL(candidate)
        if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null
        return url
    } catch {
        return null
    }
}

export function webHostname(url: string) {
    return parseWebUrl(url)?.hostname.replace(/^www\./, '') ?? 'web page'
}

export async function checkEmbeddable(url: string): Promise<EmbedCheck> {
    if (!supabase) return { status: 'unknown', reason: 'The embed check needs a connection to SkyBoard\'s server.' }
    try {
        const { data, error } = await supabase.functions.invoke('check-embed', { body: { url } })
        if (error || !data || !['allowed', 'blocked', 'unknown'].includes(data.status)) throw error ?? new Error('bad response')
        return { status: data.status, reason: String(data.reason ?? '') }
    } catch {
        return { status: 'unknown', reason: 'The embed check is unavailable right now.' }
    }
}
