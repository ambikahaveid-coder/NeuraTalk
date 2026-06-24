import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Phone, Globe, Shield, Zap, Users, Building2, HeartHandshake, Languages,
  Mic, Volume2, Brain, ArrowRight, CheckCircle2, Play, Headphones,
  MessageSquare, Video, PhoneCall, Sparkles, Wifi
} from "lucide-react";
import { motion } from "framer-motion";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.6 }
};

const stagger = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="relative py-28 md:py-36 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-background to-blue-500/5" />
        <div className="absolute top-10 left-10 w-80 h-80 bg-primary/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-10 right-10 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[200px]" />
        
        <div className="max-w-6xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              AI-Powered Voice Communication Platform
            </Badge>
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-[1.1] tracking-tight"
          >
            Break Language Barriers.
            <span className="block bg-gradient-to-r from-primary via-blue-500 to-primary bg-clip-text text-transparent mt-2">
              Speak Freely.
            </span>
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl md:text-2xl text-muted-foreground mb-10 max-w-3xl mx-auto leading-relaxed"
          >
            Real-time multilingual voice & video communication with emotion-aware translation.
            Connect with anyone, anywhere, in any language.
          </motion.p>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 justify-center mb-12"
          >
            <Link href="/login">
              <Button size="lg" className="text-lg px-8 shadow-lg shadow-primary/25" data-testid="button-get-started">
                Get Started Free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link href="/demo">
              <Button size="lg" variant="outline" className="text-lg px-8" data-testid="button-view-demo">
                <Play className="mr-2 w-5 h-5" />
                Watch Demo
              </Button>
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>20+ languages supported</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>Security-first, reliability-focused</span>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-16">
            <Badge variant="outline" className="mb-4">How It Works</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">AI Translation in Real-Time</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Our advanced AI pipeline processes your voice in milliseconds, preserving emotion and intent
            </p>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              { icon: Mic, step: "1", title: "You Speak", desc: "Speak naturally in your language - Telugu, Hindi, Tamil, or any of 20+ languages", color: "text-blue-500", bg: "bg-blue-500/10" },
              { icon: Brain, step: "2", title: "AI Understands", desc: "Advanced speech recognition captures every word with emotion detection", color: "text-purple-500", bg: "bg-purple-500/10" },
              { icon: Languages, step: "3", title: "Smart Translation", desc: "Context-aware translation preserves meaning, tone, and cultural nuance", color: "text-amber-500", bg: "bg-amber-500/10" },
              { icon: Volume2, step: "4", title: "They Hear", desc: "Your message delivered in their language with natural, emotion-aware voice", color: "text-emerald-500", bg: "bg-emerald-500/10" },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                {...stagger}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <Card className="relative group hover:shadow-lg transition-shadow duration-300 h-full">
                  <CardContent className="p-6 text-center">
                    <div className={`w-14 h-14 rounded-2xl ${item.bg} flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300`}>
                      <item.icon className={`w-7 h-7 ${item.color}`} />
                    </div>
                    <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {item.step}
                    </div>
                    <h3 className="font-semibold mb-2 text-lg">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-14">
            <Badge variant="outline" className="mb-4">Core Strengths</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Why NeuraTalk?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Built from the ground up for natural, emotionally intelligent communication
            </p>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Languages, title: "Multilingual", desc: "Telugu, Tamil, Kannada, Hindi, English - speak naturally in your language", color: "text-blue-500" },
              { icon: Zap, title: "Ultra-Fast", desc: "Sub-second translation keeps conversations flowing naturally", color: "text-amber-500" },
              { icon: HeartHandshake, title: "Emotion-Aware", desc: "Preserves tone, emotion, and intent across every language", color: "text-rose-500" },
              { icon: Shield, title: "100% Secure", desc: "Self-hosted infrastructure with zero third-party data access", color: "text-emerald-500" },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                {...stagger}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <Card className="group hover:shadow-lg hover:border-primary/20 transition-all duration-300 h-full">
                  <CardContent className="p-6 text-center">
                    <item.icon className={`w-10 h-10 mx-auto mb-4 ${item.color} group-hover:scale-110 transition-transform duration-300`} />
                    <h3 className="font-semibold mb-2 text-lg">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-16">
            <Badge variant="outline" className="mb-4">Call Types</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Every Way to Connect</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Video, voice, face-to-face, or SIM-to-SIM - all with real-time translation
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: Video, title: "Video Calls", desc: "HD video with live subtitles and translated audio overlay", color: "from-blue-500 to-cyan-500" },
              { icon: Mic, title: "Voice Calls", desc: "Crystal-clear voice with emotion-preserved translation", color: "from-purple-500 to-pink-500" },
              { icon: Users, title: "Face-to-Face", desc: "In-person meetings with real-time translation bridge", color: "from-emerald-500 to-teal-500" },
              { icon: Phone, title: "SIM Calls", desc: "Bridge regular phone calls with live voice translation", color: "from-orange-500 to-red-500" },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                {...stagger}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <Card className="group hover:shadow-lg transition-all duration-300 overflow-hidden h-full">
                  <div className={`h-1.5 bg-gradient-to-r ${item.color}`} />
                  <CardContent className="p-6 text-center">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300`}>
                      <item.icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="font-semibold mb-2 text-lg">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-16">
            <Badge variant="outline" className="mb-4">Solutions</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built For Everyone</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Whether you're an individual, business, or enterprise - we have the perfect solution
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-8">
            <motion.div {...stagger} transition={{ duration: 0.5, delay: 0 }}>
              <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 h-full">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
                <CardContent className="p-8">
                  <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Users className="w-7 h-7 text-blue-500" />
                  </div>
                  <Badge variant="secondary" className="mb-3">C2C</Badge>
                  <h3 className="text-2xl font-bold mb-2">Personal Calls</h3>
                  <p className="text-muted-foreground mb-6">
                    Connect with friends and family across language barriers
                  </p>
                  <ul className="space-y-3 mb-8">
                    {["Free video & voice calls", "Real-time translation", "Emotion preservation", "AI voice assistant"].map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/login">
                    <Button className="w-full" data-testid="button-c2c-start">
                      <PhoneCall className="mr-2 w-4 h-4" />
                      Start Free
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div {...stagger} transition={{ duration: 0.5, delay: 0.1 }}>
              <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 border-primary/50 h-full">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary to-purple-500" />
                <CardContent className="p-8">
                  <div className="absolute top-4 right-4">
                    <Badge className="shadow-sm">Popular</Badge>
                  </div>
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Headphones className="w-7 h-7 text-primary" />
                  </div>
                  <Badge variant="secondary" className="mb-3">B2C</Badge>
                  <h3 className="text-2xl font-bold mb-2">Customer Service</h3>
                  <p className="text-muted-foreground mb-6">
                    Serve customers in their preferred language instantly
                  </p>
                  <ul className="space-y-3 mb-8">
                    {["Agent dashboard with CRM", "Live call translation", "Call analytics & reports", "Quality monitoring"].map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/login">
                    <Button className="w-full shadow-lg shadow-primary/20" data-testid="button-b2c-start">
                      <MessageSquare className="mr-2 w-4 h-4" />
                      Start Business Trial
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div {...stagger} transition={{ duration: 0.5, delay: 0.2 }}>
              <Card className="relative overflow-hidden group hover:shadow-xl transition-all duration-300 h-full">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-500 to-red-500" />
                <CardContent className="p-8">
                  <div className="w-14 h-14 rounded-2xl bg-orange-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Building2 className="w-7 h-7 text-orange-500" />
                  </div>
                  <Badge variant="secondary" className="mb-3">B2B</Badge>
                  <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
                  <p className="text-muted-foreground mb-6">
                    Full call center integration with SIP/PBX support
                  </p>
                  <ul className="space-y-3 mb-8">
                    {["SIP trunk integration", "WebRTC gateway", "Enterprise API access", "Custom deployment"].map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href="/contact">
                    <Button variant="outline" className="w-full" data-testid="button-b2b-contact">
                      <Video className="mr-2 w-4 h-4" />
                      Contact Sales
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <motion.div {...fadeUp} className="text-center mb-14">
            <Badge variant="outline" className="mb-4">Platform</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Powerful Capabilities</h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Globe, title: "20+ Languages", desc: "Telugu, Tamil, Kannada, Hindi, Spanish, French, Arabic and more", color: "text-blue-500" },
              { icon: Zap, title: "Ultra-Low Latency", desc: "Sub-300ms translation for natural, flowing conversations", color: "text-amber-500" },
              { icon: HeartHandshake, title: "Emotion Detection", desc: "AI detects and preserves emotional tone across translations", color: "text-rose-500" },
              { icon: Shield, title: "Enterprise Security", desc: "Self-hosted infrastructure with end-to-end encryption", color: "text-emerald-500" },
              { icon: Video, title: "HD Video Calls", desc: "High-quality video with real-time subtitle translation overlay", color: "text-indigo-500" },
              { icon: Wifi, title: "Always Connected", desc: "WebRTC with TURN fallback ensures calls work everywhere", color: "text-cyan-500" },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                {...stagger}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <Card className="group hover:shadow-md hover:border-primary/20 transition-all duration-300">
                  <CardContent className="p-6">
                    <item.icon className={`w-10 h-10 ${item.color} mb-4 group-hover:scale-110 transition-transform duration-300`} />
                    <h3 className="font-semibold mb-2 text-lg">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-gradient-to-br from-primary via-primary to-blue-600 text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div {...fadeUp}>
            <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
              Ready to Break Language Barriers?
            </h2>
            <p className="text-xl opacity-90 mb-10 max-w-2xl mx-auto leading-relaxed">
              Join thousands of users who communicate freely across languages every day.
              Start your first translated call in under 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/login">
                <Button size="lg" variant="secondary" className="text-lg px-8 shadow-xl" data-testid="button-cta-signup">
                  Create Free Account
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="outline" className="text-lg px-8 border-white/30 text-white" data-testid="button-cta-contact">
                  Talk to Sales
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
