import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Mail, MessageCircle } from 'lucide-react'

export const Support = () => {
  const navigate = useNavigate()

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
            <h1 className="text-3xl font-bold">Support</h1>
            <p className="text-gray-600">How can we help you?</p>
          </div>
        </div>

        {/* Contact Options */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Support
              </CardTitle>
              <CardDescription>Get help via email</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                For questions, feedback, or issues, reach out to us at:
              </p>
              <a
                href="mailto:support@dermodel.com"
                className="text-violet-600 hover:underline font-medium"
              >
                support@dermodel.com
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                FAQs
              </CardTitle>
              <CardDescription>Common questions answered</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-medium text-sm">How do I save a product?</p>
                <p className="text-sm text-gray-600">
                  Tap the heart icon next to a product to add it to your favorites list.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm">Where does the ingredient data come from?</p>
                <p className="text-sm text-gray-600">
                  Our ingredient data is sourced from product ingredient lists and verified databases.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm">How do I delete my account?</p>
                <p className="text-sm text-gray-600">
                  Go to Settings and scroll to the bottom to find the delete account option.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
