import { Button } from '@/components/ui/button';
import { Sparkles, RotateCcw } from 'lucide-react';

/** The 402 body from the chat gate. See docs/payment-model.md §12.5. */
export interface ChatLimit {
  reason: string;
  plan: string | null;
  conversations_remaining_lifetime: number | null;
  conversations_remaining: number | null;
  credit_usd_remaining: number | null;
}

interface BellaLimitProps {
  limit: ChatLimit;
  /** False ⇒ region policy says don't sell here; render no purchase path. */
  canBuy: boolean;
  signedIn: boolean;
  onNewChat: () => void;
  onUpgrade: () => void;
  onSignIn: () => void;
}

/**
 * What replaces the composer when the gate refuses a turn.
 *
 * Rendered entirely from the 402 body — no follow-up fetch, or the wall would
 * flash an empty state while it loaded (payment-model.md §12.5).
 */
export const BellaLimit = ({
  limit,
  canBuy,
  signedIn,
  onNewChat,
  onUpgrade,
  onSignIn,
}: BellaLimitProps) => {
  // Ran out of turns inside one conversation. Not a wall — starting a new one
  // is allowed, but it permanently spends one of a free user's conversations,
  // so the button says so rather than quietly costing them.
  if (limit.reason === 'conversation_turn_limit') {
    const left = limit.conversations_remaining_lifetime;
    return (
      <div className="border-t border-rose-100/80 bg-white/70 px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-gray-600">
          This conversation has reached its length limit.
          {typeof left === 'number' && (
            <>
              {' '}
              You have <span className="font-semibold text-gray-800">{left}</span>{' '}
              {left === 1 ? 'conversation' : 'conversations'} left.
            </>
          )}
        </p>
        <Button size="sm" variant="outline" className="mt-2.5" onClick={onNewChat}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Start a new conversation
        </Button>
      </div>
    );
  }

  // The real wall. Sell memory, not messages — and say plainly that favorites
  // survive, because "you're out of chats" reads like losing your saved work.
  if (
    limit.reason === 'lifetime_conversation_limit' ||
    limit.reason === 'monthly_conversation_limit' ||
    limit.reason === 'daily_conversation_limit'
  ) {
    return (
      <div className="border-t border-rose-100/80 bg-gradient-to-b from-rose-50/70 to-white px-4 py-4">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-rose-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
            You've used your free chats
          </span>
        </div>
        <p className="text-[12.5px] leading-relaxed text-gray-600">
          Premium remembers your cabinet — what you own, when it runs out, and
          what to try next.{' '}
          <span className="font-medium text-gray-700">
            Your saved products stay either way.
          </span>
        </p>
        {!signedIn ? (
          <Button size="sm" className="mt-3 w-full" onClick={onSignIn}>
            Sign in to keep going
          </Button>
        ) : canBuy ? (
          <Button size="sm" className="mt-3 w-full" onClick={onUpgrade}>
            See Premium
          </Button>
        ) : (
          // sell_premium is false for this region — offering a purchase path
          // the server will refuse is worse than offering none.
          <p className="mt-3 text-[12px] text-gray-400">
            Premium isn't available in your region yet.
          </p>
        )}
      </div>
    );
  }

  if (limit.reason === 'monthly_credit_limit') {
    return (
      <div className="border-t border-rose-100/80 bg-white/70 px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-gray-600">
          You've used this month's Bella credit. It resets at your next renewal.
        </p>
        {canBuy && (
          <Button size="sm" variant="outline" className="mt-2.5" onClick={onUpgrade}>
            Add credit
          </Button>
        )}
      </div>
    );
  }

  const copy: Record<string, string> = {
    deep_dive_requires_premium: 'Deep dives are a Premium feature.',
    free_tier_budget_exhausted:
      "Bella is over capacity this month. Please try again later — this one's on us, not you.",
    chat_not_available: "Bella isn't available on your plan.",
  };

  return (
    <div className="border-t border-rose-100/80 bg-white/70 px-4 py-3">
      <p className="text-[12.5px] leading-relaxed text-gray-600">
        {copy[limit.reason] ?? "Bella can't take that right now."}
      </p>
      {limit.reason === 'deep_dive_requires_premium' && canBuy && (
        <Button size="sm" className="mt-2.5" onClick={onUpgrade}>
          See Premium
        </Button>
      )}
    </div>
  );
};
