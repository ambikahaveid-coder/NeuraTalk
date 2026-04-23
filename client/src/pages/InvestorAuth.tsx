import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { 
  Loader2, 
  Sparkles, 
  ArrowLeft, 
  Mail, 
  Lock, 
  User,
  TrendingUp,
  Eye,
  EyeOff
} from "lucide-react";

type AuthMode = "login" | "signup";

export default function InvestorAuth() {
  const [, setLocation] = useLocation();
  const { setAuth } = useAuth();
  const { toast } = useToast();
  
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = mode === "login" 
        ? "/api/investor/login" 
        : "/api/investor/signup";

      const body = mode === "login" 
        ? { email: formData.email, password: formData.password }
        : formData;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Authentication failed");
      }

      toast({
        title: mode === "login" ? "Welcome back!" : "Account created!",
        description: data.message,
      });

      setAuth(data.token, data.user);
      setLocation("/investor");
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-500/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px]" />
      </div>

      <header className="w-full py-4 px-4 flex items-center justify-between z-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1" data-testid="link-back">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to App</span>
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="w-4 h-4" />
          <span className="hidden sm:inline">Investor Portal</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <motion.div 
              className="inline-flex items-center justify-center p-3 mb-4 rounded-full bg-white/5 border border-white/10 backdrop-blur-md"
              whileHover={{ scale: 1.05 }}
            >
              <TrendingUp className="w-5 h-5 text-cyan-400 mr-2" />
              <span className="text-xs font-medium tracking-widest text-cyan-400/80 uppercase">Investor Access</span>
            </motion.div>
            <h1 className="text-4xl md:text-5xl font-black mb-3 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
              NeuraTalk
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "login" ? "Access your investor dashboard" : "Join as an investor"}
            </p>
          </div>

          <Card className="bg-white/5 border-white/10 backdrop-blur-md">
            <CardHeader className="text-center">
              <CardTitle>
                {mode === "login" ? "Investor Login" : "Create Investor Account"}
              </CardTitle>
              <CardDescription>
                {mode === "login" 
                  ? "Enter your credentials to access the platform" 
                  : "Sign up for investor access to NeuraTalk"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="name"
                        type="text"
                        placeholder="Your full name"
                        className="pl-10"
                        value={formData.name}
                        onChange={(e) => handleInputChange("name", e.target.value)}
                        required
                        data-testid="input-name"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="investor@example.com"
                      className="pl-10"
                      value={formData.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      required
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder={mode === "signup" ? "Min. 8 characters" : "Your password"}
                      className="pl-10 pr-10"
                      value={formData.password}
                      onChange={(e) => handleInputChange("password", e.target.value)}
                      required
                      minLength={mode === "signup" ? 8 : 1}
                      data-testid="input-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === "signup" && (
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone (Optional)</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 234 567 8900"
                      value={formData.phone}
                      onChange={(e) => handleInputChange("phone", e.target.value)}
                      data-testid="input-phone"
                    />
                  </div>
                )}

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={loading}
                  data-testid="button-submit"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {mode === "login" ? "Signing in..." : "Creating account..."}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      {mode === "login" ? "Sign In" : "Create Account"}
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 text-center text-sm">
                {mode === "login" ? (
                  <p className="text-muted-foreground">
                    Don't have an account?{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setMode("signup")}
                      data-testid="link-signup"
                    >
                      Sign up
                    </button>
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setMode("login")}
                      data-testid="link-login"
                    >
                      Sign in
                    </button>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-center">
              <div className="text-lg font-bold text-cyan-400">50+</div>
              <div className="text-xs text-muted-foreground">Languages</div>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-center">
              <div className="text-lg font-bold text-cyan-400">&lt;200ms</div>
              <div className="text-xs text-muted-foreground">Latency</div>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-center">
              <div className="text-lg font-bold text-cyan-400">100%</div>
              <div className="text-xs text-muted-foreground">Self-Hosted</div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
