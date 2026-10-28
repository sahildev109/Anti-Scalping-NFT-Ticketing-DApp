import { useState, useEffect, useCallback, useId } from "react";
import { Link } from "react-router-dom";
import { ethers, BrowserProvider } from "ethers";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../hooks/useToast";
import {
  CONTRACT_ADDRESS,
  CHAIN_ID,
  getReadContract,
  getSignerContract,
  decodeContractError,
} from "../lib/contract";
import {
  buildEntryPassMessage,
  encodeEntryPass,
  type EntryPassPayload,
} from "../lib/entryPass";

// ─── Data Types ───────────────────────────────────────────────────────────────
interface TicketItem {
  tokenId: number;
  eventId: number;
  eventName: string;
  eventTime: number;
  active: boolean;
  faceValue: bigint;
  faceValueFormatted: string;
  maxResaleBps: number;
  resaleCapPercent: number;
  royaltyBps: number;
  maxAllowedPrice: bigint;
  maxAllowedPriceFormatted: string;
  isUsed: boolean;
  isListed: boolean;
  listingPrice: bigint;
  listingPriceFormatted: string;
}

// ─── Helper: Format Date ──────────────────────────────────────────────────────
function formatDate(timestamp: number) {
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString(undefined, {
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

// ─── Sell Ticket Bottom Sheet ─────────────────────────────────────────────────
interface SellModalProps {
  ticket: TicketItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

function SellBottomSheet({ ticket, onClose, onSuccess }: SellModalProps) {
  const { withTx } = useToast();
  const [priceInput, setPriceInput] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const inputId = useId();

  // Reset or preset default price to face value when opened
  useEffect(() => {
    if (ticket) {
      setPriceInput(ticket.faceValueFormatted);
    }
  }, [ticket]);

  if (!ticket) return null;

  // Calculate limits and validation
  let enteredWei = 0n;
  let isParseError = false;
  try {
    if (priceInput.trim()) {
      enteredWei = ethers.parseEther(priceInput);
    }
  } catch {
    isParseError = true;
  }

  const isAboveCap = enteredWei > ticket.maxAllowedPrice;
  const isZeroOrNeg = enteredWei <= 0n;
  const isInvalid = isParseError || isAboveCap || isZeroOrNeg;

  // Calculate estimated seller proceeds (after royalty)
  let estimatedRoyaltyWei = 0n;
  let estimatedProceedsWei = 0n;
  if (!isInvalid && enteredWei > 0n) {
    estimatedRoyaltyWei = (enteredWei * BigInt(ticket.royaltyBps)) / 10000n;
    estimatedProceedsWei = enteredWei - estimatedRoyaltyWei;
  }

  const handleSetMaxCap = () => {
    setPriceInput(ticket.maxAllowedPriceFormatted);
  };

  const handleSetFaceValue = () => {
    setPriceInput(ticket.faceValueFormatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isInvalid || isSubmitting) return;

    // Safety auto-clamp
    const finalWei = enteredWei > ticket.maxAllowedPrice ? ticket.maxAllowedPrice : enteredWei;

    setIsSubmitting(true);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx(`List Ticket #${ticket.tokenId} for resale`, async () => {
        return signer.listForResale(ticket.tokenId, finalWei);
      });

      if (receipt) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      console.error("Listing error:", decodeContractError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-slate-900 border-t border-slate-700/80 rounded-t-3xl p-6 shadow-2xl z-10 space-y-5 animate-in slide-in-from-bottom duration-300">
        {/* Handle bar */}
        <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto" />

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">Sell Ticket on Market</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {ticket.eventName} • Ticket #{ticket.tokenId}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Price Cap Notice Box */}
        <div className="bg-indigo-950/40 border border-indigo-500/25 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Face Value:</span>
            <span className="text-slate-200 font-bold">{ticket.faceValueFormatted} ETH</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-indigo-300 font-medium flex items-center gap-1">
              <span>🛡️ Resale Price Cap ({ticket.resaleCapPercent}%):</span>
            </span>
            <span className="text-indigo-200 font-bold">{ticket.maxAllowedPriceFormatted} ETH</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-tight pt-1 border-t border-indigo-500/15">
            The smart contract guarantees anti-scalping by blocking listings higher than the cap.
          </p>
        </div>

        {/* Price Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={inputId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Asking Price (ETH)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSetFaceValue}
                  className="text-[11px] font-semibold text-slate-400 hover:text-indigo-300 transition-colors"
                >
                  Face Value
                </button>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={handleSetMaxCap}
                  className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 underline transition-colors"
                >
                  Max Cap
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                id={inputId}
                type="number"
                step="0.0001"
                min="0.0001"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0.05"
                className={`w-full bg-slate-950 border rounded-2xl py-3.5 pl-4 pr-16 text-lg font-bold text-white focus:outline-none transition-colors ${
                  isAboveCap
                    ? "border-rose-500 focus:border-rose-400 text-rose-200 bg-rose-950/20"
                    : "border-slate-700 focus:border-indigo-500"
                }`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">
                ETH
              </span>
            </div>

            {/* Over Cap Warning Banner */}
            {isAboveCap && (
              <div className="mt-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 text-rose-300 text-xs">
                <svg className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold">Exceeds Maximum Resale Cap!</p>
                  <p className="mt-0.5 text-rose-300/80">
                    Highest allowed listing is <strong className="text-white">{ticket.maxAllowedPriceFormatted} ETH</strong>. The contract will revert if listed higher.
                  </p>
                  <button
                    type="button"
                    onClick={handleSetMaxCap}
                    className="mt-1.5 text-xs font-bold text-rose-200 underline hover:text-white"
                  >
                    Auto-clamp to {ticket.maxAllowedPriceFormatted} ETH
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Breakdown summary */}
          {!isInvalid && enteredWei > 0n && (
            <div className="bg-slate-950/50 rounded-2xl p-3 border border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Organizer cut ({ticket.royaltyBps / 100}% royalty):</span>
                <span>{ethers.formatEther(estimatedRoyaltyWei)} ETH</span>
              </div>
              <div className="flex justify-between text-emerald-400 font-semibold border-t border-slate-800/80 pt-1.5">
                <span>Estimated seller payout:</span>
                <span>~{ethers.formatEther(estimatedProceedsWei)} ETH</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[48px] rounded-2xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 font-semibold text-sm transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isInvalid || isSubmitting}
              className={`flex-1 min-h-[48px] rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${
                isInvalid || isSubmitting
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                  : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/30 active:scale-[0.98]"
              }`}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  <span>Listing…</span>
                </>
              ) : (
                <span>List for Resale</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Entry Pass Modal (Cryptographic Signed Pass with 120s Timer) ─────────────
interface EntryPassModalProps {
  ticket: TicketItem | null;
  account: string;
  onClose: () => void;
}

function EntryPassModal({ ticket, account, onClose }: EntryPassModalProps) {
  const [status, setStatus] = useState<"signing" | "active" | "expired" | "error">("signing");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [payload, setPayload] = useState<EntryPassPayload | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(120);

  // Keep screen awake if supported
  useEffect(() => {
    let wakeLock: { release: () => Promise<void> } | null = null;
    if ("wakeLock" in navigator) {
      (navigator as unknown as { wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock
        .request("screen")
        .then((lock) => {
          wakeLock = lock;
        })
        .catch(() => {});
    }
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  // ── Function to sign message and generate pass ──────────────────────────────
  const generateAndSignPass = useCallback(async () => {
    if (!ticket || !window.ethereum) return;

    setStatus("signing");
    setErrorMessage("");

    try {
      const nowTimestamp = Math.floor(Date.now() / 1000);
      const message = buildEntryPassMessage(
        CONTRACT_ADDRESS,
        CHAIN_ID,
        ticket.tokenId,
        nowTimestamp
      );

      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Sign the canonical message via personal_sign
      const signature = await signer.signMessage(message);

      const newPayload: EntryPassPayload = {
        t: ticket.tokenId,
        ts: nowTimestamp,
        sig: signature,
      };

      setPayload(newPayload);
      setTimeLeft(120);
      setStatus("active");
    } catch (err: unknown) {
      console.error("Sign entry pass error:", err);
      const msg = decodeContractError(err);
      setErrorMessage(
        msg.includes("rejected") || msg.includes("cancelled")
          ? "Wallet signature was cancelled. An active cryptographic signature is required to verify ticket ownership at the entrance."
          : msg
      );
      setStatus("error");
    }
  }, [ticket]);

  // Initial trigger when modal opens
  useEffect(() => {
    if (ticket && !ticket.isUsed && !ticket.isListed) {
      generateAndSignPass();
    }
  }, [ticket, generateAndSignPass]);

  // 120-second countdown interval
  useEffect(() => {
    if (status !== "active") return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setStatus("expired");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

  if (!ticket) return null;

  // Circular timer math
  // Radius = 20, Circumference = 2 * PI * 20 = 125.66
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - timeLeft / 120);

  const qrString = payload ? encodeEntryPass(payload) : "";

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between p-5 md:p-8 animate-in fade-in duration-200 overflow-y-auto">
      {/* ── Top Bar ── */}
      <div className="w-full max-w-sm mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "active" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              LIVE PASS
            </span>
          ) : status === "expired" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              EXPIRED (120s)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              SIGNING…
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          aria-label="Close pass"
          className="w-9 h-9 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-base font-bold"
        >
          ✕
        </button>
      </div>

      {/* ── Main Center Area ── */}
      <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-center my-auto py-4 text-center">
        {/* Screen Brightness Hint Banner */}
        <div className="w-full mb-4 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center gap-2 text-amber-300 text-xs font-medium">
          <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <span>Set screen brightness to maximum for instant gate scanning</span>
        </div>

        {/* 120s Countdown Ring Header */}
        {status === "active" && (
          <div className="flex items-center gap-3 mb-4 px-4 py-2 rounded-2xl bg-slate-900 border border-slate-800/80">
            {/* SVG Circular Ring */}
            <div className="relative w-11 h-11 flex items-center justify-center">
              <svg className="w-11 h-11 -rotate-90" viewBox="0 0 48 48">
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  className="stroke-slate-800"
                  strokeWidth="4"
                  fill="none"
                />
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  className={`transition-all duration-1000 ${
                    timeLeft <= 20 ? "stroke-rose-400" : timeLeft <= 50 ? "stroke-amber-400" : "stroke-emerald-400"
                  }`}
                  strokeWidth="4"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              <span className="absolute text-[11px] font-mono font-bold text-white">
                {timeLeft}
              </span>
            </div>

            <div className="text-left">
              <p className="text-xs font-bold text-slate-200">Anti-Fraud Refresh</p>
              <p className="text-[10px] text-slate-400">Pass expires in {timeLeft} seconds</p>
            </div>
          </div>
        )}

        {/* ── State 1: Awaiting Signature ── */}
        {status === "signing" && (
          <div className="w-full py-16 flex flex-col items-center justify-center space-y-4">
            <div className="relative w-20 h-20 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <svg className="animate-spin h-10 w-10 text-indigo-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            </div>
            <h4 className="text-lg font-bold text-white">Signing Entry Pass…</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              Please approve the ownership signature request in MetaMask to activate your high-contrast QR entry pass.
            </p>
          </div>
        )}

        {/* ── State 2: Signature Error ── */}
        {status === "error" && (
          <div className="w-full py-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h4 className="text-base font-bold text-white">Signature Required</h4>
            <p className="text-xs text-slate-400 max-w-xs">{errorMessage}</p>
            <button
              onClick={generateAndSignPass}
              className="min-h-[44px] px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all active:scale-95"
            >
              Retry Signing
            </button>
          </div>
        )}

        {/* ── State 3 & 4: Active QR or Expired Blurred QR ── */}
        {(status === "active" || status === "expired") && (
          <div className="relative flex flex-col items-center justify-center my-2">
            {/* High-Contrast QR Code container (~280px with quiet zone) */}
            <div
              className={`p-4 bg-white rounded-3xl shadow-2xl transition-all duration-300 relative ${
                status === "expired" ? "blur-md opacity-25 select-none pointer-events-none" : ""
              }`}
            >
              <QRCodeSVG
                value={qrString}
                size={280}
                level="M"
                marginSize={4}
                className="rounded-xl"
              />
            </div>

            {/* Expired Overlay with Refresh Button */}
            {status === "expired" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20 space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-xl backdrop-blur-md">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-lg font-extrabold text-white">Pass Expired</h4>
                  <p className="text-xs text-slate-300 mt-1 max-w-[240px]">
                    120-second dynamic validity window expired to prevent screenshot forwarding.
                  </p>
                </div>

                <button
                  onClick={generateAndSignPass}
                  className="min-h-[48px] px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 flex items-center gap-2 transition-all active:scale-95"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Refresh Pass</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Event Details Under QR ── */}
        <div className="mt-4 space-y-1">
          <h3 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
            {ticket.eventName}
          </h3>
          <div className="flex items-center justify-center gap-2 pt-0.5">
            <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-md border border-indigo-500/20">
              Ticket #{ticket.tokenId}
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono text-slate-400">
              Holder: {shortenAddress(account)}
            </span>
          </div>
          <p className="text-xs text-slate-400 pt-1">{formatDate(ticket.eventTime)}</p>
        </div>
      </div>

      {/* ── Bottom Close Bar ── */}
      <div className="w-full max-w-sm mx-auto pt-2">
        <button
          onClick={onClose}
          className="w-full min-h-[48px] rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-semibold text-sm transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Main My Tickets Page ─────────────────────────────────────────────────────
export default function MyTicketsPage() {
  const { account, connect } = useWallet();
  const { withTx, show } = useToast();

  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [filter, setFilter] = useState<"all" | "valid" | "listed" | "used">("all");

  // Modals state
  const [sellModalTicket, setSellModalTicket] = useState<TicketItem | null>(null);
  const [passModalTicket, setPassModalTicket] = useState<TicketItem | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // ─── Fetch tickets owned by current account ─────────────────────────────────
  const loadUserTickets = useCallback(async (isRefresh = false) => {
    if (!account) {
      setTickets([]);
      setIsLoading(false);
      return;
    }

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
        setTickets([]);
        return;
      }

      // Check tokens in batches
      const userTickets: TicketItem[] = [];
      const batchSize = 25;

      for (let start = 0; start < totalMinted; start += batchSize) {
        const end = Math.min(start + batchSize, totalMinted);
        const checks = Array.from({ length: end - start }, async (_, idx) => {
          const tokenId = start + idx;
          try {
            const owner = await readContract.ownerOf(tokenId);
            if (owner.toLowerCase() === account.toLowerCase()) {
              const [eventIdRaw, originalPriceRaw, isUsed, listing] = await Promise.all([
                readContract.ticketEvent(tokenId),
                readContract.originalPrice(tokenId),
                readContract.used(tokenId),
                readContract.getListing(tokenId),
              ]);

              const eventId = Number(eventIdRaw);
              const ev = await readContract.getFunction("getEvent")(eventId);

              const faceValue = originalPriceRaw as bigint;
              const maxResaleBps = Number(ev.maxResaleBps);
              const maxAllowedPrice = (faceValue * BigInt(maxResaleBps)) / 10000n;

              return {
                tokenId,
                eventId,
                eventName: ev.name,
                eventTime: Number(ev.eventTime),
                active: Boolean(ev.active),
                faceValue,
                faceValueFormatted: ethers.formatEther(faceValue),
                maxResaleBps,
                resaleCapPercent: maxResaleBps / 100,
                royaltyBps: Number(ev.royaltyBps),
                maxAllowedPrice,
                maxAllowedPriceFormatted: ethers.formatEther(maxAllowedPrice),
                isUsed: Boolean(isUsed),
                isListed: Boolean(listing.active),
                listingPrice: listing.active ? (listing.price as bigint) : 0n,
                listingPriceFormatted: listing.active ? ethers.formatEther(listing.price) : "0",
              } as TicketItem;
            }
          } catch {
            // Ignore non-existent or failed tokens
          }
          return null;
        });

        const batchResults = await Promise.all(checks);
        for (const item of batchResults) {
          if (item) userTickets.push(item);
        }
      }

      // Sort: active/valid tickets first, then listed, then used
      userTickets.sort((a, b) => {
        if (a.isUsed !== b.isUsed) return a.isUsed ? 1 : -1;
        if (a.isListed !== b.isListed) return a.isListed ? 1 : -1;
        return a.tokenId - b.tokenId;
      });

      setTickets(userTickets);
    } catch (err) {
      console.error("Failed to load user tickets:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [account]);

  useEffect(() => {
    loadUserTickets();
  }, [loadUserTickets]);

  // ─── Entry Pass Trigger with Strict Blocking ────────────────────────────────
  const handleShowPass = (ticket: TicketItem) => {
    if (ticket.isUsed) {
      show(
        {
          status: "failed",
          message: "Cannot generate entry pass: This ticket has already been checked in at the door.",
        },
        5000
      );
      return;
    }

    if (ticket.isListed) {
      show(
        {
          status: "failed",
          message: "Cannot generate entry pass: This ticket is currently listed for sale. Please cancel the listing first.",
        },
        5000
      );
      return;
    }

    setPassModalTicket(ticket);
  };

  // ─── Cancel Resale Listing ──────────────────────────────────────────────────
  const handleCancelListing = async (ticket: TicketItem) => {
    setCancellingId(ticket.tokenId);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx(`Cancel resale listing for Ticket #${ticket.tokenId}`, async () => {
        return signer.cancelListing(ticket.tokenId);
      });

      if (receipt) {
        await loadUserTickets(true);
      }
    } catch (err) {
      console.error("Cancel listing error:", decodeContractError(err));
    } finally {
      setCancellingId(null);
    }
  };

  // ─── Filtered Tickets ───────────────────────────────────────────────────────
  const filteredTickets = tickets.filter((t) => {
    if (filter === "valid") return !t.isUsed && !t.isListed;
    if (filter === "listed") return t.isListed && !t.isUsed;
    if (filter === "used") return t.isUsed;
    return true;
  });

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-5 md:py-8 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>My Tickets</span>
            {account && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {tickets.length}
              </span>
            )}
          </h1>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Your NFT passes, resale listings, and entry credentials
          </p>
        </div>

        {account && (
          <button
            onClick={() => loadUserTickets(true)}
            disabled={isRefreshing || isLoading}
            aria-label="Refresh tickets"
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
        )}
      </div>

      {/* ── No Wallet Screen ── */}
      {!account ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white">Connect Your Wallet</h2>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Connect your MetaMask wallet to view your purchased tickets, access your QR entry pass, or list tickets for resale.
          </p>
          <button
            onClick={() => connect()}
            className="min-h-[44px] px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <>
          {/* ── Filters ── */}
          {tickets.length > 0 && (
            <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl">
              <button
                onClick={() => setFilter("all")}
                className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-medium transition-all ${
                  filter === "all"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All ({tickets.length})
              </button>
              <button
                onClick={() => setFilter("valid")}
                className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-medium transition-all ${
                  filter === "valid"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Valid ({tickets.filter((t) => !t.isUsed && !t.isListed).length})
              </button>
              <button
                onClick={() => setFilter("listed")}
                className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-medium transition-all ${
                  filter === "listed"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Listed ({tickets.filter((t) => t.isListed && !t.isUsed).length})
              </button>
              <button
                onClick={() => setFilter("used")}
                className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-medium transition-all ${
                  filter === "used"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Used ({tickets.filter((t) => t.isUsed).length})
              </button>
            </div>
          )}

          {/* ── Content ── */}
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl animate-pulse space-y-4">
                  <div className="flex justify-between">
                    <div className="h-6 bg-slate-800 rounded-lg w-1/2" />
                    <div className="h-6 bg-slate-800 rounded-full w-20" />
                  </div>
                  <div className="h-16 bg-slate-800/50 rounded-2xl" />
                  <div className="h-11 bg-slate-800 rounded-2xl" />
                </div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center max-w-sm mx-auto">
              <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6 text-indigo-400 shadow-xl">
                <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">No Tickets in Wallet</h2>
              <p className="text-slate-400 text-xs leading-relaxed mb-6">
                You haven't bought any event tickets yet. Explore upcoming concerts and festivals to claim your pass!
              </p>
              <Link
                to="/events"
                className="min-h-[46px] px-6 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
              >
                <span>Browse Events</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              No tickets found in this section.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTickets.map((ticket) => {
                const isCancelling = cancellingId === ticket.tokenId;

                return (
                  <div
                    key={ticket.tokenId}
                    className={`relative rounded-3xl p-5 border shadow-2xl transition-all duration-300 overflow-hidden ${
                      ticket.isUsed
                        ? "bg-slate-900/40 border-slate-800/80 opacity-70"
                        : ticket.isListed
                        ? "bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-cyan-500/30 hover:border-cyan-500/50"
                        : "bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-slate-800 hover:border-indigo-500/40 shadow-indigo-950/20"
                    }`}
                  >
                    {/* CHECKED IN STAMP for used tickets */}
                    {ticket.isUsed && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none z-20">
                        <div className="border-4 border-slate-500/80 text-slate-400/90 font-black tracking-widest uppercase text-base px-4 py-1.5 rounded-xl rotate-[-12deg] shadow-lg bg-slate-950/60 backdrop-blur-sm">
                          CHECKED IN
                        </div>
                      </div>
                    )}

                    {/* Top Row: Event name + Status Chip */}
                    <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base md:text-lg font-bold text-white tracking-tight truncate">
                            {ticket.eventName}
                          </h2>
                          <span className="shrink-0 text-xs font-mono font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                            #{ticket.tokenId}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{formatDate(ticket.eventTime)}</p>
                      </div>

                      {/* Status Chip */}
                      <div className="shrink-0">
                        {ticket.isUsed ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                            <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Used
                          </span>
                        ) : ticket.isListed ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            Listed • {ticket.listingPriceFormatted} ETH
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Valid Pass
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metrics / Details */}
                    <div className="grid grid-cols-2 gap-2.5 my-3 relative z-10">
                      <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          Face Value
                        </span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="text-base font-bold text-white">
                            {ticket.faceValueFormatted}
                          </span>
                          <span className="text-[11px] font-bold text-indigo-400">ETH</span>
                        </div>
                      </div>

                      <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          Max Resale Cap
                        </span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="text-base font-bold text-indigo-300">
                            {ticket.maxAllowedPriceFormatted}
                          </span>
                          <span className="text-[11px] font-bold text-indigo-400">ETH</span>
                          <span className="text-[10px] text-slate-400 ml-1">
                            ({ticket.resaleCapPercent}%)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2.5 pt-2 relative z-10">
                      {!ticket.isUsed && (
                        <>
                          {/* Show Entry Pass - Blocked if ticket is listed */}
                          {ticket.isListed ? (
                            <button
                              onClick={() => handleShowPass(ticket)}
                              title="Delist ticket from marketplace to use as an entry pass"
                              className="flex-1 min-h-[44px] rounded-xl bg-slate-800/50 border border-slate-800 text-slate-500 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed"
                            >
                              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              <span>Pass Locked (Listed)</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleShowPass(ticket)}
                              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                            >
                              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                              </svg>
                              <span>Show Entry Pass</span>
                            </button>
                          )}

                          {/* Sell / Cancel Listing */}
                          {ticket.isListed ? (
                            <button
                              onClick={() => handleCancelListing(ticket)}
                              disabled={isCancelling}
                              className="flex-1 min-h-[44px] rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50"
                            >
                              {isCancelling ? (
                                <svg className="animate-spin h-4 w-4 text-rose-300" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                </svg>
                              ) : (
                                <span>Cancel Listing</span>
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() => setSellModalTicket(ticket)}
                              className="flex-1 min-h-[44px] rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98]"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>Sell Ticket</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      <SellBottomSheet
        ticket={sellModalTicket}
        onClose={() => setSellModalTicket(null)}
        onSuccess={() => loadUserTickets(true)}
      />

      <EntryPassModal
        ticket={passModalTicket}
        account={account || ""}
        onClose={() => setPassModalTicket(null)}
      />
    </div>
  );
}
