/// Raised for any non-2xx NeuraTalk API response. [body] is the parsed JSON
/// error payload — its shape varies by module (there is no single error
/// envelope across the API: auth returns `{message}`/`{success, message}`,
/// calls/transcripts return `{error}`). Check defensively rather than
/// assuming one shape.
class NeuraTalkApiException implements Exception {
  final int status;
  final dynamic body;
  final String message;

  NeuraTalkApiException(this.status, this.body) : message = _extractMessage(body) ?? 'Request failed with status $status';

  static String? _extractMessage(dynamic body) {
    if (body is Map) {
      final message = body['message'];
      if (message is String) return message;
      final error = body['error'];
      if (error is String) return error;
    }
    return null;
  }

  @override
  String toString() => message;
}

class NeuraTalkNetworkException implements Exception {
  final Object cause;
  NeuraTalkNetworkException(this.cause);

  @override
  String toString() => 'Network error while calling the NeuraTalk API: $cause';
}
