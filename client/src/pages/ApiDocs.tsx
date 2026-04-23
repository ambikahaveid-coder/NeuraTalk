import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
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
          callerNumber: "+1234567890", 
          receiverNumber: "+0987654321",
          callerLanguage: "en",
          receiverLanguage: "es",
          translationEnabled: true,
          emotionPreservation: true
        },
        response: { callId: "call_123", status: "created" },
      },
      {
        method: "GET",
        path: "/api/calls/:callId",
        description: "Get call details and status",
        response: { id: 1, status: "active", duration: 120 },
      },
      {
        method: "POST",
        path: "/api/calls/:callId/end",
        description: "End an active call",
        response: { success: true, duration: 300 },
      },
    ],
  },
  {
    category: "Meeting Rooms",
    endpoints: [
      {
        method: "POST",
        path: "/api/meetings/create",
        description: "Create a new meeting room",
        body: { 
          name: "Team Standup",
          maxParticipants: 10,
          isVideoEnabled: true,
          isTranslationEnabled: true
        },
        response: { roomCode: "ABC123", meetingId: 1 },
      },
      {
        method: "POST",
        path: "/api/meetings/join",
        description: "Join an existing meeting",
        body: { roomCode: "ABC123", displayName: "John" },
        response: { success: true, participants: [] },
      },
    ],
  },
  {
    category: "Translation",
    endpoints: [
      {
        method: "POST",
        path: "/api/translate/text",
        description: "Translate text with emotion preservation",
        body: { 
          text: "Hello, how are you?",
          sourceLang: "en",
          targetLang: "es",
          preserveEmotion: true
        },
        response: { translated: "Hola, como estas?", emotion: "friendly" },
      },
      {
        method: "POST",
        path: "/api/translate/voice",
        description: "Translate voice with identity preservation",
        body: { 
          audio: "base64_audio_data",
          sourceLang: "en",
          targetLang: "es"
        },
        response: { translatedAudio: "base64_audio", transcript: "..." },
      },
    ],
  },
  {
    category: "Voice Profiles",
    endpoints: [
      {
        method: "POST",
        path: "/api/voice-profiles/create",
        description: "Create a new voice profile for identity preservation",
        body: { name: "My Voice", samples: [] },
        response: { profileId: 1, status: "training" },
      },
      {
        method: "POST",
        path: "/api/voice-profiles/:id/samples",
        description: "Add voice sample for training",
        body: { audio: "base64_audio", transcript: "Sample text" },
        response: { sampleId: 1, status: "processing" },
      },
    ],
  },
];

const SDK_EXAMPLES = {
  javascript: `import NeuraTalk from '@neuratalk/sdk';

const client = new NeuraTalk({
  apiKey: 'your_api_key',
  baseUrl: 'https://api.neuratalk.io'
});

// Initialize a call with real-time translation
const call = await client.calls.create({
  to: '+1234567890',
  myLanguage: 'en',
  theirLanguage: 'es',
  options: {
    translationEnabled: true,
    emotionPreservation: true,
    voiceIdentityPreserved: true
  }
});

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
    to='+1234567890',
    my_language='en',
    their_language='es',
    translation_enabled=True,
    emotion_preservation=True
)

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
    "callerNumber": "+1234567890",
    "receiverNumber": "+0987654321",
    "callerLanguage": "en",
    "receiverLanguage": "es",
    "translationEnabled": true
  }'`,

  websocket: `// WebSocket Signaling for Real-time Calls
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
    theirLanguage: 'es',
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
  const [apiKey, setApiKey] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<keyof typeof SDK_EXAMPLES>("javascript");

  const generateApiKey = async () => {
    // In production, this would call a backend endpoint:
    // const response = await fetch('/api/keys/generate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    // For demo purposes, generating a placeholder key
    const key = `ntk_demo_${Array.from({ length: 24 }, () => 
      "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
    ).join("")}`;
    setApiKey(key);
    toast({ 
      title: "Demo Key Generated", 
      description: "Production keys are generated server-side for security" 
    });
  };

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
                <div className="font-semibold">50+ Languages</div>
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
                    value={apiKey}
                    placeholder="Generate an API key..."
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(apiKey)}
                    disabled={!apiKey}
                    data-testid="button-copy-key"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-end">
                <Button onClick={generateApiKey} data-testid="button-generate-key">
                  <Key className="w-4 h-4 mr-2" />
                  Generate Key
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
                  Receive real-time notifications about calls, translations, and more
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Webhook URL</Label>
                  <Input
                    data-testid="input-webhook-url"
                    placeholder="https://your-server.com/webhooks/neuratalk"
                  />
                </div>

                <div className="space-y-4">
                  <h4 className="font-semibold">Available Events</h4>
                  
                  {[
                    { event: "call.started", description: "Triggered when a call begins" },
                    { event: "call.ended", description: "Triggered when a call ends" },
                    { event: "call.translation", description: "Real-time translation events" },
                    { event: "call.emotion", description: "Emotion detection updates" },
                    { event: "meeting.started", description: "Meeting room activated" },
                    { event: "meeting.participant.joined", description: "New participant joined" },
                    { event: "meeting.participant.left", description: "Participant left the meeting" },
                  ].map((item) => (
                    <div key={item.event} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <code className="font-mono text-sm">{item.event}</code>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                      <Badge variant="outline">Active</Badge>
                    </div>
                  ))}
                </div>

                <Button className="w-full" data-testid="button-save-webhook">
                  Save Webhook Configuration
                </Button>
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
