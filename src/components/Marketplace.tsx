import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Download, Eye, FileText, NotebookTabs, PackageCheck, Search, Store, Upload, User, X } from 'lucide-react'
import LessonThumbnail from './LessonThumbnail'
import { getImageSize, getItemBounds, getLineEndpoints, registerImageAspect, smoothPath } from '../lib/boardGeometry'
import {
    detachVersionAssets, formatPrice, listMyListings, listPublishedListings, listPurchases, loadOwnedVersion,
    publishLesson, purchaseListing, setListingStatus,
} from '../lib/marketplaceRepository'
import type { MarketplaceListing, MarketplacePage, MarketplacePurchase, MarketplaceVersion } from '../lib/marketplaceRepository'
import { getOrderedFolders, notePalette } from '../lib/workspaceUtils'
import type { BoardItem, Lesson, PageItems } from '../lib/workspaceTypes'

type Tab = 'browse' | 'owned' | 'selling'
type MarketplaceProps = {
    userId: string
    lessons: Lesson[]
    folders: string[]
    itemsByPage: PageItems
    backgroundsByPage: Record<string, string>
    initialLessonId?: string
    onClose: () => void
    onAddToWorkspace: (version: MarketplaceVersion, pages: MarketplacePage[], destinationFolder: string) => void
}

function ReadOnlyItem({ item, onImageLoad }: { item: BoardItem; onImageLoad?: () => void }): ReactNode {
    const scale = item.scale ?? 1
    const x = 'left' in item ? item.left * 10 : 0
    const y = 'top' in item ? item.top * 6.2 : 0
    if (item.type === 'stroke') return <path d={smoothPath(item.points)} fill="none" stroke={item.color} strokeWidth={item.width} strokeOpacity={item.opacity} strokeLinecap="round" strokeLinejoin="round" />
    if (item.type === 'text') {
        const bounds = getItemBounds(item)
        return <text x={bounds.left + bounds.width / 2} y={bounds.top + bounds.height / 2} textAnchor="middle" dominantBaseline="central" fill={item.color} fontSize={item.size * scale} fontFamily={item.fontFamily}>{item.text}</text>
    }
    if (item.type === 'note') return <foreignObject x={x} y={y} width={190 * scale} height={170 * scale}><div className="board-sticky" style={{ backgroundColor: item.color ?? notePalette[0], fontSize: `${(item.fontSize ?? 14) * scale}px`, fontFamily: item.fontFamily }}>{item.text}</div></foreignObject>
    if (item.type === 'shape') {
        if (item.shape === 'circle') return <circle cx={x} cy={y} r={46 * scale} fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" />
        if (item.shape === 'rectangle') return <rect x={x} y={y} width={125 * scale} height={78 * scale} rx="8" fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${x + 62.5 * scale} ${y + 39 * scale})`} />
        if (item.shape === 'square') return <rect x={x} y={y} width={92 * scale} height={92 * scale} rx="8" fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${x + 46 * scale} ${y + 46 * scale})`} />
        if (item.shape === 'triangle') return <polygon points={`${x + 62.5 * scale},${y} ${x + 125 * scale},${y + 78 * scale} ${x},${y + 78 * scale}`} fill={item.fillColor ?? 'none'} stroke={item.color} strokeWidth="4" transform={`rotate(${item.rotation ?? 0} ${x + 62.5 * scale} ${y + 39 * scale})`} />
        const { start, end } = getLineEndpoints(item)
        return <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={item.color} strokeWidth="4" />
    }
    if (item.type === 'grid') {
        const cols = item.cols ?? 3
        const rows = item.rows ?? 3
        return <foreignObject x={x} y={y} width={294 * scale} height={184 * scale}><div className="board-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>{item.values.map((value, index) => <span key={index} className="board-grid-cell" style={{ color: item.cellStyles?.[index]?.color ?? item.color ?? '#405f51', fontSize: `${(item.cellStyles?.[index]?.fontSize ?? item.fontSize ?? 20) * scale}px`, fontFamily: item.fontFamily, display: 'grid', placeItems: 'center' }}>{value}</span>)}</div></foreignObject>
    }
    if (item.type === 'image' && !item.src) return <foreignObject x={x} y={y} width={240 * scale} height={160 * scale}><div className="pdf-tile"><FileText size={28} /><span>{item.label} (included after purchase)</span></div></foreignObject>
    if (item.type === 'image') {
        const size = getImageSize(item.src)
        return <foreignObject x={x} y={y} width={size.width * scale} height={size.height * scale}><img className="board-image" src={item.src} alt={item.label} draggable={false} onLoad={(event) => { if (registerImageAspect(item.src, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)) onImageLoad?.() }} /></foreignObject>
    }
    return <foreignObject x={x} y={y} width={300 * scale} height={220 * scale}><div className="pdf-tile"><FileText size={28} /><span>{item.label}</span></div></foreignObject>
}

