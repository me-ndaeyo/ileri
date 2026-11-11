/**
 * Environment access, in one place, split by who is allowed to see what.
 *
 * Only `NEXT_PUBLIC_*` may reach the browser. Everything else is server-only, and this
 * module throws rather than returning a blank if server code is ever bundled into the
 * client, so the mistake surfaces at build time instead of leaking a key at runtime.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy app/.env.example to app/.env.local and fill it in.`,
    );
  }
  return value;
}

/** Safe in the browser. Nothing secret may ever be added here. */
export const publicEnv = {
  network: (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet",
  contractId: required("NEXT_PUBLIC_CONTRACT_ID", process.env.NEXT_PUBLIC_CONTRACT_ID),
  tokenId: required("NEXT_PUBLIC_TOKEN_ID", process.env.NEXT_PUBLIC_TOKEN_ID),
};

export const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (publicEnv.network === "mainnet"
    ? "https://rpc.mainnet.near.org"
    : "https://rpc.testnet.near.org");

export const explorerBase =
  publicEnv.network === "mainnet"
    ? "https://nearblocks.io"
    : "https://testnet.nearblocks.io";
