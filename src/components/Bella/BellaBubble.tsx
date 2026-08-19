import { useState, useCallback } from 'react';
import type { BellaHook } from '@/hooks/useBellaHooks';
import type { FaceAnchor } from '@/components/FaceModel';

/** Offsets from the face centre, in reference-scale px (multiplied by anchor.scale). */
const OFFSET_X = 150;
const OFFSET_Y = 90;

/** Expanded-text sizing, in the bubble's own (pre-scale) pixels. */
const MAX_TEXT_PX = 240;
const MIN_TEXT_PX = 130;
/** Horizontal padding + tail, subtracted from the space available for text. */
const BUBBLE_CHROME_PX = 40;
/** Keep this much clear of the viewport edge. */
const EDGE_MARGIN = 12;

interface BellaBubbleProps {
  anchor: FaceAnchor | null;
  hooks: BellaHook[];
  onOpen: (hook: BellaHook | null) => void;
  /** Hold still — used while the feature intro spotlights this bubble. */
  frozen?: boolean;
}

/**
 * Bella's floating invitation, hanging off the left of the 3D face.
 *
 * At rest it's just an ellipsis — quiet enough to ignore. Hovering expands it
 * into one hook drawn at random from the server-built bank; clicking hands that
 * hook to the chat panel, which loads it into the composer rather than sending
 * it, so nothing is asked on the user's behalf. The full bank is reachable from
 * the chips in the panel, so nobody has to hover-cycle to find the one they
 * wanted.
 *
 * Position and size come from the Spline camera projection (`anchor`), so the
 * bubble tracks the model through camera moves and window resizes.
 */
export const BellaBubble = ({ anchor, hooks, onOpen, frozen = false }: BellaBubbleProps) => {
  const [expanded, setExpanded] = useState(false);
  const [hook, setHook] = useState<BellaHook | null>(null);

  // A fresh draw each time it opens, so repeated hovers surface different ideas.
  const drawHook = useCallback((): BellaHook | null => {
    if (hooks.length === 0) return null;
    const next = hooks[Math.floor(Math.random() * hooks.length)];
    setHook(next);
    return next;
  }, [hooks]);

  const handleEnter = () => {
    drawHook();
    setExpanded(true);
  };

  // Works for touch too, where there's no hover to expand first.
  const handleClick = () => onOpen(hook ?? drawHook());

  // Wait for the projection before drawing, so the bubble never flashes at the
  // wrong spot on load.
  if (!anchor) return null;

  const showText = expanded && !!hook;

  // The bubble hangs to the LEFT of the face, so it expands leftward — cap the
  // text to the room actually left on screen or it runs off the edge when the
  // model sits far left. Divided by scale because the whole bubble is scaled.
  const availablePx = (anchor.x - OFFSET_X * anchor.scale - EDGE_MARGIN) / anchor.scale;
  const textMaxWidth = Math.min(MAX_TEXT_PX, Math.max(MIN_TEXT_PX, availablePx - BUBBLE_CHROME_PX));

  return (
    <div
      className="absolute z-20"
      style={{
        left: anchor.x - OFFSET_X * anchor.scale,
        top: anchor.y - OFFSET_Y * anchor.scale,
        transform: `translate(-100%, -50%) scale(${anchor.scale})`,
        transformOrigin: 'right center',
      }}
    >
      {/* The intro spotlight measures this element's rect; a drifting bubble
          both reads as un-frozen and pulls the spotlight out of alignment. */}
      <div className={frozen ? undefined : 'animate-bella-float'}>
        <button
          onMouseEnter={handleEnter}
          onMouseLeave={() => setExpanded(false)}
          onFocus={handleEnter}
          onBlur={() => setExpanded(false)}
          onClick={handleClick}
          aria-label={showText ? hook!.text : 'Talk to Bella AI'}
          data-bella-bubble
          className="group relative block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 rounded-[1.25rem]"
        >
          <div className="relative overflow-hidden rounded-[1.25rem] border border-rose-200/70 bg-gradient-to-br from-white/95 via-white/90 to-rose-50/90 px-4 py-2 shadow-[0_6px_20px_-6px_rgba(190,110,140,0.35)] backdrop-blur-sm transition-all duration-300 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_26px_-6px_rgba(190,110,140,0.45)]">
            {/* Glass highlight along the top edge */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[1.25rem] bg-gradient-to-b from-white/70 to-transparent" />
            {/* Slow sheen sweep */}
            <div
              className={`pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent ${
                frozen ? '' : 'animate-bella-sheen'
              }`}
            />

            <div className="relative flex items-center">
              {/* Resting state: three dots, collapsing away as the text opens.
                  The 0fr→1fr grid column is what makes the width animate. */}
              <div
                className={`grid overflow-hidden transition-all duration-300 ease-out ${
                  showText ? 'grid-cols-[0fr] opacity-0' : 'grid-cols-[1fr] opacity-100'
                }`}
              >
                <div className="flex h-3 min-w-0 items-center gap-1.5 overflow-hidden">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="animate-bella-dot h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300"
                      style={{ animationDelay: `${i * 0.36}s` }}
                    />
                  ))}
                </div>
              </div>

              {/* Width collapses via the grid column; height via max-height.
                  Both are needed: collapsing only the column leaves the
                  paragraph wrapping at zero width -- one word per line -- which
                  held the resting bubble open at the hook text's full height.
                  `grid-rows-[0fr→1fr]` looks like the tidier fix but resolves to
                  a 0px row inside this auto-height flex row, hiding the text
                  entirely. Verified in the browser, not by eye. */}
              <div
                className={`grid overflow-hidden transition-all duration-300 ease-out ${
                  showText
                    ? 'grid-cols-[1fr] max-h-32 opacity-100'
                    : 'grid-cols-[0fr] max-h-0 opacity-0'
                }`}
              >
                <p
                  className="min-h-0 min-w-0 overflow-hidden text-[13px] font-medium leading-snug text-gray-700"
                  style={{ maxWidth: textMaxWidth }}
                >
                  {hook?.text}
                </p>
              </div>
            </div>

            {/* Tail — points right, toward the face */}
            <div className="absolute -right-[6px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-r border-t border-rose-200/70 bg-rose-50/90" />
          </div>
        </button>
      </div>
    </div>
  );
};
