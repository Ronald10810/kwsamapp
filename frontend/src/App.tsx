import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/Login';
import HomePage from './pages/Home';
import Dashboard from './pages/Dashboard';
import ListingsPage from './pages/Listings';
import TransactionsPage from './pages/Transactions';
import RentalsPage from './pages/Rentals';
import AgentsPage from './pages/Agents';
import MarketCentresPage from './pages/MarketCentres';
import TeamsPage from './pages/Teams';
import AssociatesPage from './pages/Associates';
import NotificationsPage from './pages/Notifications';
import ReportsPage from './pages/Reports';
import CMAGeneratorPage from './pages/CMAGenerator';
import AIToolsPage from './pages/AITools';
import LoomPage from './pages/Loom';
import TrainingHubPage from './pages/TrainingHub';
import MCAdminToolsPage from './pages/MCAdminTools';
import { REPORTS } from './pages/reportsConfig';
import { useAuth } from './contexts/AuthContext';

function RootRedirect() {
  const { isOfficeAdmin, isRegionalAdmin } = useAuth();
  if (isOfficeAdmin || isRegionalAdmin) return <Navigate to="/mc-admin-tools" replace />;
  return <Navigate to="/home" replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/home" element={<HomePage />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/listings" element={<ListingsPage />} />
                <Route path="/rentals" element={<RentalsPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/market-centres" element={<MarketCentresPage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/associates" element={<AssociatesPage />} />
                <Route path="/listing-approvals" element={<Navigate to="/notifications" replace />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/reports" element={<Navigate to={`/reports/${REPORTS[0].id}`} replace />} />
                <Route path="/reports/:reportId" element={<ReportsPage />} />
                <Route path="/ai-tools" element={<AIToolsPage />} />
                <Route path="/cma" element={<CMAGeneratorPage />} />
                <Route path="/loom" element={<LoomPage />} />
                <Route path="/training-hub" element={<TrainingHubPage />} />
                <Route path="/mc-admin-tools" element={<MCAdminToolsPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
