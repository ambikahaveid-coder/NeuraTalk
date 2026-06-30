import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Home, Sparkles } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center mesh-bg p-6">
          <Card className="max-w-md w-full glass-card border-none shadow-3xl text-center p-8 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
              <Sparkles className="w-20 h-24 text-primary" />
            </div>
            
            <CardHeader className="pb-6">
              <div className="mx-auto w-20 h-20 rounded-3xl bg-destructive/10 flex items-center justify-center mb-6 rotate-3">
                <AlertTriangle className="w-10 h-10 text-destructive animate-pulse" />
              </div>
              <CardTitle className="text-3xl font-black font-display tracking-tight">System Decoupled</CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              <p className="text-muted-foreground leading-relaxed">
                Our neural link experienced a temporary desync. Don't worry, your data is safe. Let's try to reconnect.
              </p>
              
              {process.env.NODE_ENV === "development" && this.state.error && (
                <div className="bg-white/[0.03] border border-white/[0.05] p-4 rounded-xl text-left">
                   <p className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mb-2">Debug Trace</p>
                   <div className="text-xs font-mono text-muted-foreground/80 overflow-auto max-h-32 scrollbar-hide">
                    {this.state.error.message}
                   </div>
                </div>
              )}
              
              <div className="flex flex-col gap-3">
                <Button 
                  onClick={this.handleRetry} 
                  className="h-12 rounded-xl premium-gradient border-none shadow-lg shadow-primary/20"
                  data-testid="button-retry"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reconnect Session
                </Button>
                <Button 
                  onClick={this.handleGoHome} 
                  variant="ghost"
                  className="h-12 rounded-xl hover:bg-white/5"
                  data-testid="button-go-home"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
