import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useAuth, AuthProvider } from "@/hooks/use-auth";
import { USER_ROLES } from "@shared/schema";
import ErrorBoundary from "@/components/ErrorBoundary";
import { lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

const Landing = lazy(() => import("@/pages/Landing"));
const ConsumerDashboard = lazy(() => import("@/pages/ConsumerDashboard"));
const CompanyDashboard = lazy(() => import("@/pages/CompanyDashboard"));
const SuperAdminDashboard = lazy(() => import("@/pages/SuperAdminDashboard"));
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const BusinessChatPage = lazy(() => import("@/pages/BusinessChatPage"));
const VoiceCloneSettings = lazy(() => import("@/pages/VoiceCloneSettings"));
const ApiDocs = lazy(() => import("@/pages/ApiDocs"));
const NotFound = lazy(() => import("@/pages/not-found"));
const InvestorDashboard = lazy(() => import("@/pages/InvestorDashboard"));
const InvestorAuth = lazy(() => import("@/pages/InvestorAuth"));
const EnterpriseDashboard = lazy(() => import("@/pages/EnterpriseDashboard"));
const NumberHub = lazy(() => import("@/pages/enterprise/NumberHub"));
const NumberRegistration = lazy(() => import("@/pages/enterprise/NumberRegistration"));
const OrgStructurePage = lazy(() => import("@/pages/enterprise/OrgStructure"));
const TelephonyConfigPage = lazy(() => import("@/pages/enterprise/TelephonyConfig"));
const AgentPresencePage = lazy(() => import("@/pages/enterprise/AgentPresence"));
const SupervisorMonitorPage = lazy(() => import("@/pages/enterprise/SupervisorMonitor"));
const CostCentersPage = lazy(() => import("@/pages/enterprise/CostCenters"));
const BillingContractsPage = lazy(() => import("@/pages/enterprise/BillingContracts"));
const BillingPage = lazy(() => import("@/pages/BillingPage"));
const C2CCallPage = lazy(() => import("@/pages/calls/C2CCallPage"));
const B2BCallPage = lazy(() => import("@/pages/calls/B2BCallPage"));
const FaceToFacePage = lazy(() => import("@/pages/calls/FaceToFacePage"));
const SimCallPage = lazy(() => import("@/pages/calls/SimCallPage"));
// Legacy voice/video/b2c/contact routes consolidated onto C2CCallPage via defaultMode
const VoiceCallLegacy = lazy(async () => {
  const mod = await import("@/pages/calls/C2CCallPage");
  return { default: () => <mod.default defaultMode="voice" /> };
});
const VideoCallLegacy = lazy(async () => {
  const mod = await import("@/pages/calls/C2CCallPage");
  return { default: () => <mod.default defaultMode="video" /> };
});
const PlatformConfigPage = lazy(() => import("@/pages/admin/PlatformConfigPage"));
const LiveMonitor = lazy(() => import("@/pages/admin/LiveMonitor"));
const TranscriptAdminDashboard = lazy(() => import("@/pages/admin/TranscriptAdminDashboard"));
// Legacy meeting/video room flow. Keep isolated from primary LiveKit calling stack.
const VideoCall = lazy(() => import("@/pages/VideoCall"));
const CallHistory = lazy(() => import("@/pages/CallHistory"));
const AIPersonas = lazy(() => import("@/pages/AIPersonas"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const CallDiagnostics = lazy(() => import("@/pages/CallDiagnostics"));
// Legacy join-token meeting flow. Primary app/app and app/PSTN calling should not depend on this path.
const JoinCall = lazy(() => import("@/pages/JoinCall"));
const MeetingsPage = lazy(() => import("@/pages/MeetingsPage"));
const VoiceAssistantPage = lazy(() => import("@/pages/VoiceAssistantPage"));

const WebsiteLayout = lazy(() => import("@/components/website/WebsiteLayout"));
const HomePage = lazy(() => import("@/pages/website/HomePage"));
const AboutPage = lazy(() => import("@/pages/website/AboutPage"));
const ProductsPage = lazy(() => import("@/pages/website/ProductsPage"));
const SolutionsPage = lazy(() => import("@/pages/website/SolutionsPage"));
const DemoPage = lazy(() => import("@/pages/website/DemoPage"));
const ContactPage = lazy(() => import("@/pages/website/ContactPage"));
const FAQPage = lazy(() => import("@/pages/website/FAQPage"));
const PrivacyPage = lazy(() => import("@/pages/website/PrivacyPage"));
const TermsPage = lazy(() => import("@/pages/website/TermsPage"));
const CopyrightPage = lazy(() => import("@/pages/website/CopyrightPage"));
const DPAPage = lazy(() => import("@/pages/website/DPAPage"));
const PricingPage = lazy(() => import("@/pages/website/PricingPage"));
const SDKDocsPage = lazy(() => import("@/pages/website/SDKDocsPage"));
const CookiePolicyPage = lazy(() => import("@/pages/website/CookiePolicyPage"));
const RefundPolicyPage = lazy(() => import("@/pages/website/RefundPolicyPage"));
const CancellationPolicyPage = lazy(() => import("@/pages/website/CancellationPolicyPage"));
const DataRetentionPage = lazy(() => import("@/pages/website/DataRetentionPage"));
const AIUsagePolicyPage = lazy(() => import("@/pages/website/AIUsagePolicyPage"));
const RecordingConsentPage = lazy(() => import("@/pages/website/RecordingConsentPage"));
const TranslationDisclaimerPage = lazy(() => import("@/pages/website/TranslationDisclaimerPage"));
const AccountDeletionPage = lazy(() => import("@/pages/website/AccountDeletionPage"));
const DataExportPage = lazy(() => import("@/pages/website/DataExportPage"));
const LegalNoticePage = lazy(() => import("@/pages/website/LegalNoticePage"));
const TrustCenterPage = lazy(() => import("@/pages/website/TrustCenterPage"));
const StatusPage = lazy(() => import("@/pages/website/StatusPage"));
const ReleaseNotesPage = lazy(() => import("@/pages/website/ReleaseNotesPage"));
const HelpCenterPage = lazy(() => import("@/pages/website/HelpCenterPage"));
const ReportAbusePage = lazy(() => import("@/pages/website/ReportAbusePage"));

import { CookieConsent } from "@/components/CookieConsent";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { MobileNav } from "@/components/MobileNav";
import { UpdatePrompt } from "@/components/UpdatePrompt";

const legacyMeetingTransportEnabled = (import.meta.env.VITE_ENABLE_LEGACY_MEETING_TRANSPORT || "").toLowerCase() === "true";

function PageLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center mesh-bg z-[100]" data-testid="page-loader">
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-16 h-16 rounded-3xl border-2 border-primary/20 border-t-primary shadow-[0_0_20px_rgba(0,255,255,0.1)]" 
          />
          <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-primary animate-pulse" />
        </div>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-primary mb-1">Neural Linking</p>
          <p className="text-[10px] text-muted-foreground/60 tracking-wider">Initializing secure translation channel...</p>
        </div>
      </div>
    </div>
  );
}

function LegacyTransportUnavailable() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-500">Legacy Route Disabled</p>
        <h1 className="text-2xl font-bold">This meeting transport is not part of the primary calling stack.</h1>
        <p className="text-sm text-muted-foreground">
          Use the main LiveKit calling flows instead. Re-enable this route only for controlled legacy meeting support.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <a href="/meetings" className="text-sm text-primary underline underline-offset-4">Go to Meetings</a>
          <a href="/calls/c2c" className="text-sm text-primary underline underline-offset-4">Go to Calls</a>
        </div>
      </div>
    </div>
  );
}

