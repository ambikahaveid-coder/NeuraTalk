/// "₹1,200" / "₹12,34,567.50" -- Indian digit grouping, paise only when present.
String formatRupees(num paise) {
  final negative = paise < 0;
  final abs = paise.abs();
  final whole = abs ~/ 100;
  final cents = (abs % 100).round();
  final digits = whole.toString();
  String grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    final last3 = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last3';
  }
  return '${negative ? '-' : ''}₹$grouped${cents == 0 ? '' : '.${cents.toString().padLeft(2, '0')}'}';
}
