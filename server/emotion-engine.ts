import OpenAI from "openai";
import { cache } from "./cache";
import { getOpenAIKey } from "./openai-config";

const openai = new OpenAI({
  apiKey: getOpenAIKey() || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type EmotionType = "happy" | "calm" | "angry" | "sad" | "stressed" | "neutral";

export interface EmotionState {
  emotion: EmotionType;
  intensity: number;
  timestamp: number;
}

export interface EmotionContext {
  current: EmotionState;
  history: EmotionState[];
  trend: "improving" | "stable" | "declining";
}

const EMOTION_DETECTION_PROMPT = `Analyze the emotional state of the following message. Return ONLY a JSON object with these exact fields:
- "emotion": one of "happy", "calm", "angry", "sad", "stressed", "neutral"
- "intensity": a number from 0.0 to 1.0 indicating how strong the emotion is

Consider:
- Word choice and tone
- Punctuation (!!!, ???, ...)
- Caps usage
- Language patterns indicating frustration, joy, sadness, etc.
- Mixed language emotional expressions (Telugu/Hindi/English)

Examples:
"I'm so excited about this!!!" -> {"emotion": "happy", "intensity": 0.9}
"okay sure" -> {"emotion": "neutral", "intensity": 0.3}
"This is so frustrating, nothing works!" -> {"emotion": "angry", "intensity": 0.8}
"I don't know what to do anymore..." -> {"emotion": "sad", "intensity": 0.7}
"I have so much to do and no time" -> {"emotion": "stressed", "intensity": 0.6}

Message to analyze:`;

export async function detectEmotion(text: string): Promise<EmotionState> {
  // ── RULE-BASED DETECTION (works without any API key) ──────────────
  const ruleResult = detectEmotionRuleBased(text);

  // Try OpenAI for more nuanced detection, but don't depend on it
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content: "You are an emotion detection system. Output ONLY valid JSON, no other text.",
        },
        {
          role: "user",
          content: `${EMOTION_DETECTION_PROMPT}\n"${text}"`,
        },
      ],
      max_completion_tokens: 50,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content || '{"emotion": "neutral", "intensity": 0.5}';
    const parsed = JSON.parse(content);

    return {
      emotion: parsed.emotion || "neutral",
      intensity: Math.min(1, Math.max(0, parsed.intensity || 0.5)),
      timestamp: Date.now(),
    };
  } catch (error) {
    // OpenAI failed (key expired/missing) — use rule-based result
    return ruleResult;
  }
}

export function detectEmotionFast(text: string): EmotionState {
  return detectEmotionRuleBased(text);
}

/**
 * Rule-based emotion detection — works with ZERO external APIs.
 * Handles English, Hindi, Telugu, Tamil, and common multilingual patterns.
 * Not as nuanced as GPT, but gives honest results instead of "neutral" always.
 */
