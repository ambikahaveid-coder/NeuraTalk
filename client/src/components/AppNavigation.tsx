import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Home, 
  Phone, 
  MessageSquare, 
  CreditCard, 
  Settings,
  Users,
  Building2,
  Menu,
  Video
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { USER_ROLES } from "@shared/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppNavigationProps {
  title?: string;
  showBack?: boolean;
  backPath?: string;
}

export default function AppNavigation({ title, showBack = true, backPath }: AppNavigationProps) {
  const [location, setLocation] = useLocation();
  const { user, logout, isSuperAdmin, isCompanyAdmin, isAgent } = useAuth();

  const handleBack = () => {
    if (backPath) {
      setLocation(backPath);
    } else {
      window.history.back();
    }
  };

  const getDashboardPath = () => {
    if (isSuperAdmin) return "/admin";
    if (isCompanyAdmin || isAgent) return "/company";
    return "/dashboard";
  };

  const navItems = [
    { path: getDashboardPath(), label: "Dashboard", icon: Home, show: true },
    { path: "/calls/c2c", label: "Personal Call", icon: Phone, show: true },
    { path: "/calls/video-translation", label: "Video Translation", icon: Video, show: true },
    { path: "/calls/b2c", label: "Agent Console", icon: Users, show: isCompanyAdmin || isAgent },
    { path: "/calls/b2b", label: "Control Room", icon: Building2, show: isSuperAdmin || isCompanyAdmin },
    { path: "/chat", label: "Chat", icon: MessageSquare, show: true },
    { path: "/billing", label: "Billing", icon: CreditCard, show: true },
  ];

  const visibleNavItems = navItems.filter(item => item.show);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}

        {title && (
          <h1 className="text-lg font-semibold" data-testid="text-page-title">{title}</h1>
        )}

        <div className="hidden md:flex items-center gap-1 ml-4">
          {visibleNavItems.map((item) => (
            <Link key={item.path} href={item.path}>
              <Button
                variant={location === item.path ? "secondary" : "ghost"}
                size="sm"
                className="gap-2"
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden lg:inline">{item.label}</span>
              </Button>
            </Link>
          ))}
        </div>

        <div className="flex-1" />

        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {visibleNavItems.map((item) => (
                <DropdownMenuItem
                  key={item.path}
                  onClick={() => setLocation(item.path)}
                  data-testid={`mobile-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <item.icon className="h-4 w-4 mr-2" />
                  {item.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation("/website")}>
                Website
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <Link href="/website">
            <Button variant="ghost" size="sm" data-testid="nav-website">
              Website
            </Button>
          </Link>
          
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-user-menu">
                  <Settings className="h-4 w-4 mr-2" />
                  {user.username || user.email || user.phone}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                  {user.role}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/billing")}>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Billing
                </DropdownMenuItem>
                {(isSuperAdmin || isCompanyAdmin) && (
                  <DropdownMenuItem onClick={() => setLocation("/api-docs")}>
                    <Settings className="h-4 w-4 mr-2" />
                    API Docs
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} data-testid="button-logout">
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
