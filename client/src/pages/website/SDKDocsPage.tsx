import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Key, Zap, AlertTriangle, Code2, BookOpen, ArrowRight, Copy, Check, ChevronRight } from "lucide-react";

const BASE_URL = "https://neuratalk.in/api";

const tocItems = [
  { id: "authentication", label: "Authentication" },
  { id: "endpoints", label: "API Endpoints" },
  { id: "rate-limits", label: "Rate Limits" },
  { id: "error-codes", label: "Error Codes" },
  { id: "sdk-examples", label: "SDK Examples" },
];

type CodeTab = "curl" | "javascript" | "python";

function CodeBlock({ code, className = "" }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`relative group ${className}`}>
      <pre className="bg-zinc-900 text-zinc-100 rounded-md p-4 overflow-x-auto text-sm font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ visibility: "visible" }}
        onClick={handleCopy}
        data-testid="button-copy-code"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

function CodeTabs({ tabs }: { tabs: Record<CodeTab, string> }) {
  const [active, setActive] = useState<CodeTab>("curl");
  const labels: Record<CodeTab, string> = { curl: "cURL", javascript: "JavaScript", python: "Python" };

  return (
    <div>
      <div className="flex gap-1 border-b mb-0">
        {(Object.keys(tabs) as CodeTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors ${
              active === tab
                ? "bg-zinc-900 text-zinc-100 border border-b-0 border-zinc-700"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`tab-${tab}`}
          >
            {labels[tab]}
          </button>
        ))}
      </div>
      <CodeBlock code={tabs[active]} />
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xl font-bold mt-16 mb-6 scroll-mt-24 flex items-center gap-3">
      <a href={`#${id}`} className="text-muted-foreground hover:text-primary transition-colors">#</a>
      {children}
    </h2>
  );
}

