import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { LogoWithIcon } from "@/components/Logo";
import { LinkQrPanel } from "@/components/LinkQrPanel";
import { useAuth } from "@/hooks/use-auth";

/**
 * Use NeuraTalk on this computer by linking it from your phone (like WhatsApp Web):
 * show a QR + short code, the phone approves, this page signs in.
 * (/login shows the same QR first; this page stays for links and the phone's QR URL.)
 */
export default function LinkDevicePage() {
  const { setAuth } = useAuth();
  const [, setLocation] = useLocation();
  const signedOut = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("signedOut") === "1";

  return (
    <div className="min-h-screen bg-[#F5F2EC] dark:bg-background flex flex-col items-center px-4 py-10">
      <Link href="/"><LogoWithIcon size="md" /></Link>
      {signedOut && (
        <p className="w-full max-w-3xl mt-6 rounded-2xl border bg-background px-4 py-3 text-sm" role="status" data-testid="text-signed-out">
          This computer was signed out of NeuraTalk. Your phone is still signed in. Scan the code again to use NeuraTalk here.
        </p>
      )}
      <Card className="w-full max-w-3xl mt-8 rounded-[2rem]">
        <CardContent className="p-6 sm:p-10 grid gap-8 md:grid-cols-[1fr_auto] items-center">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Use NeuraTalk on this computer</h1>
            <ol className="space-y-3 text-muted-foreground list-decimal pl-5">
              <li>Open <strong className="text-foreground">NeuraTalk</strong> on your phone.</li>
              <li>Go to <strong className="text-foreground">More → Linked devices</strong> and tap <strong className="text-foreground">Link a device</strong>.</li>
              <li>Point your phone at this QR code, or type the code below.</li>
            </ol>
            <p className="text-sm text-muted-foreground mt-6">
              Only link computers you trust. You can sign this computer out any time from your phone (More → Linked devices).
            </p>
            <p className="text-sm mt-4"><Link href="/login?with=phone" className="text-primary underline">Log in with your phone number instead</Link></p>
          </div>
          <LinkQrPanel
            onLinked={(token, user) => {
              setAuth(token, user);
              setLocation(user?.role === "consumer" || !user?.role ? "/web" : "/login");
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
