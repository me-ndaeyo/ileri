import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

/* One family. Public Sans reads like a plain official document and has tabular figures,
   which is what keeps columns of money aligned. */
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ileri",
  description:
    "Issue an invoice as an NFT on NEAR, get paid from any chain, and sell it early.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      {/* No referrer anywhere: an invite link carries a private key in its fragment,
          and a leaked Referer header would be the one way that escapes the browser. */}
      <head>
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="font-sans min-h-full flex flex-col text-sm">{children}</body>
    </html>
  );
}
