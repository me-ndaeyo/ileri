import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Public_Sans } from "next/font/google";
import { THEME_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

/* Three faces, each with a job. Public Sans runs the app: it reads like a plain official
   document and has tabular figures, which is what keeps columns of money aligned. */
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

/* Instrument Serif is the instrument's own voice, and it is only used on the sheet: the
   wordmark, a page title, and the amount due. Named for what this app issues, which was
   too good to pass up. One weight is all it has. */
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

/* The mono carries anything a machine issued and a person should not have to read as
   prose: serial numbers, account ids, hashes, contract calls. */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Ileri",
  description:
    "Issue an invoice as an NFT on NEAR, get paid from any chain, and sell it early.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${instrumentSerif.variable} ${plexMono.variable} antialiased`}
    >
      {/* No referrer anywhere: an invite link carries a private key in its fragment,
          and a leaked Referer header would be the one way that escapes the browser. */}
      <head>
        <meta name="referrer" content="no-referrer" />
        {/* Applies a stored theme before the first paint. Anything that runs after
            hydration gives a flash of the wrong one, which is worse than no toggle. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans flex flex-col text-sm">{children}</body>
    </html>
  );
}
