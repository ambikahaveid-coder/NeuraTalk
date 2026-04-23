import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  Bot, Plus, Star, Users, Sparkles, Brain, Heart, 
  Briefcase, GraduationCap, Stethoscope, Code, ArrowLeft 
} from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Persona {
  id: number;
  name: string;
  description: string | null;
  systemPrompt: string;
  voiceId: string;
  category: string;
  personality: string;
  language: string;
  isPublic: boolean;
  usageCount: number;
  rating: number;
}

const categoryIcons: Record<string, any> = {
  general: Sparkles,
  business: Briefcase,
  education: GraduationCap,
  health: Stethoscope,
  technology: Code,
};

const personalityColors: Record<string, string> = {
  friendly: "bg-green-500",
  professional: "bg-blue-500",
  patient: "bg-purple-500",
  analytical: "bg-orange-500",
  empathetic: "bg-pink-500",
};

export default function AIPersonas() {
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    voiceId: "alloy",
    category: "general",
    personality: "friendly",
    language: "en",
    isPublic: false,
  });

  const { data: personasData, isLoading } = useQuery({
    queryKey: ["/api/features/personas"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/features/personas", formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/features/personas"] });
      setIsCreateOpen(false);
      setFormData({
        name: "",
        description: "",
        systemPrompt: "",
        voiceId: "alloy",
        category: "general",
        personality: "friendly",
        language: "en",
        isPublic: false,
      });
    },
  });

  const usePersonaMutation = useMutation({
    mutationFn: async (personaId: number) => {
      return apiRequest("POST", `/api/features/personas/${personaId}/use`);
    },
    onError: (error: Error) => {
      console.error("Failed to use persona:", error);
    },
  });

  const handleSelectPersona = (persona: Persona) => {
    usePersonaMutation.mutate(persona.id);
    setSelectedPersona(persona);
  };

  const handleStartChat = () => {
    if (selectedPersona) {
      navigate(`/dashboard?persona=${selectedPersona.id}`);
    }
  };

  const typedData = personasData as { public?: Persona[]; custom?: Persona[] } | undefined;
  const publicPersonas = typedData?.public || [];
  const customPersonas = typedData?.custom || [];

  const voices = [
    { id: "alloy", name: "Alloy - Neutral" },
    { id: "echo", name: "Echo - Warm" },
    { id: "fable", name: "Fable - British" },
    { id: "onyx", name: "Onyx - Deep" },
    { id: "nova", name: "Nova - Friendly" },
    { id: "shimmer", name: "Shimmer - Clear" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate("/dashboard")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">AI Personas</h1>
            <p className="text-muted-foreground">Choose or create custom AI personalities</p>
          </div>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-persona">
              <Plus className="w-4 h-4 mr-2" />
              Create Persona
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create AI Persona</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  placeholder="My Custom Assistant"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  data-testid="input-persona-name"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Input
                  placeholder="A helpful assistant for..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  data-testid="input-persona-description"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">System Prompt</label>
                <Textarea
                  placeholder="You are a helpful assistant that..."
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                  rows={4}
                  data-testid="input-persona-prompt"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Voice</label>
                  <Select 
                    value={formData.voiceId} 
                    onValueChange={(v) => setFormData({ ...formData, voiceId: v })}
                  >
                    <SelectTrigger data-testid="select-voice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {voices.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Category</label>
                  <Select 
                    value={formData.category} 
                    onValueChange={(v) => setFormData({ ...formData, category: v })}
                  >
                    <SelectTrigger data-testid="select-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                      <SelectItem value="education">Education</SelectItem>
                      <SelectItem value="health">Health</SelectItem>
                      <SelectItem value="technology">Technology</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Personality</label>
                <Select 
                  value={formData.personality} 
                  onValueChange={(v) => setFormData({ ...formData, personality: v })}
                >
                  <SelectTrigger data-testid="select-personality">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="patient">Patient</SelectItem>
                    <SelectItem value="analytical">Analytical</SelectItem>
                    <SelectItem value="empathetic">Empathetic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button 
                className="w-full" 
                onClick={() => createMutation.mutate()}
                disabled={!formData.name || !formData.systemPrompt || createMutation.isPending}
                data-testid="button-save-persona"
              >
                {createMutation.isPending ? "Creating..." : "Create Persona"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {customPersonas.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Your Personas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customPersonas.map((persona) => (
              <PersonaCard 
                key={persona.id} 
                persona={persona} 
                onSelect={handleSelectPersona}
                isSelected={selectedPersona?.id === persona.id}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Public Personas
        </h2>
        {publicPersonas.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Bot className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Public Personas Yet</h3>
              <p className="text-muted-foreground text-center">
                Create your own persona or check back later.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {publicPersonas.map((persona) => (
              <PersonaCard 
                key={persona.id} 
                persona={persona} 
                onSelect={handleSelectPersona}
                isSelected={selectedPersona?.id === persona.id}
              />
            ))}
          </div>
        )}
      </div>

      {selectedPersona && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
          <div className="container max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <p className="font-medium">Selected: {selectedPersona.name}</p>
              <p className="text-sm text-muted-foreground">{selectedPersona.description}</p>
            </div>
            <Button onClick={handleStartChat} data-testid="button-start-with-persona">
              Start Chat with {selectedPersona.name}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaCard({ 
  persona, 
  onSelect,
  isSelected 
}: { 
  persona: Persona; 
  onSelect: (p: Persona) => void;
  isSelected: boolean;
}) {
  const CategoryIcon = categoryIcons[persona.category] || Sparkles;
  
  return (
    <Card 
      className={`cursor-pointer hover-elevate transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={() => onSelect(persona)}
      data-testid={`card-persona-${persona.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <CategoryIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{persona.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {persona.category}
                </Badge>
                <div className={`w-2 h-2 rounded-full ${personalityColors[persona.personality] || "bg-gray-500"}`} />
              </div>
            </div>
          </div>
          {persona.isPublic && (
            <Badge variant="outline" className="text-xs">
              <Users className="w-3 h-3 mr-1" />
              Public
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="line-clamp-2">
          {persona.description || persona.systemPrompt.slice(0, 100)}...
        </CardDescription>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3" />
            {persona.rating || 0}
          </span>
          <span>{persona.usageCount} uses</span>
          <span>Voice: {persona.voiceId}</span>
        </div>
      </CardContent>
    </Card>
  );
}
