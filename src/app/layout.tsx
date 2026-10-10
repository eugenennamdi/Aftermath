import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aftermath — Autonomous Recovery for Broken Business Operations',
  description: 'Identifies and recovers broken SaaS payment entitlements autonomously.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-zinc-950 text-zinc-50 font-sans">
        {children}
      </body>
    </html>
  );
}
