import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
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
  parseEntryPass,
  recoverEntryPassSigner,
  type EntryPassPayload,
} from "../lib/entryPass";

// ─── Data Types ───────────────────────────────────────────────────────────────
interface ScanResultData {
  isValid: boolean;
  reason?: string;
  tokenId?: number;
  eventName?: string;
  eventTime?: number;
  holderAddress?: string;
  recoveredSigner?: string;
  timestamp?: number;
}

interface RecentScanItem {
  id: string;
  tokenId: number;
  eventName: string;
  status: "admitted" | "valid" | "invalid";
  reason?: string;
  timeStr: string;
  holder?: string;
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "—";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Main Scan Page ───────────────────────────────────────────────────────────
export default function ScanPage() {
  const { account, isChecker, isAdmin, connect } = useWallet();
  const { withTx } = useToast();

  // Scanner states
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);

  // Fallback demo input state
  const [pasteInput, setPasteInput] = useState<string>("");
  const [isVerifyingManual, setIsVerifyingManual] = useState<boolean>(false);

  // Result overlay state
  const [scanResult, setScanResult] = useState<ScanResultData | null>(null);
  const [isAdmitting, setIsAdmitting] = useState<boolean>(false);
  const [isAdmitted, setIsAdmitted] = useState<boolean>(false);

  // Recent scans list
  const [recentScans, setRecentScans] = useState<RecentScanItem[]>([]);

  // Double-scan prevention: stores last scanned text and timestamp
  const lastScanRef = useRef<{ text: string; time: number } | null>(null);
  const isProcessingRef = useRef<boolean>(false);

  // ─── Verify Pass Logic ──────────────────────────────────────────────────────
  const verifyPassPayload = useCallback(
    async (rawText: string): Promise<ScanResultData> => {
      // 1. Parse JSON payload
      const payload: EntryPassPayload | null = parseEntryPass(rawText);
      if (!payload) {
        return {
          isValid: false,
          reason: "Invalid pass format: QR payload could not be parsed into entry pass JSON.",
        };
      }

      // 2. Timestamp freshness check (last 120s, allowing up to 10s clock drift in future)
      const nowSec = Math.floor(Date.now() / 1000);
      const diff = nowSec - payload.ts;
      if (diff < -10) {
        return {
          isValid: false,
          tokenId: payload.t,
          timestamp: payload.ts,
          reason: "Invalid Timestamp: Pass timestamp is set in the future.",
        };
      }
      if (diff > 120) {
        return {
          isValid: false,
          tokenId: payload.t,
          timestamp: payload.ts,
          reason: `Pass Expired: Generated ${diff} seconds ago (max validity is 120s). Attendee must tap 'Refresh Pass'.`,
        };
      }

      // 3. Recover signer address with ethers.verifyMessage
      let recoveredSigner = "";
      try {
        recoveredSigner = recoverEntryPassSigner(payload, CONTRACT_ADDRESS, CHAIN_ID);
      } catch {
        return {
          isValid: false,
          tokenId: payload.t,
          timestamp: payload.ts,
          reason: "Cryptographic signature recovery failed: Invalid signature.",
        };
      }

      // 4. Contract verification
      try {
        const readContract = getReadContract();

        // 4a. Check ownerOf(tokenId)
        let owner: string;
        try {
          owner = await readContract.ownerOf(payload.t);
        } catch {
          return {
            isValid: false,
            tokenId: payload.t,
            timestamp: payload.ts,
            recoveredSigner,
            reason: `Ticket #${payload.t} Not Found: Token does not exist on the smart contract.`,
          };
        }

        // 4b. Verify owner equals recovered signer
        if (owner.toLowerCase() !== recoveredSigner.toLowerCase()) {
          return {
            isValid: false,
            tokenId: payload.t,
            timestamp: payload.ts,
            holderAddress: owner,
            recoveredSigner,
            reason: `Signer is not owner: Pass signed by ${shortenAddress(recoveredSigner)}, but ticket is held by ${shortenAddress(owner)}.`,
          };
        }

        // 4c. Verify ticket is not already used
        const isUsed = await readContract.used(payload.t);
        if (isUsed) {
          return {
            isValid: false,
            tokenId: payload.t,
            timestamp: payload.ts,
            holderAddress: owner,
            recoveredSigner,
            reason: `Already Used: Ticket #${payload.t} has already been checked in at the door.`,
          };
        }

        // 4d. Verify event is active and not ended
        const eventId = await readContract.ticketEvent(payload.t);
        const ev = await readContract.getFunction("getEvent")(eventId);

        if (!ev.active) {
          return {
            isValid: false,
            tokenId: payload.t,
            timestamp: payload.ts,
            eventName: ev.name,
            holderAddress: owner,
            recoveredSigner,
            reason: `Event Inactive: "${ev.name}" is marked inactive on the smart contract.`,
          };
        }

        // Check if event has already ended (e.g. 24h past start)
        const eventTimeSec = Number(ev.eventTime);
        if (nowSec > eventTimeSec + 86400) {
          return {
            isValid: false,
            tokenId: payload.t,
            timestamp: payload.ts,
            eventName: ev.name,
            holderAddress: owner,
            recoveredSigner,
            reason: `Event Ended: "${ev.name}" concluded on ${formatDate(eventTimeSec)}.`,
          };
        }

        // Everything passed!
        return {
          isValid: true,
          tokenId: payload.t,
          eventName: ev.name,
          eventTime: eventTimeSec,
          holderAddress: owner,
          recoveredSigner,
          timestamp: payload.ts,
        };
      } catch (err) {
        return {
          isValid: false,
          tokenId: payload.t,
          reason: `Verification error: ${decodeContractError(err)}`,
        };
      }
    },
    []
  );

