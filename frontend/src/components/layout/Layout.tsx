import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import { useAuth } from '../../contexts/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, accessControl } = useAuth();
  const isSuspended = accessControl.featureEnabled && accessControl.isTemporarilySuspended;
  const firstName = String(user?.name ?? '').trim().split(/\s+/)[0] || 'Associate';

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Navbar onMenuOpen={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto p-4 sm:p-6 md:p-8">
          <div className="mx-auto w-full max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
      {isSuspended && (
        <div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[1px]">
          <div className="mx-auto mt-16 w-[min(92vw,720px)] rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">MAPP Access Suspended</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              Hi {firstName}, your MAPP access has been temporarily suspended.
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              Please reach out to your Market Centre Leadership to resolve this issue.
            </p>
            {accessControl.suspendedReason && (
              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Reason: {accessControl.suspendedReason}
              </p>
            )}
            <p className="mt-4 text-xs text-slate-500">
              This message will remain until an administrator restores your access.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
