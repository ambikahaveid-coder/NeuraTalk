enum PushTargetType { personalChat, groupChat }

class PushTarget {
  const PushTarget({required this.type, required this.id});

  final PushTargetType type;
  final int id;

  static PushTarget? fromData(Map<String, dynamic> data) {
    final type = data['type'];
    final idValue = type == 'personal_chat_message'
        ? data['threadId']
        : type == 'group_chat_message'
            ? data['groupId']
            : null;
    final id = int.tryParse(idValue?.toString() ?? '');
    if (id == null || id <= 0) return null;

    return PushTarget(
      type: type == 'personal_chat_message'
          ? PushTargetType.personalChat
          : PushTargetType.groupChat,
      id: id,
    );
  }
}
