import{o as y,j as e,B as m,L as h,e as c,T as u,r as g}from"./index-DNvOFy84.js";import{B as a}from"./badge-B5JIq9HC.js";import{A as p}from"./arrow-right-DC9Fz_jD.js";import{C as N}from"./chevron-right-7r0v-2GO.js";import{B as b}from"./book-open-CM6FnfjJ.js";import{K as v}from"./key--HpEt5Rn.js";import{Z as j}from"./zap-D-S-BJSr.js";import{C as k}from"./check-Bxvbr3sK.js";import{C as _}from"./copy-D24vnoRM.js";const w=y("CodeXml",[["path",{d:"m18 16 4-4-4-4",key:"1inbqp"}],["path",{d:"m6 8-4 4 4 4",key:"15zrgr"}],["path",{d:"m14.5 4-5 16",key:"e7oirm"}]]),s="https://neuratalk.in/api",f=[{id:"authentication",label:"Authentication"},{id:"endpoints",label:"API Endpoints"},{id:"rate-limits",label:"Rate Limits"},{id:"error-codes",label:"Error Codes"},{id:"sdk-examples",label:"SDK Examples"}];function r({code:t,className:o=""}){const[x,l]=g.useState(!1),n=()=>{navigator.clipboard.writeText(t),l(!0),setTimeout(()=>l(!1),2e3)};return e.jsxs("div",{className:`relative group ${o}`,children:[e.jsx("pre",{className:"bg-zinc-900 text-zinc-100 rounded-md p-4 overflow-x-auto text-sm font-mono leading-relaxed",children:e.jsx("code",{children:t})}),e.jsx(m,{size:"icon",variant:"ghost",className:"absolute top-2 right-2 text-zinc-400 hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity",style:{visibility:"visible"},onClick:n,"data-testid":"button-copy-code",children:x?e.jsx(k,{className:"w-4 h-4"}):e.jsx(_,{className:"w-4 h-4"})})]})}function d({tabs:t}){const[o,x]=g.useState("curl"),l={curl:"cURL",javascript:"JavaScript",python:"Python"};return e.jsxs("div",{children:[e.jsx("div",{className:"flex gap-1 border-b mb-0",children:Object.keys(t).map(n=>e.jsx("button",{onClick:()=>x(n),className:`px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors ${o===n?"bg-zinc-900 text-zinc-100 border border-b-0 border-zinc-700":"text-muted-foreground hover:text-foreground"}`,"data-testid":`tab-${n}`,children:l[n]},n))}),e.jsx(r,{code:t[o]})]})}function i({id:t,children:o}){return e.jsxs("h2",{id:t,className:"text-2xl font-bold mt-16 mb-6 scroll-mt-24 flex items-center gap-3",children:[e.jsx("a",{href:`#${t}`,className:"text-muted-foreground hover:text-primary transition-colors",children:"#"}),o]})}function X(){return e.jsxs("div",{children:[e.jsxs("section",{className:"relative bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 text-white py-20",children:[e.jsx("div",{className:"absolute inset-0 bg-black/40"}),e.jsxs("div",{className:"relative max-w-7xl mx-auto px-4 text-center",children:[e.jsx(a,{variant:"secondary",className:"mb-4",children:"Enterprise SDK"}),e.jsx("h1",{className:"text-4xl md:text-5xl font-bold mb-4","data-testid":"text-sdk-title",children:"NeuraTalk Enterprise SDK"}),e.jsx("p",{className:"text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto mb-8",children:"Integrate real-time translation, text-to-speech, speech-to-text, and AI voice chat into your applications with our RESTful API."}),e.jsxs("div",{className:"flex flex-wrap justify-center gap-4",children:[e.jsx("a",{href:"#authentication",children:e.jsxs(m,{variant:"outline",className:"bg-white/10 backdrop-blur border-white/20 text-white","data-testid":"button-get-started",children:["Get Started ",e.jsx(p,{className:"w-4 h-4 ml-2"})]})}),e.jsx(h,{href:"/contact",children:e.jsx(m,{variant:"outline",className:"bg-white/10 backdrop-blur border-white/20 text-white","data-testid":"button-request-key",children:"Request API Key"})})]})]})]}),e.jsx("div",{className:"max-w-7xl mx-auto px-4 py-12",children:e.jsxs("div",{className:"flex gap-12",children:[e.jsx("aside",{className:"hidden lg:block w-56 shrink-0",children:e.jsxs("nav",{className:"sticky top-24 space-y-1",children:[e.jsx("p",{className:"text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider",children:"On this page"}),f.map(t=>e.jsxs("a",{href:`#${t.id}`,className:"flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-1.5","data-testid":`link-toc-${t.id}`,children:[e.jsx(N,{className:"w-3 h-3"}),t.label]},t.id))]})}),e.jsxs("div",{className:"flex-1 min-w-0",children:[e.jsx("div",{className:"lg:hidden flex flex-wrap gap-2 mb-8",children:f.map(t=>e.jsx("a",{href:`#${t.id}`,children:e.jsx(a,{variant:"outline",className:"cursor-pointer","data-testid":`badge-toc-${t.id}`,children:t.label})},t.id))}),e.jsx(c,{className:"p-6 mb-8 border-primary/20 bg-primary/5",children:e.jsxs("div",{className:"flex items-start gap-3",children:[e.jsx(b,{className:"w-5 h-5 text-primary mt-0.5 shrink-0"}),e.jsxs("div",{children:[e.jsx("p",{className:"font-medium mb-1",children:"Base URL"}),e.jsx("code",{className:"text-sm bg-zinc-900 text-zinc-100 px-3 py-1 rounded font-mono",children:s}),e.jsxs("p",{className:"text-sm text-muted-foreground mt-2",children:["All API requests must include a valid API key in the ",e.jsx("code",{className:"bg-muted px-1 rounded text-xs",children:"X-API-Key"})," header."]})]})]})}),e.jsxs(i,{id:"authentication",children:[e.jsx(v,{className:"w-6 h-6 text-primary"})," Authentication"]}),e.jsx("p",{className:"text-muted-foreground mb-4",children:"NeuraTalk uses API key authentication. Keys are issued by the super admin through the admin dashboard and must be activated before use."}),e.jsx("div",{className:"space-y-4 mb-6",children:e.jsxs(c,{className:"p-4",children:[e.jsx("h4",{className:"font-semibold mb-2",children:"How API Keys Work"}),e.jsxs("ol",{className:"list-decimal list-inside space-y-2 text-sm text-muted-foreground",children:[e.jsx("li",{children:"A super admin creates an API key for your organization"}),e.jsx("li",{children:"The key is returned once and must be securely stored"}),e.jsx("li",{children:"The super admin activates the key"}),e.jsxs("li",{children:["Include the key in every request via the ",e.jsx("code",{className:"bg-muted px-1 rounded text-xs",children:"X-API-Key"})," header"]})]})]})}),e.jsx("p",{className:"text-sm font-medium mb-2",children:"Example Header"}),e.jsx(r,{code:"X-API-Key: ntk_ent_your_key_here"}),e.jsxs(i,{id:"endpoints",children:[e.jsx(j,{className:"w-6 h-6 text-primary"})," API Endpoints"]}),e.jsxs("div",{className:"space-y-12",children:[e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3 flex-wrap",children:[e.jsx(a,{className:"bg-green-600 text-white no-default-hover-elevate no-default-active-elevate",children:"POST"}),e.jsx("code",{className:"text-sm font-mono font-semibold",children:"/api/sdk/translate"})]}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Translate text between supported languages."}),e.jsx("p",{className:"text-sm font-medium mb-2",children:"Request Body"}),e.jsx("div",{className:"overflow-x-auto mb-4",children:e.jsxs("table",{className:"w-full text-sm border rounded-md","data-testid":"table-translate-params",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-muted/50",children:[e.jsx("th",{className:"text-left p-2 font-medium",children:"Parameter"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Type"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Required"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Description"})]})}),e.jsxs("tbody",{children:[e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"text"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"Yes"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:"Text to translate"})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"sourceLang"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"Yes"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:'Source language code (e.g. "en")'})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"targetLang"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"Yes"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:'Target language code (e.g. "es")'})]})]})]})}),e.jsx(d,{tabs:{curl:`curl -X POST ${s}/api/sdk/translate \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -d '{
    "text": "Hello, how are you?",
    "sourceLang": "en",
    "targetLang": "es"
  }'`,javascript:`const response = await fetch("${s}/api/sdk/translate", {
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
// { translatedText, sourceLang, targetLang, originalText }`,python:`import requests

response = requests.post(
    f"${s}/api/sdk/translate",
    headers={"X-API-Key": "ntk_ent_your_key_here"},
    json={
        "text": "Hello, how are you?",
        "sourceLang": "en",
        "targetLang": "es"
    }
)

data = response.json()
# {"translatedText", "sourceLang", "targetLang", "originalText"}`}}),e.jsx("p",{className:"text-sm font-medium mt-4 mb-2",children:"Response"}),e.jsx(r,{code:`{
  "translatedText": "Hola, ¿cómo estás?",
  "sourceLang": "en",
  "targetLang": "es",
  "originalText": "Hello, how are you?"
}`})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3 flex-wrap",children:[e.jsx(a,{className:"bg-green-600 text-white no-default-hover-elevate no-default-active-elevate",children:"POST"}),e.jsx("code",{className:"text-sm font-mono font-semibold",children:"/api/sdk/tts"})]}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Convert text to speech audio."}),e.jsx("p",{className:"text-sm font-medium mb-2",children:"Request Body"}),e.jsx("div",{className:"overflow-x-auto mb-4",children:e.jsxs("table",{className:"w-full text-sm border rounded-md","data-testid":"table-tts-params",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-muted/50",children:[e.jsx("th",{className:"text-left p-2 font-medium",children:"Parameter"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Type"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Required"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Description"})]})}),e.jsxs("tbody",{children:[e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"text"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"Yes"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:"Text to convert to speech"})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"voice"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"No"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:'Voice ID (default: "nova")'})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"lang"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"No"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:'Language code (default: "en")'})]})]})]})}),e.jsx(d,{tabs:{curl:`curl -X POST ${s}/api/sdk/tts \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -d '{
    "text": "Welcome to NeuraTalk",
    "voice": "nova",
    "lang": "en"
  }'`,javascript:`const response = await fetch("${s}/api/sdk/tts", {
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
// audio: base64-encoded MP3`,python:`import requests
import base64

response = requests.post(
    f"${s}/api/sdk/tts",
    headers={"X-API-Key": "ntk_ent_your_key_here"},
    json={
        "text": "Welcome to NeuraTalk",
        "voice": "nova",
        "lang": "en"
    }
)

data = response.json()
audio_bytes = base64.b64decode(data["audio"])`}}),e.jsx("p",{className:"text-sm font-medium mt-4 mb-2",children:"Response"}),e.jsx(r,{code:`{
  "audio": "<base64-encoded-mp3>",
  "format": "mp3",
  "voice": "nova",
  "lang": "en"
}`})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3 flex-wrap",children:[e.jsx(a,{className:"bg-green-600 text-white no-default-hover-elevate no-default-active-elevate",children:"POST"}),e.jsx("code",{className:"text-sm font-mono font-semibold",children:"/api/sdk/stt"})]}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Transcribe audio to text using speech recognition."}),e.jsx("p",{className:"text-sm font-medium mb-2",children:"Request Body"}),e.jsxs("p",{className:"text-sm text-muted-foreground mb-4",children:["Multipart form data with an ",e.jsx("code",{className:"bg-muted px-1 rounded text-xs",children:"audio"})," file field. Max file size: 25 MB."]}),e.jsx(d,{tabs:{curl:`curl -X POST ${s}/api/sdk/stt \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -F "audio=@recording.webm"`,javascript:`const formData = new FormData();
formData.append("audio", audioFile);

const response = await fetch("${s}/api/sdk/stt", {
  method: "POST",
  headers: {
    "X-API-Key": "ntk_ent_your_key_here"
  },
  body: formData
});

const { text, language } = await response.json();`,python:`import requests

with open("recording.webm", "rb") as f:
    response = requests.post(
        f"${s}/api/sdk/stt",
        headers={"X-API-Key": "ntk_ent_your_key_here"},
        files={"audio": f}
    )

data = response.json()
# {"text": "...", "language": "en"}`}}),e.jsx("p",{className:"text-sm font-medium mt-4 mb-2",children:"Response"}),e.jsx(r,{code:`{
  "text": "Hello, welcome to the meeting.",
  "language": "en"
}`})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3 flex-wrap",children:[e.jsx(a,{className:"bg-blue-600 text-white no-default-hover-elevate no-default-active-elevate",children:"GET"}),e.jsx("code",{className:"text-sm font-mono font-semibold",children:"/api/sdk/languages"})]}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Get the list of all supported languages."}),e.jsx(d,{tabs:{curl:`curl -X GET ${s}/api/sdk/languages \\
  -H "X-API-Key: ntk_ent_your_key_here"`,javascript:`const response = await fetch("${s}/api/sdk/languages", {
  headers: {
    "X-API-Key": "ntk_ent_your_key_here"
  }
});

const { languages, total } = await response.json();`,python:`import requests

response = requests.get(
    f"${s}/api/sdk/languages",
    headers={"X-API-Key": "ntk_ent_your_key_here"}
)

data = response.json()
# {"languages": [...], "total": 40}`}}),e.jsx("p",{className:"text-sm font-medium mt-4 mb-2",children:"Response"}),e.jsx(r,{code:`{
  "languages": [
    { "code": "en", "name": "English" },
    { "code": "es", "name": "Spanish" },
    { "code": "hi", "name": "Hindi" },
    ...
  ],
  "total": 40
}`})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3 flex-wrap",children:[e.jsx(a,{className:"bg-blue-600 text-white no-default-hover-elevate no-default-active-elevate",children:"GET"}),e.jsx("code",{className:"text-sm font-mono font-semibold",children:"/api/sdk/usage"})]}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Check your API key usage and quota information."}),e.jsx(d,{tabs:{curl:`curl -X GET ${s}/api/sdk/usage \\
  -H "X-API-Key: ntk_ent_your_key_here"`,javascript:`const response = await fetch("${s}/api/sdk/usage", {
  headers: {
    "X-API-Key": "ntk_ent_your_key_here"
  }
});

const usage = await response.json();`,python:`import requests

response = requests.get(
    f"${s}/api/sdk/usage",
    headers={"X-API-Key": "ntk_ent_your_key_here"}
)

usage = response.json()`}}),e.jsx("p",{className:"text-sm font-medium mt-4 mb-2",children:"Response"}),e.jsx(r,{code:`{
  "keyName": "Production Key",
  "keyPrefix": "ntk_ent_a1b2c3",
  "status": "active",
  "usageCount": 1523,
  "usageToday": 42,
  "dailyQuota": 1000,
  "rateLimitPerMinute": 60,
  "lastUsedAt": "2024-01-15T10:30:00Z",
  "expiresAt": null
}`})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center gap-2 mb-3 flex-wrap",children:[e.jsx(a,{className:"bg-green-600 text-white no-default-hover-elevate no-default-active-elevate",children:"POST"}),e.jsx("code",{className:"text-sm font-mono font-semibold",children:"/api/sdk/voice-chat"})]}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Send a message to the AI voice chat assistant with optional conversation history."}),e.jsx("p",{className:"text-sm font-medium mb-2",children:"Request Body"}),e.jsx("div",{className:"overflow-x-auto mb-4",children:e.jsxs("table",{className:"w-full text-sm border rounded-md","data-testid":"table-voice-chat-params",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-muted/50",children:[e.jsx("th",{className:"text-left p-2 font-medium",children:"Parameter"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Type"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Required"}),e.jsx("th",{className:"text-left p-2 font-medium",children:"Description"})]})}),e.jsxs("tbody",{children:[e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"message"}),e.jsx("td",{className:"p-2",children:"string"}),e.jsx("td",{className:"p-2",children:"Yes"}),e.jsx("td",{className:"p-2 text-muted-foreground",children:"The user message"})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-2 font-mono text-xs",children:"history"}),e.jsx("td",{className:"p-2",children:"array"}),e.jsx("td",{className:"p-2",children:"No"}),e.jsxs("td",{className:"p-2 text-muted-foreground",children:["Previous messages [","{role, content}","]"]})]})]})]})}),e.jsx(d,{tabs:{curl:`curl -X POST ${s}/api/sdk/voice-chat \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ntk_ent_your_key_here" \\
  -d '{
    "message": "How do you say thank you in Japanese?",
    "history": []
  }'`,javascript:`const response = await fetch("${s}/api/sdk/voice-chat", {
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

const { message } = await response.json();`,python:`import requests

response = requests.post(
    f"${s}/api/sdk/voice-chat",
    headers={"X-API-Key": "ntk_ent_your_key_here"},
    json={
        "message": "How do you say thank you in Japanese?",
        "history": []
    }
)

data = response.json()
# {"message": "In Japanese, 'thank you' is ..."}`}}),e.jsx("p",{className:"text-sm font-medium mt-4 mb-2",children:"Response"}),e.jsx(r,{code:`{
  "message": "In Japanese, 'thank you' is 'arigatou gozaimasu' (ありがとうございます)."
}`})]})]}),e.jsxs(i,{id:"rate-limits",children:[e.jsx(j,{className:"w-6 h-6 text-primary"})," Rate Limits"]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("p",{className:"text-muted-foreground",children:"Each API key has configurable rate limits to ensure fair usage across all clients."}),e.jsx("div",{className:"overflow-x-auto",children:e.jsxs("table",{className:"w-full text-sm border rounded-md","data-testid":"table-rate-limits",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-muted/50",children:[e.jsx("th",{className:"text-left p-3 font-medium",children:"Limit Type"}),e.jsx("th",{className:"text-left p-3 font-medium",children:"Default"}),e.jsx("th",{className:"text-left p-3 font-medium",children:"Description"})]})}),e.jsxs("tbody",{children:[e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-3 font-medium",children:"Per-Minute Rate Limit"}),e.jsx("td",{className:"p-3",children:e.jsx("code",{className:"bg-muted px-1.5 py-0.5 rounded text-xs",children:"60 requests/min"})}),e.jsx("td",{className:"p-3 text-muted-foreground",children:"Maximum requests allowed per minute"})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-3 font-medium",children:"Daily Quota"}),e.jsx("td",{className:"p-3",children:e.jsx("code",{className:"bg-muted px-1.5 py-0.5 rounded text-xs",children:"1,000 requests/day"})}),e.jsx("td",{className:"p-3 text-muted-foreground",children:"Maximum requests allowed per calendar day (UTC)"})]})]})]})}),e.jsx(c,{className:"p-4 border-yellow-500/30 bg-yellow-500/5",children:e.jsxs("div",{className:"flex items-start gap-3",children:[e.jsx(u,{className:"w-5 h-5 text-yellow-500 mt-0.5 shrink-0"}),e.jsxs("div",{children:[e.jsx("p",{className:"font-medium mb-1",children:"When Limits Are Exceeded"}),e.jsxs("p",{className:"text-sm text-muted-foreground mb-2",children:["You will receive a ",e.jsx("code",{className:"bg-muted px-1 rounded text-xs",children:"429 Too Many Requests"})," response. The response body includes details about your quota."]}),e.jsx(r,{code:`{
  "error": "Daily quota exceeded",
  "quota": 1000,
  "used": 1000
}`})]})]})})]}),e.jsxs(i,{id:"error-codes",children:[e.jsx(u,{className:"w-6 h-6 text-primary"})," Error Codes"]}),e.jsx("div",{className:"overflow-x-auto",children:e.jsxs("table",{className:"w-full text-sm border rounded-md","data-testid":"table-error-codes",children:[e.jsx("thead",{children:e.jsxs("tr",{className:"bg-muted/50",children:[e.jsx("th",{className:"text-left p-3 font-medium",children:"Status Code"}),e.jsx("th",{className:"text-left p-3 font-medium",children:"Meaning"}),e.jsx("th",{className:"text-left p-3 font-medium",children:"Description"})]})}),e.jsxs("tbody",{children:[e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-3",children:e.jsx(a,{variant:"destructive",className:"no-default-hover-elevate no-default-active-elevate",children:"401"})}),e.jsx("td",{className:"p-3 font-medium",children:"Unauthorized"}),e.jsxs("td",{className:"p-3 text-muted-foreground",children:["Invalid or missing API key. Ensure your ",e.jsx("code",{className:"bg-muted px-1 rounded text-xs",children:"X-API-Key"})," header is correct."]})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-3",children:e.jsx(a,{variant:"destructive",className:"no-default-hover-elevate no-default-active-elevate",children:"403"})}),e.jsx("td",{className:"p-3 font-medium",children:"Forbidden"}),e.jsx("td",{className:"p-3 text-muted-foreground",children:"API key is suspended, revoked, or expired. Contact your admin."})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-3",children:e.jsx(a,{className:"bg-yellow-600 text-white no-default-hover-elevate no-default-active-elevate",children:"429"})}),e.jsx("td",{className:"p-3 font-medium",children:"Too Many Requests"}),e.jsx("td",{className:"p-3 text-muted-foreground",children:"Rate limit or daily quota exceeded. Wait and retry."})]}),e.jsxs("tr",{className:"border-t",children:[e.jsx("td",{className:"p-3",children:e.jsx(a,{variant:"destructive",className:"no-default-hover-elevate no-default-active-elevate",children:"500"})}),e.jsx("td",{className:"p-3 font-medium",children:"Server Error"}),e.jsx("td",{className:"p-3 text-muted-foreground",children:"An internal error occurred. Retry with exponential backoff."})]})]})]})}),e.jsxs(i,{id:"sdk-examples",children:[e.jsx(w,{className:"w-6 h-6 text-primary"})," SDK Code Examples"]}),e.jsxs("div",{className:"space-y-8",children:[e.jsxs("div",{children:[e.jsx("h3",{className:"text-lg font-semibold mb-3",children:"JavaScript / TypeScript"}),e.jsx("p",{className:"text-sm text-muted-foreground mb-4",children:"A reusable SDK class for Node.js or browser environments."}),e.jsx(r,{code:`class NeuraTalkSDK {
  constructor(apiKey, baseUrl = "${s}") {
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
console.log(usage.usageToday, "/", usage.dailyQuota);`})]}),e.jsxs("div",{children:[e.jsx("h3",{className:"text-lg font-semibold mb-3",children:"Python"}),e.jsx("p",{className:"text-sm text-muted-foreground mb-4",children:"A Python SDK using the requests library."}),e.jsx(r,{code:`import requests
import base64


class NeuraTalkSDK:
    def __init__(self, api_key, base_url="${s}"):
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
print(f"Used {usage['usageToday']} / {usage['dailyQuota']} today")`})]})]}),e.jsxs(c,{className:"mt-16 p-6 text-center",children:[e.jsx("h3",{className:"text-lg font-semibold mb-2",children:"Need Help?"}),e.jsx("p",{className:"text-muted-foreground mb-4 text-sm",children:"Contact our enterprise support team for API key provisioning, custom rate limits, or integration assistance."}),e.jsx(h,{href:"/contact",children:e.jsxs(m,{"data-testid":"button-contact-support",children:["Contact Support ",e.jsx(p,{className:"w-4 h-4 ml-2"})]})})]})]})]})})]})}export{X as default};
