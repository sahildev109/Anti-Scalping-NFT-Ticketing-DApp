import { ethers } from "ethers";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface EntryPassPayload {
  t: number; // tokenId
  ts: number; // unix timestamp (seconds)
  sig: string; // personal_sign signature
}

/**
 * Builds the canonical entry pass message string for signing.
 * Format: TICKET-ENTRY|<contractAddress>|<chainId>|<tokenId>|<unixTimestamp>
 */
export function buildEntryPassMessage(
  contractAddress: string,
  chainId: number,
  tokenId: number,
  unixTimestamp: number
): string {
  const addr = ethers.isAddress(contractAddress)
    ? ethers.getAddress(contractAddress)
    : contractAddress;
  return `TICKET-ENTRY|${addr}|${chainId}|${tokenId}|${unixTimestamp}`;
}

/**
 * Encodes payload into compact JSON for QR code generation.
 */
export function encodeEntryPass(payload: EntryPassPayload): string {
  return JSON.stringify(payload);
}

/**
 * Parses the raw QR string into an EntryPassPayload.
 */
export function parseEntryPass(raw: string): EntryPassPayload | null {
  try {
    const data = JSON.parse(raw);
    if (
      typeof data.t === "number" &&
      typeof data.ts === "number" &&
      typeof data.sig === "string"
    ) {
      return {
        t: data.t,
        ts: data.ts,
        sig: data.sig,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Recovers the signer's Ethereum address from an EntryPassPayload.
 */
export function recoverEntryPassSigner(
  payload: EntryPassPayload,
  contractAddress: string,
  chainId: number
): string {
  const message = buildEntryPassMessage(
    contractAddress,
    chainId,
    payload.t,
    payload.ts
  );
  return ethers.verifyMessage(message, payload.sig);
}

/**
 * Validates whether the pass timestamp is within the valid active window.
 */
export function isEntryPassFresh(timestamp: number, maxAgeSeconds: number = 120): boolean {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  // Valid if issued up to maxAgeSeconds ago (and allows up to 10s clock drift in future)
  return diff >= -10 && diff <= maxAgeSeconds;
}
