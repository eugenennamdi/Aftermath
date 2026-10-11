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
    <html lang="en">
      <body className="antialiased min-h-screen bg-[#FAFAF9] text-[#171B23] selection:bg-[#44647B]/15 selection:text-[#171B23]">
        {children}
      </body>
    </html>
  );
}
