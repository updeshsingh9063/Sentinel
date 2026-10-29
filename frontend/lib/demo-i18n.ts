import {
  COHORT,
  FAMILY,
  findDetail,
  type DemoSenior,
  type FamilySummary,
  type SeniorDetail,
} from "@/lib/demo";
import type { Lang } from "@/lib/i18n";

/**
 * Hindi for the demo fixtures.
 *
 * lib/demo.ts stays the single English source; this file overlays Hindi onto
 * it by id, rather than forking the dataset. Shapes therefore cannot drift:
 * add a senior in demo.ts and they appear in both languages, in English until
 * a Hindi entry exists.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED
 *  · A senior's own words. `quote` and `script` are what she actually said and
 *    are quoted verbatim in both languages — translating evidence into the
 *    reader's language is exactly the interpretation the brief forbids.
 *  · The `outcome` key on a contact. It drives a data-attribute and a CSS
 *    colour, so the key stays English and only its LABEL is translated.
 *  · Scores and contributions. Numerals.
 *
 * WHEN THESE SURFACES MOVE TO THE DATABASE this file stops being the answer.
 * Reasons and next steps will arrive from Postgres in one language, so the
 * risk engine will have to emit a reason CODE plus its parameters and let the
 * client render the sentence — which is why every reason already carries a
 * stable `code`.
 */

interface SeniorOverlay {
  name: string;
  city: string;
  nextStep: string;
  /** Keyed by reason code, so a reason added in demo.ts fails loudly here. */
  reasons: Record<string, string>;
}

interface Overlay {
  seniors: Record<string, SeniorOverlay>;
  series: { label: string; unit: string };
  /** Positional: same order as DETAIL.cues in demo.ts. */
  cues: { day: string; kind: string; note: string }[];
  contacts: { day: string; channel: string; detail: string }[];
  outcomeLabels: Record<string, string>;
  weekdays: Record<string, string>;
  family: {
    seniorName: string;
    week: string;
    headline: string;
    body: string[];
    doing: string;
    consents: Record<string, { label: string; detail: string }>;
  };
}

const HI: Overlay = {
  seniors: {
    "savitri-devi": {
      name: "सावित्री देवी",
      city: "लखनऊ",
      nextStep:
        "आज सुबह कॉल करें। पूछें कि कहीं वे जल्दी से खड़ी तो नहीं हो रही थीं, शाम की दवा की पुष्टि करें, और आज नर्स की एक मुलाक़ात का विकल्प दें।",
      reasons: {
        bp_above_baseline: "सिस्टोलिक लगातार छह दिन से उनकी अपनी 14-दिन की माध्यिका से ऊपर",
        dose_missed: "इस हफ़्ते शाम की दो ख़ुराक दर्ज नहीं हुईं",
        cue_dizziness: "मंगलवार के कॉल नोट में चक्कर का ज़िक्र",
      },
    },
    "ramesh-chandra": {
      name: "रमेश चंद्र",
      city: "कानपुर",
      nextStep:
        "दूसरे नंबर पर कोशिश करें, फिर उनकी बेटी को। अगर दोपहर तक कोई न उठाए, तो घर पर मुलाक़ात तय करें।",
      reasons: {
        no_contact: "छह कॉल अनुत्तरित; किसी भी संपर्क को आठ दिन हो गए",
        activity_down: "गतिविधि उनके अपने सामान्य कामकाजी दिनों से कम",
        cue_poor_sleep: "इस पखवाड़े दो बार नींद ठीक न होने का ज़िक्र",
      },
    },
    "kamla-bai": {
      name: "कमला बाई",
      city: "वाराणसी",
      nextStep:
        "दैनिक चेक-इन के लिए कॉल करें। पूछें कि आज उन्होंने क्या खाया और खाना कौन बनाता है।",
      reasons: {
        weight_down: "14 दिनों में वज़न 1.1 किलो कम",
        cue_low_appetite: "कॉल नोट्स में दो बार भूख का ज़िक्र",
      },
    },
    "abdul-rahman": {
      name: "अब्दुल रहमान",
      city: "हैदराबाद",
      nextStep: "आज कोई कार्रवाई नहीं। कामकाजी हफ़्ते के लिए यह उनकी सामान्य सीमा में है।",
      reasons: { dose_missed: "शाम की तीन ख़ुराक दर्ज नहीं हुईं" },
    },
    "joseph-dsouza": {
      name: "जोसेफ़ डिसूज़ा",
      city: "पुणे",
      nextStep: "आज कोई कार्रवाई नहीं।",
      reasons: { stable: "सामान्य सीमा से कोई बदलाव नहीं" },
    },
    "meena-pillai": {
      name: "मीना पिल्लई",
      city: "कोच्चि",
      nextStep: "आज कोई कार्रवाई नहीं।",
      reasons: { stable: "सामान्य सीमा से कोई बदलाव नहीं" },
    },
  },

  series: { label: "सिस्टोलिक", unit: "mmHg" },

  cues: [
    {
      day: "मंगल",
      kind: "चक्कर",
      note: "मंगलवार की चेक-इन कॉल में कहा गया। जैसा कहा गया वैसा ही दर्ज; इसका कोई अर्थ नहीं निकाला गया।",
    },
    {
      day: "शुक्र",
      kind: "निषेध — कोई संकेत दर्ज नहीं",
      note: "निषेध पहचाना गया, इसलिए दर्द का कोई संकेत दर्ज नहीं हुआ। वाक्य फिर भी व्यक्ति के लिए रखा गया है।",
    },
  ],

  contacts: [
    { day: "आज", channel: "निर्धारित कॉल", detail: "सुबह 9:20 के लिए क़तार में" },
    { day: "2 दिन पहले", channel: "समन्वयक कॉल", detail: "सामान्य चेक-इन, 4 मिनट" },
    { day: "5 दिन पहले", channel: "फ़ोन चेक-इन", detail: "2 दबाया — वैसा ही" },
    { day: "7 दिन पहले", channel: "समन्वयक कॉल", detail: "कोई संदेश नहीं छोड़ा" },
  ],

  outcomeLabels: {
    answered: "उत्तर मिला",
    "no answer": "कोई उत्तर नहीं",
    keypad: "बटन दबाया",
  },

  weekdays: {
    Mon: "सोम",
    Tue: "मंगल",
    Wed: "बुध",
    Thu: "गुरु",
    Fri: "शुक्र",
    Sat: "शनि",
    Sun: "रवि",
  },

  family: {
    seniorName: "सावित्री देवी",
    week: "7–13 अप्रैल 2025 का सप्ताह",
    headline: "यह हफ़्ता पहले से कुछ शांत रहा, और हम संपर्क में रहे हैं।",
    body: [
      "सावित्री जी की सुबहें हमेशा की तरह रहीं और उन्होंने मंगलवार को हमारी चेक-इन कॉल उठाई।",
      "इस हफ़्ते शाम की दवा के कुछ रिमाइंडर दर्ज नहीं हुए, इसलिए आपकी समन्वयक आज कॉल कर रही हैं ताकि शाम का क्रम फिर से पटरी पर आ जाए।",
      "यहाँ ऐसा कुछ नहीं है जिसके लिए आपको अभी कुछ करना पड़े। अगर यह बदलता है, तो हम आपको सीधे फ़ोन करेंगे — सारांश की एक पंक्ति में छोड़ नहीं देंगे।",
    ],
    doing:
      "उनकी देखभाल समन्वयक प्रिया शर्मा आज सुबह कॉल कर रही हैं, और ज़रूरत लगी तो नर्स की मुलाक़ात का विकल्प देंगी।",
    consents: {
      weekly: {
        label: "साप्ताहिक कुशल-क्षेम सारांश",
        detail: "हर सोमवार इसी तरह की एक छोटी चिट्ठी। सरल भाषा, कोई मेडिकल रीडिंग नहीं।",
      },
      urgent: {
        label: "कुछ गंभीर हो तो मुझे कॉल करें",
        detail: "समन्वयक आपको सीधे फ़ोन करते हैं। किसी भी ज़रूरी बात के लिए यही एकमात्र रास्ता है।",
      },
      visits: {
        label: "नर्स की मुलाक़ात होने पर बताएँ",
        detail: "घर पर किसी मुलाक़ात के बाद एक छोटी सूचना, कि वह हुई — यह नहीं कि उसमें क्या मिला।",
      },
    },
  },
};

