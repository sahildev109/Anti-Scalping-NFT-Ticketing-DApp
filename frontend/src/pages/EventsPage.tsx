import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../hooks/useToast";
import { getReadContract, getSignerContract, decodeContractError } from "../lib/contract";
import { AntiScalpingOnboarding } from "../components/AntiScalpingOnboarding";

// ─── Data Interface ───────────────────────────────────────────────────────────
interface EventItem {
  id: number;
  name: string;
  ticketPrice: bigint;
  priceFormatted: string;
  maxSupply: number;
  minted: number;
  remaining: number;
  percentSold: number;
  maxResaleBps: number;
  resaleCapPercent: number;
  royaltyBps: number;
  eventTime: number;
  maxPerWallet: number;
  active: boolean;
  userBalance: number;
}

// ─── Date Formatter ───────────────────────────────────────────────────────────
function formatEventDate(unixTimestamp: number): {
  formatted: string;
  relative: string;
  isPast: boolean;
} {
  const date = new Date(unixTimestamp * 1000);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const isPast = diffMs <= 0;

  const formatted = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (isPast) {
    return { formatted, relative: "Event Ended", isPast: true };
  }

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  let relative = "";
  if (diffDays > 1) {
    relative = `In ${diffDays} days`;
  } else if (diffDays === 1) {
    relative = "Tomorrow";
  } else if (diffHours > 0) {
    relative = `In ${diffHours} hr${diffHours > 1 ? "s" : ""}`;
  } else {
    const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    relative = `In ${diffMins}m`;
  }

  return { formatted, relative, isPast: false };
}

