import { useLocation, Link } from "wouter";
import { Home, Phone, MessageSquare, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

const navItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/calls/c2c", icon: Phone, label: "Calls" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/call-history", icon: Clock, label: "History" },
  { path: "/billing", icon: User, label: "Account" },
];

const WEBSITE_PATH_PREFIXES = [
  "/about", "/products", "/solutions", "/contact", "/faq", "/pricing",
  "/privacy", "/terms", "/copyright", "/dpa", "/cookie-policy",
  "/refund-policy", "/cancellation-policy", "/data-retention",
  "/ai-usage-policy", "/recording-consent", "/translation-disclaimer",
  "/account-deletion", "/data-export", "/legal-notice", "/trust",
  "/status", "/release-notes", "/help", "/report-abuse", "/sdk-docs",
  "/demo", "/investor",
];

export function MobileNav() {
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  const isWebsitePage = location === "/" || location === "/login" ||
    WEBSITE_PATH_PREFIXES.some(p => location === p || location.startsWith(p + "/"));
  if (isWebsitePage) return null;

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-lg md:hidden safe-area-inset-bottom"
      data-testid="mobile-nav"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive = location === item.path ||
            location.startsWith(item.path + "/") ||
            (item.path === "/calls/c2c" && location.startsWith("/calls/"));
          const Icon = item.icon;
          
          return (
            <Link key={item.path} href={item.path}>
              <button
                className={cn(
                  "flex flex-col items-center justify-center w-16 h-14 rounded-lg transition-colors",
                  isActive 
                    ? "text-primary bg-primary/10" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span className={cn(
                  "text-xs mt-1 font-medium",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  {item.label}
                </span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
