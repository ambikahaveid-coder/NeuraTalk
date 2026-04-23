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
const ApiDocs = lazy(() => import("@/pages/ApiDocs"));
const NotFound = lazy(() => import("@/pages/not-found"));
const InvestorDashboard = lazy(() => import("@/pages/InvestorDashboard"));
const InvestorAuth = lazy(() => import("@/pages/InvestorAuth"));
const EnterpriseDashboard = lazy(() => import("@/pages/EnterpriseDashboard"));
const BillingPage = lazy(() => import("@/pages/BillingPage"));
const C2CCallPage = lazy(() => import("@/pages/calls/C2CCallPage"));
const B2BCallPage = lazy(() => import("@/pages/calls/B2BCallPage"));
const FaceToFacePage = lazy(() => import("@/pages/calls/FaceToFacePage"));
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
const VideoCall = lazy(() => import("@/pages/VideoCall"));
const CallHistory = lazy(() => import("@/pages/CallHistory"));
const AIPersonas = lazy(() => import("@/pages/AIPersonas"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const CallDiagnostics = lazy(() => import("@/pages/CallDiagnostics"));
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

import { CookieConsent } from "@/components/CookieConsent";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { MobileNav } from "@/components/MobileNav";
import { UpdatePrompt } from "@/components/UpdatePrompt";

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
  const isInBusinessSignup = signupFlow && JSON.parse(signupFlow).accountType === "business";
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
        <Redirect to="/calls/b2b" />
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

      <Route path="/video/:roomCode">
        <ProtectedRoute component={VideoCall} />
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
        <Suspense fallback={<PageLoader />}><JoinCall /></Suspense>
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
