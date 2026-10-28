/**
 * App.tsx — Akar aplikasi: penyedia konteks (React Query, autentikasi, tema)
 * dan definisi rute.
 *
 * Pilihan router: HashRouter. Aplikasi dipublikasikan pada GitHub Pages
 * (hosting statis tanpa penulisan ulang URL), sehingga tautan dalam
 * (`#/app/contracts/…`) selalu dapat dibuka langsung tanpa 404.
 */

import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthProvider';
import { queryClient } from '@/lib/queryClient';
import { AppToaster } from '@/components/common/Toaster';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Spinner } from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute, PublicOnlyRoute } from '@/routes/ProtectedRoute';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SetupRequiredPage } from '@/pages/system/SetupRequiredPage';
import { NoAccessPage } from '@/pages/system/NoAccessPage';
import { NotFoundPage } from '@/pages/system/NotFoundPage';

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const CustomersPage = lazy(() => import('@/pages/customers/CustomersPage'));
const CustomerDetailPage = lazy(() => import('@/pages/customers/CustomerDetailPage'));
const CustomerFormPage = lazy(() => import('@/pages/customers/CustomerFormPage'));
const ApplicationsPage = lazy(() => import('@/pages/applications/ApplicationsPage'));
const ApplicationFormPage = lazy(() => import('@/pages/applications/ApplicationFormPage'));
const ApplicationDetailPage = lazy(() => import('@/pages/applications/ApplicationDetailPage'));
const SimulatorPage = lazy(() => import('@/pages/applications/SimulatorPage'));
const ContractsPage = lazy(() => import('@/pages/contracts/ContractsPage'));
const ContractDetailPage = lazy(() => import('@/pages/contracts/ContractDetailPage'));
const InstallmentsPage = lazy(() => import('@/pages/installments/InstallmentsPage'));
const PaymentsPage = lazy(() => import('@/pages/payments/PaymentsPage'));
const PaymentFormPage = lazy(() => import('@/pages/payments/PaymentFormPage'));
const PaymentDetailPage = lazy(() => import('@/pages/payments/PaymentDetailPage'));
const PenaltiesPage = lazy(() => import('@/pages/penalties/PenaltiesPage'));
const RemindersPage = lazy(() => import('@/pages/reminders/RemindersPage'));
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'));
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const UsersPage = lazy(() => import('@/pages/settings/UsersPage'));
const AuditLogPage = lazy(() => import('@/pages/settings/AuditLogPage'));
const ProfilePage = lazy(() => import('@/pages/settings/ProfilePage'));

function RouteFallback(): JSX.Element {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label="Memuat halaman" />
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <AuthProvider>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route
                  path="/login"
                  element={
                    <PublicOnlyRoute>
                      <LoginPage />
                    </PublicOnlyRoute>
                  }
                />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/setup" element={<SetupRequiredPage />} />
                <Route path="/no-access" element={<NoAccessPage />} />

                <Route
                  path="/app"
                  element={
                    <ProtectedRoute>
                      <AppShell />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/new" element={<CustomerFormPage mode="create" />} />
                  <Route path="customers/:customerId" element={<CustomerDetailPage />} />
                  <Route path="customers/:customerId/edit" element={<CustomerFormPage mode="edit" />} />
                  <Route path="applications" element={<ApplicationsPage />} />
                  <Route path="applications/new" element={<ApplicationFormPage />} />
                  <Route path="applications/:applicationId" element={<ApplicationDetailPage />} />
                  <Route path="simulator" element={<SimulatorPage />} />
                  <Route path="contracts" element={<ContractsPage />} />
                  <Route path="contracts/:contractId" element={<ContractDetailPage />} />
                  <Route path="installments" element={<InstallmentsPage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="payments/new" element={<PaymentFormPage />} />
                  <Route path="payments/:paymentId" element={<PaymentDetailPage />} />
                  <Route path="penalties" element={<PenaltiesPage />} />
                  <Route path="reminders" element={<RemindersPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="settings/:section" element={<SettingsPage />} />
                  <Route path="settings/users" element={<UsersPage />} />
                  <Route path="settings/audit" element={<AuditLogPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                </Route>

                <Route path="/" element={<Navigate to="/app" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
            <AppToaster />
          </AuthProvider>
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
