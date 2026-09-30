import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export interface RoutineRecommendation {
  product_id: string;
  product_name: string | null;
  image_url: string | null;
  /** The routine slot most people keep it in. */
  routine: 'am' | 'pm' | 'both' | null;
  /** How many public routines contain it. */
  shared_by: number;
  /** Total overlap between those routines and the caller's — the ranking key. */
  overlap: number;
}

/**
 * Public routine toggle + the recommendations it unlocks.
 *
 * `routine_recommendations()` is server-gated on the caller's own
 * `routine_public` flag: the pool is only visible from inside it. The client
 * mirrors that gate purely for the UI (locked vs unlocked state); it never has
 * a way to read the pool while private.
 */
export const useRoutineSharing = () => {
  const { user, updateProfile } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const isPublic = user?.routine_public ?? false;

  const recommendations = useQuery({
    queryKey: ['routine-recommendations', userId],
    queryFn: async (): Promise<RoutineRecommendation[]> => {
      const { data, error } = await supabase.rpc('routine_recommendations', { p_limit: 12 });
      if (error) throw error;
      return (data ?? []) as RoutineRecommendation[];
    },
    enabled: !!userId && isPublic,
  });

  // Shown while locked: "N people have made their routine public".
  const poolSize = useQuery({
    queryKey: ['routine-pool-size', userId],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('routine_recommendations_count');
      if (error) throw error;
      return data ?? 0;
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  // Through updateProfile so the AuthContext copy of the profile (where
  // `isPublic` is read from) updates in the same tick as the row.
  const setPublic = useMutation({
    mutationFn: async (value: boolean) => {
      if (!userId) throw new Error('Not signed in');
      await updateProfile({ routine_public: value });
      return value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routine-recommendations', userId] });
      queryClient.invalidateQueries({ queryKey: ['routine-pool-size', userId] });
    },
  });

  const shareUrl = user
    ? `${window.location.origin}/r/${encodeURIComponent(user.username || user.id)}`
    : null;

  const referralUrl =
    user && user.referral_code ? `${window.location.origin}/?ref=${user.referral_code}` : null;

  return {
    isPublic,
    setPublic,
    shareUrl,
    referralUrl,
    recommendations: recommendations.data ?? [],
    recommendationsLoading: recommendations.isLoading,
    poolSize: poolSize.data ?? 0,
  };
};