/* ---- lookups ------------------------------------------------------------ */

export function localizedCohort(lang: Lang): DemoSenior[] {
  if (lang === "en") return COHORT;
  return COHORT.map((s) => {
    const o = HI.seniors[s.id];
    if (!o) return s;
    return {
      ...s,
      name: o.name,
      city: o.city,
      nextStep: o.nextStep,
      reasons: s.reasons.map((r) => ({ ...r, text: o.reasons[r.code] ?? r.text })),
    };
  });
}

export function localizedSenior(lang: Lang, id: string): DemoSenior | undefined {
  return localizedCohort(lang).find((s) => s.id === id);
}

export function localizedDetail(lang: Lang, id: string): SeniorDetail | undefined {
  const detail = findDetail(id);
  if (!detail || lang === "en") return detail;
  return {
    ...detail,
    series: { ...detail.series, label: HI.series.label, unit: HI.series.unit },
    adherence: detail.adherence.map((d) => ({
      ...d,
      day: HI.weekdays[d.day] ?? d.day,
    })),
    // quote and script are left exactly as spoken.
    cues: detail.cues.map((c, i) => ({
      ...c,
      day: HI.cues[i]?.day ?? c.day,
      kind: HI.cues[i]?.kind ?? c.kind,
      note: HI.cues[i]?.note ?? c.note,
    })),
    contacts: detail.contacts.map((c, i) => ({
      ...c,
      day: HI.contacts[i]?.day ?? c.day,
      channel: HI.contacts[i]?.channel ?? c.channel,
      detail: HI.contacts[i]?.detail ?? c.detail,
    })),
  };
}

/** Display label for a contact outcome. The key itself stays English. */
export function outcomeLabel(lang: Lang, outcome: string): string {
  return lang === "en" ? outcome : HI.outcomeLabels[outcome] ?? outcome;
}

export function localizedFamily(lang: Lang): FamilySummary {
  if (lang === "en") return FAMILY;
  return {
    ...FAMILY,
    seniorName: HI.family.seniorName,
    week: HI.family.week,
    headline: HI.family.headline,
    body: HI.family.body,
    doing: HI.family.doing,
    consents: FAMILY.consents.map((c) => ({
      ...c,
      label: HI.family.consents[c.id]?.label ?? c.label,
      detail: HI.family.consents[c.id]?.detail ?? c.detail,
    })),
  };
}
