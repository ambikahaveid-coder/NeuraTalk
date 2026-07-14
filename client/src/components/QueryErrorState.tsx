import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, WifiOff, ShieldAlert } from "lucide-react";

interface QueryErrorStateProps {
  error?: unknown;
  onRetry: () => void;
  /** Short label for what failed to load, e.g. "recent calls", "wallet balance". */
  label?: string;
  className?: string;
}

function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch|failed to fetch|ECONNREFUSED|ETIMEDOUT/i.test(message);
}

function isPermissionError(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number } | null)?.status
    ?? (error as { status?: number; statusCode?: number } | null)?.statusCode;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized|forbidden|401|403/i.test(message);
}

/**
 * Inline (not full-page) error state for a single failed data-fetching
 * section — distinguishes network failures and permission-denied responses
 * from generic errors so the retry button doesn't get offered when retrying
 * won't help (e.g. a 403 needs different credentials, not a retry).
 */
export function QueryErrorState({ error, onRetry, label = "this data", className = "" }: QueryErrorStateProps) {
  const permissionDenied = isPermissionError(error);
  const networkError = isNetworkError(error);

  const Icon = permissionDenied ? ShieldAlert : networkError ? WifiOff : AlertTriangle;
  const title = permissionDenied
    ? "You don't have access to this"
    : networkError
      ? "Connection problem"
      : "Couldn't load this";
  const description = permissionDenied
    ? `You don't have permission to view ${label}. Try signing in again, or contact an admin if this seems wrong.`
    : networkError
      ? `Couldn't reach the server to load ${label}. Check your connection and try again.`
      : `Something went wrong loading ${label}.`;

  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center ${className}`}>
      <Icon className="h-8 w-8 text-destructive" />
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      {!permissionDenied && (
        <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry-query">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          Retry
        </Button>
      )}
    </div>
  );
}

export default QueryErrorState;
