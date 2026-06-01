import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NSE RS Scanner | Relative Strength + RSI + EMA50",
  description: "Professional NSE stock scanner with Relative Strength vs Nifty, RSI(14), 50 EMA, volume. Build a personal watchlist that saves across logins. Powered by Yahoo Finance. Login with Google or Email.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0f1a] text-zinc-200">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
