enum PushTargetType { personalChat, groupChat, businessChat, businessInbox }

class PushTarget {
  const PushTarget({required this.type, required this.id, this.businessId});

  final PushTargetType type;
  final int id;
  /// For [PushTargetType.businessInbox]: the business the conversation belongs to.
  final int? businessId;

  static PushTarget? fromData(Map<String, dynamic> data) {
    final type = data['type'];
    final PushTargetType? targetType;
    final Object? idValue;
    switch (type) {
      case 'personal_chat_message':
        targetType = PushTargetType.personalChat;
        idValue = data['threadId'];
        break;
      case 'group_chat_message':
        targetType = PushTargetType.groupChat;
        idValue = data['groupId'];
        break;
      case 'business_message':
        targetType = PushTargetType.businessChat;
        idValue = data['businessId'];
        break;
      case 'business_inbox_message':
        final id = int.tryParse(data['conversationId']?.toString() ?? '');
        final businessId = int.tryParse(data['businessId']?.toString() ?? '');
        if (id == null || businessId == null) return null;
        return PushTarget(type: PushTargetType.businessInbox, id: id, businessId: businessId);
      default:
        return null;
    }
    final id = int.tryParse(idValue?.toString() ?? '');
    if (id == null || id <= 0) return null;
    return PushTarget(type: targetType, id: id);
  }
}