import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  caller: {
    callId: string;
    callerId: string;
    callerName?: string;
    callType: "voice" | "video";
  } | null;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallRing({ caller, onAccept, onReject }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!caller) return;
    // Beep loop via Web Audio — no external asset needed
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let stopped = false;
    const playBeep = () => {
      if (stopped) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 480;
      osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    };
    playBeep();
    const id = setInterval(playBeep, 1500);

    // Vibration (mobile)
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);

    return () => {
      stopped = true;
      clearInterval(id);
      try { ctx.close(); } catch {}
    };
  }, [caller]);

  return (
    <AnimatePresence>
      {caller && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
          data-testid="incoming-call-ring"
        >
          <audio ref={audioRef} loop />
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-zinc-900 to-black border border-white/10 shadow-2xl p-8 text-center"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-primary mb-6 font-bold">
              Incoming {caller.callType === "video" ? "Video" : "Voice"} Call
            </p>

            <motion.div
              className="w-28 h-28 mx-auto rounded-full bg-primary/20 flex items-center justify-center mb-4 relative"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              <motion.div
                className="absolute inset-0 rounded-full bg-primary/20"
                animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              {caller.callType === "video" ? (
                <Video className="w-12 h-12 text-primary relative z-10" />
              ) : (
                <Phone className="w-12 h-12 text-primary relative z-10" />
              )}
            </motion.div>

            <h2 className="text-2xl font-bold text-white mb-1">
              {caller.callerName || caller.callerId}
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
              NeuraTalk · Translated call
            </p>

            <div className="flex items-center justify-center gap-8">
              <Button
                size="icon"
                variant="destructive"
                className="w-16 h-16 rounded-full shadow-lg"
                onClick={onReject}
                data-testid="button-reject-call"
              >
                <PhoneOff className="w-7 h-7" />
              </Button>
              <Button
                size="icon"
                className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/40 animate-pulse"
                onClick={onAccept}
                data-testid="button-accept-call"
              >
                <Phone className="w-7 h-7" />
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
