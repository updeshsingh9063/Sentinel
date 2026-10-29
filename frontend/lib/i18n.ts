/**
 * Landing-page copy in English and Hindi.
 *
 * The brief scores accessibility for Hindi-speaking users directly, so the
 * language switch has to change the page, not just highlight a word.
 *
 * WHY A COOKIE AND NOT CONTEXT: Hero, Dashboard and Sections are server
 * components — they call into lib/images.ts, which touches the filesystem and
 * must never reach a client bundle. So the language is read from a cookie on
 * the server and the whole page renders in that language. The switch itself is
 * a small client component that sets the cookie and refreshes. That also means
 * no flash of the wrong language, and a crawler sees real Hindi markup.
 *
 * `Copy` is an explicit interface rather than inferred from the English, so a
 * missing Hindi string is a compile error instead of a silent fallback to
 * English in the middle of a Hindi page.
 *
 * TWO RULES THE HINDI KEEPS, same as the English:
 *  1. Nothing names a condition. The strings describe what changed and what a
 *     person should do. "never diagnose" is translated as a promise, not
 *     softened into "usually does not diagnose".
 *  2. The product name stays "Samarth Sentinel" in both languages.
 */

export type Lang = "en" | "hi";

export const LANG_COOKIE = "samarth_lang";
export const LANGS: Lang[] = ["en", "hi"];

export function isLang(v: string | undefined | null): v is Lang {
  return v === "en" || v === "hi";
}

/**
 * Fill {placeholders} in a copy string.
 *
 * Copy is stored as templates rather than functions for one hard reason: a
 * server component passing copy to a client component serialises it, and a
 * function cannot cross that boundary — React throws "Functions cannot be
 * passed directly to Client Components". Templates keep every entry a plain
 * string, so the same dictionary works on both sides.
 */
export function fmt(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in vars ? String(vars[key]) : whole,
  );
}

interface Row {
  name: string;
  meta: string;
  levelLabel: string;
  reason: string;
  action: string;
}

interface Feature {
  title: string;
  body: string;
  lead?: string;
  lead2?: string;
  body2?: string;
}

interface Stat {
  /** Mostly numerals, which are not localised — but "~1 in 5" is prose. */
  value: string;
  body: string;
  source: string;
}

export interface Copy {
  /** Label for the OTHER language, shown on the switch. */
  switchLabel: string;
  /** Document title and description, used by the root layout. */
  meta: { title: string; description: string };
  nav: {
    home: string;
    how: string;
    features: string;
    impact: string;
    about: string;
    cta: string;
    menu: string;
    main: string;
    language: string;
  };
  hero: {
    eyebrow: string;
    subA: string;
    subB: string;
    body: string;
    promises: string[];
    seeHow: string;
    watch: string;
  };
  dash: {
    eyebrow: string;
    titleA: string;
    titleB: string;
    lede: string;
    points: string[];
    listHead: string;
    date: string;
    reason: string;
    action: string;
    whyTitle: string;
    whyBody: string;
    approach: string;
    sidebar: string[];
    userName: string;
    userRole: string;
    rows: Row[];
    videoHead: string;
    videoBody: string;
  };
  features: {
    eyebrow: string;
    title: string;
    link: string;
    items: Feature[];
  };
  impact: {
    eyebrow: string;
    titleA: string;
    titleB: string;
    stats: Stat[];
  };
  closing: {
    eyebrow: string;
    titleA: string;
    titleB: string;
    sub: string;
    cta: string;
    learn: string;
  };
  footer: {
    links: string[];
    tag: string;
    legal: string;
    nav: string;
  };
  chat: {
    open: string;
    title: string;
    note: string;
    greeting: string;
    suggestions: string[];
    placeholder: string;
    send: string;
    close: string;
    thinking: string;
    disclaimer: string;
    errorGeneric: string;
    errorRate: string;
    errorBusy: string;
    errorOff: string;
  };
}

