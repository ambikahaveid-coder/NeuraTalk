import { useState } from "react";
import { useContacts } from "@/hooks/use-contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Phone, PhoneOff, Star, Trash2, Plus, Search,
  MessageCircle, Clock
} from "lucide-react";

interface ContactListProps {
  onCallContact?: (contactId: string, contactName: string) => void;
  onSelectContact?: (contactId: string) => void;
  showRecentOnly?: boolean;
  maxContacts?: number;
}

export function ContactList({
  onCallContact,
  onSelectContact,
  showRecentOnly = false,
  maxContacts = 50,
}: ContactListProps) {
  const { 
    contacts, 
    addContact, 
    deleteContact, 
    toggleFavorite,
    getRecentContacts,
    getFavoriteContacts,
  } = useContacts();

  const [searchQuery, setSearchQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactId, setNewContactId] = useState("");
  const [newContactLanguage, setNewContactLanguage] = useState("en");

  // Filter contacts based on search
  const displayedContacts = showRecentOnly
    ? getRecentContacts(maxContacts)
    : contacts
        .filter(c => 
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.identifier.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, maxContacts);

  const favorites = getFavoriteContacts();

  const handleAddContact = () => {
    if (!newContactName || !newContactId) {
      alert("Please enter contact name and identifier");
      return;
    }
    
    console.log(`[ContactList] Adding contact: ${newContactName}`);
    addContact(newContactName, newContactId, newContactLanguage);
    setNewContactName("");
    setNewContactId("");
    setNewContactLanguage("en");
    setShowAddForm(false);
  };

  const handleCall = (contactId: string, contactName: string) => {
    console.log(`[ContactList] Calling contact: ${contactName}`);
    onCallContact?.(contactId, contactName);
  };

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Contacts</h2>
        <Button
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </Button>
      </div>

      {/* Add Contact Form */}
      {showAddForm && (
        <Card className="bg-blue-50">
          <CardContent className="pt-6 space-y-3">
            <div>
              <label className="text-sm font-medium">Contact Name</label>
              <Input
                placeholder="e.g., Mom, Office Support"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Contact ID / Email</label>
              <Input
                placeholder="e.g., user@example.com or username"
                value={newContactId}
                onChange={(e) => setNewContactId(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                This is NOT shown to the other person - just for identification
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Preferred Language</label>
              <select 
                value={newContactLanguage} 
                onChange={(e) => setNewContactLanguage(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="en">English</option>
                <option value="te">Telugu</option>
                <option value="hi">Hindi</option>
                <option value="ta">Tamil</option>
                <option value="kn">Kannada</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddContact} className="flex-1">Save Contact</Button>
              <Button
                variant="outline"
                onClick={() => setShowAddForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {!showRecentOnly && (
        <div className="relative">
          <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Favorite Contacts */}
      {favorites.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
            Favorites
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {favorites.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onCall={handleCall}
                onSelect={onSelectContact}
                onDelete={deleteContact}
                onToggleFavorite={toggleFavorite}
                isFavorite={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent Contacts / All Contacts */}
      {displayedContacts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {showRecentOnly ? "Recent" : "All"} Contacts ({displayedContacts.length})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {displayedContacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onCall={handleCall}
                onSelect={onSelectContact}
                onDelete={deleteContact}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {contacts.length === 0 && (
        <Card className="text-center py-12">
          <MessageCircle className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No contacts yet</p>
          <p className="text-sm text-gray-400">Add your first contact to start calling with translation</p>
          <Button onClick={() => setShowAddForm(true)} className="mt-4">
            <Plus className="w-4 h-4 mr-2" />
            Add Your First Contact
          </Button>
        </Card>
      )}
    </div>
  );
}

interface ContactCardProps {
  contact: any;
  onCall: (id: string, name: string) => void;
  onSelect?: (id: string) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
  isFavorite?: boolean;
}

function ContactCard({
  contact,
  onCall,
  onSelect,
  onDelete,
  onToggleFavorite,
  isFavorite,
}: ContactCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-4">
          {/* Contact Info */}
          <div 
            className="flex-1 cursor-pointer"
            onClick={() => onSelect?.(contact.id)}
          >
            <div className="font-medium">{contact.name}</div>
            <div className="text-sm text-gray-500">
              {contact.lastCalled && (
                <>
                  Last call: {new Date(contact.lastCalled).toLocaleDateString()}
                </>
              )}
              {!contact.lastCalled && "Never called"}
            </div>
            {contact.language && (
              <Badge variant="secondary" className="mt-2 text-xs">
                {contact.language.toUpperCase()}
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleFavorite(contact.id)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Star 
                className={`w-5 h-5 ${
                  isFavorite 
                    ? "fill-yellow-400 text-yellow-400" 
                    : "text-gray-300"
                }`}
              />
            </button>
            <button
              onClick={() => onCall(contact.id, contact.name)}
              className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
              title="Call this contact"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete "${contact.name}"?`)) {
                  onDelete(contact.id);
                }
              }}
              className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
              title="Delete contact"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
