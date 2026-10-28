import { useState } from "react";

const STORAGE_KEY = "antiscalping_onboarding_dismissed";

export function AntiScalpingOnboarding() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignored
    }
  };

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-indigo-950/40 hover:bg-indigo-950/70 border border-indigo-500/25 text-xs text-indigo-300 font-medium transition-all group"
      >
        <span className="flex items-center gap-2">
          <span>🛡️</span>
          <span>How does our Anti-Scalping protocol work?</span>
        </span>
        <span className="text-[11px] underline text-indigo-400 group-hover:text-indigo-200">
          Learn more →
        </span>
      </button>
    );
  }

  return (
    <div className="relative rounded-3xl p-5 md:p-6 bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-950 border border-indigo-500/30 shadow-2xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Top Bar */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
            🛡️
          </div>
          <div>
            <h2 className="text-sm md:text-base font-bold text-white tracking-tight">
              How Anti-Scalping Protocol Works
            </h2>
            <p className="text-[11px] text-slate-400">
              Zero scalpers • Enforced caps • Fraud-proof entry
            </p>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          aria-label="Dismiss guide"
          className="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-xs"
        >
          ✕
        </button>
      </div>

      {/* 4 Feature Columns */}
      {!isMinimized && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {/* 1. Transfer Lock */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-indigo-300">
              <span>🚫</span>
              <span>Direct Transfers Blocked</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Tickets cannot be transferred wallet-to-wallet outside the contract, eliminating black-market and off-platform scalping.
            </p>
          </div>

          {/* 2. Resale Cap */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-cyan-300">
              <span>📈</span>
              <span>Enforced Price Cap</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Sellers can only list tickets up to the organizer's limit (e.g. 110% of face value). Higher asking prices revert on-chain.
            </p>
          </div>

          {/* 3. Royalties */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-violet-300">
              <span>💎</span>
              <span>Creator Resale Royalties</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Event organizers receive an automatic royalty cut on every verified resale via non-reentrant pull payments.
            </p>
          </div>

          {/* 4. 120s Dynamic Pass */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-emerald-300">
              <span>⏱️</span>
              <span>120s Dynamic QR Pass</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Entry passes require a fresh cryptographic signature that expires in 2 minutes, preventing static screenshot fraud.
            </p>
          </div>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-1 text-xs">
        <button
          onClick={() => setIsMinimized(!isMinimized)}
          className="text-slate-400 hover:text-slate-200 transition-colors"
        >
          {isMinimized ? "Show Details ↓" : "Hide Details ↑"}
        </button>

        <button
          onClick={handleDismiss}
          className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition-all active:scale-95"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
