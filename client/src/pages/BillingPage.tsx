import { useState } from "react";
import { Link } from "wouter";
import { useAuth, getAuthToken } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, LogOut, ArrowLeft, Check, Loader2, CreditCard,
  Clock, Zap, Star, Receipt, AlertTriangle, RefreshCw
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface BillingPlan {
  id: number;
  name: string;
  displayName?: string;
  description?: string;
  planType: string;
  billingModel: string;
  duration: string;
  durationDays: number;
  includedMinutes: number;
  priceInPaise: number;
  currency: string;
  gstPercentage: number;
  features?: Record<string, boolean>;
  isEnabled: boolean;
  isFeatured: boolean;
  displayOrder: number;
  priceFormatted?: string;
  ratePerSecondPaise?: number;
  ratePerSecondFormatted?: string;
  ratePerMinuteFormatted?: string;
  tierLabel?: string;
  featureHighlights?: string[];
  standards?: {
    voiceCalls: boolean;
    videoCalls: boolean;
    faceToFace: boolean;
    emotionAware: boolean;
    apiAccess: boolean;
  };
}

interface Subscription {
  id: number;
  planId: number;
  status: string;
  startDate: string;
  endDate: string;
  remainingMinutes: number;
  plan: BillingPlan;
  planName: string;
}

interface BillingDashboard {
  subscription: Subscription | null;
  recentInvoices: Array<{
    id: number;
    invoiceNumber: string;
    totalAmountPaise: number;
    status: string;
    createdAt: string;
  }>;
  usageSummary: {
    totalMinutes: number;
  };
}

