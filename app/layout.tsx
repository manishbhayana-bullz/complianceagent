import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ComplianceAgent',
  description: 'Multi-domain agentic RAG compliance assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-ink font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
