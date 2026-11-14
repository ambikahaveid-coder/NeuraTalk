import 'dart:convert';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// End-to-end encryption for Private chats (server/private-chats.ts).
///
/// - This phone has one X25519 key pair. The private key stays in the phone's
///   secure storage (Android Keystore-backed) and never goes to the server.
/// - Each message gets a fresh AES-256-GCM key. That key is sealed for every
///   phone allowed to read it (the other person's and our own): a fresh
///   ephemeral X25519 key + HKDF-SHA256 gives a wrapping key per phone.
/// - The server only ever stores ciphertext and public keys.
class E2eCrypto {
  E2eCrypto({KeyStore? store}) : _store = store ?? SecureKeyStore();

  static final _x25519 = X25519();
  static final _aes = AesGcm.with256bits();
  static final _hkdf = Hkdf(hmac: Hmac.sha256(), outputLength: 32);
  static final _info = utf8.encode('neuratalk-private-chat-v1');

  final KeyStore _store;
  SimpleKeyPair? _pair;

  /// This phone's key pair, made on first use.
  Future<SimpleKeyPair> keyPair() async {
    if (_pair != null) return _pair!;
    final saved = await _store.read();
    if (saved != null) {
      _pair = await _x25519.newKeyPairFromSeed(base64Decode(saved));
    } else {
      final pair = await _x25519.newKeyPair();
      await _store.write(base64Encode(await pair.extractPrivateKeyBytes()));
      _pair = pair;
    }
    return _pair!;
  }

  Future<String> publicKey() async => base64Encode((await (await keyPair()).extractPublicKey()).bytes);

  /// Encrypts [plaintext] for each phone in [recipients] (key id → base64 public key).
  /// Returns the body for POST .../private/messages.
  Future<Map<String, dynamic>> encrypt(String plaintext, Map<String, String> recipients) async {
    final messageKey = await _aes.newSecretKey();
    final messageKeyBytes = await messageKey.extractBytes();
    final nonce = _aes.newNonce();
    final box = await _aes.encrypt(utf8.encode(plaintext), secretKey: messageKey, nonce: nonce);
    final keys = <String, dynamic>{};
    for (final entry in recipients.entries) {
      final recipient = SimplePublicKey(base64Decode(entry.value), type: KeyPairType.x25519);
      final ephemeral = await _x25519.newKeyPair();
      final ephemeralPublic = await ephemeral.extractPublicKey();
      final wrapKey = await _wrapKey(await _x25519.sharedSecretKey(keyPair: ephemeral, remotePublicKey: recipient), ephemeralPublic.bytes, recipient.bytes);
      final wrapNonce = _aes.newNonce();
      final wrapped = await _aes.encrypt(messageKeyBytes, secretKey: wrapKey, nonce: wrapNonce);
      keys[entry.key] = {
        'ephemeralPublicKey': base64Encode(ephemeralPublic.bytes),
        'nonce': base64Encode(wrapNonce),
        'wrapped': base64Encode([...wrapped.cipherText, ...wrapped.mac.bytes]),
      };
    }
    return {
      'ciphertext': base64Encode([...box.cipherText, ...box.mac.bytes]),
      'nonce': base64Encode(nonce),
      'keys': keys,
    };
  }

  /// Opens a message sealed for this phone's key [myKeyId]. Throws if it
  /// wasn't sealed for this phone or was tampered with.
  Future<String> decrypt(Map message, String myKeyId) async {
    final sealed = (message['keys'] as Map?)?[myKeyId] as Map?;
    if (sealed == null) throw const E2eNotForThisPhone();
    final pair = await keyPair();
    final myPublic = await pair.extractPublicKey();
    final ephemeral = SimplePublicKey(base64Decode('${sealed['ephemeralPublicKey']}'), type: KeyPairType.x25519);
    final wrapKey = await _wrapKey(await _x25519.sharedSecretKey(keyPair: pair, remotePublicKey: ephemeral), ephemeral.bytes, myPublic.bytes);
    final messageKeyBytes = await _aes.decrypt(_box(base64Decode('${sealed['wrapped']}'), base64Decode('${sealed['nonce']}')), secretKey: wrapKey);
    final clear = await _aes.decrypt(
      _box(base64Decode('${message['ciphertext']}'), base64Decode('${message['nonce']}')),
      secretKey: SecretKey(messageKeyBytes),
    );
    return utf8.decode(clear);
  }

  Future<SecretKey> _wrapKey(SecretKey shared, List<int> ephemeralPublic, List<int> recipientPublic) =>
      _hkdf.deriveKey(secretKey: shared, nonce: [...ephemeralPublic, ...recipientPublic], info: _info);

  static SecretBox _box(List<int> cipherAndMac, List<int> nonce) {
    if (cipherAndMac.length < 16) throw const FormatException('Too short');
    return SecretBox(cipherAndMac.sublist(0, cipherAndMac.length - 16), nonce: nonce, mac: Mac(cipherAndMac.sublist(cipherAndMac.length - 16)));
  }
}

class E2eNotForThisPhone implements Exception {
  const E2eNotForThisPhone();
}

/// Where the private key lives.
abstract class KeyStore {
  Future<String?> read();
  Future<void> write(String value);
}

class SecureKeyStore implements KeyStore {
  static const _key = 'neuratalk_e2e_private_key_v1';
  final _storage = const FlutterSecureStorage();
  @override
  Future<String?> read() => _storage.read(key: _key);
  @override
  Future<void> write(String value) => _storage.write(key: _key, value: value);
}

/// For tests.
class MemoryKeyStore implements KeyStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String v) async => value = v;
}
