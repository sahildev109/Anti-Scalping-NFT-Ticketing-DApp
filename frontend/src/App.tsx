import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { WalletProvider, useWallet } from "./hooks/useWallet";
import { ToastProvider } from "./hooks/useToast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import EventsPage from "./pages/EventsPage";
import MyTicketsPage from "./pages/MyTicketsPage";
import MarketPage from "./pages/MarketPage";
import ScanPage from "./pages/ScanPage";
import AdminPage from "./pages/AdminPage";

// ─── Shorten address ──────────────────────────────────────────────────────────
function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Network badge ────────────────────────────────────────────────────────────
function NetworkBadge({ chainId }: { chainId: number | null }) {
  const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
  const isCorrect = chainId === CHAIN_ID;
  const label =
    chainId === 11155111 ? "Sepolia" :
    chainId === 1 ? "Mainnet" :
    chainId ? `Chain ${chainId}` : "—";

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        ${isCorrect
          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
          : "bg-rose-500/15 text-rose-300 border border-rose-500/25"
        }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isCorrect ? "bg-emerald-400" : "bg-rose-400"}`} />
      {label}
    </span>
  );
}

// ─── No Wallet Screen ─────────────────────────────────────────────────────────
function NoWalletScreen() {
  const host = typeof window !== "undefined" ? window.location.host + window.location.pathname : "";
  const metamaskLink = `https://metamask.app.link/dapp/${host}`;

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 z-50">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-600/30 to-violet-600/30 border border-indigo-500/30 flex items-center justify-center mb-8 shadow-2xl">
        <svg className="w-12 h-12 text-indigo-300" fill="none" viewBox="0 0 48 48">
          <rect width="48" height="48" rx="16" fill="url(#grad)" fillOpacity="0" />
          <path d="M24 8l12 6v10l-12 6-12-6V14l12-6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 14l12 6 12-6M24 20v18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-white mb-2 text-center">Wallet Required</h1>
      <p className="text-slate-400 text-sm text-center max-w-xs mb-10">
        NFT Ticketing DApp requires a Web3 wallet. Install MetaMask to continue, or open this page directly in the MetaMask mobile browser.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <a
          href={metamaskLink}
          className="min-h-[44px] flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-sm px-6 py-3 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
        >
          <svg className="w-5 h-5" viewBox="0 0 35 33" fill="none">
            <path d="M32.958.5L19.198 10.735l2.52-5.956L32.958.5z" fill="#E17726" stroke="#E17726" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2.042.5l13.644 10.326-2.406-6.047L2.042.5z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Open in MetaMask
        </a>

        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[44px] flex items-center justify-center w-full rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-medium px-6 py-3 transition-all active:scale-95"
        >
          Install MetaMask Extension
        </a>
      </div>
    </div>
  );
}

// ─── Wrong Network Banner ─────────────────────────────────────────────────────
function WrongNetworkBanner() {
  const { wrongNetwork, switchToCorrectNetwork } = useWallet();
  if (!wrongNetwork) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between gap-3">
      <p className="text-amber-300 text-xs font-medium flex items-center gap-1.5">
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
        </svg>
        Wrong network detected
      </p>
      <button
        onClick={switchToCorrectNetwork}
        className="shrink-0 text-xs font-semibold text-amber-300 border border-amber-500/40 rounded-lg px-3 py-1 hover:bg-amber-500/10 transition-colors min-h-[30px]"
      >
        Switch
      </button>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header() {
  const { account, chainId, isConnecting, connect, disconnect } = useWallet();

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/60 px-4 py-3 flex items-center justify-between">
      {/* App name */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
        </div>
        <span className="font-bold text-white text-sm tracking-tight">NFT Tickets</span>
      </div>

      {/* Right: network badge + wallet */}
      <div className="flex items-center gap-2">
        {account && <NetworkBadge chainId={chainId} />}

        {account ? (
          <button
            onClick={disconnect}
            title="Disconnect wallet"
            className="min-h-[36px] flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 text-slate-300 text-xs font-medium transition-colors active:scale-95"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {shortenAddress(account)}
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="min-h-[36px] rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold px-4 transition-all active:scale-95 disabled:opacity-60 shadow-lg shadow-indigo-500/20"
          >
            {isConnecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </header>
  );
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────
interface TabDef {
  to: string;
  label: string;
  icon: React.ReactNode;
  show?: boolean;
}

function TabBar() {
  const { isAdmin, isChecker } = useWallet();

  const tabs: TabDef[] = [
    {
      to: "/events",
      label: "Events",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      to: "/tickets",
      label: "My Tickets",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
        </svg>
      ),
    },
    {
      to: "/market",
      label: "Market",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      to: "/scan",
      label: "Scan",
      show: isChecker || isAdmin,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
      ),
    },
    {
      to: "/admin",
      label: "Admin",
      show: isAdmin,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ].filter((t) => t.show !== false);

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800/60 safe-area-pb"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[56px] py-2 px-1 transition-colors relative
               ${isActive
                 ? "text-indigo-400"
                 : "text-slate-500 hover:text-slate-300 active:text-slate-200"
               }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-indigo-400 rounded-b-full" />
                )}
                {tab.icon}
                <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
function AppShell() {
  const hasWallet = typeof window !== "undefined" && Boolean(window.ethereum);

  if (!hasWallet) return <NoWalletScreen />;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100">
      <Header />
      <WrongNetworkBanner />

      {/* Page content – push up above tab bar (56px) */}
      <main className="flex flex-col flex-1 pb-16 overflow-y-auto">
        <Routes>
          <Route index element={<Navigate to="/events" replace />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/tickets" element={<MyTicketsPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/events" replace />} />
        </Routes>
      </main>

      <TabBar />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <WalletProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </ToastProvider>
      </WalletProvider>
    </ErrorBoundary>
  );
}
