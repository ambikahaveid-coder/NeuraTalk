enum PushTargetType { personalChat, groupChat, businessChat }

class PushTarget {
  const PushTarget({required this.type, required this.id});

  final PushTargetType type;
  final int id;

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
      default:
        return null;
    }
    final id = int.tryParse(idValue?.toString() ?? '');
    if (id == null || id <= 0) return null;
    return PushTarget(type: targetType, id: id);
  }
}