import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

/** How OFTEN a product is used. When it's used is `CabinetRoutine`. */
export type CabinetFrequency =
  | 'daily'
  | 'every_other_day'
  | 'weekly'
  | 'as_needed';

export const FREQUENCY_LABELS: Record<CabinetFrequency, string> = {
  daily: 'Every day',
  every_other_day: 'Every other day',
  weekly: 'Weekly',
  as_needed: 'As needed',
};

/** WHEN it's used. 'both' doubles the daily rate, so it halves the estimate. */
export type CabinetRoutine = 'am' | 'pm' | 'both';

export const ROUTINE_LABELS: Record<CabinetRoutine, string> = {
  am: 'AM',
  pm: 'PM',
  both: 'Both',
};

export interface CabinetItem {
  id: string;
  product_id: string;
  product_name: string | null;
  image_url: string | null;
  opened_on: string;
  frequency: CabinetFrequency;
  routine: CabinetRoutine;
  size_ml: number | null;
  dose_ml: number | null;
  status: 'active' | 'finished' | 'discarded';
  /** Null when we couldn't parse a size from the product name. */
  days_supply: number | null;
  estimated_empty_on: string | null;
}

/**
 * The user's cabinet — what they own, and when it's due to run out.
 *
 * Reads `my_cabinet`, which computes the replenishment estimate in SQL so the
 * client and the check-in emails can never disagree about a date. Size and dose
 * are filled in by a trigger from the product name; both stay editable because
 * the parser misses ~11% of names and guesses the dose from keywords.
 */
export const useCabinet = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['cabinet', user?.id],
    queryFn: async (): Promise<CabinetItem[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('my_cabinet')
        .select('*')
        .order('estimated_empty_on', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as unknown as CabinetItem[];
    },
    enabled: !!user,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['cabinet', user?.id] });

  const addItem = useMutation({
    mutationFn: async (input: {
      productId: string;
      frequency?: CabinetFrequency;
      routine?: CabinetRoutine;
      openedOn?: string;
    }) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase.from('cabinet_items').insert({
        user_id: user.id,
        product_id: input.productId,
        frequency: input.frequency ?? 'daily',
        routine: input.routine ?? 'both',
        // Omitted size_ml/dose_ml on purpose: the trigger derives them.
        ...(input.openedOn ? { opened_on: input.openedOn } : {}),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: async (input: {
      id: string;
      frequency?: CabinetFrequency;
      routine?: CabinetRoutine;
      sizeMl?: number | null;
      openedOn?: string;
      status?: CabinetItem['status'];
    }) => {
      const payload: Record<string, unknown> = {};
      if (input.frequency) payload.frequency = input.frequency;
      if (input.routine) payload.routine = input.routine;
      if (input.sizeMl !== undefined) payload.size_ml = input.sizeMl;
      if (input.openedOn) payload.opened_on = input.openedOn;
      if (input.status) payload.status = input.status;
      const { error } = await supabase
        .from('cabinet_items')
        .update(payload)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cabinet_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    addItem,
    updateItem,
    removeItem,
  };
};

/** Human phrasing for the estimate, or null when we couldn't compute one. */
export const describeRemaining = (item: CabinetItem): string | null => {
  if (!item.estimated_empty_on) return null;
  const days = Math.round(
    (new Date(item.estimated_empty_on).getTime() - Date.now()) / 86_400_000
  );
  if (days < 0) return 'Probably empty by now';
  if (days === 0) return 'Running out today';
  if (days === 1) return 'About a day left';
  if (days < 14) return `About ${days} days left`;
  if (days < 60) return `About ${Math.round(days / 7)} weeks left`;
  return `About ${Math.round(days / 30)} months left`;
};
