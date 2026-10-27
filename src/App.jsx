import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { pagesConfig } from './pages.config';
import ProductionMeeting from './pages/ProductionMeeting';
import VisualInspection from './pages/VisualInspection';
import Login from './pages/Login';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = Pages[mainPageKey] || (() => null);

function LayoutWrapper({ children, currentPageName }) {
  return Layout ? <Layout currentPageName={currentPageName}>{children}</Layout> : children;
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoadingAuth, authError, isPasswordRecovery } = useAuth();
  const location = useLocation();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  if (!isAuthenticated) {
    if (location.pathname === '/login') return <Login />;
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (location.pathname === '/login' && isPasswordRecovery) return <Login />;

  if (authError) {
    return <div role="alert" className="m-8 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{authError.message}</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<LayoutWrapper currentPageName={mainPageKey}><MainPage /></LayoutWrapper>} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route key={path} path={`/${path}`} element={<LayoutWrapper currentPageName={path}><Page /></LayoutWrapper>} />
      ))}
      <Route path="/ProductionMeeting" element={<LayoutWrapper currentPageName="ProductionMeeting"><ProductionMeeting /></LayoutWrapper>} />
      <Route path="/VisualInspection" element={<LayoutWrapper currentPageName="VisualInspection"><VisualInspection /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}
