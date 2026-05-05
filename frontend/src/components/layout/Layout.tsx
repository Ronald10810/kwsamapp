import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  useEffect(() => {
    const hideLegacySidebarEntries = (): void => {
      const sidebar = document.querySelector('aside');
      if (!sidebar) return;

      const candidates = sidebar.querySelectorAll('a, button');
      for (const node of Array.from(candidates)) {
        const label = (node.textContent ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (label === 'notifications' || label === 'listing approvals') {
          const element = node as HTMLElement;
          element.style.display = 'none';
        }
      }
    };

    hideLegacySidebarEntries();

    const sidebar = document.querySelector('aside');
    if (!sidebar) return;

    const observer = new MutationObserver(() => {
      hideLegacySidebarEntries();
    });

    observer.observe(sidebar, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <div className="mx-auto w-full max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
