import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../hooks/useToast";
import {
  getReadContract,
  getSignerContract,
  decodeContractError,
} from "../lib/contract";

// ─── Data Interface ───────────────────────────────────────────────────────────
interface MarketListing {
  tokenId: number;
  eventId: number;
  eventName: string;
  eventTime: number;
  eventActive: boolean;
  seller: string;
  price: bigint;
  priceFormatted: string;
  faceValue: bigint;
  faceValueFormatted: string;
  maxResaleBps: number;
  resaleCapPercent: number;
  percentOverFaceValue: number;
  maxPerWallet: number;
  userBalance: number;
  royaltyBps: number;
}

// ─── Date Formatter ───────────────────────────────────────────────────────────
function formatEventDate(unixTimestamp: number): string {
  const date = new Date(unixTimestamp * 1000);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Loading Skeletons ────────────────────────────────────────────────────────
function MarketSkeleton() {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl animate-pulse space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-6 bg-slate-800 rounded-lg w-2/3" />
          <div className="h-4 bg-slate-800/60 rounded-md w-1/3" />
        </div>
        <div className="h-6 w-24 bg-slate-800 rounded-full shrink-0" />
      </div>

      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <div className="h-16 bg-slate-800/40 rounded-2xl" />
        <div className="h-16 bg-slate-800/40 rounded-2xl" />
      </div>

      <div className="h-8 bg-slate-800/50 rounded-xl w-3/4" />
      <div className="h-12 bg-slate-800 rounded-2xl w-full" />
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyMarketState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center max-w-sm mx-auto">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center mb-6 text-cyan-400 shadow-2xl shadow-cyan-500/10">
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      </div>

      <h2 className="text-xl font-bold text-white mb-2">No Active Resale Listings</h2>
      <p className="text-slate-400 text-xs leading-relaxed mb-8">
        There are currently no tickets listed for resale. All ticket holders are holding onto their passes! Check back soon or browse primary event drops.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 w-full">
        <Link
          to="/events"
          className="flex-1 min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
          Explore Events
        </Link>
        <button
          onClick={onRefresh}
          className="flex-1 min-h-[46px] flex items-center justify-center gap-2 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-sm font-medium transition-all active:scale-95"
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

// ─── Main Marketplace Page ───────────────────────────────────────────────────
export default function MarketPage() {
  const navigate = useNavigate();
  const { account, connect, wrongNetwork, switchToCorrectNetwork } = useWallet();
  const { withTx, show } = useToast();

  const [listings, setListings] = useState<MarketListing[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [buyingTokenId, setBuyingTokenId] = useState<number | null>(null);
  const [hideMyListings, setHideMyListings] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<"low" | "high" | "event">("low");

  // ─── Fetch Active Listings from Contract ────────────────────────────────────
  const loadMarketListings = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const readContract = getReadContract();
      const totalMintedRaw = await readContract.totalMinted();
      const totalMinted = Number(totalMintedRaw);

      if (totalMinted === 0) {
        setListings([]);
        return;
      }

      const activeListings: MarketListing[] = [];
      const batchSize = 25;

      for (let start = 0; start < totalMinted; start += batchSize) {
        const end = Math.min(start + batchSize, totalMinted);
        const checks = Array.from({ length: end - start }, async (_, idx) => {
          const tokenId = start + idx;
          try {
            const listing = await readContract.getListing(tokenId);
            if (listing.active) {
              const [eventIdRaw, originalPriceRaw, isUsed] = await Promise.all([
                readContract.ticketEvent(tokenId),
                readContract.originalPrice(tokenId),
                readContract.used(tokenId),
              ]);

              // Active listing cannot be a used ticket
              if (isUsed) return null;

              const eventId = Number(eventIdRaw);
              const ev = await readContract.getFunction("getEvent")(eventId);

              const price = listing.price as bigint;
              const faceValue = originalPriceRaw as bigint;

              // Calculate % over face value
              let percentOverFaceValue = 0;
              if (faceValue > 0n) {
                if (price >= faceValue) {
                  const diff = price - faceValue;
                  percentOverFaceValue = Number((diff * 10000n) / faceValue) / 100;
                } else {
                  const diff = faceValue - price;
                  percentOverFaceValue = -(Number((diff * 10000n) / faceValue) / 100);
                }
              }

              let userBal = 0;
              if (account) {
                try {
                  const bal = await readContract.walletBalance(eventId, account);
                  userBal = Number(bal);
                } catch {
                  userBal = 0;
                }
              }

              const maxResaleBps = Number(ev.maxResaleBps);

              return {
                tokenId,
                eventId,
                eventName: ev.name,
                eventTime: Number(ev.eventTime),
                eventActive: Boolean(ev.active),
                seller: listing.seller as string,
                price,
                priceFormatted: ethers.formatEther(price),
                faceValue,
                faceValueFormatted: ethers.formatEther(faceValue),
                maxResaleBps,
                resaleCapPercent: maxResaleBps / 100,
                percentOverFaceValue,
                maxPerWallet: Number(ev.maxPerWallet),
                userBalance: userBal,
                royaltyBps: Number(ev.royaltyBps),
              } as MarketListing;
            }
          } catch {
            // Ignore failed token
          }
          return null;
        });

        const batchResults = await Promise.all(checks);
        for (const item of batchResults) {
          if (item) activeListings.push(item);
        }
      }

      setListings(activeListings);
    } catch (err) {
      console.error("Failed to load market listings:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [account]);

  useEffect(() => {
    loadMarketListings();
  }, [loadMarketListings]);

  // ─── Buy Resale Ticket Handler ──────────────────────────────────────────────
  const handleBuyResale = async (listing: MarketListing) => {
    if (!account) {
      await connect();
      return;
    }

    if (wrongNetwork) {
      await switchToCorrectNetwork();
      return;
    }

    if (account.toLowerCase() === listing.seller.toLowerCase()) {
      return;
    }

    setBuyingTokenId(listing.tokenId);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx(
        `Purchase Ticket #${listing.tokenId} on Resale`,
        async () => {
          return signer.buyResale(listing.tokenId, {
            value: listing.price,
          });
        }
      );

      if (receipt) {
        show(
          {
            status: "confirmed",
            message: `🎉 Successfully purchased Ticket #${listing.tokenId} for "${listing.eventName}"!`,
          },
          7000
        );
        // Navigate to My Tickets immediately after purchase
        navigate("/tickets");
      }
    } catch (err: unknown) {
      console.error("Buy resale error:", decodeContractError(err));
    } finally {
      setBuyingTokenId(null);
    }
  };

  // ─── Filter & Sort ──────────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);

  const displayedListings = listings
    .filter((l) => {
      // Must not be expired
      if (l.eventTime <= nowSec || !l.eventActive) return false;
      // Filter out user's own listings if toggle is checked
      if (hideMyListings && account && l.seller.toLowerCase() === account.toLowerCase()) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "low") {
        return a.price < b.price ? -1 : 1;
      }
      if (sortBy === "high") {
        return a.price > b.price ? -1 : 1;
      }
      return a.eventTime - b.eventTime;
    });

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-5 md:py-8 space-y-6">
      {/* ─── Hero / Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>Ticket Market</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {displayedListings.length}
            </span>
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Verified peer-to-peer resale guaranteed with smart contract price caps
          </p>
        </div>

        <button
          onClick={() => loadMarketListings(true)}
          disabled={isRefreshing || isLoading}
          aria-label="Refresh marketplace"
          className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 shrink-0"
        >
          <svg
            className={`w-4 h-4 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`}
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

      {/* ─── Filter & Sort Bar ─────────────────────────────────────────────── */}
      {listings.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-2 bg-slate-900/80 border border-slate-800 rounded-2xl">
          {/* Sort Buttons */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase">Sort:</span>
            <button
              onClick={() => setSortBy("low")}
              className={`py-1 px-2.5 rounded-xl text-xs font-medium transition-all ${
                sortBy === "low"
                  ? "bg-cyan-600 text-white shadow-sm shadow-cyan-600/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Price: Low
            </button>
            <button
              onClick={() => setSortBy("high")}
              className={`py-1 px-2.5 rounded-xl text-xs font-medium transition-all ${
                sortBy === "high"
                  ? "bg-cyan-600 text-white shadow-sm shadow-cyan-600/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Price: High
            </button>
            <button
              onClick={() => setSortBy("event")}
              className={`py-1 px-2.5 rounded-xl text-xs font-medium transition-all ${
                sortBy === "event"
                  ? "bg-cyan-600 text-white shadow-sm shadow-cyan-600/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Date
            </button>
          </div>

          {/* Hide My Listings Checkbox */}
          {account && (
            <label className="flex items-center gap-2 px-2 py-1 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideMyListings}
                onChange={(e) => setHideMyListings(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 focus:ring-offset-0"
              />
              <span>Hide my tickets</span>
            </label>
          )}
        </div>
      )}

      {/* ─── Content List ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-4">
          <MarketSkeleton />
          <MarketSkeleton />
        </div>
      ) : displayedListings.length === 0 ? (
        <EmptyMarketState onRefresh={() => loadMarketListings(true)} />
      ) : (
        <div className="space-y-4">
          {displayedListings.map((listing) => {
            const isSeller = Boolean(account && listing.seller.toLowerCase() === account.toLowerCase());
            const isWalletLimitReached = Boolean(account && listing.userBalance >= listing.maxPerWallet);
            const isBuying = buyingTokenId === listing.tokenId;

            // Determine button state
            let buttonLabel = `Buy for ${listing.priceFormatted} ETH`;
            let isButtonDisabled = false;
            let buttonStyle: "primary" | "warning" | "disabled" | "network" = "primary";

            if (!account) {
              buttonLabel = "Connect Wallet to Buy";
              buttonStyle = "primary";
            } else if (wrongNetwork) {
              buttonLabel = "Switch to Sepolia";
              buttonStyle = "network";
            } else if (isBuying) {
              buttonLabel = "Processing Purchase…";
              isButtonDisabled = true;
              buttonStyle = "disabled";
            } else if (isSeller) {
              buttonLabel = "Your Listing (Cannot Buy)";
              isButtonDisabled = true;
              buttonStyle = "disabled";
            } else if (isWalletLimitReached) {
              buttonLabel = `Wallet Limit Reached (${listing.userBalance}/${listing.maxPerWallet})`;
              isButtonDisabled = true;
              buttonStyle = "warning";
            }

            return (
              <div
                key={listing.tokenId}
                className="group relative bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-slate-800 hover:border-cyan-500/40 rounded-3xl p-5 shadow-2xl transition-all duration-300 backdrop-blur-sm overflow-hidden"
              >
                {/* Glow accent */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all pointer-events-none" />

                {/* ── Header: Event Name & Token ID ── */}
                <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base md:text-lg font-bold text-white tracking-tight truncate group-hover:text-cyan-200 transition-colors">
                        {listing.eventName}
                      </h2>
                      <span className="shrink-0 text-xs font-mono font-semibold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                        #{listing.tokenId}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                      <span>{formatEventDate(listing.eventTime)}</span>
                      <span>•</span>
                      <span className="text-slate-400">
                        Seller: <span className="font-mono text-slate-300">{shortenAddress(listing.seller)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Resale % Over Face Value Badge */}
                  <div className="shrink-0">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm">
                      <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span>
                        {listing.percentOverFaceValue > 0
                          ? `+${listing.percentOverFaceValue.toFixed(1)}%`
                          : listing.percentOverFaceValue === 0
                          ? "At Face Value"
                          : `${listing.percentOverFaceValue.toFixed(1)}%`}
                      </span>
                    </span>
                  </div>
                </div>

                {/* ── Key Metrics Grid ── */}
                <div className="grid grid-cols-2 gap-2.5 my-3.5 relative z-10">
                  {/* Asking Price */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Resale Asking Price
                    </span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-extrabold text-white">
                        {listing.priceFormatted}
                      </span>
                      <span className="text-xs font-bold text-cyan-400">ETH</span>
                    </div>
                  </div>

                  {/* Face Value Comparison */}
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Original Face Value
                    </span>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-base font-bold text-slate-300">
                        {listing.faceValueFormatted}
                      </span>
                      <span className="text-xs font-bold text-slate-400">ETH</span>
                      <span className="text-[10px] text-emerald-400 font-medium ml-1">
                        (Cap: {listing.resaleCapPercent}%)
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Price Protection Callout ── */}
                <div className="mb-3.5 px-3 py-2 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center justify-between text-xs text-slate-400 relative z-10">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Protected by Anti-Scalp Protocol</span>
                  </span>
                  <span className="text-[11px] text-slate-300">
                    Royalty: {listing.royaltyBps / 100}%
                  </span>
                </div>

                {/* ── Buy Resale Button ── */}
                <button
                  onClick={() => handleBuyResale(listing)}
                  disabled={isButtonDisabled}
                  className={`w-full min-h-[48px] rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all relative z-10
                    ${
                      buttonStyle === "primary"
                        ? "bg-gradient-to-r from-cyan-600 via-teal-500 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-lg shadow-cyan-600/25 hover:shadow-cyan-600/40 active:scale-[0.98]"
                        : buttonStyle === "network"
                        ? "bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-600/20 active:scale-[0.98]"
                        : buttonStyle === "warning"
                        ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                        : "bg-slate-800/80 text-slate-500 border border-slate-800 cursor-not-allowed"
                    }
                  `}
                >
                  {isBuying ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      <span>Buying Ticket…</span>
                    </>
                  ) : (
                    <>
                      {buttonStyle === "primary" && (
                        <svg className="w-4 h-4 text-cyan-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      )}
                      <span>{buttonLabel}</span>
                    </>
                  )}
                </button>

                {/* If user is the seller, show shortcut link */}
                {isSeller && (
                  <div className="mt-2 text-center relative z-10">
                    <Link
                      to="/tickets"
                      className="text-xs text-cyan-400 hover:text-cyan-300 underline font-medium"
                    >
                      Manage or delist this ticket in My Tickets →
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
