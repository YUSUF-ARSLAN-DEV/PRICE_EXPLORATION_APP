import type { ReactNode } from 'react';

export const metadata = { title: 'Qarib - Qatar grocery prices' };

export default function RootLayout({ children }: { children: ReactNode }) {
  // i18n + RTL (next-intl, dir="rtl" for ar) arrives in Phase 7 (plan 7.1).
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
