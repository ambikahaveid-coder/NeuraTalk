import{o as S,u as C,a as I,l as _,r as L,b as E,d as O,j as e,L as A,B as i,S as R,e as s,R as K,g as n,h as l,i as c,f as r,F as d,P as M}from"./index-D4OTEDwL.js";import{u as D}from"./useQuery-BnyrXs_T.js";import{B as o}from"./badge-DXqaH78I.js";import{T as q,a as V,b as g,c as j}from"./tabs-C6WoV9TE.js";import{I as f}from"./input-D5tfdm3a.js";import{A as B}from"./arrow-left-DSLtkybF.js";import{C as k}from"./code-Cv3mvlXk.js";import{Z as z}from"./zap-BWOVVnLu.js";import{S as G}from"./shield-BLGXhEG9.js";import{G as H}from"./globe-F-nztfMf.js";import{K as v}from"./key-BUsG0E_e.js";import{C as y}from"./copy-Cn4j2s5G.js";import{B as W}from"./book-open-DbLLu2mW.js";import{W as J}from"./webhook-BLocCXMT.js";import{V as U}from"./video-DEdI2yaq.js";import{L as F}from"./languages-D6TaY-nF.js";import"./index-6_XsHbQx.js";import"./index-BRH-9E3v.js";import"./index-D6e1VtJa.js";const X=S("Terminal",[["polyline",{points:"4 17 10 11 4 5",key:"akl6gq"}],["line",{x1:"12",x2:"20",y1:"19",y2:"19",key:"q2wloq"}]]),Q=[{category:"Authentication",endpoints:[{method:"POST",path:"/api/auth/otp/request",description:"Request OTP for login/signup",body:{identifier:"email@example.com",channel:"email"},response:{success:!0,message:"OTP sent"}},{method:"POST",path:"/api/auth/otp/verify",description:"Verify OTP and get session token",body:{identifier:"email@example.com",channel:"email",code:"123456"},response:{success:!0,token:"bearer_token",user:{}}}]},{category:"Call Management",endpoints:[{method:"POST",path:"/api/calls/create",description:"Initiate a new translated call",body:{calleeIdentifier:"+919876543210",callType:"voice",myLanguage:"en",theirLanguage:"bn",translationEnabled:!0,translationMode:"voice"},response:{callId:"call_123",joinMethod:"app_to_pstn",livekitUrl:"wss://media.neuratalk.io",livekitToken:"lk_token",session:{callId:"call_123",routeType:"app_to_pstn",sourceLanguage:"en",targetLanguage:"bn",translationEnabled:!0,translationMode:"voice",callerIdentityMode:"organization_caller_id"}}},{method:"GET",path:"/api/calls/:callId",description:"Get call details and status",response:{id:"call_123",status:"active",session:{callId:"call_123",routeType:"app_to_pstn",provider:"msg91_sip",sourceLanguage:"en",targetLanguage:"bn",durationSeconds:120,caller:{externalId:"user_42",phoneNumber:"+919999999999"},callee:{externalId:"+919876543210",phoneNumber:"+919876543210"}}}},{method:"POST",path:"/api/calls/:callId/end",description:"End an active call",response:{success:!0,duration:300}}]},{category:"Meeting Rooms",endpoints:[{method:"POST",path:"/api/meetings/create",description:"Create a new meeting room",body:{name:"Team Standup",maxParticipants:10,isVideoEnabled:!0,isTranslationEnabled:!0},response:{roomCode:"ABC123",meetingId:1}},{method:"POST",path:"/api/meetings/join",description:"Join an existing meeting",body:{roomCode:"ABC123",displayName:"John"},response:{success:!0,participants:[]}}]},{category:"Translation",endpoints:[{method:"POST",path:"/api/translate/text",description:"Translate text with emotion preservation",body:{text:"Hello, how are you?",sourceLang:"en",targetLang:"es",preserveEmotion:!0},response:{translated:"Hola, como estas?",emotion:"friendly"}},{method:"POST",path:"/api/translate/voice",description:"Translate voice with identity preservation",body:{audio:"base64_audio_data",sourceLang:"en",targetLang:"es"},response:{translatedAudio:"base64_audio",transcript:"..."}}]},{category:"Voice Profiles",endpoints:[{method:"POST",path:"/api/voice-profiles/create",description:"Create a new voice profile for identity preservation",body:{name:"My Voice",samples:[]},response:{profileId:1,status:"training"}},{method:"POST",path:"/api/voice-profiles/:id/samples",description:"Add voice sample for training",body:{audio:"base64_audio",transcript:"Sample text"},response:{sampleId:1,status:"processing"}}]}],N={javascript:`import NeuraTalk from '@neuratalk/sdk';

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
};`};function je(){const{user:Y}=C(),{toast:m}=I();_();const[p,w]=L.useState("javascript"),T=E(),{data:b}=D({queryKey:["/api/company/api-key"],queryFn:()=>fetch("/api/company/api-key",{credentials:"include"}).then(a=>a.json())}),h=O({mutationFn:()=>fetch("/api/company/api-key/generate",{method:"POST",credentials:"include"}).then(a=>a.json()),onSuccess:()=>{T.invalidateQueries({queryKey:["/api/company/api-key"]}),m({title:"API Key Generated",description:"Your new API key is ready to use."})},onError:()=>m({title:"Error",description:"Failed to generate API key. Try from Company Dashboard.",variant:"destructive"})}),x=b?.key??"",u=a=>{navigator.clipboard.writeText(a),m({title:"Copied to clipboard"})};return e.jsxs("div",{className:"min-h-screen bg-background",children:[e.jsx("header",{className:"border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-50",children:e.jsxs("div",{className:"container mx-auto px-4 h-14 flex items-center justify-between",children:[e.jsxs("div",{className:"flex items-center gap-4",children:[e.jsx(A,{href:"/company",children:e.jsxs(i,{variant:"ghost",size:"sm",className:"gap-1","data-testid":"link-back",children:[e.jsx(B,{className:"w-4 h-4"}),"Back"]})}),e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(R,{className:"w-5 h-5 text-primary"}),e.jsx("span",{className:"font-bold hidden sm:block",children:"API Documentation"})]})]}),e.jsxs(o,{variant:"secondary",className:"gap-1",children:[e.jsx(k,{className:"w-3 h-3"}),"Developer Portal"]})]})}),e.jsx("div",{className:"p-4 md:p-8",children:e.jsxs("div",{className:"max-w-6xl mx-auto space-y-8",children:[e.jsxs("div",{children:[e.jsx("h1",{className:"text-3xl font-bold","data-testid":"text-page-title",children:"API & SDK Documentation"}),e.jsx("p",{className:"text-muted-foreground mt-2",children:"Build with NeuraTalk's self-hosted voice translation platform"})]}),e.jsxs("div",{className:"grid md:grid-cols-4 gap-4",children:[e.jsx(s,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-cyan-500/10 rounded-lg",children:e.jsx(z,{className:"w-5 h-5 text-cyan-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"<300ms"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"Latency"})]})]})}),e.jsx(s,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-green-500/10 rounded-lg",children:e.jsx(G,{className:"w-5 h-5 text-green-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"Self-Hosted"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"No 3rd Party"})]})]})}),e.jsx(s,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-purple-500/10 rounded-lg",children:e.jsx(H,{className:"w-5 h-5 text-purple-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"50+ Languages"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"Real-time"})]})]})}),e.jsx(s,{className:"p-4",children:e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx("div",{className:"p-2 bg-orange-500/10 rounded-lg",children:e.jsx(K,{className:"w-5 h-5 text-orange-500"})}),e.jsxs("div",{children:[e.jsx("div",{className:"font-semibold",children:"Voice Preserved"}),e.jsx("div",{className:"text-sm text-muted-foreground",children:"Identity"})]})]})})]}),e.jsxs(s,{children:[e.jsxs(n,{children:[e.jsxs(l,{className:"flex items-center gap-2",children:[e.jsx(v,{className:"w-5 h-5"}),"API Keys"]}),e.jsx(c,{children:"Generate API keys to authenticate your applications"})]}),e.jsxs(r,{className:"space-y-4",children:[e.jsxs("div",{className:"flex gap-4",children:[e.jsxs("div",{className:"flex-1",children:[e.jsx(d,{children:"API Key"}),e.jsxs("div",{className:"flex gap-2 mt-1",children:[e.jsx(f,{"data-testid":"input-api-key",value:x?`ntk_live_••••••••${x.slice(-8)}`:"",placeholder:"No API key yet — click Generate",readOnly:!0,className:"font-mono"}),e.jsx(i,{size:"icon",variant:"outline",onClick:()=>u(b?.key??""),disabled:!x,"data-testid":"button-copy-key",children:e.jsx(y,{className:"w-4 h-4"})})]})]}),e.jsx("div",{className:"flex items-end",children:e.jsxs(i,{onClick:()=>h.mutate(),disabled:h.isPending,"data-testid":"button-generate-key",children:[e.jsx(v,{className:"w-4 h-4 mr-2"}),h.isPending?"Generating...":"Generate Key"]})})]}),e.jsx("div",{className:"p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg",children:e.jsx("p",{className:"text-sm text-amber-600 dark:text-amber-400",children:"Keep your API keys secure. Never expose them in client-side code or public repositories."})})]})]}),e.jsxs(q,{defaultValue:"endpoints",className:"w-full",children:[e.jsxs(V,{className:"grid w-full grid-cols-3",children:[e.jsxs(g,{value:"endpoints","data-testid":"tab-endpoints",children:[e.jsx(W,{className:"w-4 h-4 mr-2"}),"API Endpoints"]}),e.jsxs(g,{value:"sdk","data-testid":"tab-sdk",children:[e.jsx(k,{className:"w-4 h-4 mr-2"}),"SDK Examples"]}),e.jsxs(g,{value:"webhooks","data-testid":"tab-webhooks",children:[e.jsx(J,{className:"w-4 h-4 mr-2"}),"Webhooks"]})]}),e.jsx(j,{value:"endpoints",className:"mt-6 space-y-6",children:Q.map(a=>e.jsxs(s,{children:[e.jsx(n,{children:e.jsxs(l,{className:"flex items-center gap-2",children:[a.category==="Authentication"&&e.jsx(v,{className:"w-5 h-5"}),a.category==="Call Management"&&e.jsx(M,{className:"w-5 h-5"}),a.category==="Meeting Rooms"&&e.jsx(U,{className:"w-5 h-5"}),a.category==="Translation"&&e.jsx(F,{className:"w-5 h-5"}),a.category==="Voice Profiles"&&e.jsx(X,{className:"w-5 h-5"}),a.category]})}),e.jsx(r,{className:"space-y-4",children:a.endpoints.map((t,P)=>e.jsxs("div",{className:"p-4 border rounded-lg space-y-3",children:[e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx(o,{variant:t.method==="GET"?"secondary":"default",children:t.method}),e.jsx("code",{className:"font-mono text-sm",children:t.path}),e.jsx(i,{size:"icon",variant:"ghost",className:"ml-auto h-8 w-8",onClick:()=>u(t.path),children:e.jsx(y,{className:"w-4 h-4"})})]}),e.jsx("p",{className:"text-sm text-muted-foreground",children:t.description}),t.body&&e.jsxs("div",{children:[e.jsx(d,{className:"text-xs",children:"Request Body"}),e.jsx("pre",{className:"mt-1 p-3 bg-muted rounded text-xs overflow-x-auto",children:JSON.stringify(t.body,null,2)})]}),e.jsxs("div",{children:[e.jsx(d,{className:"text-xs",children:"Response"}),e.jsx("pre",{className:"mt-1 p-3 bg-muted rounded text-xs overflow-x-auto",children:JSON.stringify(t.response,null,2)})]})]},P))})]},a.category))}),e.jsx(j,{value:"sdk",className:"mt-6",children:e.jsxs(s,{children:[e.jsxs(n,{children:[e.jsx(l,{children:"SDK Integration Examples"}),e.jsx(c,{children:"Get started quickly with our official SDKs and code examples"})]}),e.jsxs(r,{children:[e.jsx("div",{className:"flex gap-2 mb-4",children:Object.keys(N).map(a=>e.jsx(i,{variant:p===a?"default":"outline",size:"sm",onClick:()=>w(a),"data-testid":`button-lang-${a}`,children:a.charAt(0).toUpperCase()+a.slice(1)},a))}),e.jsxs("div",{className:"relative",children:[e.jsx(i,{size:"icon",variant:"ghost",className:"absolute top-2 right-2",onClick:()=>u(N[p]),"data-testid":"button-copy-code",children:e.jsx(y,{className:"w-4 h-4"})}),e.jsx("pre",{className:"p-4 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-sm",children:N[p]})]})]})]})}),e.jsx(j,{value:"webhooks",className:"mt-6",children:e.jsxs(s,{children:[e.jsxs(n,{children:[e.jsx(l,{children:"Webhook Events"}),e.jsx(c,{children:"Receive real-time notifications about calls, translations, and more"})]}),e.jsxs(r,{className:"space-y-4",children:[e.jsxs("div",{className:"space-y-2",children:[e.jsx(d,{children:"Webhook URL"}),e.jsx(f,{"data-testid":"input-webhook-url",placeholder:"https://your-server.com/webhooks/neuratalk"})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("h4",{className:"font-semibold",children:"Available Events"}),[{event:"call.started",description:"Triggered when a call begins"},{event:"call.ended",description:"Triggered when a call ends"},{event:"call.translation",description:"Real-time translation events"},{event:"call.emotion",description:"Emotion detection updates"},{event:"meeting.started",description:"Meeting room activated"},{event:"meeting.participant.joined",description:"New participant joined"},{event:"meeting.participant.left",description:"Participant left the meeting"}].map(a=>e.jsxs("div",{className:"flex items-center justify-between p-3 border rounded-lg",children:[e.jsxs("div",{children:[e.jsx("code",{className:"font-mono text-sm",children:a.event}),e.jsx("p",{className:"text-sm text-muted-foreground",children:a.description})]}),e.jsx(o,{variant:"outline",children:"Active"})]},a.event))]}),e.jsx(i,{className:"w-full","data-testid":"button-save-webhook",children:"Save Webhook Configuration"})]})]})})]}),e.jsxs(s,{children:[e.jsxs(n,{children:[e.jsx(l,{children:"Architecture Overview"}),e.jsx(c,{children:"Self-hosted, zero third-party telecom dependencies"})]}),e.jsx(r,{children:e.jsxs("div",{className:"grid md:grid-cols-2 gap-6",children:[e.jsxs("div",{className:"space-y-4",children:[e.jsx("h4",{className:"font-semibold",children:"Media Pipeline"}),e.jsxs("div",{className:"space-y-2 text-sm",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(o,{variant:"outline",className:"w-20",children:"Audio"}),e.jsx("span",{children:"Processed for translation, emotion detection"})]}),e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx(o,{variant:"outline",className:"w-20",children:"Video"}),e.jsx("span",{children:"Passed through untouched (no processing)"})]})]})]}),e.jsxs("div",{className:"space-y-4",children:[e.jsx("h4",{className:"font-semibold",children:"Core Components"}),e.jsxs("div",{className:"space-y-2 text-sm",children:[e.jsx("div",{className:"p-2 bg-muted rounded",children:"WebSocket Signaling Server"}),e.jsx("div",{className:"p-2 bg-muted rounded",children:"RTP/UDP Media Relay"}),e.jsx("div",{className:"p-2 bg-muted rounded",children:"Emotion Detection Engine"}),e.jsx("div",{className:"p-2 bg-muted rounded",children:"Voice Identity Preservation"})]})]})]})})]})]})})]})}export{je as default};
