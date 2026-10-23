/// Which app this build is: the customer app ("NeuraTalk") or the business
/// team app ("NeuraTalk Business"). Set at build time:
///   flutter build apk --flavor business --dart-define=APP_VARIANT=business
const String appVariant = String.fromEnvironment('APP_VARIANT', defaultValue: 'customer');
const bool isBusinessApp = appVariant == 'business';
const String appDisplayName = isBusinessApp ? 'NeuraTalk Business' : 'NeuraTalk';