function backgroundStyle(background?: string) {
    if (!background) return '#fffef9'
    return background.startsWith('data:') || background.startsWith('http') ? `center / cover url(${background})` : background
}

function PagePreview({ page }: { page: MarketplacePage }) {
    const [, setImageVersion] = useState(0)
    return (
        <div className="market-page-preview" style={{ background: backgroundStyle(page.background) }}>
            <svg viewBox="0 0 1000 620" role="img" aria-label={page.name}>
                {page.items.map((item) => <g key={item.id}><ReadOnlyItem item={item} onImageLoad={() => setImageVersion((version) => version + 1)} /></g>)}
            </svg>
        </div>
    )
}

// Same cover rules as workspace lesson cards.
function ListingThumbnail({ listing }: { listing: MarketplaceListing }) {
    const [, setImageVersion] = useState(0)
    const cover = listing.cover ?? 'vowels'
    const firstPage = listing.previewPages[0]
    if (cover === 'page' && firstPage) return <div className="lesson-thumb page-preview" aria-hidden="true" style={{ background: backgroundStyle(firstPage.background) }}><svg viewBox="0 0 1000 620" preserveAspectRatio="xMidYMin slice">{firstPage.items.map((item) => <g key={item.id}><ReadOnlyItem item={item} onImageLoad={() => setImageVersion((version) => version + 1)} /></g>)}</svg></div>
    if (cover === 'custom' && listing.coverImage) return <div className="lesson-thumb custom-cover" aria-hidden="true"><img src={listing.coverImage} alt="" /></div>
    return <LessonThumbnail kind={cover === 'page' || cover === 'custom' ? 'vowels' : cover} tint={listing.color} />
}

function ListingCard({ listing, onOpen, actions }: { listing: MarketplaceListing; onOpen?: () => void; actions?: ReactNode }) {
    return (
        <article className="lesson-card market-card" onClick={onOpen}>
            <ListingThumbnail listing={listing} />
            <div className="lesson-info">
                <div className="lesson-name-line"><h2>{listing.title}</h2><span className={`market-price ${listing.priceCents === 0 ? 'free' : ''}`}>{formatPrice(listing.priceCents)}</span></div>
                <div className="lesson-meta"><span className="lesson-file-icon"><NotebookTabs size={14} /></span><span>{listing.pageCount} page{listing.pageCount === 1 ? '' : 's'}</span><span className="meta-dot">·</span><span className="market-seller"><User size={13} />{listing.sellerName || 'SkyBoard teacher'}</span></div>
                {listing.tags.length > 0 && <div className="lesson-tags" aria-label={`Tags for ${listing.title}`}>{listing.tags.map((tag) => <span className="lesson-tag" key={tag}>{tag}</span>)}</div>}
                {actions && <div className="market-card-actions" onClick={(event) => event.stopPropagation()}>{actions}</div>}
            </div>
        </article>
    )
}

