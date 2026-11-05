import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppHeader } from '@/components/layout/AppHeader';
import { Sidebar } from '@/components/layout/Sidebar';
import { useNavigationMode } from '@/features/dashboard/navigation';

const COLLAPSE_KEY = 'vio.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [mode] = useNavigationMode();
  const withSidebar = mode === 'sidebar';
  const { pathname } = useLocation();

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    try {
      localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  };

  // Close the mobile drawer after navigating.
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {withSidebar && (
        <aside
          className={clsx(
            'fixed inset-y-0 start-0 z-40 hidden border-e border-line bg-surface transition-[width] duration-200 lg:block',
            collapsed ? 'w-[84px]' : 'w-[272px]',
          )}
        >
          <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed(true)} shortcut />
        </aside>
      )}

      {/* Mobile / tablet navigation drawer */}
      {withSidebar && (
        <div className={clsx('fixed inset-0 z-50 lg:hidden', navOpen ? 'visible' : 'invisible')} aria-hidden={!navOpen}>
          <div
            className={clsx('absolute inset-0 bg-[rgb(16_24_40/0.4)] backdrop-blur-[2px] transition-opacity', navOpen ? 'opacity-100' : 'opacity-0')}
            onClick={() => setNavOpen(false)}
          />
          <aside
            className={clsx(
              'absolute inset-y-0 start-0 w-[288px] max-w-[85vw] bg-surface shadow-[var(--shadow-pop)] transition-transform duration-200',
              navOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full',
            )}
          >
            <Sidebar onNavigate={() => setNavOpen(false)} onClose={() => setNavOpen(false)} />
          </aside>
        </div>
      )}

      <div className={clsx('flex min-h-dvh flex-col transition-[padding] duration-200', withSidebar && (collapsed ? 'lg:ps-[84px]' : 'lg:ps-[272px]'))}>
        <AppHeader mode={mode} onOpenNavigation={() => setNavOpen(true)} sidebarCollapsed={collapsed} onExpandSidebar={() => setCollapsed(false)} />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1440px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
