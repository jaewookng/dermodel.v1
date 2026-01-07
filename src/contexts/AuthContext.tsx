import React, { createContext, useContext, useEffect, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/types'

type ProfileRow = Database['public']['Tables']['profiles']['Row']
type ProfileInsert = Database['public']['Tables']['profiles']['Insert']

interface AuthContextType {
  session: Session | null
  user: ProfileRow | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (
    updates: Partial<Pick<ProfileRow, 'username' | 'avatar_url' | 'bio' | 'skin_concerns'>> & {
      skin_type?: string | string[] | null
    }
  ) => Promise<ProfileRow>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const getFallbackProfileFromSession = (session: Session | null): ProfileRow | null => {
  if (!session?.user) return null

  return {
    id: session.user.id,
    email: session.user.email || '',
    username:
      session.user.user_metadata?.username ||
      session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      null,
    avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null,
    bio: null,
    skin_type: null,
    skin_concerns: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

const normalizeSkinType = (value: string | string[] | null | undefined): string[] | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => v.trim()).filter(Boolean)
    return cleaned.length ? cleaned : null
  }
  const cleaned = value.trim()
  return cleaned ? [cleaned] : null
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async (currentSession: Session | null) => {
    if (!currentSession?.user) {
      setUser(null)
      return
    }

    const fallback = getFallbackProfileFromSession(currentSession)
    if (fallback) {
      setUser((prev) => (prev && prev.id === fallback.id ? prev : fallback))
    }

    const userId = currentSession.user.id
    const email = currentSession.user.email || ''

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error
      if (data) {
        setUser(data)
        return
      }

      if (!fallback) return

      const { data: upserted, error: upsertError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: userId,
            email,
            username: fallback.username,
            avatar_url: fallback.avatar_url,
          },
          { onConflict: 'id' }
        )
        .select('*')
        .single()

      if (upsertError) throw upsertError
      setUser(upserted)
    } catch (error) {
      console.error('Failed to load profile:', error)
      setUser(getFallbackProfileFromSession(currentSession))
    }
  }

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError) {
          console.error('Session error:', sessionError)
        }

        setSession(currentSession)
        await loadProfile(currentSession)
      } catch (error) {
        console.error('Failed to initialize auth:', error)
      } finally {
        setLoading(false)
      }
    }

    initializeAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log('Auth state changed:', event)
      setSession(newSession)
      await loadProfile(newSession)
    })

    return () => subscription?.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}`,
      },
    })
    if (error) throw error
  }

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}`,
        data: displayName ? { username: displayName } : undefined,
      },
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setSession(null)
    setUser(null)
  }

  const updateProfile: AuthContextType['updateProfile'] = async (updates) => {
    const userId = session?.user?.id
    const email = session?.user?.email || user?.email

    if (!userId) throw new Error('Not authenticated')
    if (!email) throw new Error('Missing email for profile upsert')

    const payload: ProfileInsert = {
      id: userId,
      email,
    }

    if (updates.username !== undefined) payload.username = updates.username
    if (updates.avatar_url !== undefined) payload.avatar_url = updates.avatar_url
    if (updates.bio !== undefined) payload.bio = updates.bio
    if (updates.skin_concerns !== undefined) payload.skin_concerns = updates.skin_concerns

    if ('skin_type' in updates) {
      payload.skin_type = normalizeSkinType(updates.skin_type)
    }

    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single()

    if (error) throw error
    setUser(data)
    return data
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
