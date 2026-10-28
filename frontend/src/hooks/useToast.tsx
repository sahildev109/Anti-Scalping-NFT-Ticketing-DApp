import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { etherscanTxUrl, decodeContractError } from "../lib/contract";

// ─── Types ────────────────────────────────────────────────────────────────────
export type ToastStatus = "pending" | "confirmed" | "failed";

export interface Toast {
  id: string;
  status: ToastStatus;
  message: string;
  txHash?: string;
}

export interface ToastContextValue {
  toasts: Toast[];
  show: (toast: Omit<Toast, "id">, autoDismissMs?: number) => string;
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: string) => void;
  withTx: <T>(
    label: string,
    txFn: () => Promise<{ hash: string; wait: () => Promise<T> }>,
  ) => Promise<T | null>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    clearTimeout(timeouts.current.get(id));
    timeouts.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, "id">, autoDismissMs?: number): string => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 5));

      if (autoDismissMs) {
        const t = setTimeout(() => dismiss(id), autoDismissMs);
        timeouts.current.set(id, t);
      }

      return id;
    },
    [dismiss],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      // Auto-dismiss confirmed/failed after 8 s
      if (patch.status === "confirmed" || patch.status === "failed") {
        const t = setTimeout(() => dismiss(id), 8000);
        timeouts.current.set(id, t);
      }
    },
    [dismiss],
  );

  // Helper: wrap an async transaction call with full lifecycle toasts
  const withTx = useCallback(
    async <T,>(
      label: string,
      txFn: () => Promise<{ hash: string; wait: () => Promise<T> }>,
    ): Promise<T | null> => {
      const id = show({ status: "pending", message: `${label} — awaiting wallet approval…` });
      try {
        const tx = await txFn();
        update(id, {
          status: "pending",
          message: `${label} — transaction broadcasted`,
          txHash: tx.hash,
        });
        const receipt = await tx.wait();
        update(id, {
          status: "confirmed",
          message: `${label} — confirmed on chain! 🎉`,
          txHash: tx.hash,
        });
        return receipt;
      } catch (err: unknown) {
        update(id, {
          status: "failed",
          message: decodeContractError(err),
        });
        return null;
      }
    },
    [show, update],
  );

  // Cleanup on unmount
  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);

  return (
    <ToastContext.Provider value={{ toasts, show, update, dismiss, withTx }}>
      {children}
      <ToastList toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

// ─── Toast UI Component ───────────────────────────────────────────────────────
export interface ToastListProps {
  toasts: Toast[];
  dismiss: (id: string) => void;
}

function ToastIcon({ status }: { status: ToastStatus }) {
  if (status === "pending")
    return (
      <svg className="animate-spin h-5 w-5 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
      </svg>
    );
  if (status === "confirmed")
    return (
      <svg className="h-5 w-5 text-emerald-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    );
  return (
    <svg className="h-5 w-5 text-rose-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  );
}

export function ToastList({ toasts, dismiss }: ToastListProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm z-50 flex flex-col gap-2.5 pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3.5 shadow-2xl border backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-3
            ${t.status === "pending" ? "bg-slate-900/95 border-indigo-500/40 shadow-indigo-950/50" : ""}
            ${t.status === "confirmed" ? "bg-slate-900/95 border-emerald-500/40 shadow-emerald-950/50" : ""}
            ${t.status === "failed" ? "bg-slate-900/95 border-rose-500/40 shadow-rose-950/50" : ""}
          `}
        >
          <div className="mt-0.5">
            <ToastIcon status={t.status} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-100 font-medium leading-snug break-words">
              {t.message}
            </p>
            {t.txHash && (
              <a
                href={etherscanTxUrl(t.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                <span>View on Etherscan</span>
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                  <path d="M2 10L10 2M10 2H5M10 2v5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>

          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 text-slate-400 hover:text-slate-200 transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg hover:bg-slate-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.22 4.22a.75.75 0 011.06 0L8 6.94l2.72-2.72a.75.75 0 111.06 1.06L9.06 8l2.72 2.72a.75.75 0 11-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
