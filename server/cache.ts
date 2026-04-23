// In-memory cache layer (can be swapped for Redis in production)
// Provides session cache, presence status, and emotion state management

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private pubsubChannels = new Map<string, Set<(message: any) => void>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const entry: CacheEntry<T> = { value };
    if (ttlSeconds) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
    this.store.set(key, entry);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async hset(key: string, field: string, value: any): Promise<void> {
    let hash = await this.get<Record<string, any>>(key) || {};
    hash[field] = value;
    await this.set(key, hash);
  }

  async hget(key: string, field: string): Promise<any> {
    const hash = await this.get<Record<string, any>>(key);
    return hash?.[field] ?? null;
  }

  async hgetall(key: string): Promise<Record<string, any> | null> {
    return this.get<Record<string, any>>(key);
  }

  // Pub/Sub for real-time updates
  subscribe(channel: string, callback: (message: any) => void): void {
    if (!this.pubsubChannels.has(channel)) {
      this.pubsubChannels.set(channel, new Set());
    }
    this.pubsubChannels.get(channel)!.add(callback);
  }

  unsubscribe(channel: string, callback: (message: any) => void): void {
    this.pubsubChannels.get(channel)?.delete(callback);
  }

  publish(channel: string, message: any): void {
    this.pubsubChannels.get(channel)?.forEach(cb => cb(message));
  }

  // Cleanup expired entries periodically
  startCleanup(intervalMs = 60000): void {
    setInterval(() => {
      const now = Date.now();
      const entries = Array.from(this.store.entries());
      entries.forEach(([key, entry]) => {
        if (entry.expiresAt && now > entry.expiresAt) {
          this.store.delete(key);
        }
      });
    }, intervalMs);
  }
}

export const cache = new MemoryCache();
cache.startCleanup();

// Session Cache
export const sessionCache = {
  async setSession(userId: number, data: any, ttlSeconds = 3600): Promise<void> {
    await cache.set(`session:${userId}`, data, ttlSeconds);
  },
  async getSession(userId: number): Promise<any | null> {
    return cache.get(`session:${userId}`);
  },
  async clearSession(userId: number): Promise<void> {
    await cache.del(`session:${userId}`);
  },
};

// Presence Status
export const presenceCache = {
  async setOnline(userId: number, ttlSeconds = 300): Promise<void> {
    await cache.set(`presence:${userId}`, { status: 'online', lastSeen: Date.now() }, ttlSeconds);
    cache.publish('presence', { userId, status: 'online' });
  },
  async setOffline(userId: number): Promise<void> {
    await cache.set(`presence:${userId}`, { status: 'offline', lastSeen: Date.now() });
    cache.publish('presence', { userId, status: 'offline' });
  },
  async getPresence(userId: number): Promise<{ status: string; lastSeen: number } | null> {
    return cache.get(`presence:${userId}`);
  },
  async isOnline(userId: number): Promise<boolean> {
    const presence = await this.getPresence(userId);
    return presence?.status === 'online';
  },
  onPresenceChange(callback: (data: { userId: number; status: string }) => void): void {
    cache.subscribe('presence', callback);
  },
};

// Emotion State (for voice conversations)
export const emotionCache = {
  async setEmotion(conversationId: number, emotion: string, confidence: number): Promise<void> {
    const data = { emotion, confidence, updatedAt: Date.now() };
    await cache.set(`emotion:${conversationId}`, data, 1800); // 30 min TTL
    cache.publish('emotion', { conversationId, ...data });
  },
  async getEmotion(conversationId: number): Promise<{ emotion: string; confidence: number; updatedAt: number } | null> {
    return cache.get(`emotion:${conversationId}`);
  },
  onEmotionChange(callback: (data: { conversationId: number; emotion: string; confidence: number }) => void): void {
    cache.subscribe('emotion', callback);
  },
};

// Context Preloading
export const contextCache = {
  async preloadUserContext(userId: number, context: {
    user: any;
    organization?: any;
    voiceProfile?: any;
    recentConversations?: any[];
    systemPrompt?: string;
  }): Promise<void> {
    await cache.set(`context:${userId}`, context, 1800);
  },
  async getUserContext(userId: number): Promise<any | null> {
    return cache.get(`context:${userId}`);
  },
  async invalidateUserContext(userId: number): Promise<void> {
    await cache.del(`context:${userId}`);
  },
};
