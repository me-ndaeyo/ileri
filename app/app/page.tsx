import Link from "next/link";
import { publicEnv } from "@/lib/env";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-16">
      <h1 className="text-xl">Ileri</h1>
      <p className="mt-4 max-w-[48ch] text-base">
        Send an invoice as an NFT on NEAR. Get paid from any chain. Sell the invoice
        early if you cannot wait.
      </p>

      <nav className="mt-10 flex flex-col gap-px border-y border-rule">
        {[
          { href: "/app/new", label: "Create an invoice", note: "You will need a NEAR wallet" },
          { href: "/market", label: "Browse the market", note: "Invoices for sale, no sign in" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-baseline justify-between gap-4 border-b border-rule bg-sheet px-4 py-4 last:border-0 hover:bg-paper"
          >
            <span>{item.label}</span>
            <span className="text-xs text-ink/60">{item.note}</span>
          </Link>
        ))}
      </nav>

      <p className="mt-10 text-xs text-ink/60">
        Running against {publicEnv.network}, contract {publicEnv.contractId}. Amounts,
        account names and due dates are public on chain.
      </p>
    </main>
  );
}
