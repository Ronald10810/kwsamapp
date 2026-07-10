import { useState } from 'react';
import clsx from 'clsx';
import CMAGeneratorPage from './CMAGenerator';
import MarketingPlanGeneratorPage from './MarketingPlanGenerator';
import AIToolsHistoryPage from './AIToolsHistory';

type AIToolTab = 'cma-generator' | 'marketing-plan-generator' | 'history';

const AI_TOOL_TABS: { id: AIToolTab; label: string; icon: React.ReactNode }[] = [
  { id: 'cma-generator', label: 'CMA Generator', icon: <UiIcon kind="chart-bar" className="h-4 w-4" /> },
  { id: 'marketing-plan-generator', label: 'Marketing Plan Generator', icon: <UiIcon kind="megaphone" className="h-4 w-4" /> },
  { id: 'history', label: 'History', icon: <UiIcon kind="folder" className="h-4 w-4" /> },
];

function UiIcon({
  kind,
  className = 'h-4 w-4',
}: {
  kind: 'chart-bar' | 'megaphone' | 'folder' | 'sparkles';
  className?: string;
}) {
  if (kind === 'chart-bar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <rect x="4" y="10" width="3.5" height="10" stroke="currentColor" strokeWidth="1.7" rx="0.5" />
        <rect x="10.25" y="6" width="3.5" height="14" stroke="currentColor" strokeWidth="1.7" rx="0.5" />
        <rect x="16.5" y="13" width="3.5" height="7" stroke="currentColor" strokeWidth="1.7" rx="0.5" />
      </svg>
    );
  }
  if (kind === 'megaphone') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 12c0 1.5 1 3 2 4v-8c-1 1-2 2.5-2 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M10 8v8c1 1 3 2 5 2s4-1 5-2v-8c-1-1-3-2-5-2s-4 1-5 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 10v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4 6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2H12L9.41 4.59C9.05 4.23 8.55 4 8 4H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'sparkles') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 2L9.5 8h-7l5.5 4-2 6.5L12 14l5 6.5-2-6.5 5.5-4h-7L12 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

export default function AIToolsPage() {
  const [activeTab, setActiveTab] = useState<AIToolTab>('cma-generator');

  return (
    <div className="space-y-6">
      {/* Hero / Introduction Section */}
      <div>
        <h1 className="page-title">AI Tools</h1>
        <div className="mt-4 rounded-xl border p-5" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-strong)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Generate Professional, Seller-Ready Documents</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            AI Tools helps you create professional Comparative Market Analyses and Marketing Plans using KW data, LOOM reports, and structured property inputs. 
            All documents are generated in minutes and ready for immediate distribution to sellers.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <section className="surface-card">
        <div className="flex items-center gap-1 p-2">
          {AI_TOOL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* Tab Content */}
      <section>
        {activeTab === 'cma-generator' && <CMAGeneratorPage />}
        {activeTab === 'marketing-plan-generator' && <MarketingPlanGeneratorPage />}
        {activeTab === 'history' && <AIToolsHistoryPage />}
      </section>
    </div>
  );
}
