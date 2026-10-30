/// Business categories (same list as BUSINESS_CATEGORIES on the server).
const kBusinessCategories = <String>[
  'Shopping & retail', 'Food & restaurant', 'Grocery', 'Clothing & fashion', 'Beauty, spa & salon',
  'Health & medical', 'Education', 'Automotive', 'Travel & transport', 'Hotel & lodging',
  'Finance & banking', 'Professional services', 'Real estate', 'Home services', 'Electronics',
  'Event planning', 'Entertainment', 'Non-profit', 'Public service', 'Other',
];

/// "retail" (older businesses) -> "Retail"; the listed categories are unchanged.
String businessCategoryLabel(Object? raw) {
  final text = raw?.toString().trim() ?? '';
  if (text.isEmpty) return '';
  return text[0].toUpperCase() + text.substring(1);
}

/// Chat labels a business can put on a conversation (WhatsApp Business style).
const kChatLabels = <String>['New customer', 'New order', 'Pending payment', 'Paid', 'Order complete', 'Follow up'];
