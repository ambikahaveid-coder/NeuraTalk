/**
 * Call-translation bench: speed (first words) + naturalness/accuracy (blind judge) on everyday call sentences.
 *   npx tsx scripts/qa/translation-latency-bench.ts
 * Needs OPENAI_API_KEY; adds Azure OpenAI (India) when AZURE_OPENAI_ENDPOINT/_API_KEY/_DEPLOYMENT are set.
 */
import OpenAI, { AzureOpenAI } from "openai";
import { spokenInterpreterPrompt } from "../../server/token-streaming-translation";
const azure = process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT
  ? new AzureOpenAI({ endpoint: process.env.AZURE_OPENAI_ENDPOINT, apiKey: process.env.AZURE_OPENAI_API_KEY, deployment: process.env.AZURE_OPENAI_DEPLOYMENT, apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-10-21" })
  : null;
const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CASES: Array<[string, string, string]> = [
  ["en","te","Four o'clock works for me, see you then."],["en","te","Hey Kiran, how's it going? Did you reach home safely?"],
  ["en","te","I'm stuck in traffic, I'll be there in like ten minutes."],["en","te","No worries, take your time. Can you send me the location?"],
  ["en","te","My mom isn't feeling well, so I'll call you back later, okay?"],["te","en","సుష్మా, ఎలా ఉన్నావ్? అక్కడ వెదర్ ఎలా ఉంది?"],
  ["te","en","నేను ఆఫీస్ నుంచి ఇప్పుడే బయలుదేరాను, ఒక అరగంటలో కాల్ చేస్తా"],["te","en","అమ్మ నీ గురించి అడుగుతుంది, ఈ వీకెండ్ ఫ్రీ ఉన్నావా?"],["te","en","పర్లేదు, నేను మేనేజ్ చేస్తా, నువ్వు టెన్షన్ పడకు"]];
const MODELS = ["gpt-4.1-mini", "gpt-5.4-nano", ...(azure ? ["azure-india"] : [])];
async function run(model: string, f: string, t: string, x: string) {
  const t0 = Date.now(); let first = 0, out = "";
  if (model === "azure-india") {
    const st: any = await (azure!.chat.completions.create as any)({ model: process.env.AZURE_OPENAI_DEPLOYMENT, stream: true, temperature: 0, max_tokens: 200, messages: [{ role: "system", content: spokenInterpreterPrompt(f, t) }, { role: "user", content: x }] });
    for await (const c of st) { const d = c.choices?.[0]?.delta?.content; if (d) { if (!first) first = Date.now() - t0; out += d; } }
    return { out: out.trim(), first, total: Date.now() - t0 };
  }
  const five = model.startsWith("gpt-5");
  const body: any = { model, stream: true, messages: [{ role: "system", content: spokenInterpreterPrompt(f, t) }, { role: "user", content: x }] };
  if (five) { body.reasoning_effort = "none"; body.max_completion_tokens = 300; } else { body.temperature = 0; body.max_tokens = 200; }
  let s: any;
  try { s = await ai.chat.completions.create(body); } catch (e: any) { if (five) { body.reasoning_effort = "minimal"; s = await ai.chat.completions.create(body); } else throw e; }
  for await (const c of s) { const d = c.choices?.[0]?.delta?.content; if (d) { if (!first) first = Date.now() - t0; out += d; } }
  return { out: out.trim(), first, total: Date.now() - t0 };
}
async function judge(src: string, to: string, cands: string[]) {
  const L = "ABCD";
  const r = await ai.chat.completions.create({ model: "gpt-4.1", temperature: 0, response_format: { type: "json_object" }, messages: [
    { role: "system", content: `Native ${to === "te" ? "Hyderabad Telugu" : "American English"} speaker judging live call interpretation between friends. Score each 1-10 "nat" (sounds like a real person talking on a call, not bookish) and "acc" (meaning, names, numbers). JSON {"A":{"nat":n,"acc":n},...}` },
    { role: "user", content: `Said: ${src}\n` + cands.map((c, i) => `${L[i]}: ${c}`).join("\n") }] });
  return JSON.parse(r.choices[0].message.content!);
}
const agg: Record<string, { nat: number; acc: number; first: number[]; total: number[] }> = Object.fromEntries(MODELS.map((m) => [m, { nat: 0, acc: 0, first: [], total: [] }]));
for (const [i, [f, t, x]] of CASES.entries()) {
  const res: Record<string, { out: string; first: number; total: number }> = {};
  for (const m of MODELS) {
    const a = await run(m, f, t, x).catch((e) => ({ out: "ERR " + String(e.message).slice(0, 50), first: 9999, total: 9999 }));
    const b = await run(m, f, t, x).catch(() => a);
    res[m] = { out: a.out, first: Math.min(a.first, b.first), total: Math.min(a.total, b.total) };
  }
  const order = MODELS.map((_, k) => MODELS[(k + i) % MODELS.length]);
  const j = await judge(x, t, order.map((m) => res[m].out));
  console.log(`#${i + 1} ${f}->${t}`);
  order.forEach((m, k) => { const s = j["ABCD"[k]] ?? { nat: 0, acc: 0 }; agg[m].nat += s.nat; agg[m].acc += s.acc; agg[m].first.push(res[m].first); agg[m].total.push(res[m].total); console.log(`  ${m.padEnd(13)} ${s.nat}/${s.acc} ${res[m].first}ms: ${res[m].out}`); });
}
const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
console.log("=== summary");
for (const m of MODELS) { const v = agg[m]; console.log(`${m.padEnd(13)} natural ${(v.nat / 9).toFixed(1)}  accurate ${(v.acc / 9).toFixed(1)}  first words median ${med(v.first)}ms  full median ${med(v.total)}ms`); }
