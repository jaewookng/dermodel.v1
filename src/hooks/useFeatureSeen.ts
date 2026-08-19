import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'dermodel:features-seen';

/**
 * Feature-announcement keys. Add one per announcement and never reuse or rename
 * a shipped key — the key IS the "already seen" record, so changing it re-shows
 * the announcement to every user who had dismissed it.
 */
export type FeatureKey = 'bella_intro';

const readLocal = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
};

const writeLocal = (keys: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* private mode / storage disabled — the announcement just shows again */
  }
};

/**
 * Tracks whether the user has dismissed a one-time feature announcement.
 *
 * Signed in, the record lives in `profiles.features_seen` so it follows them
 * across devices; signed out, it falls back to localStorage. Either way the
 * announcement stays hidden until we know the answer, so it can never flash on
 * screen for someone who already dismissed it.
 */
export const useFeatureSeen = (feature: FeatureKey, userId: string | null) => {
  // `null` = still resolving. Callers should treat that as "don't show yet".
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      if (!userId) {
        if (!cancelled) setSeen(readLocal().includes(feature));
        return;
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('features_seen')
        .eq('id', userId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        // Column missing (migration not applied) or read failed — fall back to
        // the local record rather than nagging a user who already dismissed it.
        console.warn('Could not read features_seen:', error.message);
        setSeen(readLocal().includes(feature));
        return;
      }
      const remote = data?.features_seen ?? [];
      setSeen(remote.includes(feature) || readLocal().includes(feature));
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [feature, userId]);

  const markSeen = useCallback(async () => {
    setSeen(true);

    // Always record locally: it's instant, and it's the only record we have for
    // signed-out users or if the write below fails.
    const local = readLocal();
    if (!local.includes(feature)) writeLocal([...local, feature]);

    if (!userId) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('features_seen')
        .eq('id', userId)
        .maybeSingle();
      const current = data?.features_seen ?? [];
      if (current.includes(feature)) return;
      await supabase
        .from('profiles')
        .update({ features_seen: [...current, feature] })
        .eq('id', userId);
    } catch (err) {
      console.warn('Could not persist features_seen:', err);
    }
  }, [feature, userId]);

  return { seen, markSeen };
};
