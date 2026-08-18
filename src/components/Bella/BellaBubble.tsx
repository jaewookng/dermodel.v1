import { useState, useEffect } from 'react';
import type { BellaHook } from '@/hooks/useBellaHooks';
import type { FaceAnchor } from '@/components/FaceModel';

/** How long each hook stays up before Bella cycles to the next one. */
const ROTATE_MS = 8000;
const FADE_MS = 400;

/** Offsets from the face centre, in reference-scale px (multiplied by anchor.scale). */
const OFFSET_X = 150;
const OFFSET_Y = 90;

interface BellaBubbleProps {
  anchor: FaceAnchor | null;
  hooks: BellaHook[];
  onOpen: (hook: BellaHook | null) => void;
}

/**
 * Bella's floating invitation, hanging off the left of the 3D face.
 *
 * Position and size come from the Spline camera projection (`anchor`), so the
 * bubble tracks the model through camera moves and window resizes instead of
 * sitting at a fixed percentage. Content is the server-built hook rotation —
 * clicking hands that hook to the chat panel, which is where the LLM starts.
 */
export const BellaBubble = ({ anchor, hooks, onOpen }: BellaBubbleProps) => {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (hooks.length <= 1) return;
    const rotate = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % hooks.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(rotate);
  }, [hooks.length]);

  // Wait for the projection before drawing, so the bubble never flashes at the
  // wrong spot on load.
  if (!anchor) return null;

  const hook = hooks[index] ?? null;
  const scale = anchor.scale;

  return (
    <div
      className="absolute z-20"
      style={{
        left: anchor.x - OFFSET_X * scale,
        top: anchor.y - OFFSET_Y * scale,
        transform: `translate(-100%, -50%) scale(${scale})`,
        transformOrigin: 'right center',
      }}
    >
      <div className="animate-bella-float">
        <button
          onClick={() => onOpen(hook)}
          aria-label={hook ? hook.text : 'Chat with Bella'}
          className="group relative block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 rounded-[1.25rem]"
        >
          <div className="relative max-w-[15rem] overflow-hidden rounded-[1.25rem] border border-rose-200/70 bg-gradient-to-br from-white/95 via-white/90 to-rose-50/90 px-4 py-2.5 shadow-[0_6px_20px_-6px_rgba(190,110,140,0.35)] backdrop-blur-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_26px_-6px_rgba(190,110,140,0.45)]">
            {/* Glass highlight along the top edge */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[1.25rem] bg-gradient-to-b from-white/70 to-transparent" />
            {/* Slow sheen sweep */}
            <div className="animate-bella-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

            <div className="relative">
              {hook ? (
                <p
                  className="text-[13px] font-medium leading-snug text-gray-700 transition-opacity duration-300"
                  style={{ opacity: visible ? 1 : 0 }}
                >
                  {hook.text}
                </p>
              ) : (
                <div className="flex items-center gap-1.5 py-0.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="animate-bella-dot h-1.5 w-1.5 rounded-full bg-rose-300"
                      style={{ animationDelay: `${i * 0.18}s` }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Tail — points right, toward the face */}
            <div className="absolute -right-[6px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-r border-t border-rose-200/70 bg-rose-50/90" />
          </div>
        </button>
      </div>
    </div>
  );
};
