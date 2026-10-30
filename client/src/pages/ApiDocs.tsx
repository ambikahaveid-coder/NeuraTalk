import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  Code, 
  Copy, 
  Key, 
  Phone, 
  Video, 
  Languages, 
  Webhook,
  BookOpen,
  Terminal,
  Zap,
  Shield,
  Globe,
  RefreshCw,
  ArrowLeft,
  Sparkles
} from "lucide-react";

const API_ENDPOINTS = [
  {
    category: "Business Messaging — send header X-API-Key: ntk_ent_…",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/messaging/templates",
        description: "Your templates that NeuraTalk approved (offers and updates). Only these can start a conversation.",
        body: null,
        response: { success: true, templates: [{ templateVersionId: 42, name: "Order shipped", category: "utility", language: "en", content: "Hi {{name}}, order {{order_id}} is on the way.", variables: [{ name: "order_id", type: "text", required: true }], media: null }] },
      },
      {
        method: "POST",
        path: "/api/v1/messaging/messages",
        description: "Send an approved template to a customer (any time). The customer reads it in their own language inside NeuraTalk.",
        body: { phone: "+919876543210", name: "Ravi", templateVersionId: 42, variables: { order_id: "A-1009" } },
        response: { success: true, message: { id: 9001, customerId: 17, type: "template", chargedPaise: 10 } },
      },
      {
        method: "POST",
        path: "/api/v1/messaging/messages",
        description: "Reply with free text — only within 24 hours of the customer's last message (otherwise 409 SERVICE_WINDOW_CLOSED: send a template).",
        body: { phone: "+919876543210", text: "Your refund is processed." },
        response: { success: true, message: { id: 9002, customerId: 17, type: "text", windowClosesAt: "2026-11-01T10:00:00.000Z" } },
      },
      {
        method: "GET",
        path: "/api/v1/messaging/messages/9001",
        description: "Delivery status of a message: queued, sent, delivered, read or failed.",
        body: null,
        response: { success: true, message: { id: 9001, status: "read", statusAt: "2026-10-31T10:05:00.000Z", failureReason: null } },
      },
      {
        method: "POST",
        path: "/api/v1/messaging/utility-events",
        description: "Transactional update tied to an event (order shipped, booking confirmed). eventReference makes retries safe — the same reference is never sent twice.",
        body: { phone: "+919876543210", eventType: "order_shipped", eventReference: "order-A-1009-shipped", templateVersionId: 42, variables: { order_id: "A-1009" } },
        response: { success: true, duplicate: false, event: { id: 77, status: "sent", messageId: 9003, customerId: 17 } },
      },
      {
        method: "POST",
        path: "/api/v1/messaging/otp",
        description: "Send a one-time code to the customer's NeuraTalk app.",
        body: { phone: "+919876543210", purpose: "login" },
        response: { success: true, challenge: { id: 501, channel: "in_app", status: "sent", expiresAt: "2026-10-31T10:10:00.000Z", customerId: 17 } },
      },
      {
        method: "POST",
        path: "/api/v1/messaging/otp/501/verify",
        description: "Check the code the person typed on your website or app.",
        body: { code: "482913" },
        response: { success: true, verified: true, challenge: { id: 501, status: "verified" } },
      },
    ],
  },
  {
    category: "Authentication",
    endpoints: [
      {
        method: "POST",
        path: "/api/auth/otp/request",
        description: "Request OTP for login/signup",
        body: { identifier: "email@example.com", channel: "email" },
        response: { success: true, message: "OTP sent" },
      },
      {
        method: "POST",
        path: "/api/auth/otp/verify",
        description: "Verify OTP and get session token",
        body: { identifier: "email@example.com", channel: "email", code: "123456" },
        response: { success: true, token: "bearer_token", user: {} },
      },
    ],
  },
  {
    category: "Call Management",
    endpoints: [
      {
        method: "POST",
        path: "/api/calls/create",
        description: "Initiate a new translated call",
        body: { 
          calleeIdentifier: "+919876543210",
          callType: "voice",
          myLanguage: "en",
          theirLanguage: "bn",
          translationEnabled: true,
          translationMode: "voice"
        },
        response: {
          callId: "call_123",
          joinMethod: "app_to_pstn",
          livekitUrl: "wss://media.neuratalk.io",
          livekitToken: "lk_token",
          session: {
            callId: "call_123",
            routeType: "app_to_pstn",
            sourceLanguage: "en",
            targetLanguage: "bn",
            translationEnabled: true,
            translationMode: "voice",
            callerIdentityMode: "organization_caller_id",
          },
        },
      },
      {
        method: "GET",
        path: "/api/calls/:callId",
        description: "Get call details and status",
        response: {
          id: "call_123",
          status: "active",
          session: {
            callId: "call_123",
            routeType: "app_to_pstn",
            provider: "msg91_sip",
            sourceLanguage: "en",
            targetLanguage: "bn",
            durationSeconds: 120,
            caller: { externalId: "user_42", phoneNumber: "+919999999999" },
            callee: { externalId: "+919876543210", phoneNumber: "+919876543210" },
          },
        },
      },
      {
        method: "POST",
        path: "/api/calls/:callId/end",
        description: "End an active call",
        response: { success: true, duration: 300 },
      },
    ],
  },
  // Only endpoints that exist on the server are listed here (checked against
  // the live server). Meeting, standalone translation and voice-profile APIs
  // were listed before but never existed; they return once they are built.
];

