import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProductFavorites } from '@/hooks/useProductFavorites';
import {
  useCabinet,
  describeRemaining,
  FREQUENCY_LABELS,
  ROUTINE_LABELS,
  type CabinetFrequency,
  type CabinetRoutine,
  type CabinetItem,
} from '@/hooks/useCabinet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Plus, Trash2, PackageCheck, Sunrise, Moon } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Morning and evening routines. A product set to 'both' appears in each,
 * because that's genuinely what the routine looks like -- and it's why 'both'
 * halves the replenishment estimate.
 */
const ROUTINES = [
  { key: 'am', title: 'Morning', icon: Sunrise, match: (r: CabinetItem['routine']) => r === 'am' || r === 'both' },
  { key: 'pm', title: 'Evening', icon: Moon, match: (r: CabinetItem['routine']) => r === 'pm' || r === 'both' },
] as const;

/**
 * The cabinet: what the user owns and roughly when it runs out.
 *
 * The estimate comes from the bottle size (parsed from the product name) and
 * how often they say they use it. It's shown as "about N weeks", never a
 * precise date, because it genuinely is an approximation.
 */
export const Cabinet = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { items, loading, addItem, updateItem, removeItem } = useCabinet();
  const { favorites } = useProductFavorites();

  const inCabinet = new Set(items.map((i) => i.product_id));
  const addable = favorites.filter((f) => !inCabinet.has(f.product_id));

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <h1 className="mb-4 text-2xl font-bold">Not Signed In</h1>
        <Button onClick={() => navigate('/')}>Back to Home</Button>
      </div>
    );
  }

  const handleAdd = async (productId: string) => {
    try {
      await addItem.mutateAsync({ productId });
      toast.success('Added to your cabinet');
    } catch (err) {
      console.error('Add to cabinet failed:', err);
      toast.error('Could not add that');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <button
          onClick={() => navigate('/')}
          className="mb-6 flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <h1 className="text-2xl font-bold text-gray-900">Your cabinet</h1>
        <p className="mb-6 mt-1 text-sm text-gray-500">
          Tell Bella what you're using and how often, and we'll work on it
          together.
        </p>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : items.length === 0 ? (
          <Card className="mb-8">
            <CardContent className="p-6 text-center">
              <PackageCheck className="mx-auto mb-3 h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-500">
                Nothing in your cabinet yet. Add something you're using from your
                favorites below.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mb-10 space-y-8">
            {ROUTINES.map(({ key, title, icon: Icon, match }) => {
              const routineItems = items.filter((i) => match(i.routine));
              return (
                <section key={key}>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Icon className="h-4 w-4 text-gray-400" />
                    {title}
                    <span className="font-normal text-gray-400">
                      ({routineItems.length})
                    </span>
                  </h2>
                  {routineItems.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-400">
                      Nothing in your {title.toLowerCase()} routine yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {routineItems.map((item) => (
                        <Card key={item.id}>
                          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {item.product_name}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {item.size_ml ? `${item.size_ml} mL · ` : 'Size unknown · '}
                                {describeRemaining(item) ?? 'Add a size to get an estimate'}
                              </p>
                            </div>

                            {/* Routine. Changing it here moves the product between
                                sections; 'Both' shows it in AM and PM and doubles
                                the daily rate, so the estimate halves. */}
                            <div className="flex shrink-0 rounded-full border border-gray-200 p-0.5">
                              {(Object.keys(ROUTINE_LABELS) as CabinetRoutine[]).map((r) => (
                                <button
                                  key={r}
                                  onClick={() => updateItem.mutate({ id: item.id, routine: r })}
                                  aria-pressed={item.routine === r}
                                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                    item.routine === r
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'text-gray-400 hover:text-gray-600'
                                  }`}
                                >
                                  {ROUTINE_LABELS[r]}
                                </button>
                              ))}
                            </div>

                            <Select
                              value={item.frequency}
                              onValueChange={(v) =>
                                updateItem.mutate({
                                  id: item.id,
                                  frequency: v as CabinetFrequency,
                                })
                              }
                            >
                              <SelectTrigger className="w-full sm:w-[150px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <button
                              onClick={() => removeItem.mutate(item.id)}
                              aria-label="Remove from cabinet"
                              className="self-end text-gray-300 transition-colors hover:text-rose-500 sm:self-auto"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {addable.length > 0 && (
          <>
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              Add from your favorites
            </h2>
            <div className="space-y-2">
              {addable.slice(0, 20).map((fav) => (
                <div
                  key={fav.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5"
                >
                  <p className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {fav.sss_products?.product_name ?? fav.product_id}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAdd(fav.product_id)}
                    disabled={addItem.isPending}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
