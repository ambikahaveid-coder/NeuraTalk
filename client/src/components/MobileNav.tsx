import { useLocation, Link } from "wouter";
import { Home, Phone, Video, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

const navItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/call", icon: Phone, label: "Voice" },
  { path: "/video-translation", icon: Video, label: "Video" },
  { path: "/chat", icon: MessageSquare, label: "Chat" },
  { path: "/billing", icon: User, label: "Account" },
];

export function MobileNav() {
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  const excludedPaths = ["/", "/login", "/about", "/products", "/solutions", "/contact", "/faq", "/privacy", "/terms", "/copyright", "/dpa", "/pricing"];
  if (excludedPaths.some(path => location === path)) return null;

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-lg md:hidden safe-area-inset-bottom"
      data-testid="mobile-nav"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive = location === item.path || location.startsWith(item.path + "/");
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