function detectEmotionRuleBased(text: string): EmotionState {
  const lower = text.toLowerCase().trim();
  const len = lower.length;

  // Punctuation analysis
  const exclamationCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  const capsRatio = len > 3 ? (text.replace(/[^A-Z]/g, "").length / len) : 0;
  const ellipsis = text.includes("...");

  // ── HAPPY patterns ──
  const happyWords = [
    // English
    "happy", "glad", "great", "awesome", "amazing", "wonderful", "love", "excited",
    "fantastic", "brilliant", "perfect", "yay", "hooray", "celebrate", "congrats",
    "thank", "thanks", "grateful", "blessed", "joy", "delighted", "thrilled",
    // Hindi
    "khushi", "khush", "maza", "bahut acha", "shandar", "badhai", "dhanyavad",
    "shukriya", "pyar", "anand", "mast", "zabardast",
    // Telugu
    "santosham", "chala baga", "bagundi", "superb", "dhanyavaadalu", "premaga",
    "anandanga", "manchidi",
    // Tamil
    "nandri", "romba nalla", "super", "mgizhchi",
    // Hindi script
    "खुशी", "बधाई", "धन्यवाद", "शुक्रिया", "मज़ा", "प्यार",
    // Telugu script
    "సంతోషం", "బాగుంది", "ధన్యవాదాలు", "ప్రేమ", "ఆనందం",
  ];

  // ── SAD patterns ──
  const sadWords = [
    "sad", "unhappy", "depressed", "disappointed", "miss", "lonely", "hurt",
    "crying", "cry", "tears", "lost", "gone", "died", "sorry", "regret",
    "heartbroken", "terrible", "worst", "awful",
    "dukh", "dard", "rona", "akela", "udas",
    "baadha", "edustunnanu", "vicharanga",
    "दुख", "दर्द", "रोना", "उदास", "अकेला",
    "బాధ", "ఏడుస్తున్నాను", "విచారంగా",
  ];

  // ── ANGRY patterns ──
  const angryWords = [
    "angry", "furious", "mad", "hate", "stupid", "idiot", "terrible",
    "worst", "useless", "annoying", "frustrated", "sick of", "fed up",
    "ridiculous", "pathetic", "disgusting", "unfair", "cheated",
    "gussa", "nafrat", "bakwas", "pagal", "bewakoof",
    "kopam", "chetta", "mosam", "daridranga",
    "गुस्सा", "नफ़रत", "बकवास", "पागल", "बेवकूफ",
    "కోపం", "చెడ్డ", "మోసం",
  ];

  // ── STRESSED patterns ──
  const stressedWords = [
    "stressed", "anxious", "worried", "overwhelmed", "panic", "nervous",
    "deadline", "urgent", "busy", "too much", "can't handle", "pressure",
    "tension", "pareshan", "chinta", "jaldi",
    "ఒత్తిడి", "చింత", "కంగారు",
    "टेंशन", "परेशान", "चिंता", "जल्दी",
  ];

  // ── CALM patterns ──
  const calmWords = [
    "calm", "peaceful", "relaxed", "okay", "fine", "alright", "cool",
    "no worries", "chill", "comfortable", "steady", "good",
    "shanti", "thik hai", "sab thik",
    "ప్రశాంతం", "బాగానే ఉంది",
    "शांति", "ठीक है", "सब ठीक",
  ];

  // Score each emotion
  let scores: Record<EmotionType, number> = {
    happy: 0, sad: 0, angry: 0, stressed: 0, calm: 0, neutral: 0.2,
  };

  for (const w of happyWords) {
    if (lower.includes(w)) scores.happy += w.length > 4 ? 1.5 : 1;
  }
  for (const w of sadWords) {
    if (lower.includes(w)) scores.sad += w.length > 4 ? 1.5 : 1;
  }
  for (const w of angryWords) {
    if (lower.includes(w)) scores.angry += w.length > 4 ? 1.5 : 1;
  }
  for (const w of stressedWords) {
    if (lower.includes(w)) scores.stressed += w.length > 4 ? 1.5 : 1;
  }
  for (const w of calmWords) {
    if (lower.includes(w)) scores.calm += w.length > 4 ? 1.5 : 1;
  }

  // Boost angry if ALL CAPS or lots of !!! 
  if (capsRatio > 0.5 && len > 5) scores.angry += 2;
  if (exclamationCount >= 3) scores.happy += 1;
  if (exclamationCount >= 3 && scores.angry > scores.happy) scores.angry += 1;
  if (ellipsis) scores.sad += 0.5;
  if (questionCount >= 2) scores.stressed += 0.5;

  // Find winner
  const entries = Object.entries(scores) as [EmotionType, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [topEmotion, topScore] = entries[0];

  // Calculate intensity from score (0-1 range)
  const maxPossible = 5;
  const intensity = Math.min(1, Math.max(0.2, topScore / maxPossible));

  return {
    emotion: topEmotion,
    intensity: topScore <= 0.2 ? 0.3 : intensity,
    timestamp: Date.now(),
  };
}

export function getEmotionCacheKey(sessionId: string): string {
  return `emotion:${sessionId}`;
}

export async function storeEmotionState(sessionId: string, state: EmotionState): Promise<void> {
  const key = getEmotionCacheKey(sessionId);
  const existing = await cache.get<EmotionContext>(key);

  const history = existing?.history || [];
  history.push(state);
  if (history.length > 10) {
    history.shift();
  }

  const trend = calculateEmotionTrend(history);

  const context: EmotionContext = {
    current: state,
    history,
    trend,
  };

  await cache.set(key, context, 3600);
  cache.publish(`emotion:${sessionId}`, context);
}

export async function getEmotionContext(sessionId: string): Promise<EmotionContext | null> {
  return cache.get<EmotionContext>(getEmotionCacheKey(sessionId));
}

function calculateEmotionTrend(history: EmotionState[]): "improving" | "stable" | "declining" {
  if (history.length < 3) return "stable";

  const positiveEmotions = ["happy", "calm"];
  const negativeEmotions = ["angry", "sad", "stressed"];

  const recentCount = Math.min(5, history.length);
  const recent = history.slice(-recentCount);
  const older = history.slice(-recentCount * 2, -recentCount);

  if (older.length === 0) return "stable";

  const recentPositive = recent.filter((s) => positiveEmotions.includes(s.emotion)).length;
  const olderPositive = older.filter((s) => positiveEmotions.includes(s.emotion)).length;

  const recentNegative = recent.filter((s) => negativeEmotions.includes(s.emotion)).length;
  const olderNegative = older.filter((s) => negativeEmotions.includes(s.emotion)).length;

  if (recentPositive > olderPositive && recentNegative < olderNegative) {
    return "improving";
  }
  if (recentNegative > olderNegative && recentPositive < olderPositive) {
    return "declining";
  }
  return "stable";
}

export function generateEmotionAwarePrompt(context: EmotionContext | null): string {
  if (!context) {
    return "";
  }

  const { current, trend } = context;
  const { emotion, intensity } = current;
  const strong = intensity > 0.7;

  let prompt = `\n\n[EMOTIONAL CONTEXT]\nUser mood: ${emotion} (${strong ? "strong" : "mild"}), Trend: ${trend}\n`;

  switch (emotion) {
    case "happy":
      prompt += `→ Match their energy! Be playful, celebrate with them
→ Use: "arre wah!", "that's so cool!", "love that!"
→ Faster pacing okay, more enthusiasm`;
      break;

    case "calm":
      prompt += `→ Keep it chill and steady
→ Don't over-energize - match their peaceful vibe
→ Comfortable silences are fine`;
      break;

    case "angry":
      prompt += `→ Validate first: "yeah that's frustrating..."
→ Stay calm but present - don't be dismissive
→ Let them vent before offering solutions
→ Shorter responses, give them space`;
      break;

    case "sad":
      prompt += `→ Lead with empathy: "that sounds really hard..."
→ Slower pace, softer words, more pauses
→ Don't rush to fix - just be there
→ Reduce information density`;
      break;

    case "stressed":
      prompt += `→ Ground them: "okay... let's slow down a bit"
→ Shorter sentences, more breathing room
→ One thing at a time - don't overwhelm
→ Reassuring presence over solutions`;
      break;

    case "neutral":
    default:
      prompt += `→ Warm, balanced conversation
→ Stay attentive to shifts`;
      break;
  }

  if (trend === "declining") {
    prompt += `\n[Their mood is dropping - be extra gentle]`;
  } else if (trend === "improving") {
    prompt += `\n[Mood improving - keep the positive energy]`;
  }

  return prompt;
}

export async function analyzeAndStoreEmotion(
  sessionId: string,
  text: string
): Promise<EmotionContext> {
  const state = await detectEmotion(text);
  await storeEmotionState(sessionId, state);
  const context = await getEmotionContext(sessionId);
  return context || { current: state, history: [state], trend: "stable" };
}
