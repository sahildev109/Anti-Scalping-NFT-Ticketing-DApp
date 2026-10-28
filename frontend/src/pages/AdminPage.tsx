import { useState, useEffect, useCallback, useId } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { useToast } from "../hooks/useToast";
import {
  CHECKER_ROLE,
  getReadContract,
  getSignerContract,
  decodeContractError,
} from "../lib/contract";

// ─── Data Interface ───────────────────────────────────────────────────────────
interface AdminEventItem {
  id: number;
  name: string;
  ticketPrice: bigint;
  priceFormatted: string;
  maxSupply: number;
  minted: number;
  revenueWei: bigint;
  revenueFormatted: string;
  maxResaleBps: number;
  resaleCapPercent: number;
  royaltyBps: number;
  eventTime: number;
  maxPerWallet: number;
  active: boolean;
}

// ─── Format Helpers ───────────────────────────────────────────────────────────
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

function getDefaultDateTime(): string {
  // Default to 3 days in the future at 19:00 (7 PM)
  const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  d.setHours(19, 0, 0, 0);
  // Format as YYYY-MM-DDTHH:MM for datetime-local input
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPage() {
  const { account, isAdmin, connect } = useWallet();
  const { withTx, show } = useToast();

  // Data states
  const [events, setEvents] = useState<AdminEventItem[]>([]);
  const [pendingBalance, setPendingBalance] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isWithdrawing, setIsWithdrawing] = useState<boolean>(false);

  // Create Event Form states
  const [name, setName] = useState<string>("");
  const [priceEth, setPriceEth] = useState<string>("0.05");
  const [maxSupply, setMaxSupply] = useState<string>("100");
  const [maxPerWallet, setMaxPerWallet] = useState<string>("2");
  const [resaleCapPercent, setResaleCapPercent] = useState<number>(110); // 100 - 150
  const [royaltyPercent, setRoyaltyPercent] = useState<number>(5); // 0 - 10
  const [eventDateTime, setEventDateTime] = useState<string>(getDefaultDateTime());
  const [isCreatingEvent, setIsCreatingEvent] = useState<boolean>(false);

  // Form IDs for accessibility
  const nameId = useId();
  const priceId = useId();
  const supplyId = useId();
  const walletLimitId = useId();
  const dateTimeId = useId();
  const resaleCapId = useId();
  const royaltyId = useId();
  const checkerAddrId = useId();

  // Grant Role states
  const [checkerAddress, setCheckerAddress] = useState<string>("");
  const [isGrantingRole, setIsGrantingRole] = useState<boolean>(false);

  // ─── Load Admin Data ────────────────────────────────────────────────────────
  const loadAdminData = useCallback(async (isRefresh = false) => {
    if (!account) {
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

      // 1. Fetch pending withdrawal balance for connected account
      const bal = await readContract.pendingWithdrawals(account);
      setPendingBalance(bal as bigint);

      // 2. Fetch all events created
      const countRaw = await readContract.totalEvents();
      const count = Number(countRaw);

      if (count === 0) {
        setEvents([]);
        return;
      }

      const eventPromises = Array.from({ length: count }, async (_, i) => {
        const ev = await readContract.getFunction("getEvent")(i);

        const ticketPrice = ev.ticketPrice as bigint;
        const minted = Number(ev.minted);
        const revenueWei = ticketPrice * BigInt(minted);
        const maxResaleBps = Number(ev.maxResaleBps);

        return {
          id: i,
          name: ev.name,
          ticketPrice,
          priceFormatted: ethers.formatEther(ticketPrice),
          maxSupply: Number(ev.maxSupply),
          minted,
          revenueWei,
          revenueFormatted: ethers.formatEther(revenueWei),
          maxResaleBps,
          resaleCapPercent: maxResaleBps / 100,
          royaltyBps: Number(ev.royaltyBps),
          eventTime: Number(ev.eventTime),
          maxPerWallet: Number(ev.maxPerWallet),
          active: Boolean(ev.active),
        } as AdminEventItem;
      });

      const loadedEvents = await Promise.all(eventPromises);
      // Sort newest events first
      loadedEvents.sort((a, b) => b.id - a.id);
      setEvents(loadedEvents);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [account]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  // ─── Handle Create Event ────────────────────────────────────────────────────
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;

    // Validate inputs
    const trimmedName = name.trim();
    if (!trimmedName) {
      show({ status: "failed", message: "Please enter an event name." }, 4000);
      return;
    }

    let parsedPrice: bigint;
    try {
      parsedPrice = ethers.parseEther(priceEth);
      if (parsedPrice < 0n) throw new Error();
    } catch {
      show({ status: "failed", message: "Invalid ticket price format." }, 4000);
      return;
    }

    const supplyNum = parseInt(maxSupply, 10);
    if (isNaN(supplyNum) || supplyNum <= 0) {
      show({ status: "failed", message: "Max supply must be greater than 0." }, 4000);
      return;
    }

    const limitNum = parseInt(maxPerWallet, 10);
    if (isNaN(limitNum) || limitNum <= 0 || limitNum > 255) {
      show({ status: "failed", message: "Max per wallet must be between 1 and 255." }, 4000);
      return;
    }

    const eventDate = new Date(eventDateTime);
    const eventTimeSec = Math.floor(eventDate.getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);

    if (isNaN(eventTimeSec) || eventTimeSec <= nowSec) {
      show({ status: "failed", message: "Event date and time must be in the future." }, 4000);
      return;
    }

    // Convert percentages to basis points
    // Resale cap: 110% -> 11000 bps
    const maxResaleBps = Math.round(resaleCapPercent * 100);
    // Royalty: 5% -> 500 bps (max 1000)
    const royaltyBps = Math.min(1000, Math.round(royaltyPercent * 100));

    setIsCreatingEvent(true);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx(`Create event "${trimmedName}"`, async () => {
        return signer.createEvent(
          trimmedName,
          parsedPrice,
          supplyNum,
          maxResaleBps,
          royaltyBps,
          eventTimeSec,
          limitNum
        );
      });

      if (receipt) {
        show(
          {
            status: "confirmed",
            message: `🎉 Event "${trimmedName}" created successfully! Now accepting ticket sales.`,
          },
          7000
        );
        // Reset form to defaults
        setName("");
        setPriceEth("0.05");
        setMaxSupply("100");
        setMaxPerWallet("2");
        setResaleCapPercent(110);
        setRoyaltyPercent(5);
        setEventDateTime(getDefaultDateTime());

        // Refresh events list
        await loadAdminData(true);
      }
    } catch (err) {
      console.error("Create event error:", decodeContractError(err));
    } finally {
      setIsCreatingEvent(false);
    }
  };

  // ─── Handle Withdraw ────────────────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (pendingBalance <= 0n || isWithdrawing) return;

    setIsWithdrawing(true);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx("Withdraw organizer revenue", async () => {
        return signer.withdraw();
      });

      if (receipt) {
        show(
          {
            status: "confirmed",
            message: `🎉 Revenue of ${ethers.formatEther(pendingBalance)} ETH withdrawn to your wallet!`,
          },
          7000
        );
        await loadAdminData(true);
      }
    } catch (err) {
      console.error("Withdraw error:", decodeContractError(err));
    } finally {
      setIsWithdrawing(false);
    }
  };

  // ─── Handle Grant Checker Role ──────────────────────────────────────────────
  const handleGrantChecker = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddr = checkerAddress.trim();

    if (!ethers.isAddress(cleanAddr)) {
      show({ status: "failed", message: "Please enter a valid Ethereum address." }, 4000);
      return;
    }

    setIsGrantingRole(true);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx(
        `Grant CHECKER_ROLE to ${cleanAddr.slice(0, 6)}…${cleanAddr.slice(-4)}`,
        async () => {
          return signer.grantRole(CHECKER_ROLE, cleanAddr);
        }
      );

      if (receipt) {
        show(
          {
            status: "confirmed",
            message: `Gate staff privileges granted to ${cleanAddr}! They can now check tickets via the Scan tab.`,
          },
          7000
        );
        setCheckerAddress("");
      }
    } catch (err) {
      console.error("Grant role error:", decodeContractError(err));
    } finally {
      setIsGrantingRole(false);
    }
  };

  // ─── Guard: Unauthorized Screen ─────────────────────────────────────────────
  if (!account || !isAdmin) {
    return (
      <div className="w-full max-w-md mx-auto px-6 py-16 text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center mx-auto text-rose-400 shadow-2xl shadow-rose-950/40">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Admin Access Restricted</h1>
          <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
            This dashboard is exclusively accessible to the event organizer holding the{" "}
            <code className="text-rose-300 bg-rose-500/10 px-1.5 py-0.5 rounded text-[11px] font-mono">
              DEFAULT_ADMIN_ROLE
            </code>
            .
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-3">
          {!account ? (
            <button
              onClick={() => connect()}
              className="min-h-[46px] w-full rounded-2xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-rose-900/30 transition-all active:scale-95"
            >
              Connect Organizer Wallet
            </button>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 space-y-2">
              <p>
                Connected wallet:{" "}
                <span className="font-mono text-slate-200">{account.slice(0, 6)}…{account.slice(-4)}</span>
              </p>
              <p className="text-amber-400 font-medium">
                This wallet does not possess organizer privileges. Please switch to the deployer account in MetaMask.
              </p>
            </div>
          )}

          <Link
            to="/events"
            className="text-xs text-slate-400 hover:text-white py-2 font-medium transition-colors"
          >
            ← Return to Explore Events
          </Link>
        </div>
      </div>
    );
  }

  // Calculate high-level organizer totals
  const totalTicketsSold = events.reduce((sum, e) => sum + e.minted, 0);
  const totalPrimaryRevenueWei = events.reduce((sum, e) => sum + e.revenueWei, 0n);
  const hasClaimableBalance = pendingBalance > 0n;

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-5 md:py-8 space-y-7">
      {/* ─── Page Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Organizer Admin
            </h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase tracking-wider">
              Admin
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Manage events, revenue withdrawals, and gate staff access
          </p>
        </div>

        <button
          onClick={() => loadAdminData(true)}
          disabled={isRefreshing || isLoading}
          aria-label="Refresh admin data"
          className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 shrink-0"
        >
          <svg
            className={`w-4 h-4 ${isRefreshing ? "animate-spin text-rose-400" : ""}`}
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

      {/* ─── 1. Revenue & Withdrawal Card ──────────────────────────────────── */}
      <div className="relative rounded-3xl p-5 bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-950 border border-indigo-500/30 shadow-2xl overflow-hidden space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
              Claimable Organizer Revenue
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl md:text-3xl font-black text-white">
                {ethers.formatEther(pendingBalance)}
              </span>
              <span className="text-sm font-bold text-indigo-300">ETH</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Accrues automatically from primary ticket sales and secondary marketplace royalties
            </p>
          </div>

          <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
        </div>

        {/* Aggregate Stats */}
        <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-800">
          <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Total Tickets Sold</span>
            <p className="text-base font-bold text-slate-200 mt-0.5">{totalTicketsSold}</p>
          </div>
          <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80">
            <span className="text-[10px] font-semibold text-slate-400 uppercase">Gross Sales Volume</span>
            <p className="text-base font-bold text-slate-200 mt-0.5">
              {ethers.formatEther(totalPrimaryRevenueWei)} ETH
            </p>
          </div>
        </div>

        {/* Big Thumb-Friendly Withdraw Button */}
        <button
          onClick={handleWithdraw}
          disabled={!hasClaimableBalance || isWithdrawing}
          className={`w-full min-h-[50px] rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98] ${
            hasClaimableBalance && !isWithdrawing
              ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white shadow-emerald-900/30"
              : "bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed shadow-none"
          }`}
        >
          {isWithdrawing ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              <span>Processing Withdrawal…</span>
            </>
          ) : hasClaimableBalance ? (
            <>
              <svg className="w-5 h-5 text-emerald-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Withdraw {ethers.formatEther(pendingBalance)} ETH</span>
            </>
          ) : (
            <span>No Balance to Withdraw (0.00 ETH)</span>
          )}
        </button>
      </div>

      {/* ─── 2. Create Event Form ──────────────────────────────────────────── */}
      <div className="rounded-3xl p-5 md:p-6 bg-slate-900/90 border border-slate-800 shadow-xl space-y-5">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-bold">
              +
            </span>
            <span>Create New Event</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure primary sale details, per-wallet restrictions, and anti-scalping bounds
          </p>
        </div>

        <form onSubmit={handleCreateEvent} className="space-y-4">
          {/* Event Name */}
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Event Name
            </label>
            <input
              id={nameId}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cyberpunk Music Festival 2026"
              className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white text-sm focus:outline-none transition-colors"
            />
          </div>

          {/* Ticket Price in ETH & Max Supply (Stacked Single-Column) */}
          <div className="space-y-1.5">
            <label htmlFor={priceId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Ticket Price (ETH)
            </label>
            <div className="relative">
              <input
                id={priceId}
                type="number"
                step="0.0001"
                min="0"
                required
                value={priceEth}
                onChange={(e) => setPriceEth(e.target.value)}
                placeholder="0.05"
                className="w-full min-h-[48px] pl-4 pr-16 rounded-2xl bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white text-sm font-semibold focus:outline-none transition-colors"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                ETH
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={supplyId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Total Ticket Supply
            </label>
            <input
              id={supplyId}
              type="number"
              min="1"
              required
              value={maxSupply}
              onChange={(e) => setMaxSupply(e.target.value)}
              placeholder="100"
              className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white text-sm font-semibold focus:outline-none transition-colors"
            />
          </div>

          {/* Max Per Wallet */}
          <div className="space-y-1.5">
            <label htmlFor={walletLimitId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Max Tickets Per Wallet
            </label>
            <input
              id={walletLimitId}
              type="number"
              min="1"
              max="255"
              required
              value={maxPerWallet}
              onChange={(e) => setMaxPerWallet(e.target.value)}
              placeholder="2"
              className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white text-sm font-semibold focus:outline-none transition-colors"
            />
            <p className="text-[11px] text-slate-400">
              Prevents single-wallet hoarding in both primary minting and resale purchases
            </p>
          </div>

          {/* Date & Time Picker */}
          <div className="space-y-1.5">
            <label htmlFor={dateTimeId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Event Date & Time
            </label>
            <input
              id={dateTimeId}
              type="datetime-local"
              required
              value={eventDateTime}
              onChange={(e) => setEventDateTime(e.target.value)}
              className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white text-sm font-medium focus:outline-none transition-colors"
            />
          </div>

          {/* Slider 1: Resale Cap % (100 - 150) */}
          <div className="space-y-2 p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <label htmlFor={resaleCapId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🛡️ Anti-Scalp Resale Cap</span>
              </label>
              <span className="text-sm font-extrabold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-lg border border-indigo-500/20">
                {resaleCapPercent}% of Face Value
              </span>
            </div>

            <input
              id={resaleCapId}
              type="range"
              min={100}
              max={150}
              step={1}
              value={resaleCapPercent}
              onChange={(e) => setResaleCapPercent(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />

            <div className="flex justify-between text-[11px] text-slate-400">
              <span>100% (Strict Face Value)</span>
              <span>150% (Max Allowed)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Secondary sellers cannot list tickets higher than {resaleCapPercent}% of face value.
            </p>
          </div>

          {/* Slider 2: Organizer Royalty % (0 - 10) */}
          <div className="space-y-2 p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <label htmlFor={royaltyId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Organizer Resale Royalty
              </label>
              <span className="text-sm font-extrabold text-violet-400 bg-violet-500/10 px-2.5 py-0.5 rounded-lg border border-violet-500/20">
                {royaltyPercent.toFixed(1)}%
              </span>
            </div>

            <input
              id={royaltyId}
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={royaltyPercent}
              onChange={(e) => setRoyaltyPercent(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
            />

            <div className="flex justify-between text-[11px] text-slate-400">
              <span>0% (No Fee)</span>
              <span>10% (Maximum Protocol Cut)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Deducted automatically on every peer-to-peer resale and credited to your withdrawal balance.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isCreatingEvent}
            className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.98] disabled:opacity-50 pt-1"
          >
            {isCreatingEvent ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                <span>Deploying Event on Chain…</span>
              </>
            ) : (
              <span>Create Event on Blockchain</span>
            )}
          </button>
        </form>
      </div>

      {/* ─── 3. Gate Staff (CHECKER_ROLE) Management ───────────────────────── */}
      <div className="rounded-3xl p-5 md:p-6 bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold">
              🛡️
            </span>
            <span>Grant Gate Staff Access</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Authorize staff wallets with <code className="text-amber-300 font-mono">CHECKER_ROLE</code> to validate and check in tickets at venue entrance
          </p>
        </div>

        <form onSubmit={handleGrantChecker} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={checkerAddrId} className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Staff Wallet Address
            </label>
            <input
              id={checkerAddrId}
              type="text"
              required
              value={checkerAddress}
              onChange={(e) => setCheckerAddress(e.target.value)}
              placeholder="0x..."
              className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-950 border border-slate-800 focus:border-amber-500 text-white font-mono text-xs md:text-sm focus:outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isGrantingRole || !checkerAddress.trim()}
            className="w-full min-h-[48px] rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-900/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isGrantingRole ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                <span>Granting Role…</span>
              </>
            ) : (
              <span>Grant CHECKER_ROLE Access</span>
            )}
          </button>
        </form>
      </div>

      {/* ─── 4. List of Organizer Events ───────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">
            Created Events ({events.length})
          </h2>
          <span className="text-xs text-slate-400">Sold Count & Revenue</span>
        </div>

        {events.length === 0 ? (
          <div className="p-8 rounded-3xl bg-slate-900/40 border border-slate-800 text-center text-slate-400 text-xs">
            No events created yet. Use the form above to deploy your first event.
          </div>
        ) : (
          <div className="space-y-3.5">
            {events.map((ev) => {
              const isSoldOut = ev.minted >= ev.maxSupply;
              const percentSold = ev.maxSupply > 0 ? Math.round((ev.minted / ev.maxSupply) * 100) : 0;

              return (
                <div
                  key={ev.id}
                  className="rounded-3xl p-5 bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 hover:border-slate-700 transition-all space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white truncate">{ev.name}</h3>
                        <span className="shrink-0 text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                          ID #{ev.id}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{formatEventDate(ev.eventTime)}</p>
                    </div>

                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        isSoldOut
                          ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                          : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      }`}
                    >
                      {isSoldOut ? "Sold Out" : "Active"}
                    </span>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Price</span>
                      <p className="text-xs font-bold text-white mt-0.5">{ev.priceFormatted} ETH</p>
                    </div>
                    <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Sold Count</span>
                      <p className="text-xs font-bold text-indigo-300 mt-0.5">
                        {ev.minted} / {ev.maxSupply}
                      </p>
                    </div>
                    <div className="bg-slate-950 rounded-xl p-2.5 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">Revenue</span>
                      <p className="text-xs font-bold text-emerald-400 mt-0.5">{ev.revenueFormatted} ETH</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isSoldOut
                            ? "bg-rose-500"
                            : "bg-gradient-to-r from-indigo-500 to-emerald-400"
                        }`}
                        style={{ width: `${percentSold}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>{percentSold}% capacity reached</span>
                      <span>
                        Resale Cap: {ev.resaleCapPercent}% • Royalty: {ev.royaltyBps / 100}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
