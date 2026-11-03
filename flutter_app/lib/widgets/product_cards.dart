import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'chat_attachments.dart';

String productPrice(Object? paise) {
  final p = (paise as num?)?.toInt();
  if (p == null) return 'Price on request';
  final v = p / 100;
  return '₹${v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2)}';
}

/// Product cards a business sent (message type "product"): photo, name, price.
/// [onAdd] adds one to the customer's order; null on the business's side.
class ProductCardsView extends StatelessWidget {
  const ProductCardsView({super.key, required this.products, this.onAdd, this.isAvailable});
  final List<Map<String, dynamic>> products;
  final void Function(Map<String, dynamic> product)? onAdd;
  /// Whether the item can still be ordered (catalog as it is now). Null = unknown, assume yes.
  final bool Function(int itemId)? isAvailable;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: onAdd == null ? 184 : 232,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: products.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final p = products[i];
          final id = (p['id'] as num?)?.toInt() ?? 0;
          final available = isAvailable?.call(id) ?? true;
          return Container(
            width: 150,
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                height: 96,
                width: double.infinity,
                child: p['imageUrl'] is String
                    ? ChatImageAttachment(objectPath: p['imageUrl'] as String, name: '${p['name'] ?? 'product'}')
                    : Container(color: AppColors.blueTint, child: Icon(Icons.shopping_bag_outlined, color: AppColors.cyan, size: 36)),
              ),
              // Text takes what's left and shortens with "…" (large phone font sizes included).
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                    Flexible(
                      child: Text('${p['name'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 13.5)),
                    ),
                    Text(productPrice(p['pricePaise']), maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                  ]),
                ),
              ),
              if (onAdd != null) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(6, 0, 6, 6),
                  child: SizedBox(
                    width: double.infinity,
                    child: available
                        ? FilledButton.tonal(
                            style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
                            onPressed: () => onAdd!(p),
                            child: const Text('Add to order'),
                          )
                        : Text('Not available now', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  ),
                ),
              ],
            ]),
          );
        },
      ),
    );
  }
}
