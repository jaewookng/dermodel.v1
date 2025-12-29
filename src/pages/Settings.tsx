import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

export const Settings = () => {
  const { user, updateProfile } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState(user?.username || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold mb-4">Not Signed In</h1>
        <Button onClick={() => navigate('/')}>Back to Home</Button>
      </div>
    )
  }

  const handleSaveProfile = async () => {
    try {
      setLoading(true)
      setSaved(false)
      await updateProfile({
        username,
        bio,
      })
      toast.success('Profile updated successfully')
      setSaved(true)
    } catch (error) {
      console.error('Failed to update profile:', error)
      toast.error('Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    try {
      setDeleting(true)
      // TODO: Implement account deletion in backend
      toast.error('Account deletion is not yet available')
    } catch (error) {
      console.error('Delete account failed:', error)
      toast.error('Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="mr-4"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-gray-600">Manage your profile and preferences</p>
          </div>
        </div>

        {/* Profile Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Email (Read-only) */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="bg-gray-100"
              />
              <p className="text-xs text-gray-500">Your email cannot be changed</p>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  className="pl-7"
                />
              </div>
            </div>

            {/* Bio */}
            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about your skincare journey..."
                className="resize-none"
                rows={4}
              />
            </div>

            {/* Save Button */}
            <Button
              onClick={handleSaveProfile}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Profile'
              )}
            </Button>
            {saved && (
              <p className="text-sm text-green-700 text-center mt-1">Changes have been saved.</p>
            )}
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-100">
          <CardHeader className="pb-3">
            <p className="text-sm text-red-600">Danger zone</p>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleDeleteAccount}
              disabled={deleting}
              variant="destructive"
              className="w-full"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Account'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