  // ─── Process Scanned String ─────────────────────────────────────────────────
  const processScan = useCallback(
    async (rawText: string) => {
      if (isProcessingRef.current) return;

      // Prevent double scans of the same payload within 5 seconds
      const now = Date.now();
      if (
        lastScanRef.current &&
        lastScanRef.current.text === rawText &&
        now - lastScanRef.current.time < 5000
      ) {
        return;
      }
      lastScanRef.current = { text: rawText, time: now };
      isProcessingRef.current = true;

      const result = await verifyPassPayload(rawText);
      setScanResult(result);
      setIsAdmitted(false);

      // Record in recent scans session state
      const newScanItem: RecentScanItem = {
        id: `${Date.now()}-${Math.random()}`,
        tokenId: result.tokenId ?? 0,
        eventName: result.eventName || "Unknown Event",
        status: result.isValid ? "valid" : "invalid",
        reason: result.reason,
        timeStr: new Date().toLocaleTimeString(),
        holder: result.holderAddress,
      };
      setRecentScans((prev) => [newScanItem, ...prev.slice(0, 9)]);

      isProcessingRef.current = false;
    },
    [verifyPassPayload]
  );

  // ─── Initialize Camera Scanner ──────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const scanner = new Html5Qrcode("qr-viewfinder-region");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const edge = Math.floor(minEdge * 0.75);
            return { width: edge, height: edge };
          },
        },
        (decodedText) => {
          processScan(decodedText);
        },
        () => {
          // Ignore individual frame parse errors
        }
      );

      setIsCameraActive(true);

      // Check if torch/flashlight is supported
      try {
        const capabilities = scanner.getRunningTrackCapabilities();
        if (capabilities && "torch" in capabilities) {
          setHasTorch(true);
        }
      } catch {
        setHasTorch(false);
      }
    } catch (err: unknown) {
      console.warn("Camera start failed:", err);
      setIsCameraActive(false);
      setCameraError(
        "Rear camera could not be accessed. Ensure camera permissions are allowed, or use the demo backup paste box below."
      );
    }
  }, [processScan]);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.warn("Error stopping scanner:", err);
      }
    }
    setIsCameraActive(false);
    setTorchOn(false);
  }, []);

  // Torch Toggle
  const toggleTorch = async () => {
    if (!scannerRef.current || !hasTorch) return;
    try {
      const nextTorch = !torchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch } as Record<string, unknown>],
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.error("Failed to toggle torch:", err);
    }
  };

  // Mount camera if checker
  useEffect(() => {
    if (isChecker) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isChecker, startCamera, stopCamera]);

  // ─── Admit Ticket Holder (calls checkIn on contract) ────────────────────────
  const handleAdmit = async () => {
    if (!scanResult || scanResult.tokenId === undefined || isAdmitting) return;

    setIsAdmitting(true);
    try {
      const signer = await getSignerContract();
      const receipt = await withTx(`Check-in Ticket #${scanResult.tokenId}`, async () => {
        return signer.checkIn(scanResult.tokenId!);
      });

      if (receipt) {
        setIsAdmitted(true);

        // Update the item in recent scans to "admitted"
        setRecentScans((prev) =>
          prev.map((item) =>
            item.tokenId === scanResult.tokenId
              ? { ...item, status: "admitted" }
              : item
          )
        );

        // Pause scanning for 2 seconds, then dismiss and resume
        setTimeout(() => {
          setScanResult(null);
          setIsAdmitted(false);
        }, 2000);
      }
    } catch (err) {
      console.error("Check-in error:", decodeContractError(err));
    } finally {
      setIsAdmitting(false);
    }
  };

  // ─── Handle Manual Paste Verification ───────────────────────────────────────
  const handleVerifyManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = pasteInput.trim();
    if (!clean) return;

    setIsVerifyingManual(true);
    await processScan(clean);
    setIsVerifyingManual(false);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPasteInput(text);
        processScan(text);
      }
    } catch {
      // Clipboard read rejected
    }
  };

  // ─── Guard: CHECKER_ROLE Required ───────────────────────────────────────────
  if (!account || !isChecker) {
    return (
      <div className="w-full max-w-md mx-auto px-6 py-16 text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center mx-auto text-amber-400 shadow-2xl shadow-amber-950/40">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Gate Staff Access Only</h1>
          <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
            This terminal is restricted to venue staff holding the{" "}
            <code className="text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded text-[11px] font-mono">
              CHECKER_ROLE
            </code>
            .
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-3">
          {!account ? (
            <button
              onClick={() => connect()}
              className="min-h-[46px] w-full rounded-2xl bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-amber-900/30 transition-all active:scale-95"
            >
              Connect Gate Staff Wallet
            </button>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 space-y-2 text-left">
              <p>
                Connected: <span className="font-mono text-slate-200">{shortenAddress(account)}</span>
              </p>
              <p className="text-amber-400">
                This wallet does not have check-in permissions.
              </p>
              {isAdmin && (
                <div className="pt-2 border-t border-slate-800">
                  <p className="text-indigo-300">
                    💡 You are the contract organizer! You can grant your wallet the <code className="font-mono">CHECKER_ROLE</code> on the Admin page to test scanning.
                  </p>
                  <Link
                    to="/admin"
                    className="inline-block mt-2 text-xs font-bold text-indigo-400 hover:text-indigo-300 underline"
                  >
                    Go to Admin Dashboard →
                  </Link>
                </div>
              )}
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

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-5 md:py-8 space-y-6">
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Gate Scanner
            </h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
              CHECKER
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-0.5">
            Validate entry credentials and admit attendees
          </p>
        </div>

        {hasTorch && isCameraActive && (
          <button
            onClick={toggleTorch}
            aria-label="Toggle flashlight"
            className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 shrink-0 ${
              torchOn
                ? "bg-amber-500 border-amber-400 text-slate-950 shadow-lg shadow-amber-500/30"
                : "bg-slate-900 border-slate-800 text-slate-300 hover:text-white"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
        )}
      </div>

      {/* ─── Viewfinder Scanner Section ────────────────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl">
        {/* html5-qrcode viewfinder container */}
        <div id="qr-viewfinder-region" className="w-full bg-black min-h-[300px] md:min-h-[360px]" />

        {/* Camera Error / Fallback State */}
        {cameraError && (
          <div className="p-6 text-center space-y-3 bg-slate-900">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-xs text-amber-300 max-w-sm mx-auto">{cameraError}</p>
            <button
              onClick={startCamera}
              className="text-xs font-bold text-indigo-400 hover:text-indigo-300 underline"
            >
              Retry Camera Connection
            </button>
          </div>
        )}

        {/* Viewfinder Overlay Guidance */}
        {isCameraActive && (
          <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Camera active • Point at attendee pass</span>
            </span>
            <span className="text-[11px] text-slate-400 font-mono">120s TTL</span>
          </div>
        )}
      </div>

      {/* ─── Demo Fallback: Paste Pass JSON ─────────────────────────────────── */}
      <div className="rounded-3xl p-5 bg-slate-900/80 border border-slate-800 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="manual-json-input" className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <span>📝 Demo Backup / Paste Pass JSON</span>
          </label>
          <button
            type="button"
            onClick={handlePasteClipboard}
            className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 underline transition-colors"
          >
            Paste from Clipboard
          </button>
        </div>

        <form onSubmit={handleVerifyManual} className="space-y-3">
          <textarea
            id="manual-json-input"
            rows={2}
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            placeholder='{"t":0,"ts":1710000000,"sig":"0x..."}'
            className="w-full p-3 rounded-2xl bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs font-mono text-slate-200 focus:outline-none transition-colors"
          />

          <button
            type="submit"
            disabled={isVerifyingManual || !pasteInput.trim()}
            className="w-full min-h-[46px] rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isVerifyingManual ? (
              <span>Verifying Signature…</span>
            ) : (
              <span>Verify & Check In Ticket</span>
            )}
          </button>
        </form>
      </div>

      {/* ─── Recent Scans Session List ─────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white tracking-tight uppercase tracking-wider">
            Recent Scans ({recentScans.length})
          </h2>
          <span className="text-[11px] text-slate-500">Session history</span>
        </div>

        {recentScans.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-slate-500 text-xs">
            No scans recorded yet in this session.
          </div>
        ) : (
          <div className="space-y-2">
            {recentScans.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      item.status === "admitted"
                        ? "bg-emerald-400 shadow-sm shadow-emerald-400"
                        : item.status === "valid"
                        ? "bg-cyan-400"
                        : "bg-rose-400"
                    }`}
                  />
                  <div className="truncate">
                    <p className="font-bold text-white truncate">
                      {item.eventName} <span className="text-slate-400 font-mono">#{item.tokenId}</span>
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.status === "admitted" ? (
                        <span className="text-emerald-300 font-medium">Checked in</span>
                      ) : item.status === "valid" ? (
                        <span className="text-cyan-300 font-medium">Verified valid</span>
                      ) : (
                        <span className="text-rose-300 truncate">{item.reason || "Invalid"}</span>
                      )}
                    </p>
                  </div>
                </div>

                <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-2">
                  {item.timeStr}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Full-Screen Scan Result Modal ─────────────────────────────────── */}
      {scanResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center space-y-5 animate-in zoom-in-95 duration-200 overflow-hidden border">
            {/* Background color based on validity */}
            <div
              className={`absolute inset-0 -z-10 ${
                isAdmitted
                  ? "bg-gradient-to-b from-emerald-950 via-slate-900 to-slate-950 border-emerald-500/50"
                  : scanResult.isValid
                  ? "bg-gradient-to-b from-emerald-950 via-slate-900 to-slate-950 border-emerald-500/40"
                  : "bg-gradient-to-b from-rose-950 via-slate-900 to-slate-950 border-rose-500/40"
              }`}
            />

            {/* Status Icon */}
            <div className="pt-2">
              {isAdmitted ? (
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-300 shadow-xl shadow-emerald-500/30 animate-bounce">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : scanResult.isValid ? (
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-300 shadow-xl shadow-emerald-500/20">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-rose-500/20 border-2 border-rose-400 flex items-center justify-center mx-auto text-rose-400 shadow-xl shadow-rose-500/20">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Title Banner */}
            <div>
              <h3
                className={`text-2xl font-black tracking-tight ${
                  isAdmitted
                    ? "text-emerald-300"
                    : scanResult.isValid
                    ? "text-emerald-300"
                    : "text-rose-400"
                }`}
              >
                {isAdmitted ? "ADMITTED 🎉" : scanResult.isValid ? "VALID TICKET" : "INVALID TICKET"}
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                {isAdmitted
                  ? "Attendee successfully checked in on-chain"
                  : scanResult.isValid
                  ? "Cryptographic signature and ownership verified"
                  : "Gate entry rejected"}
              </p>
            </div>

            {/* Details Box */}
            <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 text-left text-xs space-y-2">
              {scanResult.eventName && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Event:</span>
                  <span className="text-white font-bold truncate max-w-[180px]">
                    {scanResult.eventName}
                  </span>
                </div>
              )}

              {scanResult.tokenId !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Token ID:</span>
                  <span className="text-indigo-400 font-mono font-bold">
                    #{scanResult.tokenId}
                  </span>
                </div>
              )}

              {scanResult.holderAddress && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Verified Holder:</span>
                  <span className="text-slate-200 font-mono">
                    {shortenAddress(scanResult.holderAddress)}
                  </span>
                </div>
              )}

              {/* Exact Reason if Invalid */}
              {!scanResult.isValid && scanResult.reason && (
                <div className="pt-2 border-t border-rose-500/20 text-rose-300 text-xs leading-relaxed">
                  <strong className="text-rose-200 block font-bold mb-0.5">Rejection Reason:</strong>
                  {scanResult.reason}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              {scanResult.isValid && !isAdmitted && (
                <button
                  onClick={handleAdmit}
                  disabled={isAdmitting}
                  className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-900/40 transition-all active:scale-[0.98]"
                >
                  {isAdmitting ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      <span>Checking In Ticket…</span>
                    </>
                  ) : (
                    <span>Admit Attendee</span>
                  )}
                </button>
              )}

              <button
                onClick={() => setScanResult(null)}
                disabled={isAdmitting}
                className="w-full min-h-[44px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-all"
              >
                {isAdmitted ? "Close" : "Dismiss / Scan Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
