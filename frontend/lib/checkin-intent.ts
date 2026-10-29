/**
 * Map a spoken check-in answer to one of the keypad codes.
 *
 * THE TRANSCRIPT IS THE EVIDENCE; THE CODE IS DERIVED. What the senior
 * actually said is kept verbatim and shown to the coordinator alongside the
 * code, never replaced by it. That rule runs through the whole product — a
 * senior's own words are quoted, not interpreted — and it matters most here,
 * where a three-way code is a lossy summary of a sentence.
 *
 * "UNCLEAR" IS A REAL ANSWER. When nothing matches confidently this returns
 * null rather than the nearest option. A check-in that guesses is worse than
 * one that asks again, because the guess is indistinguishable downstream from
 * something the senior said.
 *
 * NEGATION FLIPS MEANING, and Hindi puts it after the word: "theek nahi" is
 * the opposite of "theek". A matcher that only looks at keywords reads that
 * sentence as reassurance, which is the single most damaging error this
 * function could make.
 */

export type Feeling = 1 | 2 | 3;      // 1 better, 2 same, 3 worse
export type YesNo = true | false;

export interface Match<T> {
  value: T | null;
  /** What the senior said, kept exactly. */
  transcript: string;
  /** The phrase that decided it, for showing the coordinator why. */
  matched?: string;
  negated?: boolean;
}

const NEG = [
  "nahi", "nahin", "nhi", "nai", "na", "not", "no", "never",
  "नहीं", "ना", "नइ",
];

/** Collapse spelling variants so one spelling does not miss a real answer. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:।"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whole-word containment.
 *
 * Plain `includes` is wrong here: "bad" is inside "badhiya", so a senior
 * saying "badhiya" (excellent) was being scored as feeling worse. Boundaries
 * are non-letters on both sides, and \p{L} covers Devanagari as well as Latin.
 */