const en: Copy = {
  switchLabel: "हिंदी",
  meta: {
    title: "Samarth Sentinel — early warning for seniors living at home",
    description:
      "Tells a Care Coordinator who needs attention today, why, and what to do next. Flags risk and routes it to a human, never diagnoses.",
  },
  nav: {
    home: "Home",
    how: "How It Works",
    features: "Features",
    impact: "Impact",
    about: "About",
    cta: "Get Started",
    menu: "Menu",
    main: "Main",
    language: "Language",
  },
  hero: {
    eyebrow: "Earlier attention. Safer tomorrows.",
    subA: "An early-warning system for",
    subB: "seniors living at home.",
    body: "Tell a Care Coordinator who needs attention today, why, and what to do next. Flag risk and route it to a human, never diagnose.",
    promises: ["Hindi + English", "Voice-first\nfor seniors", "Explainable", "Low cost"],
    seeHow: "See How It Works",
    watch: "Watch Video",
  },
  dash: {
    eyebrow: "Built for care coordinators",
    titleA: "From data to",
    titleB: "decisions, faster.",
    lede: "A clear, ranked daily worklist with plain-language reasons and one concrete next action. Less noise. More care.",
    points: [
      "Prioritised list of seniors who need attention",
      "Explainable reasons (in simple language)",
      "One-tap action & feedback",
      "Works on low-tech phones too",
    ],
    listHead: "Today’s Attention List",
    date: "12 Apr 2025",
    reason: "Reason:",
    action: "Action:",
    whyTitle: "Why this matters",
    whyBody: "Small changes, when noticed early, can prevent bigger problems.",
    approach: "Our Approach",
    sidebar: ["Dashboard", "Seniors", "Alerts", "Reports", "Settings"],
    userName: "Priya Sharma",
    userRole: "Care Coordinator",
    rows: [
      {
        name: "Savitri Devi",
        meta: "Age 72 · Lucknow",
        levelLabel: "High Risk",
        reason: "Low appetite, irregular BP, missed call",
        action: "Call & confirm, check BP, inform family",
      },
      {
        name: "Ramesh Chandra",
        meta: "Age 68 · Kanpur",
        levelLabel: "Medium Risk",
        reason: "Poor sleep, less activity, dizziness",
        action: "Call, ask about symptoms, suggest rest",
      },
      {
        name: "Kamla Bai",
        meta: "Age 76 · Varanasi",
        levelLabel: "Low Risk",
        reason: "Missed check-in (no data)",
        action: "Call for daily check-in",
      },
    ],
    videoHead: "Today’s Attention List, 12 April 2025",
    videoBody:
      "A short silent walkthrough of the Care Coordinator’s daily worklist. It shows three seniors ranked by risk, each with the reason the alert fired and the action to take.",
  },
  features: {
    eyebrow: "Key features",
    title: "Designed for real life.",
    link: "Explore all features",
    items: [
      {
        title: "Multi-Source Health Signals",
        body: "Vitals, medication logs, call notes, activity and family input (optional).",
      },
      {
        title: "Smart Risk Detection",
        body: "Rules + ML models to catch decline days or weeks early.",
      },
      {
        title: "Low-Noise Alerts",
        lead: "Daily caps, dedupe, cool-down",
        body: " and escalation on persistence.",
      },
      {
        title: "Role-Based Access",
        body: "Consent-based ",
        lead2: "family sharing",
        body2: " and PII masking.",
      },
      {
        title: "Multi-Language & Voice",
        body: "Hindi/English support with voice and IVR for seniors.",
      },
    ],
  },
  impact: {
    eyebrow: "The impact",
    titleA: "A healthier, safer",
    titleB: "ageing India.",
    stats: [
      {
        value: "149M",
        body: "Indians aged 60+ in 2022 (10.5% of population), projected to reach 347M (20.8%) by 2050.",
        source: "UNFPA India Ageing Report 2023",
      },
      {
        value: "~1 in 5",
        body: "older persons live alone or only with a spouse.",
        source: "UNFPA, 2023",
      },
      {
        value: "24% · 23%",
        body: "face limits on daily activities · have two or more chronic ailments.",
        source: "UNFPA, 2023",
      },
      {
        value: "40,000+",
        body: "seniors across 350+ cities supported by Samarth, but coordinators prioritise from memory and notes.",
        source: "Problem statement",
      },
    ],
  },
  closing: {
    eyebrow: "Let’s build a safer tomorrow",
    titleA: "Because every senior",
    titleB: "still has a story to live.",
    sub: "Samarth Sentinel — technology with a human heart.",
    cta: "Get Started",
    learn: "Learn More",
  },
  footer: {
    links: ["Home", "How It Works", "Features", "Impact", "About"],
    tag: "Built for a kinder, healthier tomorrow.",
    legal:
      "DEV-104 · Samarth Life Management. Prototype built on a synthetic cohort of 200 seniors across 90 days. No real patient data is used, and no clinical efficacy is claimed. The system flags risk and routes it to a human — it never diagnoses.",
    nav: "Footer",
  },
  chat: {
    open: "Ask about this site",
    title: "Ask about Samarth Sentinel",
    note: "Ask about Samarth Sentinel, or anything else.",
    greeting:
      "Hello. Ask me about Samarth Sentinel — what it does, who it is for, how the privacy model works — or anything else you are curious about. I answer in Hindi or English.",
    suggestions: [
      "What does Samarth Sentinel actually do?",
      "What can a family member see?",
      "Is any of this real patient data?",
    ],
    placeholder: "Ask a question…",
    send: "Send",
    close: "Close",
    thinking: "Thinking…",
    disclaimer: "Not medical advice. This assistant never diagnoses.",
    errorGeneric: "Something went wrong reaching the assistant. Please try again.",
    errorRate: "That is a lot of questions at once. Please wait a moment and try again.",
    errorBusy: "The assistant is at capacity for a moment — this demo runs on a free tier. Try again in a few seconds.",
    errorOff: "The assistant is not configured on this deployment.",
  },
};

