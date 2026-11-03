import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/widgets/product_cards.dart';

void main() {
  final products = [
    {'id': 1, 'name': 'Kaju Barfi', 'pricePaise': 48000, 'imageUrl': null},
    {'id': 2, 'name': 'Carrot Halwa', 'pricePaise': null, 'imageUrl': null},
  ];

  testWidgets('shows name and price; Add to order adds that product', (tester) async {
    final added = <int>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ProductCardsView(
      products: products,
      isAvailable: (id) => id == 1,
      onAdd: (p) => added.add(p['id'] as int),
    ))));
    expect(find.text('Kaju Barfi'), findsOneWidget);
    expect(find.text('₹480'), findsOneWidget);
    expect(find.text('Price on request'), findsOneWidget);
    // Halwa is no longer in the catalog: no button, a clear note instead.
    expect(find.text('Add to order'), findsOneWidget);
    expect(find.text('Not available now'), findsOneWidget);
    await tester.tap(find.text('Add to order'));
    expect(added, [1]);
  });

  testWidgets('business side shows cards without order buttons', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ProductCardsView(products: products))));
    expect(find.text('Add to order'), findsNothing);
    expect(find.text('Carrot Halwa'), findsOneWidget);
  });

  testWidgets('no overflow with large phone text and long names', (tester) async {
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.6)),
      child: Scaffold(body: ProductCardsView(
        products: [{'id': 1, 'name': 'Special Dry Fruit Kaju Barfi with Silver Varq, 1 kg family box', 'pricePaise': 125050, 'imageUrl': null}],
        onAdd: (_) {},
      )),
    )));
    expect(tester.takeException(), isNull);
    expect(find.text('Add to order'), findsOneWidget);
  });

  test('prices: whole rupees without decimals, paise with two', () {
    expect(productPrice(45000), '₹450');
    expect(productPrice(45050), '₹450.50');
    expect(productPrice(null), 'Price on request');
  });
}
