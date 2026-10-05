/** Shared website and staff chat contract. Customer sessions expose only their conversation. */
export interface ChatSettings {
  enabled: boolean;
  automaticAnswers: boolean;
  buttonLabel: string;
  greeting: string;
  offlineMessage: string;
  notificationsEnabled: boolean;
}

export const defaultChatSettings: ChatSettings = {
  enabled: true,
  automaticAnswers: true,
  buttonLabel: 'Ask us',
  greeting: 'Hi, welcome. What would you like to know?',
  offlineMessage: 'Leave your question and a way to reach you. The showroom team will pick it up when they’re available.',
  notificationsEnabled: true,
};

export interface ChatAvailability {
  staffOnline: boolean;
  showroomState: 'open' | 'closed' | 'unknown';
  nextOpening: string | null;
}

export interface ChatPublicConfig {
  settings: ChatSettings;
  availability: ChatAvailability;
  dealerName: string;
}

export interface ChatVehicle {
  id: string;
  title: string;
  registration: string | null;
  price: number | null;
  imageUrl: string | null;
  url: string;
}

export interface ChatAction {
  label: string;
  href: string;
  kind: 'book_test_drive' | 'reserve' | 'vehicle' | 'contact';
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  authorRole: 'customer' | 'assistant' | 'staff';
  authorName: string;
  body: string;
  createdAt: string;
  actions: ChatAction[];
  clientMessageId: string | null;
}

export interface ChatConversation {
  id: string;
  reference: string;
  vehicle: ChatVehicle | null;
  enquiryId: string | null;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  status: 'assistant' | 'waiting_staff' | 'with_staff' | 'resolved';
  assignedToId: string | null;
  assignedToName: string | null;
  callbackRequested: boolean;
  unreadCount: number;
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ChatConversationView {
  conversation: ChatConversation;
  messages: ChatMessage[];
  availability: ChatAvailability;
}

export interface ChatSession extends ChatConversationView {
  sessionToken: string;
}

export interface ChatInbox {
  conversations: ChatConversation[];
  totalUnread: number;
  staffOnline: boolean;
}
