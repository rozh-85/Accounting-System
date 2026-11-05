import { clsx } from 'clsx';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { AppHeader } from '@/components/layout/AppHeader';
import { Sidebar } from '@/components/layout/Sidebar';

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <AppHeader onOpenNavigation={() => setNavOpen(true)} />
      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[232px] shrink-0 overflow-y-auto border-e border-line bg-surface scrollbar-thin lg:block">
          <Sidebar />
        </aside>

        {/* Mobile / tablet navigation drawer */}
        <div className={clsx('fixed inset-0 z-40 lg:hidden', navOpen ? 'visible' : 'invisible')} aria-hidden={!navOpen}>
          <div
            className={clsx('absolute inset-0 bg-[rgb(23_36_56/0.3)] transition-opacity', navOpen ? 'opacity-100' : 'opacity-0')}
            onClick={() => setNavOpen(false)}
          />
          <aside
            className={clsx(
              'absolute inset-y-0 start-0 w-[260px] overflow-y-auto border-e border-line bg-surface pt-3 transition-transform',
              navOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
            )}
          >
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </aside>
        </div>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
