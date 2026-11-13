import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/screens/chat_parity_screens.dart' show inviteCodeFrom;
import 'package:neuratalk/widgets/business_chat_extras.dart';
import 'package:neuratalk/widgets/chat_wallpaper.dart';

Widget _wrap(Widget child, {double scale = 1}) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(size: const Size(360, 780), textScaler: TextScaler.linear(scale)),
        child: Scaffold(body: SingleChildScrollView(child: SizedBox(width: 300, child: child))),
      ),
    );

void main() {
  final list = {
    'button': 'View menu',
    'sections': [
      {'title': 'Tiffins', 'rows': [{'id': 'idli', 'title': 'Idli', 'description': '2 pcs with chutney'}, {'id': 'dosa', 'title': 'Masala dosa'}]},
      {'title': 'Meals', 'rows': [{'id': 'thali', 'title': 'Andhra thali'}]},
    ],
  };

  testWidgets('list menu: button opens options; picking one replies with it', (tester) async {
    Map? picked;
    await tester.pumpWidget(_wrap(MessageListView(list: list, onPick: (r) => picked = r)));
    expect(find.text('View menu'), findsOneWidget);
    await tester.tap(find.text('View menu'));
    await tester.pumpAndSettle();
    expect(find.text('TIFFINS'), findsOneWidget);
    expect(find.text('2 pcs with chutney'), findsOneWidget);
    await tester.tap(find.text('Masala dosa'));
    await tester.pumpAndSettle();
    expect(picked?['id'], 'dosa');
  });

  testWidgets('list menu: once picked, options can no longer be chosen', (tester) async {
    Map? picked;
    await tester.pumpWidget(_wrap(MessageListView(list: list, pickedId: 'idli', onPick: (r) => picked = r)));
    await tester.tap(find.text('View menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Andhra thali'));
    await tester.pumpAndSettle();
    expect(picked, isNull);
  });

  testWidgets('contact card shows name, company and phone', (tester) async {
    await tester.pumpWidget(_wrap(const ContactCardView(contact: {'name': 'Delivery – Suresh', 'phone': '+91 98765 43210', 'organization': 'Our shop'})));
    expect(find.text('Delivery – Suresh'), findsOneWidget);
    expect(find.text('Our shop'), findsOneWidget);
    expect(find.text('+91 98765 43210'), findsOneWidget);
  });

  final payment = {
    'requestId': 1, 'amountPaise': 25050, 'note': '2 idli + dosa', 'upiId': 'srisaitiffins@okaxis',
    'payeeName': 'Sri Sai Tiffins', 'status': 'requested', 'upiLink': 'upi://pay?pa=srisaitiffins%40okaxis&am=250.50',
  };

  testWidgets('payment card: customer can pay or say they paid', (tester) async {
    await tester.pumpWidget(_wrap(PaymentCardView(payment: payment, businessId: 5)));
    expect(find.text('₹250.50'), findsOneWidget);
    expect(find.text('Pay with UPI app'), findsOneWidget);
    expect(find.text("I've paid"), findsOneWidget);
    expect(find.textContaining('srisaitiffins@okaxis'), findsOneWidget);
  });

  testWidgets('payment card: paid shows no buttons; business can confirm open ones', (tester) async {
    await tester.pumpWidget(_wrap(PaymentCardView(payment: {...payment, 'status': 'paid'}, businessId: 5)));
    expect(find.text('Pay with UPI app'), findsNothing);
    expect(find.text('Paid ✓'), findsOneWidget);
    String? settled;
    await tester.pumpWidget(_wrap(PaymentCardView(payment: {...payment, 'status': 'customer_paid'}, businessView: true, onSettle: (s) => settled = s)));
    expect(find.text('Customer says they paid · check your bank'), findsOneWidget);
    await tester.tap(find.text('Money received'));
    expect(settled, 'paid');
  });

  testWidgets('cards do not overflow with large phone text', (tester) async {
    await tester.pumpWidget(_wrap(Column(children: [
      PaymentCardView(payment: {...payment, 'note': 'A very long note about the family pack order'}, businessId: 5),
      const ContactCardView(contact: {'name': 'Our main branch in Guntur near the bus stand', 'phone': '+91 98765 43210', 'organization': 'Sri Sai Tiffins and Meals'}),
      MessageListView(list: list),
    ]), scale: 1.6));
    expect(tester.takeException(), isNull);
  });

  test('rupees text', () {
    expect(rupeesText(25050), '₹250.50');
    expect(rupeesText(10000), '₹100');
  });

  test('invite code from a link or a bare code', () {
    expect(inviteCodeFrom('https://neuratalk.in/g/SCDXM3DwolFE8oNy'), 'SCDXM3DwolFE8oNy');
    expect(inviteCodeFrom('neuratalk://g/SCDXM3DwolFE8oNy'), 'SCDXM3DwolFE8oNy');
    expect(inviteCodeFrom('Join my group: https://neuratalk.in/g/abcDEF12_-'), 'abcDEF12_-');
    expect(inviteCodeFrom('SCDXM3DwolFE8oNy'), 'SCDXM3DwolFE8oNy');
    expect(inviteCodeFrom('https://example.com/hello'), isNull);
  });

  testWidgets('every wallpaper draws in light and dark', (tester) async {
    for (final dark in [false, true]) {
      for (final p in wallpaperPresets) {
        await tester.pumpWidget(MaterialApp(
          theme: ThemeData(brightness: dark ? Brightness.dark : Brightness.light),
          home: SizedBox(width: 200, height: 300, child: WallpaperView(kind: 'preset', value: p.id, dim: 30)),
        ));
        expect(tester.takeException(), isNull);
      }
    }
    await tester.pumpWidget(const MaterialApp(home: WallpaperView(kind: 'color', value: '#1F6F5C')));
    expect(tester.takeException(), isNull);
  });
}