function WebsitePage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <WebsiteLayout>{children}</WebsiteLayout>
    </Suspense>
  );
}

function ProtectedRoute({ 
  component: Component,
  allowedRoles,
}: { 
  component: React.ComponentType;
  allowedRoles?: string[];
}) {
  const { user, isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Redirect to="/dashboard" />;
  }
  
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

function Router() {
  const { user, isAuthenticated, isSuperAdmin, isCompanyAdmin, isAgent, isInvestor } = useAuth();

  const getDashboardRedirect = () => {
    if (!user) return "/";
    if (isSuperAdmin) return "/admin";
    if (isInvestor) return "/investor";
    if (isCompanyAdmin || isAgent) return "/company";
    return "/dashboard";
  };

  const signupFlow = sessionStorage.getItem("neuratalk_signup_flow");
  let isInBusinessSignup = false;
  if (signupFlow) {
    try {
      isInBusinessSignup = JSON.parse(signupFlow).accountType === "business";
    } catch {
      // Malformed/stale sessionStorage value — treat as "not in business
      // signup" rather than crashing the whole app on every render.
      isInBusinessSignup = false;
    }
  }
  const needsBusinessSignup = isAuthenticated && isInBusinessSignup;

  return (
    <Switch>
      <Route path="/">
        {isAuthenticated && !needsBusinessSignup ? <Redirect to={getDashboardRedirect()} /> : <WebsitePage><HomePage /></WebsitePage>}
      </Route>
      
      <Route path="/login">
        {isAuthenticated && !needsBusinessSignup ? (
          <Redirect to={getDashboardRedirect()} />
        ) : (
          <Suspense fallback={<PageLoader />}><Landing /></Suspense>
        )}
      </Route>
      
      <Route path="/sys">
        {isAuthenticated && user?.role === USER_ROLES.SUPER_ADMIN ? (
          <Redirect to="/admin" />
        ) : (
          <Suspense fallback={<PageLoader />}><AdminLogin /></Suspense>
        )}
      </Route>
      
      <Route path="/dashboard">
        <ProtectedRoute component={ConsumerDashboard} />
      </Route>

      <Route path="/company">
        <ProtectedRoute 
          component={CompanyDashboard} 
          allowedRoles={[USER_ROLES.COMPANY_ADMIN, USER_ROLES.AGENT]}
        />
      </Route>

      <Route path="/admin">
        <ProtectedRoute 
          component={SuperAdminDashboard} 
          allowedRoles={[USER_ROLES.SUPER_ADMIN]}
        />
      </Route>

      <Route path="/admin/config">
        <ProtectedRoute 
          component={PlatformConfigPage} 
          allowedRoles={[USER_ROLES.SUPER_ADMIN]}
        />
      </Route>

      <Route path="/admin/live">
        <ProtectedRoute
          component={LiveMonitor}
          allowedRoles={[USER_ROLES.SUPER_ADMIN]}
        />
      </Route>

      <Route path="/admin/transcripts">
        <ProtectedRoute
          component={TranscriptAdminDashboard}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/call">
        <Redirect to="/calls/c2c" />
      </Route>

      <Route path="/calls">
        <Redirect to="/calls/c2c" />
      </Route>

      <Route path="/calls/c2c">
        <ProtectedRoute component={C2CCallPage} />
      </Route>

      <Route path="/calls/b2c">
        <ProtectedRoute
          component={VoiceCallLegacy}
          allowedRoles={[USER_ROLES.COMPANY_ADMIN, USER_ROLES.AGENT]}
        />
      </Route>

      <Route path="/calls/b2b">
        <ProtectedRoute
          component={B2BCallPage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/meetings">
        <ProtectedRoute component={MeetingsPage} />
      </Route>

      <Route path="/calls/video-translation">
        <ProtectedRoute component={VideoCallLegacy} />
      </Route>

      <Route path="/calls/voice-translation">
        <ProtectedRoute component={VoiceCallLegacy} />
      </Route>

      <Route path="/calls/sim">
        <ProtectedRoute component={SimCallPage} />
      </Route>

      <Route path="/calls/face-to-face">
        <ProtectedRoute component={FaceToFacePage} />
      </Route>

      <Route path="/calls/assistant">
        <ProtectedRoute component={VoiceAssistantPage} />
      </Route>

      <Route path="/calls/contact">
        <ProtectedRoute component={VoiceCallLegacy} />
      </Route>

      <Route path="/chat">
        <ProtectedRoute component={ChatPage} />
      </Route>

      {/* P1-3: any authenticated NeuraTalk user (no allowedRoles restriction,
          same as /chat) -- consumer messaging a business, not a business-
          management surface. No discovery UI links here yet (P1-3A); reached
          via a direct businessId in the URL for this phase. */}
      <Route path="/business-chat/:businessId">
        <ProtectedRoute component={BusinessChatPage} />
      </Route>

      <Route path="/settings/voice-clone">
        <ProtectedRoute component={VoiceCloneSettings} />
      </Route>

      <Route path="/billing">
        <ProtectedRoute component={BillingPage} />
      </Route>

      <Route path="/api-docs">
        <ProtectedRoute 
          component={ApiDocs} 
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/investor/login">
        <Suspense fallback={<PageLoader />}><InvestorAuth /></Suspense>
      </Route>

      <Route path="/investor">
        <ProtectedRoute 
          component={InvestorDashboard} 
          allowedRoles={[USER_ROLES.INVESTOR, USER_ROLES.SUPER_ADMIN]}
        />
      </Route>

      <Route path="/enterprise">
        <ProtectedRoute
          component={EnterpriseDashboard}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/hub">
        <ProtectedRoute
          component={NumberHub}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/hub/register">
        <ProtectedRoute
          component={NumberRegistration}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/org-structure">
        <ProtectedRoute
          component={OrgStructurePage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/telephony">
        <ProtectedRoute
          component={TelephonyConfigPage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/presence">
        <ProtectedRoute
          component={AgentPresencePage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN, USER_ROLES.AGENT]}
        />
      </Route>

      <Route path="/enterprise/supervisor">
        <ProtectedRoute
          component={SupervisorMonitorPage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/cost-centers">
        <ProtectedRoute
          component={CostCentersPage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/enterprise/billing-contracts">
        <ProtectedRoute
          component={BillingContractsPage}
          allowedRoles={[USER_ROLES.SUPER_ADMIN, USER_ROLES.COMPANY_ADMIN]}
        />
      </Route>

      <Route path="/video/:roomCode">
        {legacyMeetingTransportEnabled ? <ProtectedRoute component={VideoCall} /> : <LegacyTransportUnavailable />}
      </Route>

      <Route path="/call-history">
        <ProtectedRoute component={CallHistory} />
      </Route>

      <Route path="/personas">
        <ProtectedRoute component={AIPersonas} />
      </Route>

      <Route path="/diagnostics">
        <ProtectedRoute component={CallDiagnostics} />
      </Route>

      <Route path="/call-diagnostics">
        <ProtectedRoute component={CallDiagnostics} />
      </Route>

      <Route path="/join/:token">
        {legacyMeetingTransportEnabled ? <Suspense fallback={<PageLoader />}><JoinCall /></Suspense> : <LegacyTransportUnavailable />}
      </Route>

      <Route path="/about">
        <WebsitePage><AboutPage /></WebsitePage>
      </Route>
      <Route path="/products">
        <WebsitePage><ProductsPage /></WebsitePage>
      </Route>
      <Route path="/solutions">
        <WebsitePage><SolutionsPage /></WebsitePage>
      </Route>
      <Route path="/demo">
        <WebsitePage><DemoPage /></WebsitePage>
      </Route>
      <Route path="/contact">
        <WebsitePage><ContactPage /></WebsitePage>
      </Route>
      <Route path="/faq">
        <WebsitePage><FAQPage /></WebsitePage>
      </Route>
      <Route path="/privacy">
        <WebsitePage><PrivacyPage /></WebsitePage>
      </Route>
      <Route path="/terms">
        <WebsitePage><TermsPage /></WebsitePage>
      </Route>
      <Route path="/copyright">
        <WebsitePage><CopyrightPage /></WebsitePage>
      </Route>
      <Route path="/dpa">
        <WebsitePage><DPAPage /></WebsitePage>
      </Route>
      <Route path="/pricing">
        <WebsitePage><PricingPage /></WebsitePage>
      </Route>
      <Route path="/sdk-docs">
        <WebsitePage><SDKDocsPage /></WebsitePage>
      </Route>

      {/* Legal & compliance pages */}
      <Route path="/cookie-policy">
        <WebsitePage><CookiePolicyPage /></WebsitePage>
      </Route>
      <Route path="/refund-policy">
        <WebsitePage><RefundPolicyPage /></WebsitePage>
      </Route>
      <Route path="/cancellation-policy">
        <WebsitePage><CancellationPolicyPage /></WebsitePage>
      </Route>
      <Route path="/data-retention">
        <WebsitePage><DataRetentionPage /></WebsitePage>
      </Route>
      <Route path="/ai-usage-policy">
        <WebsitePage><AIUsagePolicyPage /></WebsitePage>
      </Route>
      <Route path="/recording-consent">
        <WebsitePage><RecordingConsentPage /></WebsitePage>
      </Route>
      <Route path="/translation-disclaimer">
        <WebsitePage><TranslationDisclaimerPage /></WebsitePage>
      </Route>
      <Route path="/account-deletion">
        <WebsitePage><AccountDeletionPage /></WebsitePage>
      </Route>
      <Route path="/data-export">
        <WebsitePage><DataExportPage /></WebsitePage>
      </Route>
      <Route path="/legal-notice">
        <WebsitePage><LegalNoticePage /></WebsitePage>
      </Route>

      {/* Trust & support pages */}
      <Route path="/trust">
        <WebsitePage><TrustCenterPage /></WebsitePage>
      </Route>
      <Route path="/status">
        <WebsitePage><StatusPage /></WebsitePage>
      </Route>
      <Route path="/release-notes">
        <WebsitePage><ReleaseNotesPage /></WebsitePage>
      </Route>
      <Route path="/help">
        <WebsitePage><HelpCenterPage /></WebsitePage>
      </Route>
      <Route path="/report-abuse">
        <WebsitePage><ReportAbusePage /></WebsitePage>
      </Route>

      <Route>
        <Suspense fallback={<PageLoader />}><NotFound /></Suspense>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router />
          <Toaster />
          <CookieConsent />
          <PWAInstallPrompt />
          <UpdatePrompt />
          <MobileNav />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
