import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { BrowserProvider } from "ethers";
import { CHAIN_ID, DEFAULT_ADMIN_ROLE, CHECKER_ROLE, getReadContract } from "../lib/contract";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WalletState {
  account: string | null;
  chainId: number | null;
  isConnecting: boolean;
  isAdmin: boolean;
  isChecker: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToCorrectNetwork: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecker, setIsChecker] = useState(false);

  const wrongNetwork = chainId !== null && chainId !== CHAIN_ID;

  // ── Fetch roles for account ─────────────────────────────────────────────
  const fetchRoles = useCallback(async (address: string) => {
    try {
      const contract = getReadContract();
      const [adminRole, checkerRole] = await Promise.all([
        contract.hasRole(DEFAULT_ADMIN_ROLE, address),
        contract.hasRole(CHECKER_ROLE, address),
      ]);
      setIsAdmin(Boolean(adminRole));
      setIsChecker(Boolean(checkerRole));
    } catch {
      setIsAdmin(false);
      setIsChecker(false);
    }
  }, []);

  // ── Initialise from any existing connection ─────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const init = async () => {
      try {
        const provider = new BrowserProvider(window.ethereum!);
        const accounts: string[] = await provider.send("eth_accounts", []);
        if (accounts.length > 0) {
          const network = await provider.getNetwork();
          setAccount(accounts[0]);
          setChainId(Number(network.chainId));
          await fetchRoles(accounts[0]);
        }
      } catch {
        /* silent – user hasn't connected yet */
      }
    };
    init();

    const eth = window.ethereum as NonNullable<typeof window.ethereum>;

    const onAccounts = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) || [];
      if (accounts.length === 0) {
        setAccount(null);
        setIsAdmin(false);
        setIsChecker(false);
      } else {
        setAccount(accounts[0]);
        fetchRoles(accounts[0]);
      }
    };

    const onChainChanged = (...args: unknown[]) => {
      const hexChainId = args[0] as string;
      setChainId(parseInt(hexChainId, 16));
    };

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChainChanged);

    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChainChanged);
    };
  }, [fetchRoles]);

  // ── Connect ─────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) return;
    setIsConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts: string[] = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      setAccount(accounts[0]);
      setChainId(Number(network.chainId));
      await fetchRoles(accounts[0]);
    } catch {
      /* user rejected */
    } finally {
      setIsConnecting(false);
    }
  }, [fetchRoles]);

  // ── Disconnect (clear local state only) ─────────────────────────────────
  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setIsAdmin(false);
    setIsChecker(false);
  }, []);

  // ── Switch network ──────────────────────────────────────────────────────
  const switchToCorrectNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
      });
    } catch (switchError: unknown) {
      // Error code 4902: chain not added yet
      if ((switchError as { code?: number }).code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${CHAIN_ID.toString(16)}`,
                chainName: "Sepolia",
                nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://rpc.sepolia.org"],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          });
        } catch {
          console.error("Failed to add Sepolia network");
        }
      }
    }
  }, []);

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        isConnecting,
        isAdmin,
        isChecker,
        wrongNetwork,
        connect,
        disconnect,
        switchToCorrectNetwork,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
