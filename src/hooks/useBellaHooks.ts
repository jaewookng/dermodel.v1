import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BellaHook {
  id: string;
  /** Full clickbait line, shown in the bubble on hover. */
  text: string;
  /** Brief label for the chip row. Older deploys may omit it. */
  short?: string;
  /** Sent to the `chat` function when the user clicks this hook. */
  prompt: string;
  kind: 'browse' | 'personal';
}

/**
 * Bella's opening one-liners, built server-side by `bella-hooks` from a few-hop
 * traversal over our own tables — no LLM until the user actually clicks one.
 *
 * `userId` is only used as a cache key so the hooks re-fetch when the user signs
 * in or out; the function itself reads favorites from the forwarded JWT.
 */
export const useBellaHooks = (userId: string | null) => {
  return useQuery({
    queryKey: ['bella-hooks', userId ?? 'anon'],
    queryFn: async (): Promise<BellaHook[]> => {
      const { data, error } = await supabase.functions.invoke('bella-hooks', {
        body: {},
      });
      if (error) throw error;
      const hooks = Array.isArray(data?.hooks) ? data.hooks : [];
      return hooks.filter(
        (h: unknown): h is BellaHook =>
          !!h &&
          typeof (h as BellaHook).text === 'string' &&
          typeof (h as BellaHook).prompt === 'string'
      );
    },
    // Hooks are cheap but not free, and they're flavor — don't refetch on every
    // remount or focus change.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
};
