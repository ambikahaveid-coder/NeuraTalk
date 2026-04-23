import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground">
      <div className="glass-panel p-12 rounded-2xl text-center max-w-md mx-4">
        <div className="flex justify-center mb-6">
          <AlertTriangle className="h-16 w-16 text-destructive animate-pulse" />
        </div>
        <h1 className="text-4xl font-bold mb-4 font-display">404</h1>
        <p className="text-muted-foreground mb-8 text-lg">
          The page you're looking for has vanished into the void.
        </p>
        <Link href="/">
          <Button variant="default" size="lg" className="w-full">
            Return Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
