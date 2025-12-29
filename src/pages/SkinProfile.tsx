import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

const SKIN_TYPES = ['dry', 'oily', 'combination', 'sensitive', 'normal']

const SKIN_CONCERNS = [
  'acne',
  'wrinkles',
  'dryness',
  'oiliness',
  'sensitivity',
  'hyperpigmentation',
  'redness',
  'uneven-texture',
]

export const SkinProfile = () => {
  const { user, updateProfile } = useAuth()
  const navigate = useNavigate()

  const [skinType, setSkinType] = useState(
    Array.isArray(user?.skin_type) && user.skin_type.length > 0
      ? user.skin_type[0]
      : typeof user?.skin_type === 'string'
      ? user.skin_type
      : ''
  )
  const [skinConcerns, setSkinConcerns] = useState<string[]>(user?.skin_concerns || [])
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold mb-4">Not Signed In</h1>
        <Button onClick={() => navigate('/')}>Back to Home</Button>
      </div>
    )
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      setSaved(false)
      const updates: Parameters<typeof updateProfile>[0] = {
        skin_type: skinType || null,
        skin_concerns: skinConcerns,
      }
      await updateProfile(updates)
      toast.success('Skin profile updated')
      setSaved(true)
    } catch (error) {
      console.error('Failed to update skin profile:', error)
      toast.error('Failed to update skin profile')
    } finally {
      setLoading(false)
    }
  }

  const toggleConcern = (concern: string) => {
    setSkinConcerns((prev) =>
      prev.includes(concern) ? prev.filter((c) => c !== concern) : [...prev, concern]
    )
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
            <h1 className="text-3xl font-bold">Skin Profile</h1>
            <p className="text-gray-600">Tell us about your skin for personalized recommendations</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Your Skin</CardTitle>
            <CardDescription>This helps us tailor ingredient recommendations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Skin Type */}
            <div className="space-y-2">
              <Label htmlFor="skinType">Skin Type</Label>
              <Select value={skinType} onValueChange={setSkinType}>
                <SelectTrigger id="skinType">
                  <SelectValue placeholder="Select your skin type" />
                </SelectTrigger>
                <SelectContent>
                  {SKIN_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Skin Concerns */}
            <div className="space-y-3">
              <Label>Skin Concerns</Label>
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Select all that apply:</p>
                <div className="flex flex-wrap gap-2">
                  {SKIN_CONCERNS.map((concern) => (
                    <Badge
                      key={concern}
                      variant={
                        skinConcerns.includes(concern) ? 'default' : 'outline'
                      }
                      className="cursor-pointer"
                      onClick={() => toggleConcern(concern)}
                    >
                      {concern
                        .split('-')
                        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <Button
              onClick={handleSave}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Skin Profile'
              )}
            </Button>
            {saved && (
              <p className="text-sm text-green-700 text-center">Changes have been saved.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
