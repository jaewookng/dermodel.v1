import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import type { FaceAnchor } from '@/components/FaceModel';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PADDING = 14;

interface BellaIntroProps {
  anchor: FaceAnchor | null;
  onDismiss: () => void;
}

/**
 * One-time introduction to Bella: dims the page, spotlights the resting bubble,
 * and names the feature. Dismissed by "Got it", Escape, or clicking the
 * backdrop — all of which record it as seen so it never returns.
 *
 * The spotlight measures the real bubble element rather than recomputing its
 * offsets, so it can't drift out of sync with the bubble's own layout.
 */
export const BellaIntro = ({ anchor, onDismiss }: BellaIntroProps) => {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('[data-bella-bubble]');
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
        return;
      }
      // The bubble hasn't laid out yet (or the tab is hidden, which zeroes every
      // rect) — fall back to the projected anchor so the spotlight still lands
      // somewhere sensible instead of not rendering at all.
      if (anchor) {
        const w = 64 * anchor.scale;
        const h = 36 * anchor.scale;
        setRect({
          left: anchor.x - 150 * anchor.scale - w,
          top: anchor.y - 90 * anchor.scale - h / 2,
          width: w,
          height: h,
        });
      }
    };

    measure();
    // The bubble floats, and the model settles for a moment after load.
    const id = setInterval(measure, 400);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (!rect) return null;

  const holeLeft = rect.left - PADDING;
  const holeTop = rect.top - PADDING;
  const holeWidth = rect.width + PADDING * 2;
  const holeHeight = rect.height + PADDING * 2;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop: catches the click-anywhere dismiss. The dimming itself comes
          from the spotlight's ring shadow below. */}
      <div className="absolute inset-0" onClick={onDismiss} />

      {/* Spotlight: a hole punched in the dim by an enormous ring shadow. */}
      <div
        className="animate-bella-spotlight pointer-events-none absolute rounded-[1.6rem]"
        style={{
          left: holeLeft,
          top: holeTop,
          width: holeWidth,
          height: holeHeight,
          boxShadow:
            '0 0 0 9999px rgba(24,16,20,0.62), 0 0 0 1px rgba(255,255,255,0.55) inset, 0 0 34px 6px rgba(244,180,205,0.45)',
        }}
      />

      {/* Callout, anchored under the spotlight and nudged onto the screen if the
          bubble sits near the left edge. */}
      <div
        className="animate-bella-panel-in absolute w-[17rem]"
        style={{
          left: Math.max(16, holeLeft - 16),
          top: holeTop + holeHeight + 16,
        }}
      >
        <div className="rounded-2xl border border-white/15 bg-white/95 p-4 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
              New
            </span>
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
            Talk to Bella AI
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
            Ask about any product or ingredient and Bella answers from the
            dermodel database. Hover the bubble for ideas.
          </p>
          <button
            onClick={onDismiss}
            className="mt-3 w-full rounded-full bg-gradient-to-br from-rose-300 to-pink-400 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition-shadow hover:shadow-md"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
