import { useState } from 'react'
import { ArrowRight, AudioLines, Check, LockKeyhole, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

type AuthMode = 'sign-in' | 'sign-up'
type AuthScreenProps = { loading?: boolean; loadingTitle?: string; loadingMessage?: string }

export default function AuthScreen({ loading = false, loadingTitle, loadingMessage }: AuthScreenProps) {
    const [mode, setMode] = useState<AuthMode>('sign-in')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [errorMessage, setErrorMessage] = useState('')

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!supabase || loading || busy) return
        setBusy(true)
        setMessage('')
        setErrorMessage('')
        try {
            if (mode === 'sign-in') {
                const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
                if (error) throw error
            } else {
                const { data, error } = await supabase.auth.signUp({
                    email: email.trim(),
                    password,
                    options: { emailRedirectTo: window.location.origin },
                })
                if (error) throw error
                if (!data.session) setMessage('Check your email to confirm your account, then come back to sign in.')
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Authentication failed. Please try again.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <main className="auth-screen">
            <section className="auth-panel" aria-labelledby="auth-title">
                <div className="auth-brand"><span className="brand-mark"><AudioLines size={19} /></span><span>skyboard</span></div>
                <p className="eyebrow">THERAPIST WORKSPACE</p>
                <h1 id="auth-title">{loading ? loadingTitle ?? 'Checking your session' : mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
                <p className="auth-intro">{loading ? loadingMessage ?? 'Connecting securely to your workspace.' : mode === 'sign-in' ? 'Sign in to continue to your lessons.' : 'Use your email to set up your therapist workspace.'}</p>
                {!loading && <form className="auth-form" onSubmit={submit}>
                    <label className="auth-field"><span>Email</span><span className="auth-input-wrap"><Mail size={16} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></span></label>
                    <label className="auth-field"><span>Password</span><span className="auth-input-wrap"><LockKeyhole size={16} /><input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label>
                    {errorMessage && <p className="auth-feedback error" role="alert">{errorMessage}</p>}
                    {message && <p className="auth-feedback success" role="status"><Check size={15} />{message}</p>}
                    <button type="submit" className="auth-submit" disabled={busy || !email.trim() || password.length < 8}>
                        {busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
                        {!busy && <ArrowRight size={16} />}
                    </button>
                </form>}
                {!loading && <button type="button" className="auth-mode-toggle" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(''); setErrorMessage('') }}>
                    {mode === 'sign-in' ? 'New to SkyBoard? Create an account' : 'Already have an account? Sign in'}
                </button>}
                {!loading && <p className="auth-local-note">Your lessons and student folders sync to your Supabase workspace after sign-in.</p>}
            </section>
        </main>
    )
}
