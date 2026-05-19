import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import VerifyEmail from './pages/auth/VerifyEmail';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import NotFound from './pages/NotFound';
import Dashboard from './pages/customer/Dashboard';
import Files from './pages/customer/Files';
import Keys from './pages/customer/Keys';
import Usage from './pages/customer/Usage';
import Billing from './pages/customer/Billing';
import Account from './pages/customer/Account';
import Docs from './pages/customer/Docs';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/Users';
import AdminNodes from './pages/admin/Nodes';
import AdminBuckets from './pages/admin/Buckets';
import AdminBilling from './pages/admin/Billing';

function P({ children }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
function A({ children }) {
  return <AdminRoute>{children}</AdminRoute>;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"            element={<Login />} />
          <Route path="/signup"           element={<Signup />} />
          <Route path="/verify-email"     element={<VerifyEmail />} />
          <Route path="/forgot-password"  element={<ForgotPassword />} />
          <Route path="/reset-password"   element={<ResetPassword />} />

          <Route path="/"        element={<P><Dashboard /></P>} />
          <Route path="/files"   element={<P><Files /></P>} />
          <Route path="/keys"    element={<P><Keys /></P>} />
          <Route path="/usage"   element={<P><Usage /></P>} />
          <Route path="/billing" element={<P><Billing /></P>} />
          <Route path="/account" element={<P><Account /></P>} />
          <Route path="/docs"    element={<P><Docs /></P>} />

          <Route path="/admin"          element={<A><AdminDashboard /></A>} />
          <Route path="/admin/users"   element={<A><AdminUsers /></A>} />
          <Route path="/admin/nodes"   element={<A><AdminNodes /></A>} />
          <Route path="/admin/buckets"  element={<A><AdminBuckets /></A>} />
          <Route path="/admin/billing" element={<A><AdminBilling /></A>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
