/// Lines a user reads aloud to create their voice clone. Each takes about
/// 15-20 seconds to read, in the language the user actually speaks, so the
/// clone learns their real accent. Unknown languages fall back to English.
const Map<String, List<String>> _prompts = {
  'te': [
    'నమస్కారం! ఇది నా స్వంత గొంతు. నేను NeuraTalk కోసం దీన్ని రికార్డ్ చేస్తున్నాను. ఈ రోజు వాతావరణం చాలా బాగుంది, చల్లని గాలి వీస్తోంది.',
    'మా ఊరిలో ప్రతి ఆదివారం సంత జరుగుతుంది. అక్కడ తాజా కూరగాయలు, పండ్లు, పూలు దొరుకుతాయి. పిల్లలు, పెద్దలు అందరూ సంతోషంగా వస్తారు.',
    'మీరు ఏ భాషలో మాట్లాడినా, నా మాటలు మీకు నా గొంతులోనే వినిపిస్తాయి. ఇలా మనం సులభంగా మాట్లాడుకోవచ్చు. విన్నందుకు ధన్యవాదాలు!',
  ],
  'hi': [
    'नमस्ते! यह मेरी अपनी आवाज़ है, जो NeuraTalk के लिए रिकॉर्ड हो रही है। आज मौसम बहुत सुहाना है और ठंडी हवा चल रही है।',
    'हमारे शहर में हर रविवार बाज़ार लगता है। वहाँ ताज़ी सब्ज़ियाँ, फल और फूल मिलते हैं। बच्चे और बड़े सभी खुशी से आते हैं।',
    'आप किसी भी भाषा में बात करें, मेरी बातें आपको मेरी ही आवाज़ में सुनाई देंगी। इस तरह हम आसानी से बात कर सकते हैं। सुनने के लिए धन्यवाद!',
  ],
  'en': [
    'Hello! This is my own voice, recorded for NeuraTalk. The weather is lovely today, and a cool breeze is blowing through the trees.',
    'Every Sunday there is a market in our town. You can buy fresh vegetables, fruit and flowers there, and people of all ages come along.',
    'Whatever language you speak, you will hear my words in my own voice. That way we can talk to each other easily. Thank you for listening!',
  ],
};

List<String> voicePromptsFor(String? language) {
  final base = (language ?? 'en').toLowerCase().split(RegExp('[-_]')).first;
  return _prompts[base] ?? _prompts['en']!;
}
