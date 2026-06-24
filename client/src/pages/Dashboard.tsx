import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useConversations, useCreateConversation } from "@/hooks/use-chat";
import { useVoiceRecorder, useVoiceStream } from "@/ai_integrations/audio";
import { VoiceOrb } from "@/components/VoiceOrb";
import { ChatMessage } from "@/components/ChatMessage";
import { TypingIndicator } from "@/components/TypingIndicator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatePresence } from "framer-motion";
import { Menu, Plus, Settings, MessageSquare, LogOut, Globe, Users, Building2, Shield, Briefcase, User } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { USER_ROLES } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";

const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "te", name: "Telugu" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
];

type RoleConfig = Record<string, { icon: LucideIcon; label: string; color: string; bgColor: string }>;

const roleConfig: RoleConfig = {
  [USER_ROLES.ADMIN]: { icon: Shield, label: "Admin", color: "text-red-400", bgColor: "bg-red-500/10" },
  [USER_ROLES.BUSINESS]: { icon: Briefcase, label: "Business", color: "text-secondary", bgColor: "bg-secondary/10" },
  [USER_ROLES.CONSUMER]: { icon: User, label: "Personal", color: "text-primary", bgColor: "bg-primary/10" },
};

export default function Dashboard() {
  const { logout, user } = useAuth();
  const isAdmin = user?.role === USER_ROLES.SUPER_ADMIN;
  const isBusiness = user?.role === USER_ROLES.COMPANY_ADMIN || user?.role === USER_ROLES.AGENT;
  const isConsumer = user?.role === USER_ROLES.CONSUMER;
  
  const { data: conversations } = useConversations();
  const { mutate: createConversation } = useCreateConversation();
  
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("en");
  const [messages, setMessages] = useState<{role: 'user'|'assistant', text: string, timestamp: Date}[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "team" | "settings">("chat");
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const recorder = useVoiceRecorder();
  const stream = useVoiceStream({
    onUserTranscript: (text) => {
      setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
      setIsProcessing(true);
    },
    onSentence: () => {},
    onTranscript: () => {},
    onComplete: (fullText) => {
      setMessages(prev => [...prev, { role: 'assistant', text: fullText, timestamp: new Date() }]);
      setIsProcessing(false);
    },
    onError: (err) => {
      console.error("Stream error", err);
      setIsProcessing(false);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { data: allUsers } = useQuery<any[]>({
    queryKey: ['/api/users'],
    enabled: isAdmin,
  });

  const { data: orgMembers } = useQuery<any[]>({
    queryKey: ['/api/organizations', user?.organizationId, 'members'],
    enabled: isBusiness && !!user?.organizationId,
  });

  const getOrbState = () => {
    if (recorder.state === 'recording') return 'listening';
    if (stream.playbackState === 'playing') return 'speaking';
    return 'idle';
  };

  const handleOrbClick = async () => {
    if (!activeConversationId) {
      createConversation("New Conversation", {
        onSuccess: (newConv) => {
          setActiveConversationId(newConv.id);
        }
      });
      return;
    }

    if (recorder.state === 'idle' || recorder.state === 'stopped') {
      await recorder.startRecording();
    } else if (recorder.state === 'recording') {
      const blob = await recorder.stopRecording();
      await stream.streamVoiceResponse(`/api/conversations/${activeConversationId}/voice-stream`, blob);
    }
  };

  const currentRole = user?.role || USER_ROLES.CONSUMER;
  const RoleIcon = roleConfig[currentRole]?.icon || User;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={cn(
        "fixed lg:relative z-50 w-72 h-full bg-card/80 backdrop-blur-xl border-r border-white/5 transform transition-transform duration-300 ease-in-out flex flex-col",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="p-6 flex items-center justify-between border-b border-white/5">
          <h2 className="text-xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
            NeuraTalk
          </h2>
          <Button variant="ghost" size="icon" onClick={() => createConversation("New Chat")} data-testid="button-new-chat">
            <Plus className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-4 border-b border-white/5">
          <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg", roleConfig[currentRole]?.bgColor)}>
            <RoleIcon className={cn("w-4 h-4", roleConfig[currentRole]?.color)} />
            <span className={cn("text-sm font-medium", roleConfig[currentRole]?.color)}>
              {roleConfig[currentRole]?.label} Account
            </span>
          </div>
          {isBusiness && user?.organization && (
            <div className="mt-2 flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
              <Building2 className="w-3 h-3" />
              <span>{user.organization.name}</span>
            </div>
          )}
        </div>

        <div className="p-2 flex gap-1 border-b border-white/5">
          <button
            onClick={() => setActiveTab("chat")}
            data-testid="tab-chat"
            className={cn(
              "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1",
              activeTab === "chat" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5"
            )}
          >
            <MessageSquare className="w-3 h-3" />
            Chat
          </button>
          {(isAdmin || isBusiness) && (
            <button
              onClick={() => setActiveTab("team")}
              data-testid="tab-team"
              className={cn(
                "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1",
                activeTab === "team" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5"
              )}
            >
              <Users className="w-3 h-3" />
              {isAdmin ? "Users" : "Team"}
            </button>
          )}
          <button
            onClick={() => setActiveTab("settings")}
            data-testid="tab-settings"
            className={cn(
              "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1",
              activeTab === "settings" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5"
            )}
          >
            <Settings className="w-3 h-3" />
            Settings
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {activeTab === "chat" && conversations?.map((conv) => (
            <button
              key={conv.id}
              onClick={() => {
                setActiveConversationId(conv.id);
                setIsSidebarOpen(false);
                setMessages([]);
              }}
              data-testid={`conversation-${conv.id}`}
              className={cn(
                "w-full p-3 rounded-lg text-left transition-all flex items-center gap-3",
                activeConversationId === conv.id 
                  ? "bg-primary/10 text-primary border border-primary/20" 
                  : "hover:bg-white/5 text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageSquare className="w-4 h-4 opacity-70" />
              <div className="flex-1 truncate">
                <div className="font-medium truncate">{conv.title}</div>
                <div className="text-xs opacity-50">{formatDate(conv.createdAt)}</div>
              </div>
            </button>
          ))}

          {activeTab === "team" && isAdmin && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">All Users</h3>
              {allUsers?.map((u) => (
                <div 
                  key={u.id} 
                  className="p-3 rounded-lg bg-white/5 flex items-center gap-3"
                  data-testid={`user-${u.id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white text-sm font-bold">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{u.username}</div>
                    <Badge variant="outline" className="text-xs mt-1">
                      {roleConfig[u.role]?.label || u.role}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "team" && isBusiness && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">Team Members</h3>
              {orgMembers?.map((member) => (
                <div 
                  key={member.id} 
                  className="p-3 rounded-lg bg-white/5 flex items-center gap-3"
                  data-testid={`member-${member.id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center text-white text-sm font-bold">
                    {member.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{member.username}</div>
                  </div>
                </div>
              ))}
              {(!orgMembers || orgMembers.length === 0) && (
                <div className="text-center text-muted-foreground text-sm py-4">
                  No team members yet
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-white/5 space-y-3">
                <h3 className="text-sm font-semibold">Account Info</h3>
                <div className="text-xs text-muted-foreground space-y-2">
                  <div className="flex justify-between">
                    <span>Username:</span>
                    <span className="text-foreground">{user?.username}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Role:</span>
                    <span className="text-foreground">{roleConfig[currentRole]?.label}</span>
                  </div>
                  {user?.organization && (
                    <div className="flex justify-between">
                      <span>Organization:</span>
                      <span className="text-foreground">{user.organization.name}</span>
                    </div>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
                  <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Admin Controls
                  </h3>
                  <p className="text-xs text-muted-foreground mt-2">
                    You have access to manage all users and organizations.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-bold">
              {user?.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 truncate">{user?.username}</div>
            <Button variant="ghost" size="icon" onClick={logout} title="Logout" data-testid="button-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative">
        <header className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 z-10">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsSidebarOpen(true)} data-testid="button-menu">
            <Menu className="w-6 h-6" />
          </Button>
          
          <div className="flex-1" />

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md rounded-full px-3 py-1.5 border border-white/10">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <select 
                className="bg-transparent border-none text-sm focus:ring-0 text-foreground"
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                data-testid="select-language"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code} className="bg-card">{lang.name}</option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col relative">
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 md:px-16 py-20 space-y-4 scrollbar-hide">
            <AnimatePresence mode="popLayout">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  role={msg.role}
                  content={msg.text}
                  timestamp={msg.timestamp}
                />
              ))}
            </AnimatePresence>
            {isProcessing && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          <div className="absolute bottom-0 left-0 right-0 pb-8 pt-4 bg-gradient-to-t from-background via-background to-transparent">
            <div className="flex flex-col items-center">
              <VoiceOrb 
                state={getOrbState()} 
                onClick={handleOrbClick}
              />
              <p className="text-center mt-6 text-sm text-muted-foreground/70">
                {getOrbState() === 'idle' && "Tap to speak"}
                {getOrbState() === 'listening' && "Listening..."}
                {getOrbState() === 'speaking' && "Speaking..."}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
