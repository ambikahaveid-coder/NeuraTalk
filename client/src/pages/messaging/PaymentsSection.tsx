import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IndianRupee, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverMessage } from "@/lib/server-message";
import { rupeesText } from "@/components/BusinessMessageExtras";
import { UpiSettingsForm, useUpiSettings } from "@/components/RequestPaymentDialog";

type Req = {
  id: number; amountPaise: number; note: string | null; status: "requested" | "customer_paid" | "paid" | "cancelled";
  reference: string; customerReference: string | null; customerName: string | null; createdAt: string;
};

const LABEL: Record<Req["status"], string> = { requested: "Waiting", customer_paid: "Customer says paid", paid: "Paid", cancelled: "Cancelled" };

/** UPI payments in chat: the business's UPI ID and every request, to confirm. */
export default function PaymentsSection({ businessId }: { businessId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settings = useUpiSettings(businessId);
  const key = ["/api/business", businessId, "payment-requests"];
  const requests = useQuery<{ requests: Req[]; totals: Record<string, { count: number; amountPaise: number }> }>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/business/${businessId}/payment-requests`)).json(),
  });

  async function settle(id: number, status: "paid" | "cancelled") {
    try {
      await apiRequest("PATCH", `/api/business/${businessId}/payment-requests/${id}`, { status });
      toast({ title: status === "paid" ? "Marked as paid. The customer was told." : "Request cancelled." });
    } catch (e) {
      toast({ title: "Couldn't update", description: serverMessage(e, "Try again."), variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: key });
  }

  const totals = requests.data?.totals ?? {};
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] [&>*]:min-w-0" data-testid="payments-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><IndianRupee className="w-4 h-4" />Your UPI ID</CardTitle>
          <CardDescription>
            In a chat, tap ₹ to ask a customer to pay. They pay from their own UPI app and tap "I've paid". Check your bank, then mark it received.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <UpiSettingsForm businessId={businessId} current={settings.data?.settings ?? null} onSaved={() => toast({ title: "UPI ID saved" })} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Payment requests</CardTitle>
          <CardDescription>
            Received: <strong>{rupeesText(totals.paid?.amountPaise ?? 0)}</strong> · To check: <strong>{totals.customer_paid?.count ?? 0}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !(requests.data?.requests.length) ? (
            <p className="text-sm text-muted-foreground">No payment requests yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Customer</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>UTR</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {requests.data.requests.map((r) => (
                  <TableRow key={r.id} data-testid={`payment-row-${r.id}`}>
                    <TableCell>
                      <div className="font-medium">{r.customerName ?? "Customer"}</div>
                      <div className="text-xs text-muted-foreground">{r.note ?? ""} · {new Date(r.createdAt).toLocaleString()}</div>
                    </TableCell>
                    <TableCell>{rupeesText(r.amountPaise)}</TableCell>
                    <TableCell><Badge variant={r.status === "paid" ? "default" : r.status === "customer_paid" ? "destructive" : "secondary"}>{LABEL[r.status]}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.customerReference ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(r.status === "requested" || r.status === "customer_paid") && (
                        <>
                          <Button size="sm" onClick={() => settle(r.id, "paid")} data-testid={`payment-received-${r.id}`}>Received</Button>
                          <Button size="sm" variant="ghost" onClick={() => settle(r.id, "cancelled")}>Cancel</Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