const SDK_EXAMPLES = {
  javascript: `import NeuraTalk from '@neuratalk/sdk';

const client = new NeuraTalk({
  apiKey: 'your_api_key',
  baseUrl: 'https://api.neuratalk.io'
});

// Initialize a call with real-time translation
const call = await client.calls.create({
  calleeIdentifier: '+919876543210',
  callType: 'voice',
  myLanguage: 'en',
  theirLanguage: 'bn',
  translationEnabled: true,
  translationMode: 'voice'
});

console.log(call.session.routeType);
console.log(call.session.callerIdentityMode);

// Listen for events
call.on('connected', () => console.log('Call connected'));
call.on('translation', (data) => {
  console.log('Translated:', data.text);
  console.log('Emotion:', data.emotion);
});

// End call
await call.end();`,

  python: `from neuratalk import NeuraTalk

client = NeuraTalk(
    api_key='your_api_key',
    base_url='https://api.neuratalk.io'
)

# Initialize a call with real-time translation
call = client.calls.create(
    callee_identifier='+919876543210',
    call_type='voice',
    my_language='en',
    their_language='bn',
    translation_enabled=True,
    translation_mode='voice'
)

print(call.session["routeType"])
print(call.session["callerIdentityMode"])

# Listen for translations
for event in call.stream():
    if event.type == 'translation':
        print(f"Translated: {event.text}")
        print(f"Emotion: {event.emotion}")

# End call
call.end()`,

  curl: `# Request OTP
curl -X POST https://api.neuratalk.io/api/auth/otp/request \\
  -H "Content-Type: application/json" \\
  -d '{"identifier": "user@example.com", "channel": "email"}'

# Verify OTP
curl -X POST https://api.neuratalk.io/api/auth/otp/verify \\
  -H "Content-Type: application/json" \\
  -d '{"identifier": "user@example.com", "channel": "email", "code": "123456"}'

# Initiate Call
curl -X POST https://api.neuratalk.io/api/calls/create \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "calleeIdentifier": "+919876543210",
    "callType": "voice",
    "myLanguage": "en",
    "theirLanguage": "bn",
    "translationEnabled": true,
    "translationMode": "voice"
  }'`,

  websocket: `// Legacy meeting signaling example (not the primary LiveKit calling path)
const ws = new WebSocket('wss://api.neuratalk.io/signaling');

// Register client
ws.send(JSON.stringify({
  type: 'register',
  capabilities: {
    supportsWebRTC: true,
    audioCodecs: ['opus'],
    videoCodecs: ['VP8', 'H264']
  }
}));

// Initiate call
ws.send(JSON.stringify({
  type: 'call_initiate',
  to: 'user@example.com',
  metadata: {
    myLanguage: 'en',
    theirLanguage: 'bn',
    translationEnabled: true
  }
}));

// Handle incoming messages
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'call_ringing':
      console.log('Ringing...');
      break;
    case 'call_accept':
      // Start WebRTC negotiation
      break;
    case 'translation':
      console.log('Translation:', msg.payload);
      break;
  }
};`,
};