const hi: Copy = {
  switchLabel: "EN",
  meta: {
    title: "Samarth Sentinel — घर पर रह रहे बुज़ुर्गों के लिए पूर्व-चेतावनी",
    description:
      "देखभाल समन्वयक को बताता है कि आज किस पर ध्यान देना है, क्यों, और अगला कदम क्या है। जोखिम चिह्नित करके किसी व्यक्ति तक पहुँचाता है, निदान कभी नहीं करता।",
  },
  nav: {
    home: "होम",
    how: "यह कैसे काम करता है",
    features: "विशेषताएँ",
    impact: "प्रभाव",
    about: "परिचय",
    cta: "शुरू करें",
    menu: "मेन्यू",
    main: "मुख्य",
    language: "भाषा",
  },
  hero: {
    eyebrow: "समय रहते ध्यान। सुरक्षित कल।",
    subA: "घर पर रह रहे बुज़ुर्गों के लिए",
    subB: "एक पूर्व-चेतावनी प्रणाली।",
    body: "देखभाल समन्वयक को बताएँ कि आज किस पर ध्यान देना है, क्यों, और अगला कदम क्या है। यह जोखिम को चिह्नित करके किसी व्यक्ति तक पहुँचाता है — निदान कभी नहीं करता।",
    promises: ["हिंदी + अंग्रेज़ी", "बुज़ुर्गों के लिए\nआवाज़-आधारित", "कारण स्पष्ट", "कम लागत"],
    seeHow: "देखें यह कैसे काम करता है",
    watch: "वीडियो देखें",
  },
  dash: {
    eyebrow: "देखभाल समन्वयकों के लिए बनाया गया",
    titleA: "आँकड़ों से निर्णय तक,",
    titleB: "और तेज़ी से।",
    lede: "एक स्पष्ट, क्रमबद्ध दैनिक सूची — सरल भाषा में कारण और एक ठोस अगला कदम। कम शोर। ज़्यादा देखभाल।",
    points: [
      "ध्यान चाहने वाले बुज़ुर्गों की प्राथमिकता-सूची",
      "सरल भाषा में स्पष्ट कारण",
      "एक टैप में कार्रवाई और प्रतिक्रिया",
      "साधारण फ़ोन पर भी काम करता है",
    ],
    listHead: "आज की ध्यान-सूची",
    date: "12 अप्रैल 2025",
    reason: "कारण:",
    action: "कार्रवाई:",
    whyTitle: "यह क्यों मायने रखता है",
    whyBody: "छोटे बदलाव, समय रहते दिख जाएँ, तो बड़ी परेशानी टल सकती है।",
    approach: "हमारा तरीक़ा",
    sidebar: ["डैशबोर्ड", "बुज़ुर्ग", "अलर्ट", "रिपोर्ट", "सेटिंग्स"],
    userName: "प्रिया शर्मा",
    userRole: "देखभाल समन्वयक",
    rows: [
      {
        name: "सावित्री देवी",
        meta: "आयु 72 · लखनऊ",
        levelLabel: "अधिक जोखिम",
        reason: "भूख कम, बीपी अनियमित, कॉल छूटी",
        action: "कॉल करके पुष्टि करें, बीपी देखें, परिवार को बताएँ",
      },
      {
        name: "रमेश चंद्र",
        meta: "आयु 68 · कानपुर",
        levelLabel: "मध्यम जोखिम",
        reason: "नींद ठीक नहीं, गतिविधि कम, चक्कर",
        action: "कॉल करें, तकलीफ़ पूछें, आराम की सलाह दें",
      },
      {
        name: "कमला बाई",
        meta: "आयु 76 · वाराणसी",
        levelLabel: "कम जोखिम",
        reason: "चेक-इन छूटा (कोई जानकारी नहीं)",
        action: "दैनिक चेक-इन के लिए कॉल करें",
      },
    ],
    videoHead: "आज की ध्यान-सूची, 12 अप्रैल 2025",
    videoBody:
      "देखभाल समन्वयक की दैनिक सूची की एक छोटी, बिना आवाज़ की झलक। इसमें जोखिम के क्रम में तीन बुज़ुर्ग दिखते हैं, हर एक के साथ अलर्ट का कारण और उठाया जाने वाला क़दम।",
  },
  features: {
    eyebrow: "मुख्य विशेषताएँ",
    title: "असल ज़िंदगी के लिए बनाया गया।",
    link: "सभी विशेषताएँ देखें",
    items: [
      {
        title: "कई स्रोतों से स्वास्थ्य संकेत",
        body: "वाइटल्स, दवा का रिकॉर्ड, कॉल नोट्स, गतिविधि और परिवार की जानकारी (वैकल्पिक)।",
      },
      {
        title: "समझदार जोखिम पहचान",
        body: "नियम और एमएल मॉडल, ताकि गिरावट दिनों या हफ़्तों पहले पकड़ी जाए।",
      },
      {
        title: "कम शोर वाले अलर्ट",
        lead: "दैनिक सीमा, दोहराव हटाना, कूल-डाउन",
        body: " और लगातार बने रहने पर एस्केलेशन।",
      },
      {
        title: "भूमिका-आधारित पहुँच",
        body: "सहमति से ",
        lead2: "परिवार के साथ साझा",
        body2: " और निजी जानकारी की सुरक्षा।",
      },
      {
        title: "बहुभाषी और आवाज़",
        body: "हिंदी/अंग्रेज़ी समर्थन, बुज़ुर्गों के लिए आवाज़ और आईवीआर के साथ।",
      },
    ],
  },
  impact: {
    eyebrow: "प्रभाव",
    titleA: "एक स्वस्थ, सुरक्षित",
    titleB: "वृद्ध होता भारत।",
    stats: [
      {
        value: "14.9 करोड़",
        body: "भारतीय 2022 में 60+ आयु के (जनसंख्या का 10.5%), जो 2050 तक 34.7 करोड़ (20.8%) होने का अनुमान है।",
        source: "यूएनएफपीए इंडिया एजिंग रिपोर्ट 2023",
      },
      {
        value: "~5 में 1",
        body: "बुज़ुर्ग अकेले या केवल जीवनसाथी के साथ रहते हैं।",
        source: "यूएनएफपीए, 2023",
      },
      {
        value: "24% · 23%",
        body: "रोज़मर्रा के कामों में कठिनाई · दो या अधिक पुरानी बीमारियों के साथ।",
        source: "यूएनएफपीए, 2023",
      },
      {
        value: "40,000+",
        body: "बुज़ुर्ग, 350+ शहरों में समर्थ द्वारा सहायता प्राप्त — पर समन्वयक याददाश्त और नोट्स के भरोसे प्राथमिकता तय करते हैं।",
        source: "समस्या विवरण",
      },
    ],
  },
  closing: {
    eyebrow: "आइए, एक सुरक्षित कल बनाएँ",
    titleA: "क्योंकि हर बुज़ुर्ग के पास",
    titleB: "जीने को एक कहानी है।",
    sub: "Samarth Sentinel — तकनीक, इंसानी दिल के साथ।",
    cta: "शुरू करें",
    learn: "और जानें",
  },
  footer: {
    links: ["होम", "यह कैसे काम करता है", "विशेषताएँ", "प्रभाव", "परिचय"],
    tag: "एक बेहतर, स्वस्थ कल के लिए बनाया गया।",
    legal:
      "DEV-104 · समर्थ लाइफ़ मैनेजमेंट। यह प्रोटोटाइप 90 दिनों के 200 बुज़ुर्गों के सिंथेटिक समूह पर बना है। किसी वास्तविक मरीज़ का डेटा उपयोग नहीं किया गया, और किसी चिकित्सकीय प्रभाव का दावा नहीं है। यह प्रणाली जोखिम को चिह्नित करके किसी व्यक्ति तक पहुँचाती है — निदान कभी नहीं करती।",
    nav: "फ़ुटर",
  },
  chat: {
    open: "इस साइट के बारे में पूछें",
    title: "Samarth Sentinel के बारे में पूछें",
    note: "Samarth Sentinel के बारे में पूछें, या कुछ और भी।",
    greeting:
      "नमस्ते। Samarth Sentinel के बारे में पूछिए — यह क्या करता है, किसके लिए है, निजता कैसे सुरक्षित रहती है — या कुछ और भी जो जानना हो। मैं हिंदी और अंग्रेज़ी दोनों में उत्तर देता हूँ।",
    suggestions: [
      "Samarth Sentinel असल में करता क्या है?",
      "परिवार के सदस्य को क्या दिखता है?",
      "क्या इसमें किसी असली मरीज़ का डेटा है?",
    ],
    placeholder: "अपना प्रश्न लिखें…",
    send: "भेजें",
    close: "बंद करें",
    thinking: "सोच रहा हूँ…",
    disclaimer: "यह चिकित्सकीय सलाह नहीं है। यह सहायक निदान कभी नहीं करता।",
    errorGeneric: "सहायक तक पहुँचने में कुछ दिक़्क़त हुई। कृपया दोबारा कोशिश करें।",
    errorRate: "एक साथ बहुत सारे प्रश्न आ गए। थोड़ी देर रुककर दोबारा कोशिश करें।",
    errorBusy: "सहायक अभी व्यस्त है — यह डेमो मुफ़्त सेवा पर चल रहा है। कुछ सेकंड बाद दोबारा कोशिश करें।",
    errorOff: "इस परिनियोजन में सहायक सेट नहीं किया गया है।",
  },
};

export const COPY: Record<Lang, Copy> = { en, hi };
