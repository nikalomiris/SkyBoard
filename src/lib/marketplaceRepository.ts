import { supabase } from './supabase'
import { id } from './workspaceUtils'
import type { BoardItem, CardDeckConfig, Lesson } from './workspaceTypes'

const marketplaceBucket = 'marketplace-assets'

export type MarketplaceListing = {
    id: string
    sellerId: string
    sellerName: string
    title: string
    description: string
    priceCents: number
    cover: Lesson['cover']
    coverImage?: string
    color: string
    tags: string[]
    pageCount: number
    previewPages: MarketplacePage[]
    status: 'published' | 'unpublished'
    updatedAt: number
}

export type MarketplacePurchase = { id: string; versionId: string; purchasedAt: number; priceCents: number; listing: MarketplaceListing }
export type MarketplacePage = { name: string; background?: string; items: BoardItem[] }
export type MarketplaceVersion = { id: string; title: string; color: string; cover?: Lesson['cover']; coverImage?: string; tags: string[]; cardDeck?: CardDeckConfig; pages: MarketplacePage[] }

type ListingRow = { id: string; seller_id: string; seller_name: string; title: string; description: string; price_cents: number; cover: string | null; cover_image: string | null; color: string; tags: string[]; page_count: number; status: 'published' | 'unpublished'; updated_at: string }
type StoredPage = { name: string; background?: string; elements: BoardItem[] }
type VersionRow = { id: string; title: string; color: string; cover: string | null; cover_image: string | null; tags: string[]; card_deck: CardDeckConfig | null; pages: StoredPage[] }

const listingColumns = 'id,seller_id,seller_name,title,description,price_cents,cover,cover_image,color,tags,page_count,status,updated_at'

function getClient() {
    if (!supabase) throw new Error('The marketplace needs Supabase to be configured.')
    return supabase
}

function toListing(row: ListingRow): MarketplaceListing {
    return {
        id: row.id,
        sellerId: row.seller_id,
        sellerName: row.seller_name,
        title: row.title,
        description: row.description,
        priceCents: row.price_cents,
        cover: (row.cover ?? undefined) as Lesson['cover'],
        coverImage: row.cover_image ?? undefined,
        color: row.color,
        tags: row.tags ?? [],
        pageCount: row.page_count,
        previewPages: [],
        status: row.status,
        updatedAt: new Date(row.updated_at).getTime(),
    }
}

export function formatPrice(priceCents: number) {
    return priceCents === 0 ? 'Free' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(priceCents / 100)
}

// One light query: row-level security already limits this to published, own and purchased listings.
export async function listVisibleListings(): Promise<MarketplaceListing[]> {
    const result = await getClient().from('marketplace_listings').select(listingColumns).order('updated_at', { ascending: false })
    if (result.error) throw new Error(result.error.message)
    return (result.data as ListingRow[]).map(toListing)
}

export async function listPurchases(userId: string): Promise<{ id: string; listingId: string; versionId: string; purchasedAt: number; priceCents: number }[]> {
    const result = await getClient().from('marketplace_purchases').select('id,listing_id,version_id,price_cents,created_at').eq('buyer_id', userId).order('created_at', { ascending: false })
    if (result.error) throw new Error(result.error.message)
    return (result.data as { id: string; listing_id: string; version_id: string; price_cents: number; created_at: string }[]).map((row) => ({ id: row.id, listingId: row.listing_id, versionId: row.version_id, purchasedAt: new Date(row.created_at).getTime(), priceCents: row.price_cents }))
}

// Previews hold embedded images, so they load separately from the listing grid.
export async function loadPreviewPages(listingIds: string[]): Promise<Record<string, MarketplacePage[]>> {
    if (!listingIds.length) return {}
    const result = await getClient().from('marketplace_listings').select('id,preview_pages').in('id', listingIds)
    if (result.error) throw new Error(result.error.message)
    return Object.fromEntries((result.data as { id: string; preview_pages: StoredPage[] | null }[]).map((row) => [row.id, (row.preview_pages ?? []).map((page) => ({ name: page.name, background: page.background, items: page.elements }))]))
}

export async function purchaseListing(listingId: string) {
    const result = await getClient().rpc('purchase_marketplace_listing', { p_listing_id: listingId })
    if (result.error) throw new Error(result.error.message)
}

export async function setListingStatus(listingId: string, status: 'published' | 'unpublished') {
    const result = await getClient().rpc('set_marketplace_listing_status', { p_listing_id: listingId, p_status: status })
    if (result.error) throw new Error(result.error.message)
}

function blobFromDataUrl(dataUrl: string) {
    const [header, payload] = dataUrl.split(',', 2)
    const contentType = header.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream'
    const binary = atob(payload)
    return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: contentType })
}

async function assetBlob(item: Extract<BoardItem, { type: 'image' | 'pdf' }>) {
    if (item.src.startsWith('data:')) return blobFromDataUrl(item.src)
    const response = await fetch(item.src)
    if (!response.ok) throw new Error(`Could not read "${item.label}" for publishing.`)
    return response.blob()
}

