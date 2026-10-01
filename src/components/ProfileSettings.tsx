import { useEffect, useState } from 'react'
import { Camera, Check, LockKeyhole, Mail, Save, Trash2, UserRound, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const avatarBucket = 'profile-avatars'
const avatarLimitBytes = 5 * 1024 * 1024

type ProfileSettingsProps = {
    userId: string
    email: string
    initialDisplayName: string
    onClose: () => void
    onSaved: (displayName: string, avatarUrl: string | null) => void
}

export default function ProfileSettings({ userId, email, initialDisplayName, onClose, onSaved }: ProfileSettingsProps) {
    const [displayName, setDisplayName] = useState(initialDisplayName)
    const [avatarPath, setAvatarPath] = useState<string | null>(null)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [removeAvatar, setRemoveAvatar] = useState(false)
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(true)
    const [savingProfile, setSavingProfile] = useState(false)
    const [savingPassword, setSavingPassword] = useState(false)
    const [profileError, setProfileError] = useState('')
    const [profileMessage, setProfileMessage] = useState('')
    const [passwordError, setPasswordError] = useState('')
    const [passwordMessage, setPasswordMessage] = useState('')

    useEffect(() => {
        if (!avatarFile) {
            setAvatarPreview(null)
            return
        }
        const preview = URL.createObjectURL(avatarFile)
        setAvatarPreview(preview)
        return () => URL.revokeObjectURL(preview)
    }, [avatarFile])

    useEffect(() => {
        let active = true
        async function loadProfile() {
            if (!supabase) return
            const { data, error } = await supabase.from('profiles').select('display_name,avatar_path').eq('id', userId).maybeSingle()
            if (error) {
                if (active) setProfileError(error.message)
            } else if (active) {
                const nextName = data?.display_name || initialDisplayName
                setDisplayName(nextName)
                setAvatarPath(data?.avatar_path ?? null)
                if (data?.avatar_path) {
                    const signed = await supabase.storage.from(avatarBucket).createSignedUrl(data.avatar_path, 60 * 60 * 24)
                    if (active && !signed.error) setAvatarUrl(signed.data.signedUrl)
                    else if (active && signed.error) setProfileError(signed.error.message)
                }
            }
            if (active) setLoading(false)
        }
        void loadProfile().catch((error: unknown) => {
            if (!active) return
            setProfileError(error instanceof Error ? error.message : 'Unable to load your profile.')
            setLoading(false)
        })
        return () => { active = false }
    }, [initialDisplayName, userId])

    function chooseAvatar(file?: File) {
        if (!file) return
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setProfileError('Choose a JPG, PNG, or WebP image.')
            return
        }
        if (file.size > avatarLimitBytes) {
            setProfileError('Choose an image smaller than 5 MB.')
            return
        }
        setProfileError('')
        setProfileMessage('')
        setAvatarFile(file)
        setRemoveAvatar(false)
    }

    async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!supabase || savingProfile) return
        const cleanedName = displayName.trim()
        if (!cleanedName) return setProfileError('Enter a display name.')
        setSavingProfile(true)
        setProfileError('')
        setProfileMessage('')
        let uploadedPath: string | null = null
        try {
            let nextAvatarPath = removeAvatar ? null : avatarPath
            if (avatarFile) {
                const extension = avatarFile.type === 'image/png' ? 'png' : avatarFile.type === 'image/webp' ? 'webp' : 'jpg'
                uploadedPath = `${userId}/${crypto.randomUUID()}.${extension}`
                const uploaded = await supabase.storage.from(avatarBucket).upload(uploadedPath, avatarFile, { contentType: avatarFile.type, upsert: false })
                if (uploaded.error) throw uploaded.error
                nextAvatarPath = uploadedPath
            }

            const userUpdate = await supabase.auth.updateUser({ data: { display_name: cleanedName } })
            if (userUpdate.error) throw userUpdate.error
            const profileUpdate = await supabase.from('profiles').update({ display_name: cleanedName, avatar_path: nextAvatarPath }).eq('id', userId)
            if (profileUpdate.error) throw profileUpdate.error

            let nextAvatarUrl: string | null = null
            if (nextAvatarPath) {
                const signed = await supabase.storage.from(avatarBucket).createSignedUrl(nextAvatarPath, 60 * 60 * 24)
                if (signed.error) throw signed.error
                nextAvatarUrl = signed.data.signedUrl
            }
            if (avatarPath && avatarPath !== nextAvatarPath) {
                await supabase.storage.from(avatarBucket).remove([avatarPath])
            }
            setAvatarPath(nextAvatarPath)
            setAvatarUrl(nextAvatarUrl)
            setAvatarFile(null)
            setRemoveAvatar(false)
            onSaved(cleanedName, nextAvatarUrl)
            setProfileMessage('Profile saved.')
        } catch (error) {
            if (uploadedPath) await supabase.storage.from(avatarBucket).remove([uploadedPath])
            setProfileError(error instanceof Error ? error.message : 'Unable to save your profile.')
        } finally {
            setSavingProfile(false)
        }
    }

    async function savePassword(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!supabase || savingPassword) return
        if (newPassword.length < 8) return setPasswordError('Use at least 8 characters.')
        if (newPassword !== confirmPassword) return setPasswordError('Passwords do not match.')
        setSavingPassword(true)
        setPasswordError('')
        setPasswordMessage('')
        try {
            const result = await supabase.auth.updateUser({ password: newPassword })
            if (result.error) throw result.error
            setNewPassword('')
            setConfirmPassword('')
            setPasswordMessage('Password updated.')
        } catch (error) {
            setPasswordError(error instanceof Error ? error.message : 'Unable to update your password.')
        } finally {
            setSavingPassword(false)
        }
    }

    const visibleAvatar = avatarPreview ?? (removeAvatar ? null : avatarUrl)
    const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || email.slice(0, 1).toUpperCase()

    return (
        <div className="modal-scrim profile-scrim" onClick={onClose}>
            <section className="share-modal profile-settings-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="modal-close" onClick={onClose} aria-label="Close profile settings"><X size={18} /></button>
                <div className="share-modal-icon"><UserRound size={20} /></div>
                <h2 id="profile-title">Profile settings</h2>
                <p>Update how you appear in your teaching workspace.</p>
                {loading ? <div className="profile-loading">Loading profile…</div> : <>
                    <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
                        <div className="profile-avatar-row">
                            <div className="profile-avatar-preview">{visibleAvatar ? <img src={visibleAvatar} alt="Profile" /> : initials}</div>
                            <div className="profile-avatar-actions">
                                <label className="profile-upload-button"><Camera size={14} /> Change photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseAvatar(event.target.files?.[0])} /></label>
                                {(avatarPath || avatarFile) && <button type="button" className="profile-remove-photo" onClick={() => { setAvatarFile(null); setRemoveAvatar(true); setProfileError('') }}><Trash2 size={14} /> Remove photo</button>}
                                <span>JPG, PNG, or WebP · Max 5 MB</span>
                            </div>
                        </div>
                        <label className="new-lesson-field">Display name<input autoComplete="name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
                        <label className="new-lesson-field">Email<span className="profile-email-value"><Mail size={14} />{email}</span></label>
                        {profileError && <p className="auth-feedback error" role="alert">{profileError}</p>}
                        {profileMessage && <p className="auth-feedback success" role="status"><Check size={15} />{profileMessage}</p>}
                        <div className="new-lesson-actions"><button type="button" className="cancel-button" onClick={onClose}>Close</button><button type="submit" className="confirm-button" disabled={savingProfile || !displayName.trim()}><Save size={15} />{savingProfile ? 'Saving…' : 'Save profile'}</button></div>
                    </form>
                    <form className="profile-password-form" onSubmit={(event) => void savePassword(event)}>
                        <h3>Change password</h3>
                        <label className="new-lesson-field">New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                        <label className="new-lesson-field">Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
                        {passwordError && <p className="auth-feedback error" role="alert">{passwordError}</p>}
                        {passwordMessage && <p className="auth-feedback success" role="status"><Check size={15} />{passwordMessage}</p>}
                        <button type="submit" className="auth-submit" disabled={savingPassword || newPassword.length < 8 || !confirmPassword}>{savingPassword ? 'Updating…' : 'Update password'}<LockKeyhole size={15} /></button>
                    </form>
                </>}
            </section>
        </div>
    )
}