export default function BillingPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<{ success: boolean; data: BillingDashboard }>({
    queryKey: ["/api/billing/consumer/dashboard"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/billing/consumer/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load billing dashboard");
      return res.json();
    },
  });

  const { data: plans, isLoading: plansLoading } = useQuery<{ success: boolean; data: BillingPlan[] }>({
    queryKey: ["/api/billing/plans/b2c"],
    queryFn: async () => {
      const token = getAuthToken();
      const res = await fetch("/api/billing/plans/b2c", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json();
    },
  });


  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if ((window as any).Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const purchaseMutation = useMutation({
    mutationFn: async (planId: number) => {
      const token = getAuthToken();
      
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error("Failed to load payment gateway");
      }

      const res = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ planId }),
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create payment order");
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      if (!data.success) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "NeuraTalk",
        description: `${data.planName} Subscription`,
        order_id: data.orderId,
        handler: async function (response: any) {
          try {
            const token = getAuthToken();
            const verifyRes = await fetch("/api/payments/verify", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                transactionId: data.transactionId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                planId: data.planId,
              }),
            });

            const result = await verifyRes.json();
            if (result.success) {
              toast({
                title: "Payment Successful",
                description: `Your ${data.planName} subscription is now active!`,
              });
              queryClient.invalidateQueries({ queryKey: ["/api/billing/consumer/dashboard"] });
            } else {
              toast({
                title: "Payment Verification Failed",
                description: result.message || "Please contact support",
                variant: "destructive",
              });
            }
          } catch (err) {
            console.error("Payment verification failed:", err);
            toast({
              title: "Error",
              description: "Failed to verify payment. Please contact support.",
              variant: "destructive",
            });
          }
          setShowConfirmDialog(false);
        },
        prefill: {
          name: user?.username || "",
          email: user?.email || "",
          contact: user?.phone || "",
        },
        theme: {
          color: "#00D9C0",
        },
        modal: {
          ondismiss: function () {
            setShowConfirmDialog(false);
          },
        },
      };

      const razorpay = new (window as any).Razorpay(options);
      razorpay.open();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setShowConfirmDialog(false);
    },
  });

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  };

  const planLabel = (plan: BillingPlan) => plan.displayName || plan.name;

  const isContactSales = (plan: BillingPlan) => {
    return plan.features?.contactSales === true || (plan.name === "Enterprise" && plan.priceInPaise === 0);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const currentSubscription = dashboard?.data?.subscription;
  const availablePlans = (plans?.data || []).filter(p => p.isEnabled);
  const usageSummary = dashboard?.data?.usageSummary;
  const recentInvoices = dashboard?.data?.recentInvoices || [];

  const totalMinutes = currentSubscription?.plan?.includedMinutes ?? 0;
  const remainingMinutes = currentSubscription?.remainingMinutes ?? 0;
  const usedMinutes = Math.max(0, totalMinutes - remainingMinutes);
  const minutesPct = totalMinutes > 0 ? Math.round((usedMinutes / totalMinutes) * 100) : 0;
  const daysLeft = currentSubscription
    ? Math.max(0, Math.ceil((new Date(currentSubscription.endDate).getTime() - Date.now()) / 86_400_000))
    : 0;
  const isExpiringSoon = daysLeft > 0 && daysLeft <= 5;
  const isLowMinutes = totalMinutes > 0 && remainingMinutes / totalMinutes < 0.15;

  const isLoading = dashboardLoading || plansLoading;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-bold">Billing</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email || user?.username}
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={logout}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-8">
            {currentSubscription && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className={`border-2 ${isExpiringSoon || isLowMinutes ? "border-amber-400/60 bg-amber-50/5" : "border-primary/20 bg-primary/5"}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2">
                      <Star className="w-5 h-5 text-primary" />
                      Current Plan
                      {(isExpiringSoon || isLowMinutes) && (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-300 gap-1 ml-auto">
                          <AlertTriangle className="w-3 h-3" />
                          {isLowMinutes ? "Low minutes" : `Expires in ${daysLeft}d`}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold">{currentSubscription.planName}</h3>
                        <p className="text-sm text-muted-foreground">
                          Valid until {formatDate(currentSubscription.endDate)} · {daysLeft} day{daysLeft !== 1 ? "s" : ""} left
                        </p>
                        {currentSubscription.plan?.ratePerSecondFormatted ? (
                          <p className="text-xs text-muted-foreground mt-1">
                            Rate: {currentSubscription.plan.ratePerSecondFormatted}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className={`text-2xl font-bold ${isLowMinutes ? "text-amber-500" : "text-primary"}`}>
                          {remainingMinutes}
                        </p>
                        <p className="text-sm text-muted-foreground">of {totalMinutes} minutes</p>
                      </div>
                    </div>

                    {/* Minutes progress bar */}
                    {totalMinutes > 0 && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{usedMinutes} used</span>
                          <span>{minutesPct}%</span>
                        </div>
                        <Progress
                          value={minutesPct}
                          className={`h-2 ${minutesPct >= 85 ? "[&>div]:bg-amber-500" : "[&>div]:bg-primary"}`}
                        />
                      </div>
                    )}

                    {/* Quick renew button when low */}
                    {(isExpiringSoon || isLowMinutes) && availablePlans.length > 0 && (
                      <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="flex-1 text-amber-700 dark:text-amber-300">
                          {isLowMinutes ? "Minutes running low — renew before calls fail." : `Subscription expiring in ${daysLeft} days.`}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-400 text-amber-700 hover:bg-amber-100 gap-1 shrink-0"
                          onClick={() => {
                            const samePlan = availablePlans.find(p => p.id === currentSubscription.planId);
                            const plan = samePlan ?? availablePlans[0];
                            setSelectedPlan(plan);
                            setShowConfirmDialog(true);
                          }}
                        >
                          <RefreshCw className="w-3 h-3" />
                          Renew
                        </Button>
                      </div>
                    )}

                    {usageSummary && (
                      <div className="pt-2 border-t border-border/40">
                        <p className="text-xs text-muted-foreground">
                          Used {usageSummary.totalMinutes} translation-minutes in the last 30 days
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <h2 className="text-xl font-semibold mb-4">
                {currentSubscription ? "Upgrade Your Plan" : "Choose a Plan"}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availablePlans.map((plan, i) => (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                  >
                    <Card 
                      className={`relative hover-elevate cursor-pointer transition-all ${
                        plan.isFeatured ? "border-primary" : ""
                      } ${isContactSales(plan) ? "border-amber-500/50 bg-amber-500/5" : ""}`}
                      onClick={() => {
                        if (isContactSales(plan)) {
                          window.open("mailto:sales@neuratalk.com?subject=Enterprise Plan Inquiry", "_blank");
                          return;
                        }
                        setSelectedPlan(plan);
                        setShowConfirmDialog(true);
                      }}
                      data-testid={`plan-card-${plan.id}`}
                    >
                      {plan.isFeatured && (
                        <Badge 
                          className="absolute -top-2 left-1/2 -translate-x-1/2"
                          variant="default"
                        >
                          Most Popular
                        </Badge>
                      )}
                      {plan.tierLabel && plan.tierLabel !== "trial" && !plan.isFeatured && !isContactSales(plan) && (
                        <Badge
                          className="absolute -top-2 right-4 capitalize"
                          variant="outline"
                        >
                          {plan.tierLabel}
                        </Badge>
                      )}
                      {isContactSales(plan) && (
                        <Badge 
                          className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-500"
                          variant="default"
                        >
                          Custom Pricing
                        </Badge>
                      )}
                      <CardHeader>
                        <CardTitle className="text-lg">{planLabel(plan)}</CardTitle>
                        <CardDescription>{plan.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4">
                          {isContactSales(plan) ? (
                            <span className="text-2xl font-bold text-amber-500">Contact Sales</span>
                          ) : (
                            <>
                              <span className="text-3xl font-bold">
                                {plan.priceFormatted || formatPrice(plan.priceInPaise)}
                              </span>
                              <span className="text-muted-foreground">/{plan.duration}</span>
                            </>
                          )}
                        </div>
                        {!isContactSales(plan) && plan.ratePerSecondFormatted ? (
                          <p className="mb-4 text-xs text-muted-foreground">
                            Effective usage: {plan.ratePerSecondFormatted} and {plan.ratePerMinuteFormatted}
                          </p>
                        ) : null}
                        <ul className="space-y-2 text-sm">
                          <li className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-primary" />
                            {plan.includedMinutes} minutes included
                          </li>
                          <li className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-primary" />
                            {plan.durationDays} days validity
                          </li>
                          {plan.standards?.videoCalls && (
                            <li className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              Voice, video, and face-to-face support
                            </li>
                          )}
                          {plan.features?.translation && (
                            <li className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              Real-time translation
                            </li>
                          )}
                          {plan.features?.emotionPreservation && (
                            <li className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              Emotion preservation
                            </li>
                          )}
                          {plan.featureHighlights?.slice(0, 2).map((feature) => (
                            <li key={feature} className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-500" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                      <CardFooter>
                        <Button 
                          className="w-full"
                          variant={plan.isFeatured ? "default" : "outline"}
                          data-testid={`button-select-plan-${plan.id}`}
                        >
                          {isContactSales(plan) ? "Contact Sales" : plan.priceInPaise === 0 ? "Start Free Trial" : "Select Plan"}
                        </Button>
                      </CardFooter>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {recentInvoices.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h2 className="text-xl font-semibold mb-4">Recent Invoices</h2>
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {recentInvoices.map((invoice) => (
                        <div
                          key={invoice.id}
                          className="flex items-center justify-between p-4 hover-elevate"
                          data-testid={`invoice-row-${invoice.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <Receipt className="w-5 h-5 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{invoice.invoiceNumber}</p>
                              <p className="text-sm text-muted-foreground">
                                {formatDate(invoice.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant={invoice.status === "paid" ? "default" : "secondary"}>
                              {invoice.status}
                            </Badge>
                            <span className="font-medium">
                              {formatPrice(invoice.totalAmountPaise)}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => window.open(`/api/billing/invoices/${invoice.id}/html`, "_blank")}
                              data-testid={`button-view-invoice-${invoice.id}`}
                            >
                              View
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>
        )}
      </main>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Purchase</DialogTitle>
            <DialogDescription>
              You are about to purchase the {selectedPlan ? planLabel(selectedPlan) : ""} plan
            </DialogDescription>
          </DialogHeader>
          {selectedPlan && (
            <div className="py-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span>Plan</span>
                  <span className="font-medium">{planLabel(selectedPlan)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duration</span>
                  <span className="font-medium">{selectedPlan.durationDays} days</span>
                </div>
                <div className="flex justify-between">
                  <span>Minutes</span>
                  <span className="font-medium">{selectedPlan.includedMinutes}</span>
                </div>
                {selectedPlan.ratePerSecondFormatted ? (
                  <div className="flex justify-between">
                    <span>Effective rate</span>
                    <span className="font-medium">{selectedPlan.ratePerSecondFormatted}</span>
                  </div>
                ) : null}
                <div className="flex justify-between font-bold text-lg border-t border-border pt-2 mt-2">
                  <span>Total</span>
                  <span className="text-primary">
                    {selectedPlan.priceFormatted || formatPrice(selectedPlan.priceInPaise)}
                  </span>
                </div>
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            You'll be redirected to our secure payment page to complete your purchase.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => selectedPlan && purchaseMutation.mutate(selectedPlan.id)}
              disabled={purchaseMutation.isPending}
              data-testid="button-confirm-purchase"
            >
              {purchaseMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CreditCard className="w-4 h-4 mr-2" />
              )}
              {selectedPlan?.priceInPaise === 0 ? "Start Trial" : "Continue to Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