const previewPageLimit = 3

// Previews are visible before purchase, so images are shrunk to low-resolution copies and PDFs stay private.
async function previewItem(item: BoardItem): Promise<BoardItem> {
    if (item.type === 'pdf') {
        const { storagePath: _storagePath, ...rest } = item
        return { ...rest, src: '' } as BoardItem
    }
    if (item.type !== 'image') return item
    const { storagePath: _storagePath, ...rest } = item
    try {
        const bitmap = await createImageBitmap(await assetBlob(item))
        const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        return { ...rest, src: canvas.toDataURL('image/jpeg', 0.6) } as BoardItem
    } catch {
        return { ...rest, src: '' } as BoardItem
    }
}

export type PublishInput = {
    listingId?: string
    lesson: Lesson
    pages: MarketplacePage[]
    description: string
    priceCents: number
}

// Copies the lesson's assets into the marketplace bucket and stores an immutable snapshot.
export async function publishLesson(sellerId: string, input: PublishInput): Promise<string> {
    const client = getClient()
    const listingId = input.listingId ?? id()
    const versionId = id()
    const storedPages: StoredPage[] = []
    for (const [pageIndex, page] of input.pages.entries()) {
        const elements: BoardItem[] = []
        for (const item of page.items) {
            if (item.type !== 'image' && item.type !== 'pdf') { elements.push(item); continue }
            const blob = await assetBlob(item)
            const storagePath = `${sellerId}/${listingId}/${versionId}/${pageIndex}-${item.id}`
            const uploaded = await client.storage.from(marketplaceBucket).upload(storagePath, blob, { contentType: blob.type || (item.type === 'pdf' ? 'application/pdf' : 'image/jpeg') })
            if (uploaded.error) throw new Error(uploaded.error.message)
            elements.push({ ...item, src: `storage://${storagePath}`, storagePath })
        }
        storedPages.push({ name: page.name, background: page.background, elements })
    }
    const previewPages: StoredPage[] = []
    for (const page of input.pages.slice(0, previewPageLimit)) {
        previewPages.push({ name: page.name, background: page.background, elements: await Promise.all(page.items.map(previewItem)) })
    }
    const result = await client.rpc('publish_marketplace_listing', {
        p_listing_id: listingId,
        p_version_id: versionId,
        p_title: input.lesson.title,
        p_description: input.description,
        p_price_cents: input.priceCents,
        p_cover: input.lesson.cover ?? null,
        p_cover_image: input.lesson.coverImage ?? null,
        p_color: input.lesson.color,
        p_tags: input.lesson.tags ?? [],
        p_card_deck: input.lesson.cardDeck ?? null,
        p_pages: storedPages,
        p_preview: previewPages,
    })
    if (result.error) throw new Error(result.error.message)
    return listingId
}

// Loads the purchased snapshot with signed URLs so it can be previewed read-only.
export async function loadOwnedVersion(versionId: string): Promise<MarketplaceVersion> {
    const client = getClient()
    const result = await client.from('marketplace_listing_versions').select('id,title,color,cover,cover_image,tags,card_deck,pages').eq('id', versionId).single()
    if (result.error) throw new Error(result.error.message)
    const row = result.data as VersionRow
    const pages: MarketplacePage[] = []
    for (const page of row.pages) {
        const items = await Promise.all(page.elements.map(async (item) => {
            if ((item.type !== 'image' && item.type !== 'pdf') || !item.storagePath) return item
            const signed = await client.storage.from(marketplaceBucket).createSignedUrl(item.storagePath, 60 * 60)
            if (signed.error) throw new Error(signed.error.message)
            return { ...item, src: signed.data.signedUrl }
        }))
        pages.push({ name: page.name, background: page.background, items })
    }
    return { id: row.id, title: row.title, color: row.color, cover: (row.cover ?? undefined) as Lesson['cover'], coverImage: row.cover_image ?? undefined, tags: row.tags ?? [], cardDeck: row.card_deck ?? undefined, pages }
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read a purchased asset.'))
        reader.readAsDataURL(blob)
    })
}

// Detaches assets from the marketplace bucket (as data URLs) so the normal workspace
// save queue uploads them into the buyer's own storage folder.
export async function detachVersionAssets(version: MarketplaceVersion): Promise<MarketplacePage[]> {
    return Promise.all(version.pages.map(async (page) => ({
        ...page,
        items: await Promise.all(page.items.map(async (item) => {
            if (item.type !== 'image' && item.type !== 'pdf') return item
            const response = await fetch(item.src)
            if (!response.ok) throw new Error(`Could not copy "${item.label}" into your workspace.`)
            const { storagePath: _storagePath, ...rest } = item
            return { ...rest, src: await blobToDataUrl(await response.blob()) } as BoardItem
        })),
    })))
}
