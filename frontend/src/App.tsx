import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/Login';
import HomePage from './pages/Home';
import Dashboard from './pages/Dashboard';
import ListingsPage from './pages/Listings';
import TransactionsPage from './pages/Transactions';
import AgentsPage from './pages/Agents';
import MarketCentresPage from './pages/MarketCentres';
import AssociatesPage from './pages/Associates';
import ReportsPage from './pages/Reports';
import { REPORTS } from './pages/reportsConfig';

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
                <Route path="/" element={<Navigate to="/home" replace />} />
                <Route path="/home" element={<HomePage />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/listings" element={<ListingsPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/market-centres" element={<MarketCentresPage />} />
                <Route path="/associates" element={<AssociatesPage />} />
                <Route path="/reports" element={<Navigate to={`/reports/${REPORTS[0].id}`} replace />} />
                <Route path="/reports/:reportId" element={<ReportsPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
