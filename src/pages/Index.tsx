import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FaceModel } from '@/components/FaceModel';
import { OptimizedIngredientDatabase } from '@/components/OptimizedIngredientDatabase';
import { useAuth } from '@/contexts/AuthContext';
import { LoginDialog } from '@/components/Auth/LoginDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogIn, LogOut, Settings, Heart, User } from 'lucide-react';
import { toast } from 'sonner';

const Index = () => {
  const { session, user, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginOpen, setLoginOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const initialTab =
    ((location.state as { tab?: 'ingredients' | 'products' } | null)?.tab) || 'ingredients';

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      await signOut();
      toast.success('Signed out successfully');
    } catch (error) {
      console.error('Sign out failed:', error);
      toast.error('Failed to sign out');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden" style={{ backgroundColor: 'white' }}>
      {/* Header with Service Name and Auth Menu */}
      <div className="absolute top-6 left-6 right-6 z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="focus:outline-none focus:ring-2 focus:ring-violet-500 rounded-md">
                <img
                  src="/favicon.ico"
                  alt="Dermodel"
                  className="w-8 h-8 rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {loading ? (
                <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
              ) : session && user ? (
                <>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.username || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/favorites')}>
                    <Heart className="mr-2 h-4 w-4" />
                    <span>Favorites</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/skin-profile')}>
                    <User className="mr-2 h-4 w-4" />
                    <span>Skin Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuLabel>Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLoginOpen(true)}>
                    <LogIn className="mr-2 h-4 w-4" />
                    <span>Sign In / Sign Up</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <h1 className="text-2xl font-bold text-black">dermodel</h1>
        </div>
      </div>

      {/* Login Dialog */}
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />

      {/* 3D Face Model - Full screen canvas that extends behind table */}
      <div className="fixed inset-0">
        <FaceModel />
      </div>
      {/* Compact Ingredient Database Overlay - Fixed on the right */}
      <div className="fixed top-0 right-0 w-96 h-screen p-4 pointer-events-none z-10">
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-2xl h-full overflow-hidden pointer-events-auto">
          <OptimizedIngredientDatabase initialTab={initialTab} />
        </div>
      </div>
    </div>
  );
};

export default Index;