export default function ApiDocs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedLanguage, setSelectedLanguage] = useState<keyof typeof SDK_EXAMPLES>("javascript");
  const qc = useQueryClient();

  const { data: apiKeyData } = useQuery<{ key: string | null }>({
    queryKey: ["/api/company/api-key"],
    queryFn: () => fetch("/api/company/api-key", { credentials: "include" }).then(r => r.json()),
  });

  const generateMutation = useMutation({
    mutationFn: () => fetch("/api/company/api-key/generate", { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/company/api-key"] });
      toast({ title: "API Key Generated", description: "Your new API key is ready to use." });
    },
    onError: () => toast({ title: "Error", description: "Failed to generate API key. Try from Company Dashboard.", variant: "destructive" }),
  });

  const apiKey = apiKeyData?.key ?? "";

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/company">
              <Button variant="ghost" size="sm" className="gap-1" data-testid="link-back">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-bold hidden sm:block">API Documentation</span>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Code className="w-3 h-3" />
            Developer Portal
          </Badge>
        </div>
      </header>
      
      <div className="p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">API & SDK Documentation</h1>
            <p className="text-muted-foreground mt-2">
              Build with NeuraTalk's self-hosted voice translation platform
            </p>
          </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Zap className="w-5 h-5 text-cyan-500" />
              </div>
              <div>
                <div className="font-semibold">&lt;300ms</div>
                <div className="text-sm text-muted-foreground">Latency</div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Shield className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <div className="font-semibold">Self-Hosted</div>
                <div className="text-sm text-muted-foreground">No 3rd Party</div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Globe className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <div className="font-semibold">23 Languages</div>
                <div className="text-sm text-muted-foreground">Real-time</div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <RefreshCw className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <div className="font-semibold">Voice Preserved</div>
                <div className="text-sm text-muted-foreground">Identity</div>
              </div>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              API Keys
            </CardTitle>
            <CardDescription>
              Generate API keys to authenticate your applications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>API Key</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    data-testid="input-api-key"
                    value={apiKey ? `ntk_live_••••••••${apiKey.slice(-8)}` : ""}
                    placeholder="No API key yet — click Generate"
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(apiKeyData?.key ?? "")}
                    disabled={!apiKey}
                    data-testid="button-copy-key"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-end">
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-generate-key">
                  <Key className="w-4 h-4 mr-2" />
                  {generateMutation.isPending ? "Generating..." : "Generate Key"}
                </Button>
              </div>
            </div>

            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Keep your API keys secure. Never expose them in client-side code or public repositories.
              </p>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="endpoints" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="endpoints" data-testid="tab-endpoints">
              <BookOpen className="w-4 h-4 mr-2" />
              API Endpoints
            </TabsTrigger>
            <TabsTrigger value="sdk" data-testid="tab-sdk">
              <Code className="w-4 h-4 mr-2" />
              SDK Examples
            </TabsTrigger>
            <TabsTrigger value="webhooks" data-testid="tab-webhooks">
              <Webhook className="w-4 h-4 mr-2" />
              Webhooks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="endpoints" className="mt-6 space-y-6">
            {API_ENDPOINTS.map((category) => (
              <Card key={category.category}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {category.category === "Authentication" && <Key className="w-5 h-5" />}
                    {category.category === "Call Management" && <Phone className="w-5 h-5" />}
                    {category.category === "Meeting Rooms" && <Video className="w-5 h-5" />}
                    {category.category === "Translation" && <Languages className="w-5 h-5" />}
                    {category.category === "Voice Profiles" && <Terminal className="w-5 h-5" />}
                    {category.category}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {category.endpoints.map((endpoint, idx) => (
                    <div key={idx} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-center gap-3">
                        <Badge variant={endpoint.method === "GET" ? "secondary" : "default"}>
                          {endpoint.method}
                        </Badge>
                        <code className="font-mono text-sm">{endpoint.path}</code>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="ml-auto h-8 w-8"
                          onClick={() => copyToClipboard(endpoint.path)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                      
                      {endpoint.body && (
                        <div>
                          <Label className="text-xs">Request Body</Label>
                          <pre className="mt-1 p-3 bg-muted rounded text-xs overflow-x-auto">
                            {JSON.stringify(endpoint.body, null, 2)}
                          </pre>
                        </div>
                      )}
                      
                      <div>
                        <Label className="text-xs">Response</Label>
                        <pre className="mt-1 p-3 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(endpoint.response, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="sdk" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>SDK Integration Examples</CardTitle>
                <CardDescription>
                  Get started quickly with our official SDKs and code examples
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  {(Object.keys(SDK_EXAMPLES) as (keyof typeof SDK_EXAMPLES)[]).map((lang) => (
                    <Button
                      key={lang}
                      variant={selectedLanguage === lang ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedLanguage(lang)}
                      data-testid={`button-lang-${lang}`}
                    >
                      {lang.charAt(0).toUpperCase() + lang.slice(1)}
                    </Button>
                  ))}
                </div>

                <div className="relative">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(SDK_EXAMPLES[selectedLanguage])}
                    data-testid="button-copy-code"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-sm">
                    {SDK_EXAMPLES[selectedLanguage]}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webhooks" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Webhook Events</CardTitle>
                <CardDescription>
                  NeuraTalk POSTs JSON to your https address. Add it in Company dashboard → API → Message webhooks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  {[
                    { event: "message.received", description: "A customer wrote to you (text, and the message type)" },
                    { event: "message.sent", description: "Your message reached NeuraTalk and was pushed to the customer's app" },
                    { event: "message.delivered", description: "The customer's app received it (messageIds)" },
                    { event: "message.read", description: "The customer opened the chat (messageIds)" },
                    { event: "message.failed", description: "Not delivered: customer not on NeuraTalk, or blocked you" },
                    { event: "call.initiated / call.connected / call.ended / call.failed", description: "Calls made with the calling API" },
                    { event: "translation.started / translation.completed / recording.ready", description: "Call translation and recordings" },
                  ].map((item) => (
                    <div key={item.event} className="p-3 border rounded-lg">
                      <code className="font-mono text-sm">{item.event}</code>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <Label className="text-xs">Example body</Label>
                  <pre className="mt-1 p-3 bg-muted rounded text-xs overflow-x-auto">{JSON.stringify({
                    event: "message.received",
                    occurredAt: "2026-10-31T10:00:00.000Z",
                    data: { messageId: 9004, customerId: 17, text: "Is my order shipped?", messageType: "text", createdAt: "2026-10-31T10:00:00.000Z" },
                  }, null, 2)}</pre>
                </div>

                <div>
                  <Label className="text-xs">Check it really came from NeuraTalk (Node.js)</Label>
                  <pre className="mt-1 p-3 bg-muted rounded text-xs overflow-x-auto">{`const crypto = require("crypto");
// rawBody = the exact request body text; secret = shown once when you added the webhook
const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.get("X-NeuraTalk-Signature")));
// The event name is also in the X-NeuraTalk-Event header. Reply 2xx within 10 s; failures are retried.`}</pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle>Architecture Overview</CardTitle>
            <CardDescription>
              Self-hosted, zero third-party telecom dependencies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-semibold">Media Pipeline</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="w-20">Audio</Badge>
                    <span>Processed for translation, emotion detection</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="w-20">Video</Badge>
                    <span>Passed through untouched (no processing)</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h4 className="font-semibold">Core Components</h4>
                <div className="space-y-2 text-sm">
                  <div className="p-2 bg-muted rounded">WebSocket Signaling Server</div>
                  <div className="p-2 bg-muted rounded">RTP/UDP Media Relay</div>
                  <div className="p-2 bg-muted rounded">Emotion Detection Engine</div>
                  <div className="p-2 bg-muted rounded">Voice Identity Preservation</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
