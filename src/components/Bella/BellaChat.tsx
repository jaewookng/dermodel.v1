import { useState, useRef, useEffect, useCallback, FormEvent, PointerEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { X, ArrowUp } from 'lucide-react';
import type { BellaHook } from '@/hooks/useBellaHooks';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Shown in the transcript but never sent to the model (greetings, hook lines). */
  local?: boolean;
  /** Sent to the model but not shown (the prompt behind a clicked hook). */
  hidden?: boolean;
}

const GREETING =
  "Hi, I'm Bella. Ask me about any product or ingredient and I'll look it up in the dermodel database.";

const PANEL_MARGIN = 8;
const BASE_LEFT = 24;
const BASE_BOTTOM = 24;

/**
 * The model needs a conversation that starts with a user turn, so drop the
 * local-only flavor lines and any assistant turns still leading the list.
 */
const toApiMessages = (messages: ChatMessage[]) => {
  const sendable = messages.filter((m) => !m.local);
  const firstUser = sendable.findIndex((m) => m.role === 'user');
  return firstUser === -1
    ? []
    : sendable.slice(firstUser).map(({ role, content }) => ({ role, content }));
};

/** Reveals text a few characters at a time — only for the newest reply. */
const useTypewriter = (text: string, enabled: boolean) => {
  const [visibleCount, setVisibleCount] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    if (!enabled) {
      setVisibleCount(text.length);
      return;
    }
    setVisibleCount(0);
    const interval = setInterval(() => {
      setVisibleCount((count) => {
        if (count >= text.length) {
          clearInterval(interval);
          return count;
        }
        return count + 3;
      });
    }, 16);
    return () => clearInterval(interval);
  }, [text, enabled]);

  return { shown: text.slice(0, visibleCount), done: visibleCount >= text.length };
};

// Renders **bold** spans from the model's markdown; everything else stays plain text.
const renderBold = (text: string) =>
  text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );

const AssistantMessage = ({ text, animate }: { text: string; animate: boolean }) => {
  const { shown, done } = useTypewriter(text, animate);
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-rose-100 bg-white/90 px-3.5 py-2.5 text-[13px] leading-relaxed text-gray-700 shadow-sm">
        {renderBold(shown)}
        {!done && <span className="animate-bella-caret text-rose-300">▍</span>}
      </div>
    </div>
  );
};

interface BellaChatProps {
  open: boolean;
  onClose: () => void;
  /** A hook the user clicked — seeds the conversation and auto-asks. */
  seedHook: BellaHook | null;
}

/**
 * Bella's chat panel. Soft glass card rather than a dialogue box, draggable by
 * grabbing anywhere that isn't a control, and stays mounted so the conversation
 * survives closing and reopening.
 */
