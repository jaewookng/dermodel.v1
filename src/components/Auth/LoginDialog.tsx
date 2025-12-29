import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Mail, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const LoginDialog = ({ open, onOpenChange }: LoginDialogProps) => {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth()
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [signUpSuccess, setSignUpSuccess] = useState(false)

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true)
      await signInWithGoogle()
    } catch (error) {
      console.error('Google sign-in failed:', error)
      toast.error('Failed to sign in with Google')
    } finally {
      setLoading(false)
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error('Please enter email and password')
      return
    }

    try {
      setLoading(true)
      if (isSignUp) {
        await signUpWithEmail(email, password, displayName || undefined)
        setSignUpSuccess(true)
      } else {
        await signInWithEmail(email, password)
        toast.success('Signed in successfully!')
        onOpenChange(false)
      }
    } catch (error: any) {
      console.error('Email auth failed:', error)
      toast.error(error.message || `Failed to ${isSignUp ? 'sign up' : 'sign in'}`)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setEmail('')
    setPassword('')
    setDisplayName('')
    setSignUpSuccess(false)
    setIsSignUp(false)
  }

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetForm()
      onOpenChange(open)
    }}>
      <DialogContent className="sm:max-w-md">
        {signUpSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle>Check Your Email</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center py-6 space-y-4">
              <div className="rounded-full bg-green-100 p-3">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  We've sent a confirmation link to
                </p>
                <p className="font-medium">{email}</p>
                <p className="text-sm text-gray-500">
                  Click the link in your email to activate your account.
                </p>
              </div>
              <Button
                onClick={() => onOpenChange(false)}
                className="w-full mt-4"
              >
                Got it
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{isSignUp ? 'Create Account' : 'Sign In'}</DialogTitle>
              <DialogDescription>
                {isSignUp
                  ? 'Create an account to save favorite products and track your skincare journey.'
                  : 'Sign in to access your saved products and preferences.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
          <Button
            onClick={handleGoogleSignIn}
            disabled={loading}
            variant="outline"
            className="w-full"
            size="lg"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <img src="/icons8-google.svg" alt="Google" className="mr-2 h-4 w-4" />
            )}
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3">
            {isSignUp && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
                  <Input
                    id="displayName"
                    type="text"
                    placeholder="username"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={loading}
                    className="pl-7"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </Button>
          </form>

          <div className="text-center text-sm">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-violet-600 hover:underline"
              disabled={loading}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