function includesWord(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${esc}($|[^\\p{L}])`, "u").test(text);
}

/**
 * Phrases whose meaning ALREADY includes the negation. "koi badlav nahi" is
 * an assertion that nothing changed, so running the negation check over it
 * flips a calm answer into a complaint — the same trap as "neend nahi aayi"
 * in the Hindi cue lexicon.
 */
const INTRINSIC_NEG = new Set([
  "koi badlav nahi", "koi badlaav nahi", "koi farak nahi", "koi fark nahi",
  "no change", "कोई बदलाव नहीं", "कोई फ़र्क नहीं",
]);

function hasNegationNear(text: string, phrase: string, window = 22): boolean {
  if (INTRINSIC_NEG.has(phrase) || INTRINSIC_NEG.has(fold(phrase))) return false;
  phrase = fold(phrase);
  const i = text.indexOf(phrase);
  if (i < 0) return false;
  // Both directions: Hindi negates after the word, English before it.
  const around =
    text.slice(Math.max(0, i - window), i) +
    " " +
    text.slice(i + phrase.length, i + phrase.length + window);
  return NEG.some((n) => new RegExp(`(^|\\s)${n}(\\s|$)`).test(` ${around} `));
}

const WORSE = [
  // Hinglish / Hindi
  "kharab", "kharaab", "kharb", "bura", "bekar", "bekaar", "kamzor", "kamzori",
  "takleef", "taklif", "pareshan", "bigad", "bigaad", "dard", "dikkat",
  "thakan", "chakkar", "bukhar", "ulti", "saans phool", "neend nahi",
  "bhookh nahi", "khana nahi",
  "खराब", "बुरा", "कमज़ोर", "कमजोर", "तकलीफ़", "तकलीफ", "दर्द", "दिक्कत",
  "परेशान", "थकान", "चक्कर", "बुख़ार", "बुखार", "उल्टी",
  // English
  "worse", "bad", "badly", "weak", "weaker", "unwell", "poorly", "terrible",
  "awful", "pain", "painful", "ache", "aching", "headache", "tired",
  "exhausted", "dizzy", "dizziness", "giddy", "breathless", "short of breath",
  "feverish", "fever", "nauseous", "sick", "hurts", "hurting", "struggling",
  "worried", "cannot sleep", "can't sleep", "no appetite", "not hungry",
];

/**
 * EXPLICIT improvement only.
 *
 * A general "I'm fine" lives in SAME, not here. The three options are
 * relative to the senior's usual state, and "fine" asserts that nothing has
 * changed rather than that today is better. Reading plain reassurance as an
 * improvement would be a guess; reading it as "no change" is what was said.
 * Either way neither can cause the costly error, which is missing a "worse".
 */
const BETTER = [
  "behtar", "behtar hu", "behtar hun", "badhiya", "badiya", "sudhar",
  "pehle se accha", "pehle se theek", "aaram hai", "aaram mil raha",
  "बेहतर", "बढ़िया", "सुधार", "आराम", "पहले से अच्छा",
  "better", "much better", "improved", "improving", "improvement",
  "great", "excellent", "wonderful", "stronger", "recovering",
];

/**
 * No change, including plain reassurance.
 *
 * The "... nahi" forms are listed whole and marked intrinsic above, so the
 * negation inside them is read as part of the phrase rather than as a flip.
 * Everything here also flips cleanly to WORSE when negated: "not well",
 * "theek nahi", "accha nahi" all become a complaint, which is the behaviour
 * that matters most in this file.
 */
const SAME = [
  "koi badlav nahi", "koi badlaav nahi", "koi farak nahi", "koi fark nahi",
  "no change", "कोई बदलाव नहीं", "कोई फ़र्क नहीं",
  "waisa hi", "waisa", "wahi", "same", "koi badlav", "koi badlaav",
  "koi farak", "koi fark", "normal", "roz jaisa", "pehle jaisa", "theek",
  "thik", "theek hai", "thik hai", "theek hun", "thik hun", "usi tarah",
  "accha", "acha", "achha", "sab theek", "bas theek",
  "वैसा ही", "वैसा", "वही", "कोई बदलाव", "कोई फ़र्क", "ठीक", "सामान्य",
  "अच्छा", "सब ठीक", "ठीक हूँ", "ठीक हूं",
  "well", "fine", "good", "okay", "ok", "alright", "all right", "as usual",
  "nothing wrong", "no problem", "no complaints", "comfortable", "steady",
];

function search(text: string, list: string[]): string | undefined {
  // The needle is folded the same way the haystack was. Without this,
  // "can't sleep" never matches, because fold() has already turned the
  // spoken text into "can t sleep" and the pattern still has its apostrophe.
  // Longest first so "koi badlav" wins over "badlav".
  return [...list]
    .sort((a, b) => b.length - a.length)
    .find((p) => includesWord(text, fold(p)));
}

/**
 * How is the senior feeling? 1 better, 2 same, 3 worse.
 *
 * Order matters. "worse" is checked first because a sentence containing both
 * a complaint and a reassurance ("thoda theek hun par dard hai") is a
 * complaint. Under-reporting a concern is the costlier mistake here.
 */
export function matchFeeling(transcript: string): Match<Feeling> {
  const t = fold(transcript);
  if (!t) return { value: null, transcript };

  const worse = search(t, WORSE);
  if (worse && !hasNegationNear(t, worse)) {
    return { value: 3, transcript, matched: worse };
  }

  const better = search(t, BETTER);
  if (better) {
    // "accha nahi" is a complaint, not an improvement.
    if (hasNegationNear(t, better)) {
      return { value: 3, transcript, matched: better, negated: true };
    }
    return { value: 1, transcript, matched: better };
  }

  const same = search(t, SAME);
  if (same) {
    if (hasNegationNear(t, same)) {
      return { value: 3, transcript, matched: same, negated: true };
    }
    return { value: 2, transcript, matched: same };
  }

  // Said something, but nothing we can map. Ask again or use the keypad —
  // do not pick the closest option.
  return { value: null, transcript };
}

const YES = [
  "haan", "han", "ha", "haa", "ji haan", "ji", "yes", "yep", "yeah",
  "le li", "le liya", "li hai", "kha li", "kha liya", "liya", "taken", "took",
  "हाँ", "हां", "जी", "ले ली", "ले लिया", "खा ली", "लिया",
];

const NO = [
  "bhool gaya", "bhool gayi", "bhool", "nahi li", "nahi liya", "nahi khai",
  "abhi nahi", "nahi", "nahin", "nhi",
  "भूल गया", "भूल गयी", "भूल", "नहीं ली", "नहीं", "नहीं लिया", "अभी नहीं",
  "no", "nope", "forgot", "missed", "not yet", "have not", "haven't",
  "did not", "didn't", "skipped", "still pending",
];

/** Did they take their medicine? */
export function matchYesNo(transcript: string): Match<YesNo> {
  const t = fold(transcript);
  if (!t) return { value: null, transcript };

  // Negatives first: "nahi li" contains "li", so checking yes first inverts it.
  const no = search(t, NO);
  if (no) return { value: false, transcript, matched: no };

  const yes = search(t, YES);
  if (yes) {
    if (hasNegationNear(t, yes)) return { value: false, transcript, matched: yes, negated: true };
    return { value: true, transcript, matched: yes };
  }

  return { value: null, transcript };
}


/* ---- pain -------------------------------------------------------------- */

const PAIN_NONE = [
  "nahi", "nahin", "nhi", "koi dard nahi", "dard nahi", "bilkul nahi",
  "नहीं", "कोई दर्द नहीं", "दर्द नहीं",
  "no", "none", "no pain", "nothing", "not at all", "fine",
];

const PAIN_SOME = [
  "thoda", "thora", "halka", "kabhi kabhi", "kam",
  "थोड़ा", "हल्का", "कभी कभी", "कम",
  "a little", "a bit", "slight", "slightly", "mild", "sometimes", "some",
];

const PAIN_LOT = [
  "bahut", "zyada", "jyada", "tez", "bahut dard", "bardasht nahi",
  "बहुत", "ज़्यादा", "ज्यादा", "तेज़", "बहुत दर्द",
  "a lot", "lot of pain", "severe", "bad", "very", "too much", "unbearable",
  "terrible", "sharp",
];

/**
 * How much pain? 1 none, 2 a little, 3 a lot.
 *
 * Checked most-severe first, and a bare "haan"/"yes" counts as SOME rather
 * than NONE: answering yes to "do you have pain" is a report of pain, and the
 * amount is simply unstated.
 */
export function matchPain(transcript: string): Match<Feeling> {
  const t = fold(transcript);
  if (!t) return { value: null, transcript };

  const lot = search(t, PAIN_LOT);
  if (lot && !hasNegationNear(t, lot)) return { value: 3, transcript, matched: lot };

  const some = search(t, PAIN_SOME);
  if (some && !hasNegationNear(t, some)) return { value: 2, transcript, matched: some };

  const none = search(t, PAIN_NONE);
  if (none) return { value: 1, transcript, matched: none };

  // "haan" alone, with no amount given.
  const yes = search(t, ["haan", "han", "ha", "ji", "हाँ", "हां", "yes"]);
  if (yes && !hasNegationNear(t, yes)) return { value: 2, transcript, matched: yes };

  return { value: null, transcript };
}


/* ---- spoken digits ------------------------------------------------------ */

/**
 * The prompt reads "बेहतर के लिए एक, वैसा ही के लिए दो…", so the most likely
 * answer is the NUMBER, not a sentiment word. Without this the commonest
 * reply of all falls through to "we could not make that out".
 *
 * TWO TIERS, because speech-to-text mangles short words. "दो" comes back as
 * "tu", "to" or "do" depending on the speaker and the model, and "एक" as
 * "ek", "ik" or "ec". Those spellings are also ordinary words — "to" and "do"
 * especially — so they are only accepted when the whole utterance is
 * essentially just that word. A numeral, or an unmistakable number word, is
 * accepted anywhere.
 */
const DIGIT_CLEAR: Record<string, number> = {
  "1": 1, "2": 2, "3": 3,
  "एक": 1, "दो": 2, "तीन": 3,
  "one": 1, "two": 2, "three": 3,
  "teen": 3, "tеen": 3, "theen": 3,
};

/**
 * Phonetic families, not a spelling list.
 *
 * Listing individual mis-hearings never converges: "दो" has come back as
 * "tu", "to", "do" AND "तू" — the same sound written four ways across two
 * scripts. Each pattern below matches the sound family instead, in Latin and
 * Devanagari together.
 *
 * Only ever applied to a near-bare utterance, because several of these are
 * ordinary words: "to" and "do" in English, "तू" (you) in Hindi.
 */
const DIGIT_FUZZY: { re: RegExp; value: number }[] = [
  // ek — a front vowel then a k
  { re: /^(ek|ekk|ik|ec|aik|yek|एक|ऐक|इक|एख|अेक)$/u, value: 1 },
  // do — a dental stop then a back vowel. Voicing and length both wander.
  { re: /^(do|doh|dho|du|duh|to|toh|too|tu|tuh|two?|दो|दौ|दू|तो|तू|तु|टू|टो|डू|डो)$/u, value: 2 },
  // teen — a dental stop, a long i, then an n
  { re: /^(teen|tean|tee?n|tin|thin|theen|deen|din|तीन|तिन|टीन|तीण|दीन)$/u, value: 3 },
];

/**
 * @param allowed the codes this question actually offers, so "2" on a
 *   yes/no question is not accepted as an answer that was never on the menu.
 */
export function matchDigit(transcript: string, allowed: number[]): number | null {
  const t = fold(transcript);
  if (!t) return null;
  const tokens = t.split(" ").filter(Boolean);

  for (const tok of tokens) {
    const clear = DIGIT_CLEAR[tok];
    if (clear && allowed.includes(clear)) return clear;
  }

  // A bare answer: at most three tokens, e.g. "tu", "do ji", "number two".
  if (tokens.length <= 3) {
    for (const tok of tokens) {
      const hit = DIGIT_FUZZY.find((d) => d.re.test(tok));
      if (hit && allowed.includes(hit.value)) return hit.value;
    }
  }
  return null;
}
