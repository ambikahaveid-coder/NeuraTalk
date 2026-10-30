/// Phone numbers as people read them: "+91 81255 57378", not "+918125557378".
/// Anything that isn't a recognisable number is returned unchanged.
String prettyPhone(Object? raw) {
  final text = raw?.toString().trim() ?? '';
  if (text.isEmpty) return '';
  final digits = text.replaceAll(RegExp(r'[^0-9]'), '');
  // Indian mobile/landline: +91 followed by 10 digits.
  if (digits.length == 12 && digits.startsWith('91')) {
    return '+91 ${digits.substring(2, 7)} ${digits.substring(7)}';
  }
  if (digits.length == 10 && !text.startsWith('+')) {
    return '${digits.substring(0, 5)} ${digits.substring(5)}';
  }
  return text;
}
