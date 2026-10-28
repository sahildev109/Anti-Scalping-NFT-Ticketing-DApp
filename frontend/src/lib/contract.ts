import { ethers, Contract, BrowserProvider, JsonRpcProvider } from "ethers";
import deploymentJson from "../contracts/TicketNFT.json";

export const CONTRACT_ADDRESS: string =
  (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) || deploymentJson.address;

export const CHAIN_ID: number =
  Number(import.meta.env.VITE_CHAIN_ID ?? deploymentJson.chainId);

export const RPC_URL: string =
  (import.meta.env.VITE_RPC_URL as string | undefined) ||
  `https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161`; // public fallback

// ─── Typed ABI ───────────────────────────────────────────────────────────────
const ABI = deploymentJson.abi;

// ─── Read-Only contract (no signer needed) ───────────────────────────────────
export function getReadContract(): Contract {
  const provider = new JsonRpcProvider(RPC_URL);
  return new Contract(CONTRACT_ADDRESS, ABI, provider);
}

// ─── Write contract (MetaMask / injected provider) ───────────────────────────
export async function getSignerContract(): Promise<Contract> {
  if (!window.ethereum) throw new Error("No injected wallet found");
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new Contract(CONTRACT_ADDRESS, ABI, signer);
}

// ─── Role bytes32 hashes ─────────────────────────────────────────────────────
export const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
export const CHECKER_ROLE = ethers.id("CHECKER_ROLE");

// ─── Convenience: decode a custom error from revert data ─────────────────────
export function decodeContractError(error: unknown): string {
  try {
    const err = error as Record<string, any>;

    // Handle user rejection first
    if (
      err?.code === "ACTION_REJECTED" ||
      err?.code === 4001 ||
      err?.message?.includes("user rejected") ||
      err?.shortMessage?.includes("user rejected")
    ) {
      return "Transaction was cancelled in wallet.";
    }

    if (
      err?.code === "INSUFFICIENT_FUNDS" ||
      err?.message?.includes("insufficient funds")
    ) {
      return "Insufficient ETH balance in wallet for ticket and gas.";
    }

    const iface = new ethers.Interface(ABI);
    const data =
      err?.data ||
      err?.error?.data ||
      err?.info?.error?.data ||
      err?.revert?.data;

    let parsed = null;
    if (data && typeof data === "string") {
      try {
        parsed = iface.parseError(data);
      } catch {
        // Ignored
      }
    }

    if (parsed) {
      switch (parsed.name) {
        case "EventSoldOut":
          return "This event is completely sold out!";
        case "EventNotActive":
          return "This event has ended or is not currently active.";
        case "WalletCapReached":
          return "You have already reached the maximum ticket limit for this event.";
        case "IncorrectPayment":
          return "Incorrect payment amount sent. Exact ticket price is required.";
        case "EventNotFound":
          return "The requested event could not be found.";
        case "PriceAboveCap":
          return "Listing price exceeds the allowed resale price cap.";
        case "DirectTransferBlocked":
          return "Direct peer-to-peer transfers are blocked to prevent scalping. Please use the marketplace.";
        case "TicketAlreadyUsed":
          return "This ticket has already been checked in.";
        case "TokenNotFound":
          return "Ticket NFT not found.";
        case "NotListed":
          return "This ticket is not actively listed for resale.";
        case "NotOwner":
          return "You do not own this ticket.";
        case "NothingToWithdraw":
          return "No pending funds available to withdraw.";
        case "WithdrawFailed":
          return "ETH withdrawal transaction failed.";
        default:
          return `${parsed.name}${parsed.args?.length ? ` (${parsed.args.join(", ")})` : ""}`;
      }
    }

    const message =
      err?.reason ||
      err?.shortMessage ||
      err?.message ||
      String(error);
    return message;
  } catch {
    return String((error as { message?: string })?.message ?? error);
  }
}

// ─── Etherscan base URL helper ────────────────────────────────────────────────
export function etherscanTxUrl(hash: string): string {
  if (CHAIN_ID === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
  if (CHAIN_ID === 1) return `https://etherscan.io/tx/${hash}`;
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function etherscanAddressUrl(address: string): string {
  if (CHAIN_ID === 11155111) return `https://sepolia.etherscan.io/address/${address}`;
  if (CHAIN_ID === 1) return `https://etherscan.io/address/${address}`;
  return `https://sepolia.etherscan.io/address/${address}`;
}
