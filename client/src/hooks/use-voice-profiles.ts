import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type VoiceProfile, type InsertVoiceProfile } from "@shared/schema";

export function useVoiceProfiles() {
  return useQuery({
    queryKey: [api.voiceProfiles.list.path],
    queryFn: async () => {
      const res = await fetch(api.voiceProfiles.list.path);
      if (!res.ok) throw new Error("Failed to fetch voice profiles");
      return await res.json() as VoiceProfile[];
    },
  });
}

export function useCreateVoiceProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertVoiceProfile) => {
      const res = await fetch(api.voiceProfiles.create.path, {
        method: api.voiceProfiles.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create voice profile");
      return await res.json() as VoiceProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.voiceProfiles.list.path] });
    },
  });
}
