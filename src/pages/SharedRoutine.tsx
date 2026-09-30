import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Sunrise, Moon, PackageCheck } from 'lucide-react';
import { FREQUENCY_LABELS, type CabinetFrequency } from '@/hooks/useCabinet';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeIlike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

const ROUTINES = [
  { key: 'am', title: 'Morning', icon: Sunrise, match: (r: string | null) => r === 'am' || r === 'both' },
  { key: 'pm', title: 'Evening', icon: Moon, match: (r: string | null) => r === 'pm' || r === 'both' },
] as const;

/**
 * Public routine at /r/<username> — no sign-in needed. Backed by the
 * public_routines view, which only returns rows for users who flipped
 * profiles.routine_public on, and exposes product + slot, never sizes or dates.
 */
const SharedRoutine = () => {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();

  const { data: items, isLoading } = useQuery({
    queryKey: ['public-routine', handle],
    queryFn: async () => {
      if (!handle) return [];
      let query = supabasePublic.from('public_routines').select('*');
      query = UUID_RE.test(handle)
        ? query.eq('user_id', handle)
        : query.ilike('username', escapeIlike(handle));
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!handle,
  });

  const username = items?.[0]?.username || null;

  const openProduct = (id: string | null, name: string | null) => {
    if (!id || !name) return;
    navigate('/', { state: { tab: 'products' as const, openProduct: { id, name } } });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8 flex items-center">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mr-4">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {username ? `${username}'s routine` : 'A routine'}
            </h1>
            <p className="text-gray-600">Shared on dermodel</p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-8">
              <p className="text-gray-600">Loading…</p>
            </CardContent>
          </Card>
        ) : !items || items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10">
              <PackageCheck className="mb-3 h-10 w-10 text-gray-300" />
              <h3 className="mb-1 text-base font-semibold">Nothing to see here</h3>
              <p className="mb-4 text-sm text-gray-600">
                This routine is private, empty, or doesn't exist.
              </p>
              <Button onClick={() => navigate('/')}>Explore dermodel</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {ROUTINES.map(({ key, title, icon: Icon, match }) => {
              const slot = items.filter((i) => match(i.routine));
              if (slot.length === 0) return null;
              return (
                <section key={key}>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Icon className="h-4 w-4 text-gray-400" />
                    {title}
                    <span className="font-normal text-gray-400">({slot.length})</span>
                  </h2>
                  <div className="space-y-3">
                    {slot.map((item) => (
                      <Card key={`${key}-${item.product_id}`} className="transition-shadow hover:shadow-md">
                        <CardContent className="flex items-center gap-4 p-4">
                          {item.image_url && (
                            <img
                              src={item.image_url}
                              alt={item.product_name || 'Product'}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                              className="h-14 w-14 shrink-0 rounded border bg-white object-contain p-1"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <button
                              onClick={() => openProduct(item.product_id, item.product_name)}
                              className="text-left text-base font-semibold hover:text-violet-700 hover:underline"
                            >
                              {item.product_name || item.product_id}
                            </button>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {FREQUENCY_LABELS[(item.frequency ?? 'daily') as CabinetFrequency] ?? item.frequency}
                              {item.ingredient_count != null ? ` · ${item.ingredient_count} ingredients` : ''}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              );
            })}

            <Card className="border-rose-100 bg-rose-50/50">
              <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-700">
                  Build your own routine and Bella will tell you before anything runs out.
                </p>
                <Button size="sm" onClick={() => navigate('/cabinet')}>
                  Start my cabinet
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default SharedRoutine;
