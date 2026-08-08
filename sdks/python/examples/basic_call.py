"""Sample app: OTP login, place a call, fetch and export the transcript.

Run with: python examples/basic_call.py
(requires NEURATALK_IDENTIFIER / NEURATALK_OTP env vars for a real run)
"""
import os

from neuratalk import NeuraTalkApiError, NeuraTalkClient


def main() -> None:
    client = NeuraTalkClient(base_url=os.environ.get("NEURATALK_BASE_URL", "https://neuratalk.in"))

    identifier = os.environ.get("NEURATALK_IDENTIFIER")
    otp = os.environ.get("NEURATALK_OTP")
    if not identifier or not otp:
        print("Set NEURATALK_IDENTIFIER and NEURATALK_OTP to run this example against a real server.")
        return

    result = client.verify_otp(identifier, "mobile", otp)
    authed = client.with_token(result["token"])

    try:
        session = authed.create_call(
            callee_identifier="+919876543210",
            call_type="voice",
            my_language="en",
            their_language="hi",
        )
        print("Call created:", session["callId"])

        transcript = authed.get_transcript(session["callId"])
        print(f"Transcript has {len(transcript)} segments")

        pdf_bytes = authed.export_transcript(session["callId"], "pdf")
        print(f"Exported PDF: {len(pdf_bytes)} bytes")
    except NeuraTalkApiError as e:
        print(f"API error {e.status}: {e}")


if __name__ == "__main__":
    main()
