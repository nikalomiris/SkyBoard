import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, Check, ExternalLink, Globe, X } from 'lucide-react'
import { checkEmbeddable, parseWebUrl, webHostname } from '../lib/webEmbed'
import type { EmbedCheck } from '../lib/webEmbed'

type WebPageDialogProps = { onClose: () => void; onAdd: (url: string, title: string) => void }

export default function WebPageDialog({ onClose, onAdd }: WebPageDialogProps) {
    const [input, setInput] = useState('')
    const [checking, setChecking] = useState(false)
    const [error, setError] = useState('')
    const [result, setResult] = useState<{ url: string; check: EmbedCheck } | null>(null)

    async function handleCheck(event: FormEvent) {
        event.preventDefault()
        if (checking) return
        const parsed = parseWebUrl(input)
        setResult(null)
        if (!parsed) {
            setError("That doesn't look like a web address we can use. Please paste a full address that starts with https://")
            return
        }
        setError('')
        setChecking(true)
        const check = await checkEmbeddable(parsed.href)
        setResult({ url: parsed.href, check })
        setChecking(false)
    }

    const status = result?.check.status

    return <div className="modal-scrim" onClick={onClose}>
        <form className="share-modal web-page-modal" role="dialog" aria-modal="true" aria-labelledby="web-page-title" onClick={(event) => event.stopPropagation()} onSubmit={handleCheck}>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
            <div className="share-modal-icon"><Globe size={20} /></div>
            <h2 id="web-page-title">Add a web page</h2>
            <p>Paste the address of a game or web page to show it inside this lesson page.</p>
            <label className="image-url-label">WEB ADDRESS
                <input value={input} onChange={(event) => { setInput(event.target.value); setResult(null); setError('') }} placeholder="Paste the web address of your game or page here" aria-label="Web address" autoFocus disabled={checking} />
            </label>
            {error && <p className="web-check web-check-blocked" role="alert"><AlertTriangle size={16} /><span>{error}</span></p>}
            {result && <div className={`web-check web-check-${status}`} role={status === 'allowed' ? 'status' : 'alert'}>
                {status === 'allowed' ? <Check size={16} /> : <AlertTriangle size={16} />}
                <span>
                    <strong>{status === 'allowed' ? 'Good news: this page should work here.' : status === 'blocked' ? 'This page will most likely appear blank.' : "We can't tell if this page will work here."}</strong>
                    <span className="web-check-detail">{status === 'allowed'
                        ? 'It should load inside your lesson, and you can play or use it right on the page.'
                        : status === 'blocked'
                            ? 'This website does not let other sites display it, so you will probably see an empty box with nothing to click. You can still open it in a new tab, but it will not be part of the lesson page.'
                            : 'The page might load normally, or it might show up as an empty box. Add it and take a quick look before your lesson. If it stays blank, use "Open in new tab" instead.'}</span>
                </span>
            </div>}
            {result ? <div className="web-page-actions">
                <button type="button" className="insert-image-button" onClick={() => onAdd(result.url, webHostname(result.url))}>{status === 'allowed' ? 'Add to page' : 'Add it anyway'}</button>
                <a className="web-open-link" href={result.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open in new tab</a>
            </div> : <button type="submit" className="insert-image-button" disabled={!input.trim() || checking}>{checking ? 'Checking…' : 'Check page'}</button>}
        </form>
    </div>
}
