import { Link } from "wouter";
import { LegalPage } from "./LegalPage";
import { POLICIES_UPDATED } from "./site-facts";

/** Own-voice translated speech: consent, limits, deletion. */
export default function VoicePolicyPage() {
  return (
    <LegalPage title="Voice and Consent Policy" updated={POLICIES_UPDATED} audience="How NeuraTalk's own-voice feature works and the rules for using it">
      <p>
        With the own-voice feature, the people you call hear the translation of your words in a voice that sounds like you. A voice is personal and
        can be misused, so this feature has stricter rules than the rest of NeuraTalk.
      </p>

      <h2>1. Only your own voice, only with your consent</h2>
      <ul>
        <li>NeuraTalk makes a voice only from recordings of <strong>you</strong>: samples you record in the app, or your speech during calls if
          you switch on "Learn my voice from calls".</li>
        <li>Learning from calls is <strong>off</strong> until you switch it on. You can switch it off at any time; we then stop collecting new speech.</li>
        <li>You must not upload or record anyone else's voice, imitate another person, or use a cloned voice to deceive anyone.</li>
        <li>Your cloned voice only ever speaks the translation of what you yourself said in a NeuraTalk call. It is not used to say anything
          else, it is not shared with other users, and it is not available through our API.</li>
      </ul>

      <h2>2. Who processes it</h2>
      <p>
        The voice is created and spoken by our voice provider ElevenLabs, under a contract that limits use to providing NeuraTalk. Speech
        recognition and translation are done by the providers listed in our <Link href="/privacy">Privacy Policy</Link>. We do not use your
        voice to train our own AI models.
      </p>

      <h2>3. Review</h2>
      <p>
        Our team may review a newly made voice to check it really is the account owner's own voice and is suitable to use. We may turn off or
        delete a voice that breaks this policy.
      </p>

      <h2>4. Turning it off and deleting it</h2>
      <ul>
        <li>In the app: More → Your voice. Switch the voice off to go back to a standard synthetic voice, or delete it.</li>
        <li>Deleting removes your samples from our storage and deletes the voice from the provider as well. It cannot be undone; to use the
          feature again you start fresh.</li>
        <li>Deleting your account deletes your voice too.</li>
      </ul>

      <h2>5. The people you call</h2>
      <p>
        The person on the other side hears an AI-generated voice that sounds like you, speaking a machine translation. It can make mistakes;
        see the <Link href="/translation-disclaimer">Translation Disclaimer</Link>. Calls are not recorded; see
        the <Link href="/recording-consent">Recording and Call Text</Link> page for what is kept.
      </p>

      <h2>6. Misuse</h2>
      <p>
        Using NeuraTalk to clone or imitate another person's voice, or to deceive anyone with a cloned voice, is a serious breach of
        our <Link href="/community-guidelines">Community Guidelines</Link>. We delete the voice, may ban the account, and may report it to the authorities.
        If you think someone is using your voice, use the <Link href="/report-abuse">Report Abuse</Link> page.
      </p>
    </LegalPage>
  );
}
