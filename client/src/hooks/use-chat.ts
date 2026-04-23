import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type Conversation, type Message } from "@shared/schema";

type ConversationWithMessages = Conversation & { messages: Message[] };

export function useConversations() {
  return useQuery({
    queryKey: [api.chat.listConversations.path],
    queryFn: async () => {
      const res = await fetch(api.chat.listConversations.path);
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return await res.json() as Conversation[];
    },
  });
}

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: [api.chat.getConversation.path, id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) throw new Error("ID required");
      const url = buildUrl(api.chat.getConversation.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch conversation");
      return await res.json() as ConversationWithMessages;
    },
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title: string = "New Chat") => {
      const res = await fetch(api.chat.createConversation.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Failed to create conversation");
      return await res.json() as Conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.chat.listConversations.path] });
    },
  });
}
