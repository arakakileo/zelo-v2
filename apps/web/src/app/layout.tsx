import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zelo — Gestão de Consultórios',
  description: 'SaaS para gestão de consultórios de psicologia',
};

export const viewport: Viewport = {
  themeColor: '#060816',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
