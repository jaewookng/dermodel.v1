import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { UpgradeDialog } from '@/components/billing/UpgradeDialog';
import { LoginDialog } from '@/components/Auth/LoginDialog';

interface UpgradeContextValue {
  /** Opens the Premium plan picker from anywhere in the app. */
  openUpgrade: () => void;
}

const UpgradeContext = createContext<UpgradeContextValue | null>(null);

/**
 * Hosts the one Premium dialog so every entry point (Settings, Bella's limit
 * wall, the header menu) opens the same picker instead of each wiring its own
 * checkout call. Owns a login dialog too, for signed-out visitors who pick a
 * plan before signing in.
 */
export const UpgradeProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const openUpgrade = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openUpgrade }), [openUpgrade]);

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <UpgradeDialog open={open} onOpenChange={setOpen} onSignIn={() => setLoginOpen(true)} />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </UpgradeContext.Provider>
  );
};

export const useUpgrade = (): UpgradeContextValue => {
  const ctx = useContext(UpgradeContext);
  if (!ctx) throw new Error('useUpgrade must be used inside <UpgradeProvider>');
  return ctx;
};