export default function Marketplace({ userId, lessons, folders, itemsByPage, backgroundsByPage, initialLessonId, onClose, onAddToWorkspace }: MarketplaceProps) {
    const [tab, setTab] = useState<Tab>('browse')
    const [search, setSearch] = useState('')
    const [listings, setListings] = useState<MarketplaceListing[]>([])
    const [myListings, setMyListings] = useState<MarketplaceListing[]>([])
    const [purchases, setPurchases] = useState<MarketplacePurchase[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [status, setStatus] = useState('')
    const [busyId, setBusyId] = useState('')
    const [detail, setDetail] = useState<MarketplaceListing | null>(null)
    const [owned, setOwned] = useState<{ purchase: MarketplacePurchase; version: MarketplaceVersion } | null>(null)
    const [previewPage, setPreviewPage] = useState(0)
    const [addFolder, setAddFolder] = useState('')
    const [showPublish, setShowPublish] = useState(false)
    const [publishLessonId, setPublishLessonId] = useState('')
    const [publishDescription, setPublishDescription] = useState('')
    const [publishPrice, setPublishPrice] = useState('0')
    const [republishing, setRepublishing] = useState<MarketplaceListing | null>(null)

    const orderedFolders = useMemo(() => getOrderedFolders(folders), [folders])
    const purchasedIds = useMemo(() => new Set(purchases.map((purchase) => purchase.listing.id)), [purchases])

    async function refresh() {
        setLoading(true)
        setError('')
        try {
            const [published, mine, bought] = await Promise.all([listPublishedListings(), listMyListings(userId), listPurchases(userId)])
            setListings(published)
            setMyListings(mine)
            setPurchases(bought)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not load the marketplace.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { void refresh() }, [userId])
    useEffect(() => {
        if (!initialLessonId) return
        setPublishLessonId(initialLessonId)
        setRepublishing(null)
        setPublishDescription('')
        setPublishPrice('0')
        setShowPublish(true)
        setError('')
    }, [initialLessonId])

    const query = search.trim().toLowerCase()
    const matches = (listing: MarketplaceListing) => !query || `${listing.title} ${listing.sellerName} ${listing.tags.join(' ')}`.toLowerCase().includes(query)
    const browseListings = listings.filter((listing) => listing.sellerId !== userId && matches(listing))

    async function buy(listing: MarketplaceListing) {
        setBusyId(listing.id)
        setError('')
        try {
            await purchaseListing(listing.id)
            await refresh()
            setDetail(null)
            setStatus(`“${listing.title}” is now in your Owned section.`)
            setTab('owned')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Purchase failed.')
        } finally {
            setBusyId('')
        }
    }

    async function openOwned(purchase: MarketplacePurchase) {
        setBusyId(purchase.id)
        setError('')
        try {
            const version = await loadOwnedVersion(purchase.versionId)
            setOwned({ purchase, version })
            setPreviewPage(0)
            setAddFolder(orderedFolders[0] ?? '')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not open this purchase.')
        } finally {
            setBusyId('')
        }
    }

    async function addToWorkspace() {
        if (!owned) return
        setBusyId(owned.purchase.id)
        setError('')
        try {
            const pages = await detachVersionAssets(owned.version)
            onAddToWorkspace(owned.version, pages, addFolder)
            setStatus(`“${owned.version.title}” was added to your workspace. The original stays here in Owned.`)
            setOwned(null)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not add this lesson to your workspace.')
        } finally {
            setBusyId('')
        }
    }

    function openDetail(listing: MarketplaceListing) {
        setDetail(listing)
        setPreviewPage(0)
    }

    function openPublish(existing?: MarketplaceListing, lessonId = '') {
        setRepublishing(existing ?? null)
        setPublishLessonId(lessonId)
        setPublishDescription(existing?.description ?? '')
        setPublishPrice(existing ? String(existing.priceCents / 100) : '0')
        setShowPublish(true)
        setError('')
    }

    async function submitPublish() {
        const lesson = lessons.find((candidate) => candidate.id === publishLessonId)
        const price = Number(publishPrice)
        if (!lesson) { setError('Choose a lesson to publish.'); return }
        if (!Number.isFinite(price) || price < 0 || price > 1000) { setError('Enter a price between 0 and 1000 USD.'); return }
        setBusyId('publish')
        setError('')
        try {
            const pages: MarketplacePage[] = lesson.pages.map((name, index) => ({ name, background: backgroundsByPage[`${lesson.id}:${index}`], items: itemsByPage[`${lesson.id}:${index}`] ?? [] }))
            await publishLesson(userId, { listingId: republishing?.id, lesson, pages, description: publishDescription.trim(), priceCents: Math.round(price * 100) })
            setShowPublish(false)
            await refresh()
            setStatus(republishing ? 'A new version was published. Existing buyers keep the version they bought.' : 'Your lesson is now listed in the marketplace.')
            setTab('selling')
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not publish this lesson.')
        } finally {
            setBusyId('')
        }
    }

    async function toggleListing(listing: MarketplaceListing) {
        setBusyId(listing.id)
        setError('')
        try {
            await setListingStatus(listing.id, listing.status === 'published' ? 'unpublished' : 'published')
            await refresh()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not update this listing.')
        } finally {
            setBusyId('')
        }
    }

    const tabs: { id: Tab; label: string; icon: typeof Store; count?: number }[] = [
        { id: 'browse', label: 'Browse', icon: Store },
        { id: 'owned', label: 'Owned', icon: PackageCheck, count: purchases.length },
        { id: 'selling', label: 'My listings', icon: Upload, count: myListings.length },
    ]
    const previewPages = owned?.version.pages ?? []

    return (
        <div className="library-layout">
            <aside className="sidebar">
                <button className="create-primary" onClick={onClose}><ArrowLeft size={17} /> Back to workspace</button>
                {tabs.map(({ id: tabId, label, icon: Icon, count }) => <button key={tabId} className={`nav-item ${tab === tabId ? 'active' : ''}`} onClick={() => { setTab(tabId); setStatus('') }}><Icon size={17} /> {label}{count !== undefined && <span className="nav-count">{count}</span>}</button>)}
                <div className="sidebar-bottom"><div className="storage-icon"><BookOpen size={18} /></div><div><strong>Marketplace</strong><span>Share and discover lessons.</span></div></div>
            </aside>
            <main className="library-main">
                <div className="library-heading-row"><div><p className="eyebrow">MARKETPLACE</p><h1>{tab === 'browse' ? 'Discover lessons' : tab === 'owned' ? 'Owned' : 'My listings'}</h1><p className="library-subtitle">{tab === 'owned' ? 'Originals you purchased stay here. Add a copy to your workspace to edit it.' : tab === 'selling' ? 'Publish lessons for sale or for free.' : 'Lessons made by other teachers.'}</p></div>{tab === 'selling' && <button className="folder-create-button" onClick={() => openPublish()}><Upload size={16} /> Publish a lesson</button>}</div>
                {tab !== 'selling' && <div className="library-controls"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, teacher or tag" aria-label="Search marketplace" /></div></div>}
                {error && <p className="market-message error" role="alert">{error}</p>}
                {status && <p className="market-message" role="status">{status}</p>}
                {loading ? <p className="market-empty" role="status">Loading…</p> : <div className="lesson-grid market-grid">
                    {tab === 'browse' && (browseListings.length ? browseListings.map((listing) => <ListingCard key={listing.id} listing={listing} onOpen={() => openDetail(listing)} actions={<>{purchasedIds.has(listing.id) && <span className="market-owned-badge"><Check size={13} /> Owned</span>}<button className="mini" onClick={() => openDetail(listing)}><Eye size={13} /> Preview</button></>} />) : <p className="market-empty">No lessons found.</p>)}
                    {tab === 'owned' && (purchases.filter((purchase) => matches(purchase.listing)).length ? purchases.filter((purchase) => matches(purchase.listing)).map((purchase) => <ListingCard key={purchase.id} listing={purchase.listing} onOpen={() => void openOwned(purchase)} actions={<button className="mini primary" disabled={busyId === purchase.id} onClick={() => void openOwned(purchase)}>{busyId === purchase.id ? 'Opening…' : 'Open'}</button>} />) : <p className="market-empty">You haven’t purchased anything yet.</p>)}
                    {tab === 'selling' && (myListings.length ? myListings.map((listing) => <ListingCard key={listing.id} listing={listing} onOpen={() => openDetail(listing)} actions={<><span className={`market-owned-badge ${listing.status}`}>{listing.status === 'published' ? 'Live' : 'Hidden'}</span><button className="mini" disabled={busyId === listing.id} onClick={() => void toggleListing(listing)}>{listing.status === 'published' ? 'Unpublish' : 'Publish'}</button><button className="mini" onClick={() => openPublish(listing)}>New version</button></>} />) : <p className="market-empty">You haven’t published anything yet.</p>)}
                </div>}
            </main>

            {detail && <div className="modal-scrim" onClick={() => setDetail(null)}><div className="share-modal market-modal market-owned-modal" role="dialog" aria-modal="true" aria-label={detail.title} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setDetail(null) }}>
                <button type="button" className="modal-close" onClick={() => setDetail(null)} aria-label="Close"><X size={18} /></button>
                <h2>{detail.title}</h2>
                <p>by {detail.sellerName || 'SkyBoard teacher'} · {detail.pageCount} page{detail.pageCount === 1 ? '' : 's'}</p>
                <p className="market-description">{detail.description || 'No description provided.'}</p>
                {detail.previewPages[previewPage] ? <>
                    <PagePreview page={detail.previewPages[previewPage]} />
                    <div className="market-pager"><button className="mini icon" aria-label="Previous preview page" title="Previous page" disabled={previewPage === 0} onClick={() => setPreviewPage((page) => page - 1)}><ChevronLeft size={15} /></button><span>{detail.previewPages[previewPage].name} · {previewPage + 1} / {detail.previewPages.length}</span><button className="mini icon" aria-label="Next preview page" title="Next page" disabled={previewPage >= detail.previewPages.length - 1} onClick={() => setPreviewPage((page) => page + 1)}><ChevronRight size={15} /></button></div>
                    <p className="market-note">Previewing {detail.previewPages.length} of {detail.pageCount} page{detail.pageCount === 1 ? '' : 's'}. Full-quality images and PDFs are included after purchase.</p>
                </> : <p className="market-note">No preview is available for this lesson.</p>}
                <div className="new-lesson-actions"><span className={`market-price ${detail.priceCents === 0 ? 'free' : ''}`}>{formatPrice(detail.priceCents)}</span>
                    {detail.sellerId === userId ? null : purchasedIds.has(detail.id) ? <button className="confirm-button" onClick={() => { const purchase = purchases.find((candidate) => candidate.listing.id === detail.id); setDetail(null); if (purchase) void openOwned(purchase) }}><PackageCheck size={15} /> Already owned — open</button> : <button className="confirm-button" disabled={busyId === detail.id} onClick={() => void buy(detail)}>{busyId === detail.id ? 'Processing…' : detail.priceCents === 0 ? 'Get for free' : `Buy for ${formatPrice(detail.priceCents)}`}</button>}
                </div>
                {detail.priceCents > 0 && detail.sellerId !== userId && <p className="market-note">Checkout is simulated for now; no payment is taken.</p>}
            </div></div>}

            {owned && <div className="modal-scrim" onClick={() => setOwned(null)}><div className="share-modal market-modal market-owned-modal" role="dialog" aria-modal="true" aria-label={`${owned.version.title} (owned)`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setOwned(null) }}>
                <button type="button" className="modal-close" onClick={() => setOwned(null)} aria-label="Close"><X size={18} /></button>
                <h2>{owned.version.title}</h2>
                <p>Original purchase · read-only</p>
                {previewPages[previewPage] && <PagePreview page={previewPages[previewPage]} />}
                <div className="market-pager"><button className="mini icon" aria-label="Previous page" title="Previous page" disabled={previewPage === 0} onClick={() => setPreviewPage((page) => page - 1)}><ChevronLeft size={15} /></button><span>{previewPages[previewPage]?.name} · {previewPage + 1} / {previewPages.length}</span><button className="mini icon" aria-label="Next page" title="Next page" disabled={previewPage >= previewPages.length - 1} onClick={() => setPreviewPage((page) => page + 1)}><ChevronRight size={15} /></button></div>
                <label className="new-lesson-field">Add a copy to<select value={addFolder} onChange={(event) => setAddFolder(event.target.value)}><option value="">Marketplace (new folder)</option>{orderedFolders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></label>
                <div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setOwned(null)}>Close</button><button type="button" className="confirm-button" disabled={busyId === owned.purchase.id} onClick={() => void addToWorkspace()}><Download size={15} /> {busyId === owned.purchase.id ? 'Adding…' : 'Add to my workspace'}</button></div>
            </div></div>}

            {showPublish && <div className="modal-scrim" onClick={() => setShowPublish(false)}><form className="share-modal market-modal" role="dialog" aria-modal="true" aria-label="Publish a lesson" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setShowPublish(false) }} onSubmit={(event) => { event.preventDefault(); void submitPublish() }}>
                <button type="button" className="modal-close" onClick={() => setShowPublish(false)} aria-label="Close"><X size={18} /></button>
                <h2>{republishing ? `New version of “${republishing.title}”` : 'Publish a lesson'}</h2>
                <p>A snapshot of the lesson is published. Later edits to your lesson don’t change what buyers own.</p>
                <label className="new-lesson-field">Lesson<select value={publishLessonId} onChange={(event) => setPublishLessonId(event.target.value)} required><option value="">Choose a lesson…</option>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title} ({lesson.folder})</option>)}</select></label>
                <label className="new-lesson-field">Description<textarea className="postit-textarea" value={publishDescription} maxLength={4000} onChange={(event) => setPublishDescription(event.target.value)} /></label>
                <label className="new-lesson-field">Price (USD, 0 for free)<input type="number" min="0" max="1000" step="0.01" value={publishPrice} onChange={(event) => setPublishPrice(event.target.value)} /></label>
                {error && <p className="market-message error" role="alert">{error}</p>}
                <div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={() => setShowPublish(false)}>Cancel</button><button type="submit" className="confirm-button" disabled={busyId === 'publish' || !publishLessonId}><Upload size={15} /> {busyId === 'publish' ? 'Publishing…' : 'Publish'}</button></div>
            </form></div>}
        </div>
    )
}
