import type { ReactNode } from 'react';
import './admin.css';

export const metadata = { title: 'Qarib Admin', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