export default function SDKDocsPage() {
  return (
    <div>
      <section className="relative bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 text-white py-20">
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative max-w-7xl mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4">Enterprise SDK</Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-sdk-title">
            NeuraTalk Enterprise SDK
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto mb-8">
            Integrate real-time translation, text-to-speech, speech-to-text, and AI voice chat into your applications with our RESTful API.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="#authentication">
              <Button variant="outline" className="bg-white/10 backdrop-blur border-white/20 text-white" data-testid="button-get-started">
                Get Started <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </a>
            <Link href="/contact">
              <Button variant="outline" className="bg-white/10 backdrop-blur border-white/20 text-white" data-testid="button-request-key">
                Request API Key
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex gap-12">
          <aside className="hidden lg:block w-56 shrink-0">
            <nav className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider">On this page</p>
              {tocItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-1.5"
                  data-testid={`link-toc-${item.id}`}
                >
                  <ChevronRight className="w-3 h-3" />
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="flex-1 min-w-0">
            <div className="lg:hidden flex flex-wrap gap-2 mb-8">
              {tocItems.map((item) => (
                <a key={item.id} href={`#${item.id}`}>
                  <Badge variant="outline" className="cursor-pointer" data-testid={`badge-toc-${item.id}`}>
                    {item.label}
                  </Badge>
                </a>
              ))}
            </div>

            <Card className="p-6 mb-8 border-primary/20 bg-primary/5">
              <div className="flex items-start gap-3">
                <BookOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1">Base URL</p>
                  <code className="text-sm bg-zinc-900 text-zinc-100 px-3 py-1 rounded font-mono">{BASE_URL}</code>
                  <p className="text-sm text-muted-foreground mt-2">All API requests must include a valid API key in the <code className="bg-muted px-1 rounded text-xs">X-API-Key</code> header.</p>
                </div>
              </div>
            </Card>

            <SectionHeading id="authentication">
              <Key className="w-6 h-6 text-primary" /> Authentication
            </SectionHeading>

            <p className="text-muted-foreground mb-4">
              NeuraTalk uses API key authentication. Keys are issued by the super admin through the admin dashboard and must be activated before use.
            </p>

            <div className="space-y-4 mb-6">
              <Card className="p-4">
                <h4 className="font-semibold mb-2">How API Keys Work</h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>A super admin creates an API key for your organization</li>
                  <li>The key is returned once and must be securely stored</li>
                  <li>The super admin activates the key</li>
                  <li>Include the key in every request via the <code className="bg-muted px-1 rounded text-xs">X-API-Key</code> header</li>
                </ol>
              </Card>
            </div>

            <p className="text-sm font-medium mb-2">Example Header</p>
            <CodeBlock code={`X-API-Key: ntk_ent_your_key_here`} />

            <SectionHeading id="endpoints">
              <Zap className="w-6 h-6 text-primary" /> API Endpoints
            </SectionHeading>

            <div className="space-y-12">
              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate">POST</Badge>
                  <code className="text-sm font-mono font-semibold">/api/sdk/translate</code>
                </div>
                <p className="text-muted-foreground mb-4 text-sm">Translate text between supported languages.</p>
                <p className="text-sm font-medium mb-2">Request Body</p>
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm border rounded-md" data-testid="table-translate-params">
                    <thead><tr className="bg-muted/50"><th className="text-left p-2 font-medium">Parameter</th><th className="text-left p-2 font-medium">Type</th><th className="text-left p-2 font-medium">Required</th><th className="text-left p-2 font-medium">Description</th></tr></thead>
                    <tbody>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">text</td><td className="p-2">string</td><td className="p-2">Yes</td><td className="p-2 text-muted-foreground">Text to translate</td></tr>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">sourceLang</td><td className="p-2">string</td><td className="p-2">Yes</td><td className="p-2 text-muted-foreground">Source language code (e.g. "en")</td></tr>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">targetLang</td><td className="p-2">string</td><td className="p-2">Yes</td><td className="p-2 text-muted-foreground">Target language code (e.g. "es")</td></tr>
                    </tbody>
                  </table>
                </div>
                <CodeTabs tabs={{
                  curl: `curl -X POST ${BASE_URL}/api/sdk/translate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -d '{
    "text": "Hello, how are you?",
    "sourceLang": "en",
    "targetLang": "es"
  }'`,
                  javascript: `const response = await fetch("${BASE_URL}/api/sdk/translate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "ntk_ent_your_key_here"
  },
  body: JSON.stringify({
    text: "Hello, how are you?",
    sourceLang: "en",
    targetLang: "es"
  })
});

const data = await response.json();
// { translatedText, sourceLang, targetLang, originalText }`,
                  python: `import requests

response = requests.post(
    f"${BASE_URL}/api/sdk/translate",
    headers={"X-API-Key": "ntk_ent_your_key_here"},
    json={
        "text": "Hello, how are you?",
        "sourceLang": "en",
        "targetLang": "es"
    }
)

data = response.json()
# {"translatedText", "sourceLang", "targetLang", "originalText"}`
                }} />
                <p className="text-sm font-medium mt-4 mb-2">Response</p>
                <CodeBlock code={`{
  "translatedText": "Hola, ¿cómo estás?",
  "sourceLang": "en",
  "targetLang": "es",
  "originalText": "Hello, how are you?"
}`} />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate">POST</Badge>
                  <code className="text-sm font-mono font-semibold">/api/sdk/tts</code>
                </div>
                <p className="text-muted-foreground mb-4 text-sm">Convert text to speech audio.</p>
                <p className="text-sm font-medium mb-2">Request Body</p>
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm border rounded-md" data-testid="table-tts-params">
                    <thead><tr className="bg-muted/50"><th className="text-left p-2 font-medium">Parameter</th><th className="text-left p-2 font-medium">Type</th><th className="text-left p-2 font-medium">Required</th><th className="text-left p-2 font-medium">Description</th></tr></thead>
                    <tbody>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">text</td><td className="p-2">string</td><td className="p-2">Yes</td><td className="p-2 text-muted-foreground">Text to convert to speech</td></tr>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">voice</td><td className="p-2">string</td><td className="p-2">No</td><td className="p-2 text-muted-foreground">Voice ID (default: "nova")</td></tr>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">lang</td><td className="p-2">string</td><td className="p-2">No</td><td className="p-2 text-muted-foreground">Language code (default: "en")</td></tr>
                    </tbody>
                  </table>
                </div>
                <CodeTabs tabs={{
                  curl: `curl -X POST ${BASE_URL}/api/sdk/tts \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -d '{
    "text": "Welcome to NeuraTalk",
    "voice": "nova",
    "lang": "en"
  }'`,
                  javascript: `const response = await fetch("${BASE_URL}/api/sdk/tts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "ntk_ent_your_key_here"
  },
  body: JSON.stringify({
    text: "Welcome to NeuraTalk",
    voice: "nova",
    lang: "en"
  })
});

const { audio, format } = await response.json();
// audio: base64-encoded MP3`,
                  python: `import requests
import base64

response = requests.post(
    f"${BASE_URL}/api/sdk/tts",
    headers={"X-API-Key": "ntk_ent_your_key_here"},
    json={
        "text": "Welcome to NeuraTalk",
        "voice": "nova",
        "lang": "en"
    }
)

data = response.json()
audio_bytes = base64.b64decode(data["audio"])`
                }} />
                <p className="text-sm font-medium mt-4 mb-2">Response</p>
                <CodeBlock code={`{
  "audio": "<base64-encoded-mp3>",
  "format": "mp3",
  "voice": "nova",
  "lang": "en"
}`} />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate">POST</Badge>
                  <code className="text-sm font-mono font-semibold">/api/sdk/stt</code>
                </div>
                <p className="text-muted-foreground mb-4 text-sm">Transcribe audio to text using speech recognition.</p>
                <p className="text-sm font-medium mb-2">Request Body</p>
                <p className="text-sm text-muted-foreground mb-4">Multipart form data with an <code className="bg-muted px-1 rounded text-xs">audio</code> file field. Max file size: 25 MB.</p>
                <CodeTabs tabs={{
                  curl: `curl -X POST ${BASE_URL}/api/sdk/stt \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -F "audio=@recording.webm"`,
                  javascript: `const formData = new FormData();
formData.append("audio", audioFile);

const response = await fetch("${BASE_URL}/api/sdk/stt", {
  method: "POST",
  headers: {
    "X-API-Key": "ntk_ent_your_key_here"
  },
  body: formData
});

const { text, language } = await response.json();`,
                  python: `import requests

with open("recording.webm", "rb") as f:
    response = requests.post(
        f"${BASE_URL}/api/sdk/stt",
        headers={"X-API-Key": "ntk_ent_your_key_here"},
        files={"audio": f}
    )

data = response.json()
# {"text": "...", "language": "en"}`
                }} />
                <p className="text-sm font-medium mt-4 mb-2">Response</p>
                <CodeBlock code={`{
  "text": "Hello, welcome to the meeting.",
  "language": "en"
}`} />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge className="bg-blue-600 text-white no-default-hover-elevate no-default-active-elevate">GET</Badge>
                  <code className="text-sm font-mono font-semibold">/api/sdk/languages</code>
                </div>
                <p className="text-muted-foreground mb-4 text-sm">Get the list of all supported languages.</p>
                <CodeTabs tabs={{
                  curl: `curl -X GET ${BASE_URL}/api/sdk/languages \\
  -H "X-API-Key: ntk_ent_your_key_here"`,
                  javascript: `const response = await fetch("${BASE_URL}/api/sdk/languages", {
  headers: {
    "X-API-Key": "ntk_ent_your_key_here"
  }
});

const { languages, total } = await response.json();`,
                  python: `import requests

response = requests.get(
    f"${BASE_URL}/api/sdk/languages",
    headers={"X-API-Key": "ntk_ent_your_key_here"}
)

data = response.json()
# {"languages": [...], "total": 40}`
                }} />
                <p className="text-sm font-medium mt-4 mb-2">Response</p>
                <CodeBlock code={`{
  "languages": [
    { "code": "en", "name": "English" },
    { "code": "es", "name": "Spanish" },
    { "code": "hi", "name": "Hindi" },
    ...
  ],
  "total": 40
}`} />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge className="bg-blue-600 text-white no-default-hover-elevate no-default-active-elevate">GET</Badge>
                  <code className="text-sm font-mono font-semibold">/api/sdk/usage</code>
                </div>
                <p className="text-muted-foreground mb-4 text-sm">Check your API key usage and quota information.</p>
                <CodeTabs tabs={{
                  curl: `curl -X GET ${BASE_URL}/api/sdk/usage \\
  -H "X-API-Key: ntk_ent_your_key_here"`,
                  javascript: `const response = await fetch("${BASE_URL}/api/sdk/usage", {
  headers: {
    "X-API-Key": "ntk_ent_your_key_here"
  }
});

const usage = await response.json();`,
                  python: `import requests

response = requests.get(
    f"${BASE_URL}/api/sdk/usage",
    headers={"X-API-Key": "ntk_ent_your_key_here"}
)

usage = response.json()`
                }} />
                <p className="text-sm font-medium mt-4 mb-2">Response</p>
                <CodeBlock code={`{
  "keyName": "Production Key",
  "keyPrefix": "ntk_ent_a1b2c3",
  "status": "active",
  "usageCount": 1523,
  "usageToday": 42,
  "dailyQuota": 1000,
  "rateLimitPerMinute": 60,
  "lastUsedAt": "2024-01-15T10:30:00Z",
  "expiresAt": null
}`} />
              </div>

              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate">POST</Badge>
                  <code className="text-sm font-mono font-semibold">/api/sdk/voice-chat</code>
                </div>
                <p className="text-muted-foreground mb-4 text-sm">Send a message to the AI voice chat assistant with optional conversation history.</p>
                <p className="text-sm font-medium mb-2">Request Body</p>
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm border rounded-md" data-testid="table-voice-chat-params">
                    <thead><tr className="bg-muted/50"><th className="text-left p-2 font-medium">Parameter</th><th className="text-left p-2 font-medium">Type</th><th className="text-left p-2 font-medium">Required</th><th className="text-left p-2 font-medium">Description</th></tr></thead>
                    <tbody>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">message</td><td className="p-2">string</td><td className="p-2">Yes</td><td className="p-2 text-muted-foreground">The user message</td></tr>
                      <tr className="border-t"><td className="p-2 font-mono text-xs">history</td><td className="p-2">array</td><td className="p-2">No</td><td className="p-2 text-muted-foreground">Previous messages [{`{role, content}`}]</td></tr>
                    </tbody>
                  </table>
                </div>
                <CodeTabs tabs={{
                  curl: `curl -X POST ${BASE_URL}/api/sdk/voice-chat \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -d '{
    "message": "How do you say thank you in Japanese?",
    "history": []
  }'`,
                  javascript: `const response = await fetch("${BASE_URL}/api/sdk/voice-chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "ntk_ent_your_key_here"
  },
  body: JSON.stringify({
    message: "How do you say thank you in Japanese?",
    history: []
  })
});

const { message } = await response.json();`,
                  python: `import requests

response = requests.post(
    f"${BASE_URL}/api/sdk/voice-chat",
    headers={"X-API-Key": "ntk_ent_your_key_here"},
    json={
        "message": "How do you say thank you in Japanese?",
        "history": []
    }
)

data = response.json()
# {"message": "In Japanese, 'thank you' is ..."}`
                }} />
                <p className="text-sm font-medium mt-4 mb-2">Response</p>
                <CodeBlock code={`{
  "message": "In Japanese, 'thank you' is 'arigatou gozaimasu' (ありがとうございます)."
}`} />
              </div>
            </div>

            <SectionHeading id="rate-limits">
              <Zap className="w-6 h-6 text-primary" /> Rate Limits
            </SectionHeading>

            <div className="space-y-4">
              <p className="text-muted-foreground">Each API key has configurable rate limits to ensure fair usage across all clients.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded-md" data-testid="table-rate-limits">
                  <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Limit Type</th><th className="text-left p-3 font-medium">Default</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
                  <tbody>
                    <tr className="border-t"><td className="p-3 font-medium">Per-Minute Rate Limit</td><td className="p-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">60 requests/min</code></td><td className="p-3 text-muted-foreground">Maximum requests allowed per minute</td></tr>
                    <tr className="border-t"><td className="p-3 font-medium">Daily Quota</td><td className="p-3"><code className="bg-muted px-1.5 py-0.5 rounded text-xs">1,000 requests/day</code></td><td className="p-3 text-muted-foreground">Maximum requests allowed per calendar day (UTC)</td></tr>
                  </tbody>
                </table>
              </div>
              <Card className="p-4 border-yellow-500/30 bg-yellow-500/5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium mb-1">When Limits Are Exceeded</p>
                    <p className="text-sm text-muted-foreground mb-2">You will receive a <code className="bg-muted px-1 rounded text-xs">429 Too Many Requests</code> response. The response body includes details about your quota.</p>
                    <CodeBlock code={`{
  "error": "Daily quota exceeded",
  "quota": 1000,
  "used": 1000
}`} />
                  </div>
                </div>
              </Card>
            </div>

            <SectionHeading id="error-codes">
              <AlertTriangle className="w-6 h-6 text-primary" /> Error Codes
            </SectionHeading>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border rounded-md" data-testid="table-error-codes">
                <thead><tr className="bg-muted/50"><th className="text-left p-3 font-medium">Status Code</th><th className="text-left p-3 font-medium">Meaning</th><th className="text-left p-3 font-medium">Description</th></tr></thead>
                <tbody>
                  <tr className="border-t">
                    <td className="p-3"><Badge variant="destructive" className="no-default-hover-elevate no-default-active-elevate">401</Badge></td>
                    <td className="p-3 font-medium">Unauthorized</td>
                    <td className="p-3 text-muted-foreground">Invalid or missing API key. Ensure your <code className="bg-muted px-1 rounded text-xs">X-API-Key</code> header is correct.</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3"><Badge variant="destructive" className="no-default-hover-elevate no-default-active-elevate">403</Badge></td>
                    <td className="p-3 font-medium">Forbidden</td>
                    <td className="p-3 text-muted-foreground">API key is suspended, revoked, or expired. Contact your admin.</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3"><Badge className="bg-yellow-600 text-white no-default-hover-elevate no-default-active-elevate">429</Badge></td>
                    <td className="p-3 font-medium">Too Many Requests</td>
                    <td className="p-3 text-muted-foreground">Rate limit or daily quota exceeded. Wait and retry.</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3"><Badge variant="destructive" className="no-default-hover-elevate no-default-active-elevate">500</Badge></td>
                    <td className="p-3 font-medium">Server Error</td>
                    <td className="p-3 text-muted-foreground">An internal error occurred. Retry with exponential backoff.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <SectionHeading id="sdk-examples">
              <Code2 className="w-6 h-6 text-primary" /> SDK Code Examples
            </SectionHeading>

            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold mb-3">JavaScript / TypeScript</h3>
                <p className="text-sm text-muted-foreground mb-4">A reusable SDK class for Node.js or browser environments.</p>
                <CodeBlock code={`class NeuraTalkSDK {
  constructor(apiKey, baseUrl = "${BASE_URL}") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async _request(method, path, body) {
    const options = {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(this.baseUrl + path, options);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Request failed");
    }
    return response.json();
  }

  async translate(text, sourceLang, targetLang) {
    return this._request("POST", "/api/sdk/translate", {
      text, sourceLang, targetLang,
    });
  }

  async textToSpeech(text, voice = "nova", lang = "en") {
    return this._request("POST", "/api/sdk/tts", {
      text, voice, lang,
    });
  }

  async speechToText(audioFile) {
    const formData = new FormData();
    formData.append("audio", audioFile);

    const response = await fetch(this.baseUrl + "/api/sdk/stt", {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
      body: formData,
    });
    if (!response.ok) throw new Error("STT request failed");
    return response.json();
  }

  async getLanguages() {
    return this._request("GET", "/api/sdk/languages");
  }

  async getUsage() {
    return this._request("GET", "/api/sdk/usage");
  }

  async voiceChat(message, history = []) {
    return this._request("POST", "/api/sdk/voice-chat", {
      message, history,
    });
  }
}

// Usage
const sdk = new NeuraTalkSDK("ntk_ent_your_key_here");

const result = await sdk.translate(
  "Good morning", "en", "hi"
);
console.log(result.translatedText);

const tts = await sdk.textToSpeech("Hello world");
console.log(tts.audio); // base64 MP3

const usage = await sdk.getUsage();
console.log(usage.usageToday, "/", usage.dailyQuota);`} />
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Python</h3>
                <p className="text-sm text-muted-foreground mb-4">A Python SDK using the requests library.</p>
                <CodeBlock code={`import requests
import base64


class NeuraTalkSDK:
    def __init__(self, api_key, base_url="${BASE_URL}"):
        self.api_key = api_key
        self.base_url = base_url
        self.headers = {"X-API-Key": api_key}

    def _request(self, method, path, json=None, files=None):
        url = f"{self.base_url}{path}"
        headers = {**self.headers}
        if json:
            headers["Content-Type"] = "application/json"

        resp = requests.request(
            method, url, headers=headers, json=json, files=files
        )
        resp.raise_for_status()
        return resp.json()

    def translate(self, text, source_lang, target_lang):
        return self._request("POST", "/api/sdk/translate", json={
            "text": text,
            "sourceLang": source_lang,
            "targetLang": target_lang,
        })

    def text_to_speech(self, text, voice="nova", lang="en"):
        data = self._request("POST", "/api/sdk/tts", json={
            "text": text,
            "voice": voice,
            "lang": lang,
        })
        return base64.b64decode(data["audio"])

    def speech_to_text(self, audio_path):
        with open(audio_path, "rb") as f:
            return self._request(
                "POST", "/api/sdk/stt",
                files={"audio": f}
            )

    def get_languages(self):
        return self._request("GET", "/api/sdk/languages")

    def get_usage(self):
        return self._request("GET", "/api/sdk/usage")

    def voice_chat(self, message, history=None):
        return self._request("POST", "/api/sdk/voice-chat", json={
            "message": message,
            "history": history or [],
        })


# Usage
sdk = NeuraTalkSDK("ntk_ent_your_key_here")

result = sdk.translate("Good morning", "en", "hi")
print(result["translatedText"])

audio_bytes = sdk.text_to_speech("Hello world")
with open("output.mp3", "wb") as f:
    f.write(audio_bytes)

usage = sdk.get_usage()
print(f"Used {usage['usageToday']} / {usage['dailyQuota']} today")`} />
              </div>
            </div>

            <Card className="mt-16 p-6 text-center">
              <h3 className="text-lg font-semibold mb-2">Need Help?</h3>
              <p className="text-muted-foreground mb-4 text-sm">Contact our enterprise support team for API key provisioning, custom rate limits, or integration assistance.</p>
              <Link href="/contact">
                <Button data-testid="button-contact-support">
                  Contact Support <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