export const BellaChat = ({ open, onClose, seedHook }: BellaChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: GREETING, local: true },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // Only the latest assistant message types out; older ones render instantly.
  const animateFromIndex = useRef(0);
  const lastSeedId = useRef<string | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = setInterval(() => {
      el.scrollTop = el.scrollHeight;
    }, 120);
    return () => clearInterval(id);
  }, [messages, sending]);

  // --- Sending -------------------------------------------------------------

  const sendConversation = useCallback(async (next: ChatMessage[]) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setMessages(next);
    setSending(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('chat', {
        body: { messages: toApiMessages(next) },
      });
      if (fnError) throw fnError;
      const reply = typeof data?.reply === 'string' ? data.reply : null;
      if (!reply) throw new Error('Empty reply');
      animateFromIndex.current = next.length;
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      console.warn('Bella chat request failed:', err);
      setError("I couldn't reach my brain just now — try again in a moment?");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  const sendTyped = useCallback(() => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    setInput('');
    setMessages((current) => {
      const next: ChatMessage[] = [...current, { role: 'user', content: text }];
      void sendConversation(next);
      return next;
    });
  }, [input, sendConversation]);

  // A clicked hook restarts the conversation: Bella says the hook line, and the
  // prompt behind it goes to the model without cluttering the transcript.
  useEffect(() => {
    if (!seedHook || seedHook.id === lastSeedId.current) return;
    lastSeedId.current = seedHook.id;
    animateFromIndex.current = 0;
    void sendConversation([
      { role: 'assistant', content: seedHook.text, local: true },
      { role: 'user', content: seedHook.prompt, hidden: true },
    ]);
  }, [seedHook, sendConversation]);

  // --- Dragging ------------------------------------------------------------

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button, a, [data-no-drag]')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;

    const { width, height } = panel.getBoundingClientRect();
    const rawX = drag.originX + (e.clientX - drag.startX);
    const rawY = drag.originY + (e.clientY - drag.startY);

    // Keep the panel on screen: it's anchored bottom-left, so positive y moves down.
    const minX = -(BASE_LEFT - PANEL_MARGIN);
    const maxX = window.innerWidth - BASE_LEFT - width - PANEL_MARGIN;
    const maxY = BASE_BOTTOM - PANEL_MARGIN;
    const minY = -(window.innerHeight - BASE_BOTTOM - height - PANEL_MARGIN);

    setOffset({
      x: Math.min(Math.max(rawX, minX), Math.max(minX, maxX)),
      y: Math.min(Math.max(rawY, minY), Math.max(minY, maxY)),
    });
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  // --- Render --------------------------------------------------------------

  return (
    // Two wrappers on purpose: the drag transform lives on the outer element and
    // the entrance animation on the inner one, so the keyframes can't clobber
    // the offset the user dragged to.
    <div
      className={`fixed z-30 w-[min(24rem,calc(100vw-3rem))] ${open ? '' : 'hidden'}`}
      style={{
        left: BASE_LEFT,
        bottom: BASE_BOTTOM,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
    >
      <div className={open ? 'animate-bella-panel-in' : undefined}>
      <div
        ref={panelRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`overflow-hidden rounded-[1.5rem] border border-rose-100 bg-white/80 shadow-[0_18px_50px_-18px_rgba(190,110,140,0.5)] backdrop-blur-xl ${
          dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rose-100/80 bg-gradient-to-r from-rose-50/90 via-white/60 to-pink-50/80 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-gradient-to-br from-rose-300 via-pink-300 to-rose-400 shadow-inner" />
            <span className="text-sm font-semibold tracking-tight text-gray-800">Bella</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-rose-50 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          data-no-drag
          className="h-72 space-y-2.5 overflow-y-auto bg-gradient-to-b from-rose-50/30 to-white/10 px-3 py-3"
        >
          {messages.map((msg, i) => {
            if (msg.hidden) return null;
            return msg.role === 'assistant' ? (
              <AssistantMessage
                key={i}
                text={msg.content}
                animate={i >= animateFromIndex.current}
              />
            ) : (
              <div key={i} className="flex justify-end">
                <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-rose-300 to-pink-300 px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-sm">
                  {msg.content}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-rose-100 bg-white/90 px-3.5 py-3 shadow-sm">
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="animate-bella-dot h-1.5 w-1.5 rounded-full bg-rose-300"
                      style={{ animationDelay: `${i * 0.18}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && <p className="px-1 text-xs text-rose-500">{error}</p>}
        </div>

        {/* Composer */}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            sendTyped();
          }}
          className="flex items-center gap-2 border-t border-rose-100/80 bg-white/70 px-3 py-2.5"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Handled here as well as onSubmit — belt-and-braces against a
              // native form submission reloading the SPA.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTyped();
              }
            }}
            placeholder="Ask about a product or ingredient…"
            className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            aria-label="Send"
            className="rounded-full bg-gradient-to-br from-rose-300 to-pink-400 p-1.5 text-white shadow-sm transition-all hover:shadow-md disabled:from-gray-200 disabled:to-gray-200 disabled:shadow-none"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </form>
      </div>
      </div>
    </div>
  );
};