// ─── Loading Skeletons ────────────────────────────────────────────────────────
function EventSkeleton() {
  return (
    <div className="bg-slate-900/80 border border-slate-800/80 rounded-3xl p-5 shadow-xl animate-pulse space-y-4">
      {/* Header & badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 flex-1">
          <div className="h-6 bg-slate-800 rounded-lg w-3/4" />
          <div className="h-4 bg-slate-800/60 rounded-md w-1/2" />
        </div>
        <div className="h-6 w-20 bg-slate-800 rounded-full shrink-0" />
      </div>

      {/* Price & info cards */}
      <div className="grid grid-cols-2 gap-2.5 pt-2">
        <div className="h-16 bg-slate-800/40 rounded-2xl border border-slate-800/60" />
        <div className="h-16 bg-slate-800/40 rounded-2xl border border-slate-800/60" />
      </div>

      {/* Progress bar */}
      <div className="space-y-2 pt-1">
        <div className="flex justify-between">
          <div className="h-3 bg-slate-800/60 rounded w-24" />
          <div className="h-3 bg-slate-800/60 rounded w-16" />
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full w-full" />
      </div>

      {/* Resale shield badge */}
      <div className="h-8 bg-slate-800/40 rounded-xl" />

      {/* Button */}
      <div className="h-12 bg-slate-800 rounded-2xl w-full pt-1" />
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyEventsState({ onRefresh, isAdmin }: { onRefresh: () => void; isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center max-w-sm mx-auto">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center shadow-2xl shadow-indigo-500/10">
          <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
            />
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-indigo-500/30 border border-indigo-400/50 flex items-center justify-center animate-bounce">
          <span className="text-[10px]">✨</span>
        </div>
      </div>

      <h2 className="text-xl font-bold text-white mb-2">No Events Available</h2>
      <p className="text-slate-400 text-sm leading-relaxed mb-8">
        There are currently no active ticket sales on the contract. Stay tuned for upcoming concerts, conferences, and festivals!
      </p>

      <div className="flex flex-col sm:flex-row gap-3 w-full">
        {isAdmin && (
          <Link
            to="/admin"
            className="flex-1 min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Event
          </Link>
        )}
        <button
          onClick={onRefresh}
          className="flex-1 min-h-[46px] flex items-center justify-center gap-2 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 text-sm font-medium transition-all active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh Feed
        </button>
      </div>
    </div>
  );
}

// ─── Main Events Page ─────────────────────────────────────────────────────────
export default function EventsPage() {
  const { account, connect, wrongNetwork, switchToCorrectNetwork, isAdmin } = useWallet();
  const { withTx } = useToast();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [filter, setFilter] = useState<"all" | "available" | "past">("all");
  const [buyingId, setBuyingId] = useState<number | null>(null);

  // ─── Fetch Events from Contract ─────────────────────────────────────────────
  const loadEvents = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const readContract = getReadContract();
      const countRaw = await readContract.totalEvents();
      const count = Number(countRaw);

      if (count === 0) {
        setEvents([]);
        return;
      }

      // Fetch all events concurrently
      const eventPromises = Array.from({ length: count }, async (_, i) => {
        const ev = await readContract.getFunction("getEvent")(i);

        let userBal = 0;
        if (account) {
          try {
            const bal = await readContract.walletBalance(i, account);
            userBal = Number(bal);
          } catch {
            userBal = 0;
          }
        }

        const maxSupply = Number(ev.maxSupply);
        const minted = Number(ev.minted);
        const remaining = Math.max(0, maxSupply - minted);
        const percentSold = maxSupply > 0 ? Math.min(100, Math.round((minted / maxSupply) * 100)) : 0;
        const maxResaleBps = Number(ev.maxResaleBps);
        const resaleCapPercent = maxResaleBps / 100;

        return {
          id: i,
          name: ev.name,
          ticketPrice: ev.ticketPrice as bigint,
          priceFormatted: ethers.formatEther(ev.ticketPrice),
          maxSupply,
          minted,
          remaining,
          percentSold,
          maxResaleBps,
          resaleCapPercent,
          royaltyBps: Number(ev.royaltyBps),
          eventTime: Number(ev.eventTime),
          maxPerWallet: Number(ev.maxPerWallet),
          active: Boolean(ev.active),
          userBalance: userBal,
        } as EventItem;
      });

      const loadedEvents = await Promise.all(eventPromises);
      // Sort: active upcoming events first, past events last
      loadedEvents.sort((a, b) => {
        const now = Math.floor(Date.now() / 1000);
        const aPast = a.eventTime <= now || !a.active;
        const bPast = b.eventTime <= now || !b.active;
        if (aPast === bPast) {
          return a.eventTime - b.eventTime;
        }
        return aPast ? 1 : -1;
      });

      setEvents(loadedEvents);
    } catch (err) {
      console.error("Failed to load events:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [account]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ─── Buy Ticket Handler ─────────────────────────────────────────────────────
  const handleBuyTicket = async (ev: EventItem) => {
    if (!account) {
      await connect();
      return;
    }

    if (wrongNetwork) {
      await switchToCorrectNetwork();
      return;
    }

    setBuyingId(ev.id);

    try {
      const signerContract = await getSignerContract();
      const receipt = await withTx(`Buy ticket for "${ev.name}"`, async () => {
        return signerContract.mintTicket(ev.id, {
          value: ev.ticketPrice,
        });
      });

      if (receipt) {
        // Refetch immediately to update tickets minted and wallet balance
        await loadEvents(true);
      }
    } catch (err: unknown) {
      console.error("Purchase error:", decodeContractError(err));
    } finally {
      setBuyingId(null);
    }
  };

  // ─── Filter Events ──────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const filteredEvents = events.filter((ev) => {
    const isPast = ev.eventTime <= nowSec || !ev.active;
    const isSoldOut = ev.minted >= ev.maxSupply;

    if (filter === "available") {
      return !isPast && !isSoldOut;
    }
    if (filter === "past") {
      return isPast || isSoldOut;
    }
    return true;
  });

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-5 md:py-8 space-y-6">
      {/* ─── Hero / Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>Explore Events</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {events.length}
            </span>
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Verified smart-contract tickets with guaranteed price caps
          </p>
        </div>

        <button
          onClick={() => loadEvents(true)}
          disabled={isRefreshing || isLoading}
          aria-label="Refresh events"
          className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 shrink-0"
        >
          <svg
            className={`w-4 h-4 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* ─── Onboarding: How Anti-Scalping Works ───────────────────────────── */}
      <AntiScalpingOnboarding />

      {/* ─── Filter Pills ──────────────────────────────────────────────────── */}
      {events.length > 0 && (
        <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl">
          <button
            onClick={() => setFilter("all")}
            className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-medium transition-all ${
              filter === "all"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All Events ({events.length})
          </button>
          <button
            onClick={() => setFilter("available")}
            className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-medium transition-all ${
              filter === "available"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Available ({events.filter((e) => e.eventTime > nowSec && e.minted < e.maxSupply && e.active).length})
          </button>
          <button
            onClick={() => setFilter("past")}
            className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-medium transition-all ${
              filter === "past"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Ended ({events.filter((e) => e.eventTime <= nowSec || e.minted >= e.maxSupply || !e.active).length})
          </button>
        </div>
      )}

      {/* ─── Content List ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-4">
          <EventSkeleton />
          <EventSkeleton />
        </div>
      ) : events.length === 0 ? (
        <EmptyEventsState onRefresh={() => loadEvents(true)} isAdmin={isAdmin} />
      ) : filteredEvents.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          No events found in this category.
        </div>
      ) : (
        <div className="space-y-5">
          {filteredEvents.map((ev) => {
            const dateInfo = formatEventDate(ev.eventTime);
            const isSoldOut = ev.minted >= ev.maxSupply;
            const isEnded = dateInfo.isPast || !ev.active;
            const isWalletLimitReached = ev.userBalance >= ev.maxPerWallet;
            const isBuyingThis = buyingId === ev.id;

            // Determine button state
            let buttonLabel = `Buy Ticket • ${ev.priceFormatted} ETH`;
            let isButtonDisabled = false;
            let buttonVariant: "primary" | "warning" | "disabled" | "network" = "primary";

            if (!account) {
              buttonLabel = "Connect Wallet to Buy";
              buttonVariant = "primary";
            } else if (wrongNetwork) {
              buttonLabel = "Switch to Sepolia";
              buttonVariant = "network";
            } else if (isBuyingThis) {
              buttonLabel = "Purchasing Ticket…";
              isButtonDisabled = true;
              buttonVariant = "disabled";
            } else if (isSoldOut) {
              buttonLabel = "Sold Out";
              isButtonDisabled = true;
              buttonVariant = "disabled";
            } else if (isEnded) {
              buttonLabel = "Event Ended";
              isButtonDisabled = true;
              buttonVariant = "disabled";
            } else if (isWalletLimitReached) {
              buttonLabel = `Wallet Limit Reached (${ev.userBalance}/${ev.maxPerWallet})`;
              isButtonDisabled = true;
              buttonVariant = "warning";
            }

            return (
              <div
                key={ev.id}
                className="group relative bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-slate-800 hover:border-indigo-500/40 rounded-3xl p-5 shadow-2xl transition-all duration-300 hover:shadow-indigo-500/5 backdrop-blur-sm overflow-hidden"
              >
                {/* Glowing subtle accent gradient */}
                <div className="absolute -top-12 -right-12 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all pointer-events-none" />

                {/* ── Top Header: Name & Status Badge ── */}
                <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg md:text-xl font-bold text-white tracking-tight break-words group-hover:text-indigo-200 transition-colors">
                      {ev.name}
                    </h2>
                    {/* Date/Time badge */}
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
                      <svg className="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="font-medium">{dateInfo.formatted}</span>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <div className="shrink-0">
                    {isSoldOut ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        Sold Out
                      </span>
                    ) : isEnded ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                        Ended
                      </span>
                    ) : ev.percentSold >= 80 ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
                        🔥 Selling Fast
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Live
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Key Metrics Grid ── */}
                <div className="grid grid-cols-2 gap-2.5 my-3.5 relative z-10">
                  {/* Price Card */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                      Ticket Price
                    </span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-extrabold text-white">
                        {ev.priceFormatted}
                      </span>
                      <span className="text-xs font-bold text-indigo-400">ETH</span>
                    </div>
                  </div>

                  {/* Wallet Limit & Owned */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                      Per-Wallet Cap
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-base font-bold text-slate-200">
                        Max {ev.maxPerWallet}
                      </span>
                      {account && (
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isWalletLimitReached
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                          }`}
                        >
                          You: {ev.userBalance}/{ev.maxPerWallet}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Supply Progress Bar ── */}
                <div className="space-y-1.5 my-3 relative z-10">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      Minted <strong className="text-slate-200 font-semibold">{ev.minted}</strong> of{" "}
                      <strong className="text-slate-200 font-semibold">{ev.maxSupply}</strong>
                    </span>
                    <span className="text-xs font-medium text-slate-300">
                      {isSoldOut ? (
                        <span className="text-rose-400 font-semibold">0 left</span>
                      ) : (
                        <span>
                          <strong className="text-indigo-400 font-semibold">{ev.remaining}</strong> left
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="w-full h-2.5 bg-slate-800/80 rounded-full overflow-hidden p-0.5 border border-slate-700/40">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        isSoldOut
                          ? "bg-rose-500"
                          : ev.percentSold >= 80
                          ? "bg-gradient-to-r from-amber-500 to-rose-500"
                          : "bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400"
                      }`}
                      style={{ width: `${Math.max(ev.percentSold, ev.minted > 0 ? 5 : 0)}%` }}
                    />
                  </div>
                </div>

                {/* ── Anti-Scalp Resale Cap Shield Badge ── */}
                <div className="mt-3.5 mb-4 p-2.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/20 flex items-center justify-between gap-2.5 relative z-10">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0 text-indigo-300 shadow-sm">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.8}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-indigo-200 truncate">
                        Resale capped at {ev.resaleCapPercent}% of face value
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        Anti-scalping smart contract enforcement
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 text-[10px] font-medium text-indigo-300/80 bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20">
                    🛡️ Protected
                  </span>
                </div>

                {/* ── Big "Buy Ticket" Button ── */}
                <button
                  onClick={() => handleBuyTicket(ev)}
                  disabled={isButtonDisabled}
                  className={`w-full min-h-[48px] rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all relative z-10
                    ${
                      buttonVariant === "primary"
                        ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 active:scale-[0.98]"
                        : buttonVariant === "network"
                        ? "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-amber-600/30 active:scale-[0.98]"
                        : buttonVariant === "warning"
                        ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                        : "bg-slate-800/80 text-slate-500 border border-slate-800 cursor-not-allowed"
                    }
                  `}
                >
                  {isBuyingThis ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      <span>Minting Ticket…</span>
                    </>
                  ) : (
                    <>
                      {buttonVariant === "primary" && (
                        <svg className="w-4 h-4 text-indigo-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                          />
                        </svg>
                      )}
                      <span>{buttonLabel}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
