import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Settings, Shield, Phone, Video, CheckCircle, XCircle, Save, Trash2, RefreshCw, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface ConfigStatus {
  key: string;
  category: string;
  description: string;
  isSet: boolean;
  isClientSide: boolean;
  requiredForStatus: boolean;
}

interface CategorySummary {
  configured: boolean;
  keys: string[];
  requiredKeys: string[];
  setKeys: string[];
  missingKeys: string[];
}

interface ConfigResponse {
  configs: ConfigStatus[];
  summary: Record<string, CategorySummary>;
}

export default function PlatformConfigPage() {
  const { toast } = useToast();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: configData, isLoading, refetch } = useQuery<ConfigResponse>({
    queryKey: ["/api/admin/config/status"],
  });

  const setSecretMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await apiRequest("POST", "/api/admin/config/secret", { key, value });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Configuration Saved",
        description: data.message,
      });
      setEditingKey(null);
      setEditValue("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/config/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSecretMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("DELETE", "/api/admin/config/secret", { key });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Configuration Removed",
        description: "The secret has been deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/config/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testFirebaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/config/test-firebase", {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Firebase Ready" : "Firebase Not Ready",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
  });

  const testTurnMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/config/test-turn", {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "TURN Ready" : "TURN Not Ready",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
  });

  const categoryLabels: Record<string, { title: string; description: string }> = {
    firebase: { title: "Firebase", description: "Phone auth and admin credentials" },
    turn: { title: "TURN Server", description: "WebRTC relay and fallback traversal" },
    openai: { title: "OpenAI", description: "AI chat, translation, and speech models" },
    msg91: { title: "MSG91", description: "India-first OTP, SMS, and PSTN calling" },
    razorpay: { title: "Razorpay", description: "Payment processing and webhook signing" },
    azure: { title: "Azure", description: "Speech and translation fallback services" },
    livekit: { title: "LiveKit", description: "Realtime rooms, tokens, and SIP" },
    deepgram: { title: "Deepgram", description: "Optional speech recognition provider" },
    agora: { title: "Agora", description: "Optional real-time calling provider" },
    voice: { title: "ElevenLabs", description: "Premium voice synthesis fallback" },
  };

  const categoryOrder = ["firebase", "turn", "openai", "msg91", "razorpay", "azure", "livekit", "deepgram", "agora", "voice"];
  const groupedConfigs = categoryOrder
    .filter((category) => (configData?.configs || []).some((config) => config.category === category))
    .map((category) => ({
      category,
      meta: categoryLabels[category] || { title: category, description: "" },
      configs: (configData?.configs || []).filter((config) => config.category === category),
      summary: configData?.summary?.[category],
    }));

  const handleSave = (key: string) => {
    if (!editValue.trim()) {
      toast({
        title: "Error",
        description: "Please enter a value",
        variant: "destructive",
      });
      return;
    }
    setSecretMutation.mutate({ key, value: editValue });
  };

  const renderConfigItem = (config: ConfigStatus) => {
    const isEditing = editingKey === config.key;
    const isJson = config.key.includes("JSON");

    return (
      <div key={config.key} className="border rounded-lg p-4 space-y-3" data-testid={`config-item-${config.key}`}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{config.key}</span>
              {config.isSet ? (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Configured
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <XCircle className="w-3 h-3 mr-1" />
                  Not Set
                </Badge>
              )}
              {config.isClientSide && (
                <Badge variant="outline">Client-side</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{config.description}</p>
          </div>
          <div className="flex gap-2">
            {!isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingKey(config.key);
                  setEditValue("");
                }}
                data-testid={`btn-edit-${config.key}`}
              >
                {config.isSet ? "Update" : "Set"}
              </Button>
            )}
            {config.isSet && !isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteSecretMutation.mutate(config.key)}
                data-testid={`btn-delete-${config.key}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="space-y-2 pt-2 border-t">
            <Label>{isJson ? "Paste JSON content:" : "Enter value:"}</Label>
            {isJson ? (
              <Textarea
                placeholder="Paste your service account JSON here..."
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={8}
                className="font-mono text-xs"
                data-testid={`input-${config.key}`}
              />
            ) : (
              <Input
                type={
                  config.key.includes("CREDENTIAL") ||
                  config.key.includes("PASSWORD") ||
                  config.key.includes("SECRET") ||
                  config.key.includes("AUTH_KEY") ||
                  config.key.endsWith("_KEY")
                    ? "password"
                    : "text"
                }
                placeholder={`Enter ${config.description}`}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                data-testid={`input-${config.key}`}
              />
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleSave(config.key)}
                disabled={setSecretMutation.isPending}
                data-testid={`btn-save-${config.key}`}
              >
                <Save className="w-4 h-4 mr-1" />
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingKey(null);
                  setEditValue("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin">
          <Button variant="ghost" size="icon" data-testid="btn-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6" />
            Platform Configuration
          </h1>
          <p className="text-muted-foreground">Manage Firebase, TURN server, and other platform settings</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Phone className="w-5 h-5" />
              Firebase Phone Auth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Badge variant={configData?.summary?.firebase?.configured ? "default" : "secondary"}>
                {configData?.summary?.firebase?.configured ? "Configured" : "Not Configured"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testFirebaseMutation.mutate()}
                disabled={testFirebaseMutation.isPending}
                data-testid="btn-test-firebase"
              >
                Test
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Video className="w-5 h-5" />
              TURN Server
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Badge variant={configData?.summary?.turn?.configured ? "default" : "secondary"}>
                {configData?.summary?.turn?.configured ? "Configured" : "Not Configured"}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testTurnMutation.mutate()}
                disabled={testTurnMutation.isPending}
                data-testid="btn-test-turn"
              >
                Test
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        {groupedConfigs.map(({ category, meta, configs, summary }) => (
          <Card key={category}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{meta.title}</CardTitle>
                  <CardDescription>{meta.description}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={summary?.configured ? "default" : "secondary"}>
                    {summary?.configured ? "Configured" : "Missing Required Keys"}
                  </Badge>
                  {category === "firebase" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testFirebaseMutation.mutate()}
                      disabled={testFirebaseMutation.isPending}
                      data-testid="btn-test-firebase-inline"
                    >
                      Test
                    </Button>
                  )}
                  {category === "turn" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testTurnMutation.mutate()}
                      disabled={testTurnMutation.isPending}
                      data-testid="btn-test-turn-inline"
                    >
                      Test
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {summary?.missingKeys?.length ? (
                <div className="bg-muted p-3 rounded-lg text-xs text-muted-foreground">
                  Missing keys: {summary.missingKeys.join(", ")}
                </div>
              ) : null}
              <div className="space-y-3">
                {configs.map(renderConfigItem)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="outline" onClick={() => refetch()} data-testid="btn-refresh">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh Status
        </Button>
      </div>
    </div>
  );
}
