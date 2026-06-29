import{l as S,u as C,a as _,k as I,r as N,j as e,L,B as i,S as E,C as a,R as O,f as n,g as l,h as c,e as r,E as d,P as A,V as R}from"./index-DuXXRkXq.js";import{B as o}from"./badge-C_a8RwTp.js";import{T as M,a as K,b as x,c as u}from"./tabs-DspwJU5J.js";import{I as b}from"./input-Ds7uiK_8.js";import{A as D}from"./arrow-left-Ed9sDZAL.js";import{C as f}from"./code-DdQzyO3n.js";import{Z as V}from"./zap-Bei27iY1.js";import{S as z}from"./shield-CnDSBG8h.js";import{G as B}from"./globe-N-kTGmBi.js";import{K as g}from"./key-CejNbWns.js";import{C as j}from"./copy-DAXSm0wE.js";import{B as q}from"./book-open-BlyWpWdt.js";import{W as G}from"./webhook-BXNE3tcJ.js";import{L as H}from"./languages-BpY0NnKy.js";import"./index-DiWz96tA.js";import"./index-DQMD-neb.js";import"./index-BlzgcsVi.js";const W=S("Terminal",[["polyline",{points:"4 17 10 11 4 5",key:"akl6gq"}],["line",{x1:"12",x2:"20",y1:"19",y2:"19",key:"q2wloq"}]]),J=[{category:"Authentication",endpoints:[{method:"POST",path:"/api/auth/otp/request",description:"Request OTP for login/signup",body:{identifier:"email@example.com",channel:"email"},response:{success:!0,message:"OTP sent"}},{method:"POST",path:"/api/auth/otp/verify",description:"Verify OTP and get session token",body:{identifier:"email@example.com",channel:"email",code:"123456"},response:{success:!0,token:"bearer_token",user:{}}}]},{category:"Call Management",endpoints:[{method:"POST",path:"/api/calls/create",description:"Initiate a new translated call",body:{calleeIdentifier:"+919876543210",callType:"voice",myLanguage:"en",theirLanguage:"bn",translationEnabled:!0,translationMode:"voice"},response:{callId:"call_123",joinMethod:"app_to_pstn",livekitUrl:"wss://media.neuratalk.io",livekitToken:"lk_token",session:{callId:"call_123",routeType:"app_to_pstn",sourceLanguage:"en",targetLanguage:"bn",translationEnabled:!0,translationMode:"voice",callerIdentityMode:"organization_caller_id"}}},{method:"GET",path:"/api/calls/:callId",description:"Get call details and status",response:{id:"call_123",status:"active",session:{callId:"call_123",routeType:"app_to_pstn",provider:"msg91_sip",sourceLanguage:"en",targetLanguage:"bn",durationSeconds:120,caller:{externalId:"user_42",phoneNumber:"+919999999999"},callee:{externalId:"+919876543210",phoneNumber:"+919876543210"}}}},{method:"POST",path:"/api/calls/:callId/end",description:"End an active call",response:{success:!0,duration:300}}]},{category:"Meeting Rooms",endpoints:[{method:"POST",path:"/api/meetings/create",description:"Create a new meeting room",body:{name:"Team Standup",maxParticipants:10,isVideoEnabled:!0,isTranslationEnabled:!0},response:{roomCode:"ABC123",meetingId:1}},{method:"POST",path:"/api/meetings/join",description:"Join an existing meeting",body:{roomCode:"ABC123",displayName:"John"},response:{success:!0,participants:[]}}]},{category:"Translation",endpoints:[{method:"POST",path:"/api/translate/text",description:"Translate text with emotion preservation",body:{text:"Hello, how are you?",sourceLang:"en",targetLang:"es",preserveEmotion:!0},response:{translated:"Hola, como estas?",emotion:"friendly"}},{method:"POST",path:"/api/translate/voice",description:"Translate voice with identity preservation",body:{audio:"base64_audio_data",sourceLang:"en",targetLang:"es"},response:{translatedAudio:"base64_audio",transcript:"..."}}]},{category:"Voice Profiles",endpoints:[{method:"POST",path:"/api/voice-profiles/create",description:"Create a new voice profile for identity preservation",body:{name:"My Voice",samples:[]},response:{profileId:1,status:"training"}},{method:"POST",path:"/api/voice-profiles/:id/samples",description:"Add voice sample for training",body:{audio:"base64_audio",transcript:"Sample text"},response:{sampleId:1,status:"processing"}}]}],v={javascript:`import NeuraTalk from '@neuratalk/sdk';

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
await call.end();`,python:`from neuratalk import NeuraTalk

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
call.end()`,curl:`# Request OTP
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
  }'`,websocket:`// Legacy meeting signaling example (not the primary LiveKit calling path)
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
};`};function me(){const{user:U}=C(),{toast:y}=_();I();const[m,k]=N.useState(""),[p,w]=N.useState("javascript"),T=async()=>{const s=`ntk_demo_${Array.from({length:24},()=>"abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random()*36)]).join("")}`;k(s),y({title:"Demo Key Generated",description:"Production keys are generated server-side for security"})},h=s=>{navigator.clipboard.writeText(s),y({title:"Copied to clipboard"})};return e.jsxs("div",{className:"min-h-screen bg-background",children:[e.jsx("header",{className:"border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-50",children:e.jsxs("div",{className:"container mx-auto px-4 h-14 flex items-center justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[e.jsx(L,{href:"/company",children:e.jsxs(i,{variant:"ghost",size:"sm",className:"gap-1","data-testid":"link-back",children:[e.jsx(D,{className:"w-4 h-4"}),"Back"]})}),e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(E,{className:"w-5 h-5 text-primary"}),e.jsx("span",{className:"font-bold hidden sm:block",children:"API Documentation"})]})]}),e.jsxs(o,{variant:"secondary",className:"gap-1",children:[e.jsx(f,{className:"w-3 h-3"}),"Developer Portal"]})]})}),e.jsx("div",{className:"p-4 md:p-8",children:e.jsxs("div",{className:"max-w-6xl mx-auto space-y-8",children:[e.jsxs("div",{children:[e.jsx("h1",{className:"text-3xl font-bold","data-testid":"text-page-title",children:"API & SDK Documentation"}),e.jsx("p",{className:"text-muted-foreground mt-2",children:"Build with NeuraTalk's self-hosted voice translation platform"})]}),e.jsxs("div",{className:"grid md:grid-cols-4 gap-4",children:[e.jsx(a,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-cyan-500/10 rounded-lg",children:e.jsx(V,{className:"w-5 h-5 text-cyan-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"<300ms"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"Latency"})]})]})}),e.jsx(a,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-green-500/10 rounded-lg",children:e.jsx(z,{className:"w-5 h-5 text-green-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"Self-Hosted"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"No 3rd Party"})]})]})}),e.jsx(a,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-purple-500/10 rounded-lg",children:e.jsx(B,{className:"w-5 h-5 text-purple-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"50+ Languages"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"Real-time"})]})]})}),e.jsx(a,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-orange-500/10 rounded-lg",children:e.jsx(O,{className:"w-5 h-5 text-orange-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"Voice Preserved"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"Identity"})]})]})})]}),e.jsxs(a,{children:[e.jsxs(n,{children:[e.jsxs(l,{className:"flex items-center gap-2",children:[e.jsx(g,{className:"w-5 h-5"}),"API Keys"]}),e.jsx(c,{children:"Generate API keys to authenticate your applications"})]}),e.jsxs(r,{className:"space-y-4",children:[e.jsxs("div",{className:"flex gap-4",children:[e.jsxs("div",{className:"flex-1",children:[e.jsx(d,{children:"API Key"}),e.jsxs("div",{className:"flex gap-2 mt-1",children:[e.jsx(b,{"data-testid":"input-api-key",value:m,placeholder:"Generate an API key...",readOnly:!0,className:"font-mono"}),e.jsx(i,{size:"icon",variant:"outline",onClick:()=>h(m),disabled:!m,"data-testid":"button-copy-key",children:e.jsx(j,{className:"w-4 h-4"})})]})]}),e.jsx("div",{className:"flex items-end",children:e.jsxs(i,{onClick:T,"data-testid":"button-generate-key",children:[e.jsx(g,{className:"w-4 h-4 mr-2"}),"Generate Key"]})})]}),e.jsx("div",{className:"p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg",children:e.jsx("p",{className:"text-sm text-amber-600 dark:text-amber-400",children:"Keep your API keys secure. Never expose them in client-side code or public repositories."})})]})]}),e.jsxs(M,{defaultValue:"endpoints",className:"w-full",children:[e.jsxs(K,{className:"grid w-full grid-cols-3",children:[e.jsxs(x,{value:"endpoints","data-testid":"tab-endpoints",children:[e.jsx(q,{className:"w-4 h-4 mr-2"}),"API Endpoints"]}),e.jsxs(x,{value:"sdk","data-testid":"tab-sdk",children:[e.jsx(f,{className:"w-4 h-4 mr-2"}),"SDK Examples"]}),e.jsxs(x,{value:"webhooks","data-testid":"tab-webhooks",children:[e.jsx(G,{className:"w-4 h-4 mr-2"}),"Webhooks"]})]}),e.jsx(u,{value:"endpoints",className:"mt-6 space-y-6",children:J.map(s=>e.jsxs(a,{children:[e.jsx(n,{children:e.jsxs(l,{className:"flex items-center gap-2",children:[s.category==="Authentication"&&e.jsx(g,{className:"w-5 h-5"}),s.category==="Call Management"&&e.jsx(A,{className:"w-5 h-5"}),s.category==="Meeting Rooms"&&e.jsx(R,{className:"w-5 h-5"}),s.category==="Translation"&&e.jsx(H,{className:"w-5 h-5"}),s.category==="Voice Profiles"&&e.jsx(W,{className:"w-5 h-5"}),s.category]})}),e.jsx(r,{className:"space-y-4",children:s.endpoints.map((t,P)=>e.jsxs("div",{className:"p-4 border rounded-lg space-y-3",children:[e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx(o,{variant:t.method==="GET"?"secondary":"default",children:t.method}),e.jsx("code",{className:"font-mono text-sm",children:t.path}),e.jsx(i,{size:"icon",variant:"ghost",className:"ml-auto h-8 w-8",onClick:()=>h(t.path),children:e.jsx(j,{className:"w-4 h-4"})})]}),e.jsx("p",{className:"text-sm text-muted-foreground",children:t.description}),t.body&&e.jsxs("div",{children:[e.jsx(d,{className:"text-xs",children:"Request Body"}),e.jsx("pre",{className:"mt-1 p-3 bg-muted rounded text-xs overflow-x-auto",children:JSON.stringify(t.body,null,2)})]}),e.jsxs("div",{children:[e.jsx(d,{className:"text-xs",children:"Response"}),e.jsx("pre",{className:"mt-1 p-3 bg-muted rounded text-xs overflow-x-auto",children:JSON.stringify(t.response,null,2)})]})]},P))})]},s.category))}),e.jsx(u,{value:"sdk",className:"mt-6",children:e.jsxs(a,{children:[e.jsxs(n,{children:[e.jsx(l,{children:"SDK Integration Examples"}),e.jsx(c,{children:"Get started quickly with our official SDKs and code examples"})]}),e.jsxs(r,{children:[e.jsx("div",{className:"flex gap-2 mb-4",children:Object.keys(v).map(s=>e.jsx(i,{variant:p===s?"default":"outline",size:"sm",onClick:()=>w(s),"data-testid":`button-lang-${s}`,children:s.charAt(0).toUpperCase()+s.slice(1)},s))}),e.jsxs("div",{className:"relative",children:[e.jsx(i,{size:"icon",variant:"ghost",className:"absolute top-2 right-2",onClick:()=>h(v[p]),"data-testid":"button-copy-code",children:e.jsx(j,{className:"w-4 h-4"})}),e.jsx("pre",{className:"p-4 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-sm",children:v[p]})]})]})]})}),e.jsx(u,{value:"webhooks",className:"mt-6",children:e.jsxs(a,{children:[e.jsxs(n,{children:[e.jsx(l,{children:"Webhook Events"}),e.jsx(c,{children:"Receive real-time notifications about calls, translations, and more"})]}),e.jsxs(r,{className:"space-y-4",children:[e.jsxs("div",{className:"space-y-2",children:[e.jsx(d,{children:"Webhook URL"}),e.jsx(b,{"data-testid":"input-webhook-url",placeholder:"https://your-server.com/webhooks/neuratalk"})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("h4",{className:"font-semibold",children:"Available Events"}),[{event:"call.started",description:"Triggered when a call begins"},{event:"call.ended",description:"Triggered when a call ends"},{event:"call.translation",description:"Real-time translation events"},{event:"call.emotion",description:"Emotion detection updates"},{event:"meeting.started",description:"Meeting room activated"},{event:"meeting.participant.joined",description:"New participant joined"},{event:"meeting.participant.left",description:"Participant left the meeting"}].map(s=>e.jsxs("div",{className:"flex items-center justify-between p-3 border rounded-lg",children:[e.jsxs("div",{children:[e.jsx("code",{className:"font-mono text-sm",children:s.event}),e.jsx("p",{className:"text-sm text-muted-foreground",children:s.description})]}),e.jsx(o,{variant:"outline",children:"Active"})]},s.event))]}),e.jsx(i,{className:"w-full","data-testid":"button-save-webhook",children:"Save Webhook Configuration"})]})]})})]}),e.jsxs(a,{children:[e.jsxs(n,{children:[e.jsx(l,{children:"Architecture Overview"}),e.jsx(c,{children:"Self-hosted, zero third-party telecom dependencies"})]}),e.jsx(r,{children:e.jsxs("div",{className:"grid md:grid-cols-2 gap-6",children:[e.jsxs("div",{className:"space-y-4",children:[e.jsx("h4",{className:"font-semibold",children:"Media Pipeline"}),e.jsxs("div",{className:"space-y-2 text-sm",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(o,{variant:"outline",className:"w-20",children:"Audio"}),e.jsx("span",{children:"Processed for translation, emotion detection"})]}),e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(o,{variant:"outline",className:"w-20",children:"Video"}),e.jsx("span",{children:"Passed through untouched (no processing)"})]})]})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("h4",{className:"font-semibold",children:"Core Components"}),e.jsxs("div",{className:"space-y-2 text-sm",children:[e.jsx("div",{className:"p-2 bg-muted rounded",children:"WebSocket Signaling Server"}),e.jsx("div",{className:"p-2 bg-muted rounded",children:"RTP/UDP Media Relay"}),e.jsx("div",{className:"p-2 bg-muted rounded",children:"Emotion Detection Engine"}),e.jsx("div",{className:"p-2 bg-muted rounded",children:"Voice Identity Preservation"})]})]})]})})]})]})})]})}export{me as default};
