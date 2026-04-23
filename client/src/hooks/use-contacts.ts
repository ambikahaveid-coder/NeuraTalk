import { useState, useCallback, useEffect } from 'react';
import { useAuth, getAuthToken } from './use-auth';

export interface Contact {
  id: number;
  name: string;
  identifier: string;
  language?: string;
  isFavorite?: boolean;
  lastCalledAt?: string | null;
  avatarUrl?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const API_BASE = '';

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();

  // Load contacts from server (with localStorage as offline cache)
  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch('/api/contacts');
      setContacts(data.contacts || []);
      // Cache in localStorage for offline access
      localStorage.setItem('neuratalk_contacts', JSON.stringify(data.contacts || []));
    } catch (error) {
      console.warn('[Contacts] Server fetch failed, loading from cache:', error);
      try {
        const saved = localStorage.getItem('neuratalk_contacts');
        if (saved) setContacts(JSON.parse(saved));
      } catch {}
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadContacts();
  }, [user, loadContacts]);

  // Add a new contact — saves to server
  const addContact = useCallback(async (name: string, identifier: string, language?: string): Promise<Contact | null> => {
    try {
      const data = await apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ name, identifier, language }),
      });
      const newContact = data.contact;
      setContacts(prev => {
        const updated = [...prev, newContact];
        localStorage.setItem('neuratalk_contacts', JSON.stringify(updated));
        return updated;
      });
      return newContact;
    } catch (error) {
      console.error('[Contacts] Add failed:', error);
      return null;
    }
  }, []);

  // Update contact — saves to server
  const updateContact = useCallback(async (id: number, updates: Partial<Contact>) => {
    try {
      const data = await apiFetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      setContacts(prev => {
        const updated = prev.map(c => c.id === id ? data.contact : c);
        localStorage.setItem('neuratalk_contacts', JSON.stringify(updated));
        return updated;
      });
    } catch (error) {
      console.error('[Contacts] Update failed:', error);
    }
  }, []);

  // Delete contact — removes from server
  const deleteContact = useCallback(async (id: number) => {
    try {
      await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' });
      setContacts(prev => {
        const updated = prev.filter(c => c.id !== id);
        localStorage.setItem('neuratalk_contacts', JSON.stringify(updated));
        return updated;
      });
    } catch (error) {
      console.error('[Contacts] Delete failed:', error);
    }
  }, []);

  // Find contact by identifier
  const findContact = useCallback((identifier: string): Contact | undefined => {
    return contacts.find(c => c.identifier === identifier);
  }, [contacts]);

  // Get contact by ID
  const getContact = useCallback((id: number): Contact | undefined => {
    return contacts.find(c => c.id === id);
  }, [contacts]);

  // Toggle favorite — server-synced
  const toggleFavorite = useCallback(async (id: number) => {
    try {
      const data = await apiFetch(`/api/contacts/${id}/favorite`, { method: 'POST' });
      setContacts(prev => {
        const updated = prev.map(c => c.id === id ? data.contact : c);
        localStorage.setItem('neuratalk_contacts', JSON.stringify(updated));
        return updated;
      });
    } catch (error) {
      console.error('[Contacts] Toggle favorite failed:', error);
    }
  }, []);

  // Record call — server-synced
  const recordCall = useCallback(async (id: number) => {
    try {
      await apiFetch(`/api/contacts/${id}/called`, { method: 'POST' });
    } catch (error) {
      console.error('[Contacts] Record call failed:', error);
    }
  }, []);

  // Get recent contacts (sorted by last called)
  const getRecentContacts = useCallback((limit = 5): Contact[] => {
    return [...contacts]
      .filter(c => c.lastCalledAt)
      .sort((a, b) => new Date(b.lastCalledAt!).getTime() - new Date(a.lastCalledAt!).getTime())
      .slice(0, limit);
  }, [contacts]);

  // Get favorite contacts
  const getFavoriteContacts = useCallback((): Contact[] => {
    return contacts.filter(c => c.isFavorite);
  }, [contacts]);

  return {
    contacts,
    isLoading,
    addContact,
    updateContact,
    deleteContact,
    findContact,
    getContact,
    toggleFavorite,
    recordCall,
    getRecentContacts,
    getFavoriteContacts,
    refresh: loadContacts,
  };
}
