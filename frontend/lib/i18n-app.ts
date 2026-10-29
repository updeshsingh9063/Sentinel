import type { Lang } from "@/lib/i18n";
import type { DemoRole } from "@/lib/session";

/**
 * Copy for the signed-in surfaces: sign-in, the app bar, the worklist, senior
 * detail, the family summary, the check-in simulator and the ops dashboard.
 *
 * Kept apart from lib/i18n.ts, which holds the landing page, so neither file
 * becomes unreadable. Same contract: `AppCopy` is written out explicitly, so
 * a missing Hindi string is a compile error rather than an English sentence
 * appearing in the middle of a Hindi page.
 *
 * THE RULES THE HINDI KEEPS, same as everywhere else:
 *  1. Nothing names a condition. "निदान कभी नहीं करता" is translated as the
 *     promise it is, never softened.
 *  2. A senior's own words are never translated. The check-in script and the
 *     quoted cues stay exactly as spoken — see lib/demo-i18n.ts.
 *  3. Statements about what a role CANNOT see stay absolute. "There is no
 *     policy granting them" must not become "they are not shown".
 */

interface RoleCopy {
  name: string;
  label: string;
  sees: string;
}

export interface AppCopy {
  /** Browser tab titles. The product name is appended by each page. */
  titles: {
    signin: string;
    worklist: string;
    senior: string;
    summary: string;
    checkin: string;
    ops: string;
  };
  signin: {
    title: string;
    sub: string;
    redirect: string;
    loading: string;
    noAccount: string;
    noteTitle: string;
    note1: string;
    note2: string;
    note3: string;
    tabSignIn: string;
    tabSignUp: string;
    email: string;
    password: string;
    fullName: string;
    role: string;
    roleCoordinator: string;
    roleFamily: string;
    roleOps: string;
    submitSignIn: string;
    submitSignUp: string;
    working: string;
    demoDivider: string;
    demoHint: string;
    checkEmail: string;
    confirmedNote: string;
    emptyAccountNote: string;
    passwordHint: string;
    google: string;
    googleNote: string;
    oauthDivider: string;
  };
  roles: Record<DemoRole, RoleCopy>;
  bar: {
    switchRole: string;
    signingOut: string;
    navSuffix: string;
    language: string;
  };
  nav: {
    today: string;
    seniors: string;
    operations: string;
    thisWeek: string;
    overview: string;
  };
  notice: {
    fixtures: string;
    ops: string;
    family: string;
  };
  verdict: {
    ask: string;
    yes: string;
    no: string;
    doneTrue: string;
    doneFalse: string;
    undo: string;
  };
  worklist: {
    date: string;
    title: string;
    /** Templates, not functions: copy crosses to client components. */
    sub: string;
    why: string;
    nextStep: string;
    open: string;
    due: string;
    cap: string;
    foot: string;
    meta: string;
    /** Held rows show the leading reason instead of a contact age. */
    metaShort: string;
    dayOne: string;
    dayMany: string;
  };
  senior: {
    crumb: string;
    meta: string;
    dayOne: string;
    dayMany: string;
    bandNote: string;
    why: string;
    whyNote: string;
    said: string;
    nextStep: string;
    nextStepNote: string;
    meds: string;
    medsDay: string;
    medsAm: string;
    medsPm: string;
    medsNote: string;
    taken: string;
    missed: string;
    contacts: string;
    contactsNote: string;
  };
  family: {
    title: string;
    doing: string;
    notIncluded: string;
    notItems: string[];
    notNote: string;
    receive: string;
    receiveNote: string;
    /** Consent copy, keyed by the `scope` column in the consents table. */
    consents: Record<string, { label: string; detail: string }>;
    noLinkTitle: string;
    noLinkBody: string;
    noSummaryTitle: string;
    noSummaryBody: string;
    week: string;
  };
  checkin: {
    chrome: string;
    step: string;
    noKey: string;
    noKeyPressed: string;
    recapNote: string;
    again: string;
    silent: string;
    hear: string;
    speaking: string;
    speak: string;
    listening: string;
    stop: string;
    transcribing: string;
    heard: string;
    unclear: string;
    silence: string;
    micDenied: string;
    micUnsupported: string;
    voiceNote: string;
    orPress: string;
  };
  ops: {
    emptyTitle: string;
    emptyBody: string;
    city: string;
    period: string;
    title: string;
    sub: string;
    raised: string;
    raisedNote: string;
    median: string;
    medianNote: string;
    falseAlarm: string;
    falseAlarmNote: string;
    precision: string;
    precisionNote: string;
    volume: string;
    keyRaised: string;
    keyActioned: string;
    volumeNote: string;
    outcomes: string;
    outcomeLabels: [string, string, string, string];
    outcomesNote: string;
    privacyTitle: string;
    privacyBody: string;
  };
}

const en: AppCopy = {
  titles: {
    signin: "Sign in",
    worklist: "Today",
    senior: "Senior record",
    summary: "How things are going",
    checkin: "Check-in",
    ops: "Operations",
  },
  signin: {
    title: "Sign in",
    sub: "Create an account, or open a demo role to see exactly what that role can reach. The surfaces differ on purpose — the family view has no readings and no score because there is no policy granting them, not because they are hidden.",
    redirect: "Sign in to open",
    loading: "Loading…",
    noAccount: "no account",
    noteTitle: "Real accounts, demo shortcuts, synthetic data",
    note1:
      "You can create a real account above: Supabase Auth with a password, and a database trigger creates your profile. The role you pick is a request, not a grant — the trigger clamps it to coordinator, family or operations, and admin cannot be obtained by registering. The demo cards below are shared logins whose password is published in the source, kept so a reviewer can see each role in one click without registering. Every senior, reading and alert in this database is generated; no real person is in it.",
    note2:
      "What protects the data is the schema, not this page. Row-level security grants the family and operations roles no policy on vitals, call_notes, note_cues or risk_scores. Signed in as the family member, those tables return zero rows — checked against the live database, not assumed.",
    note3:
      "The senior has no account at all. The brief forbids a senior-facing app, so there is nothing for her to sign in to; that card opens a simulator of what she hears on a basic phone.",
    tabSignIn: "Sign in",
    tabSignUp: "Create account",
    email: "Email",
    password: "Password",
    fullName: "Your name",
    role: "I am a",
    roleCoordinator: "Care Coordinator",
    roleFamily: "Family member",
    roleOps: "Operations manager",
    submitSignIn: "Sign in",
    submitSignUp: "Create account",
    working: "Working…",
    demoDivider: "or try a demo account",
    demoHint: "One click, no email needed. Shared accounts on synthetic data.",
    checkEmail:
      "Account created. Check your email for a confirmation link, then sign in. If it does not arrive, use a demo account below.",
    confirmedNote: "Account created and signed in.",
    emptyAccountNote:
      "A new account starts with nothing linked to it, so your pages will be empty until an operator assigns you a caseload or links you to a senior. That is row-level security working, not an error.",
    passwordHint: "At least 8 characters.",
    google: "Continue with Google",
    googleNote:
      "A Google account signs in as a family member. Roles that can reach an individual senior's health data are granted by an operator, not chosen at sign-in.",
    oauthDivider: "or",
  },
  roles: {
    coordinator: {
      name: "Priya Sharma",
      label: "Care Coordinator",
      sees: "The ranked daily worklist, each senior's own baseline, call notes and medication logs.",
    },
    family: {
      name: "Anil Devi",
      label: "Family member",
      sees: "A plain-language weekly summary and consent switches. No readings, no score, no call notes.",
    },
    ops: {
      name: "Ravi Menon",
      label: "Operations manager",
      sees: "Alert volume, response times, outcome mix and false-alarm rate. Aggregates only, no individuals.",
    },
    senior: {
      name: "Savitri Devi",
      label: "Senior",
      sees: "Nothing on a screen, and no account. This opens the phone check-in simulator — what she hears, not an app she installs.",
    },
  },
  bar: {
    switchRole: "Switch role",
    signingOut: "Signing out…",
    navSuffix: "navigation",
    language: "Language",
  },
  nav: {
    today: "Today",
    seniors: "Seniors",
    operations: "Operations",
    thisWeek: "This week",
    overview: "Overview",
  },
  notice: {
    fixtures:
      "Demo data — the synthetic cohort is not generated yet, so these figures are fixtures. No real patient data. The system flags risk and routes it to a human; it never diagnoses.",
    ops: "Live aggregates, read from the database. The cohort behind them is generated, not real people. Operations holds no table policy anywhere in the schema — there is no individual record this surface could show.",
    family:
      "Demo data. A family member never sees readings, scores or call notes — there is no policy granting them.",
  },
  verdict: {
    ask: "Was this worth raising?",
    yes: "True concern",
    no: "False alarm",
    doneTrue: "Recorded as a true concern",
    doneFalse: "Recorded as a false alarm",
    undo: "Undo",
  },
  worklist: {
    date: "Monday 12 April 2025",
    title: "Today",
    sub: "Highest concern first, capped at {cap} so the list stays worth reading. Ordering reflects change from each senior’s own baseline, not population thresholds.",
    why: "Why this fired",
    nextStep: "Next step",
    open: "Open record",
    due: "Due",
    cap: "Daily alert budget — {cap} of {total} surfaced",
    foot: "Scored but not surfaced. They stay visible so the cap is auditable: a list you cannot check is a list you cannot trust.",
    meta: "Age {age} · {city} · last contact {days} {unit} ago",
    metaShort: "Age {age} · {city} · {reason}",
    dayOne: "day",
    dayMany: "days",
  },
  senior: {
    crumb: "Today",
    meta: "Age {age} · {city} · last contact {days} {unit} ago",
    dayOne: "day",
    dayMany: "days",
    bandNote:
      "The band is her own rolling median and MAD over the window, computed excluding today so one extreme reading cannot drag its own baseline. A systolic of 150 is unremarkable for another senior and an emergency delta for her.",
    why: "Why this fired",
    whyNote:
      "Contributions are stored with the score, so the reasons survive into the alert instead of being recomputed from a model that may have moved on.",
    said: "What was said",
    nextStep: "Next step",
    nextStepNote:
      "Every path ends at a person. The system never adjusts a medication and never contacts a senior on its own.",
    meds: "Medication log",
    medsDay: "Day",
    medsAm: "AM",
    medsPm: "PM",
    medsNote:
      "Unlogged is not the same as not taken. It is a signal, and it is what the coordinator asks about.",
    taken: "Taken",
    missed: "Not logged",
    contacts: "Contact history",
    contactsNote:
      "Silence counts. An unanswered call costs nothing to compute and needs no sensor, which matters on a basic handset.",
  },
  family: {
    title: "How {name} is doing",
    doing: "What we are doing",
    notIncluded: "What this summary does not include",
    notItems: [
      "No blood pressure, sugar or weight readings.",
      "No risk score, and no ranking against anyone else.",
      "No notes from her calls with the coordinator.",
      "No named condition — this service never diagnoses.",
    ],
    notNote:
      "If something needs attention urgently, a coordinator phones you. It will not arrive as a line in a weekly note.",
    receive: "What you receive",
    receiveNote:
      "Change these whenever you like. Turning something off takes effect on the next summary.",
    consents: {
      family_summary: {
        label: "Weekly wellbeing summary",
        detail: "A short note like this one, every Monday. Plain language, no medical readings.",
      },
      urgent_call: {
        label: "Call me if something is serious",
        detail: "A coordinator phones you directly. This is the only channel for anything urgent.",
      },
      visit_notice: {
        label: "Tell me when a nurse visits",
        detail: "A short note after any home visit, saying it happened — not what was found.",
      },
    },
    noLinkTitle: "No senior is linked to this account yet",
    noLinkBody:
      "You are signed in, but no senior has been linked to you. Until an operator links you, there is nothing here to show — the database returns no rows for you rather than showing you someone else's relative. Ask your Care Coordinator to add the link.",
    noSummaryTitle: "No summary yet",
    noSummaryBody:
      "A summary is written once a week and only when consent for it has been recorded. Nothing has been published for this week yet.",
    week: "Week of",
  },
  checkin: {
    chrome: "Phone check-in simulator · what the senior hears, not an app they install",
    step: "Question {n} of {total}",
    noKey: "No key pressed",
    noKeyPressed: "No key pressed",
    recapNote:
      "A question left unanswered is recorded as unanswered. Silence is evidence, not a gap to fill in.",
    again: "Run it again",
    silent: "Press nothing (the call times out)",
    hear: "Hear the question",
    speaking: "Speaking…",
    speak: "Hold to answer by voice",
    listening: "Listening… release when done",
    stop: "Stop",
    transcribing: "Writing down what you said…",
    heard: "We heard",
    unclear: "We could not make that out. Say it again, or press a button below.",
    silence: "We did not hear anything. Say it again, or press a button below.",
    micDenied: "The microphone is blocked in this browser, so use the buttons below.",
    micUnsupported: "This browser cannot record audio, so use the buttons below.",
    voiceNote:
      "On a real call this is spoken down the line and the senior just answers. Here it uses the browser’s voice and microphone. The buttons always work without either.",
    orPress: "or press a number",
  },
  ops: {
    emptyTitle: "No aggregates to show",
    emptyBody:
      "The operations view returned no rows. Either no alerts have been raised yet, or this deployment has no database configured. Nothing is being hidden and nothing has failed silently — there is simply nothing to aggregate.",
    city: "All cities",
    period: "Last {days} days",
    title: "Operations",
    sub: "Alert volume, time to first action, outcome mix and false-alarm rate across {coordinators} coordinators and {seniors} seniors. No names, no readings, no scores.",
    raised: "Alerts raised",
    raisedNote: "{actioned} actioned, {open} not",
    median: "Median to first action",
    medianNote: "From alert raised to coordinator verdict",
    falseAlarm: "False-alarm rate",
    falseAlarmNote: "Marked not worth raising by the coordinator who took it",
    precision: "Precision @ K",
    precisionNote: "Of the capped list, the share that was a true concern",
    volume: "Daily volume",
    keyRaised: "raised",
    keyActioned: "actioned",
    volumeNote:
      "Volume on its own is not a health metric. It is here to spot a scoring change that suddenly floods or starves the queue.",
    outcomes: "Outcome mix",
    outcomeLabels: [
      "True concern, verdict recorded",
      "False alarm, marked by coordinator",
      "Could not reach the senior",
      "Not yet actioned",
    ],
    outcomesNote:
      "Every row here exists because a coordinator recorded a verdict. That verdict is the only thing that makes precision measurable at all — which is why the last row is counted but left out of the precision denominator.",
    privacyTitle: "What operations cannot see",
    privacyBody:
      "This page is one aggregated view. The operations role has no policy on vitals, call_notes, note_cues or risk_scores, so there is no query from here that returns a senior. The restriction is an absence in the schema, not a check in this code that could be written wrong — signed in as operations, those tables return zero rows.",
  },
};

const hi: AppCopy = {
  titles: {
    signin: "साइन इन",
    worklist: "आज",
    senior: "बुज़ुर्ग का रिकॉर्ड",
    summary: "हाल कैसा है",
    checkin: "चेक-इन",
    ops: "संचालन",
  },
  signin: {
    title: "साइन इन",
    sub: "अपना खाता बनाएँ, या कोई डेमो भूमिका खोलकर देखें कि वह भूमिका वास्तव में क्या देख सकती है। हर भूमिका को अलग चीज़ें दिखती हैं — परिवार के दृश्य में कोई रीडिंग या स्कोर नहीं है, क्योंकि उन्हें देखने की अनुमति ही नहीं दी गई है, इसलिए नहीं कि उन्हें छिपाया गया है।",
    redirect: "खोलने के लिए साइन इन करें",
    loading: "लोड हो रहा है…",
    noAccount: "कोई खाता नहीं",
    noteTitle: "वास्तविक खाते, डेमो शॉर्टकट, सिंथेटिक डेटा",
    note1:
      "आप ऊपर असली खाता बना सकते हैं: पासवर्ड के साथ Supabase Auth, और एक डेटाबेस ट्रिगर आपकी प्रोफ़ाइल बनाता है। आप जो भूमिका चुनते हैं वह एक अनुरोध है, अधिकार नहीं — ट्रिगर उसे समन्वयक, परिवार या संचालन तक सीमित कर देता है, और एडमिन खाता बनाकर नहीं मिल सकता। नीचे के डेमो कार्ड साझा खाते हैं जिनका पासवर्ड सोर्स में है; ये इसलिए रखे गए हैं ताकि कोई समीक्षक बिना खाता बनाए एक क्लिक में हर भूमिका देख सके। इस डेटाबेस का हर बुज़ुर्ग, रीडिंग और अलर्ट बनाया हुआ है; कोई वास्तविक व्यक्ति नहीं है।",
    note2:
      "डेटा की सुरक्षा यह पेज नहीं, स्कीमा करता है। रो-लेवल सिक्योरिटी परिवार और संचालन भूमिकाओं को vitals, call_notes, note_cues या risk_scores पर कोई अनुमति नहीं देती। परिवार के रूप में साइन इन करने पर इन तालिकाओं से शून्य पंक्तियाँ आती हैं — यह लाइव डेटाबेस पर जाँचा गया है, माना नहीं गया।",
    note3:
      "बुज़ुर्ग का कोई खाता है ही नहीं। ब्रीफ़ बुज़ुर्गों के लिए ऐप मना करता है, इसलिए उनके साइन इन करने को कुछ है ही नहीं; वह कार्ड एक सिम्युलेटर खोलता है — वही जो वे साधारण फ़ोन पर सुनती हैं।",
    tabSignIn: "साइन इन",
    tabSignUp: "नया खाता बनाएँ",
    email: "ईमेल",
    password: "पासवर्ड",
    fullName: "आपका नाम",
    role: "मैं हूँ",
    roleCoordinator: "देखभाल समन्वयक",
    roleFamily: "परिवार का सदस्य",
    roleOps: "संचालन प्रबंधक",
    submitSignIn: "साइन इन करें",
    submitSignUp: "खाता बनाएँ",
    working: "हो रहा है…",
    demoDivider: "या डेमो खाते से देखें",
    demoHint: "एक क्लिक, ईमेल की ज़रूरत नहीं। साझा खाते, सिंथेटिक डेटा पर।",
    checkEmail:
      "खाता बन गया। पुष्टि के लिए अपना ईमेल देखें, फिर साइन इन करें। अगर न आए तो नीचे डेमो खाते का उपयोग करें।",
    confirmedNote: "खाता बन गया और आप साइन इन हैं।",
    emptyAccountNote:
      "नए खाते से कुछ भी जुड़ा नहीं होता, इसलिए जब तक कोई आपको काम सौंपे या किसी बुज़ुर्ग से जोड़े, आपके पेज ख़ाली रहेंगे। यह रो-लेवल सिक्योरिटी का सही काम है, कोई त्रुटि नहीं।",
    passwordHint: "कम से कम 8 अक्षर।",
    google: "Google से जारी रखें",
    googleNote:
      "Google खाता परिवार के सदस्य के रूप में साइन इन करता है। जिन भूमिकाओं को किसी बुज़ुर्ग का स्वास्थ्य डेटा दिखता है, वे साइन-इन पर चुनी नहीं जातीं — उन्हें ऑपरेटर देता है।",
    oauthDivider: "या",
  },
  roles: {
    coordinator: {
      name: "प्रिया शर्मा",
      label: "देखभाल समन्वयक",
      sees: "क्रमबद्ध दैनिक सूची, हर बुज़ुर्ग की अपनी सामान्य सीमा, कॉल नोट्स और दवा का रिकॉर्ड।",
    },
    family: {
      name: "अनिल देवी",
      label: "परिवार के सदस्य",
      sees: "सरल भाषा में साप्ताहिक सारांश और सहमति के विकल्प। कोई रीडिंग नहीं, कोई स्कोर नहीं, कोई कॉल नोट नहीं।",
    },
    ops: {
      name: "रवि मेनन",
      label: "संचालन प्रबंधक",
      sees: "अलर्ट की संख्या, प्रतिक्रिया समय, परिणामों का मिश्रण और ग़लत अलर्ट की दर। केवल कुल आँकड़े, कोई व्यक्ति नहीं।",
    },
    senior: {
      name: "सावित्री देवी",
      label: "बुज़ुर्ग",
      sees: "स्क्रीन पर कुछ नहीं, और कोई खाता नहीं। यह फ़ोन चेक-इन सिम्युलेटर खोलता है — वही जो वे सुनती हैं, कोई ऐप नहीं जो उन्हें लगाना पड़े।",
    },
  },
  bar: {
    switchRole: "भूमिका बदलें",
    signingOut: "साइन आउट हो रहा है…",
    navSuffix: "नेविगेशन",
    language: "भाषा",
  },
  nav: {
    today: "आज",
    seniors: "बुज़ुर्ग",
    operations: "संचालन",
    thisWeek: "इस हफ़्ते",
    overview: "अवलोकन",
  },
  notice: {
    fixtures:
      "डेमो डेटा — सिंथेटिक समूह अभी बनाया नहीं गया है, इसलिए ये आँकड़े नमूना हैं। किसी वास्तविक मरीज़ का डेटा नहीं। यह प्रणाली जोखिम चिह्नित करके किसी व्यक्ति तक पहुँचाती है; निदान कभी नहीं करती।",
    ops: "लाइव आँकड़े, सीधे डेटाबेस से। इनके पीछे का समूह बनाया हुआ है, वास्तविक लोग नहीं। संचालन भूमिका के पास स्कीमा में कहीं कोई तालिका-अनुमति नहीं है — इस सतह पर कोई व्यक्तिगत रिकॉर्ड दिख ही नहीं सकता।",
    family:
      "डेमो डेटा। परिवार के सदस्य को कभी कोई रीडिंग, स्कोर या कॉल नोट नहीं दिखते — उन्हें देखने की अनुमति ही नहीं है।",
  },
  verdict: {
    ask: "क्या यह उठाने लायक़ था?",
    yes: "सही चिंता",
    no: "ग़लत अलर्ट",
    doneTrue: "सही चिंता के रूप में दर्ज",
    doneFalse: "ग़लत अलर्ट के रूप में दर्ज",
    undo: "पूर्ववत करें",
  },
  worklist: {
    date: "सोमवार 12 अप्रैल 2025",
    title: "आज",
    sub: "सबसे अधिक चिंता पहले, {cap} तक सीमित ताकि सूची पढ़ने लायक़ रहे। क्रम हर बुज़ुर्ग की अपनी सामान्य सीमा से बदलाव पर आधारित है, आबादी के औसत पर नहीं।",
    why: "यह क्यों उठा",
    nextStep: "अगला कदम",
    open: "रिकॉर्ड खोलें",
    due: "नियत",
    cap: "दैनिक अलर्ट सीमा — {total} में से {cap} दिखाए गए",
    foot: "इनका स्कोर है पर ये दिखाए नहीं गए। ये दिखते रहते हैं ताकि सीमा जाँची जा सके: जिस सूची को आप जाँच न सकें, उस पर भरोसा भी नहीं कर सकते।",
    meta: "आयु {age} · {city} · पिछला संपर्क {days} {unit} पहले",
    metaShort: "आयु {age} · {city} · {reason}",
    dayOne: "दिन",
    dayMany: "दिन",
  },
  senior: {
    crumb: "आज",
    meta: "आयु {age} · {city} · पिछला संपर्क {days} {unit} पहले",
    dayOne: "दिन",
    dayMany: "दिन",
    bandNote:
      "यह पट्टी उनकी अपनी चलती माध्यिका और MAD है, जो आज को छोड़कर निकाली गई है ताकि एक असामान्य रीडिंग अपनी ही सामान्य सीमा को खींच न सके। 150 का सिस्टोलिक किसी और बुज़ुर्ग के लिए सामान्य हो सकता है और उनके लिए बड़ा बदलाव।",
    why: "यह क्यों उठा",
    whyNote:
      "योगदान स्कोर के साथ ही सहेजे जाते हैं, इसलिए कारण अलर्ट के साथ बने रहते हैं — उन्हें ऐसे मॉडल से दोबारा नहीं निकाला जाता जो तब तक बदल चुका हो।",
    said: "क्या कहा गया",
    nextStep: "अगला कदम",
    nextStepNote:
      "हर रास्ता किसी व्यक्ति पर ख़त्म होता है। यह प्रणाली न कभी दवा बदलती है, न अपने आप किसी बुज़ुर्ग से संपर्क करती है।",
    meds: "दवा का रिकॉर्ड",
    medsDay: "दिन",
    medsAm: "सुबह",
    medsPm: "शाम",
    medsNote:
      "दर्ज न होना और न लेना एक बात नहीं है। यह अपने आप में एक संकेत है, और समन्वयक इसी के बारे में पूछते हैं।",
    taken: "ली गई",
    missed: "दर्ज नहीं",
    contacts: "संपर्क का इतिहास",
    contactsNote:
      "चुप्पी भी मायने रखती है। बिना उठी कॉल की गणना में कुछ ख़र्च नहीं होता और कोई सेंसर नहीं चाहिए — साधारण फ़ोन पर यही काम आता है।",
  },
  family: {
    title: "{name} कैसी हैं",
    doing: "हम क्या कर रहे हैं",
    notIncluded: "इस सारांश में क्या नहीं है",
    notItems: [
      "रक्तचाप, शुगर या वज़न की कोई रीडिंग नहीं।",
      "कोई जोखिम स्कोर नहीं, और किसी और से कोई तुलना नहीं।",
      "समन्वयक के साथ हुई उनकी बातों के नोट्स नहीं।",
      "किसी बीमारी का नाम नहीं — यह सेवा निदान कभी नहीं करती।",
    ],
    notNote:
      "अगर किसी बात पर तुरंत ध्यान चाहिए, तो समन्वयक आपको फ़ोन करेंगे। वह साप्ताहिक सारांश की एक पंक्ति बनकर नहीं आएगी।",
    receive: "आपको क्या मिलता है",
    receiveNote:
      "इन्हें जब चाहें बदलें। कुछ बंद करने का असर अगले सारांश से लागू होगा।",
    consents: {
      family_summary: {
        label: "साप्ताहिक कुशल-क्षेम सारांश",
        detail: "हर सोमवार इसी तरह की एक छोटी चिट्ठी। सरल भाषा, कोई मेडिकल रीडिंग नहीं।",
      },
      urgent_call: {
        label: "कुछ गंभीर हो तो मुझे कॉल करें",
        detail: "समन्वयक आपको सीधे फ़ोन करते हैं। किसी भी ज़रूरी बात के लिए यही एकमात्र रास्ता है।",
      },
      visit_notice: {
        label: "नर्स की मुलाक़ात होने पर बताएँ",
        detail: "घर पर किसी मुलाक़ात के बाद एक छोटी सूचना, कि वह हुई — यह नहीं कि उसमें क्या मिला।",
      },
    },
    noLinkTitle: "इस खाते से अभी कोई बुज़ुर्ग नहीं जुड़ा है",
    noLinkBody:
      "आप साइन इन हैं, पर आपसे कोई बुज़ुर्ग नहीं जोड़ा गया है। जब तक कोई ऑपरेटर आपको जोड़ता नहीं, यहाँ दिखाने को कुछ नहीं है — डेटाबेस आपको किसी और का रिकॉर्ड दिखाने के बजाय कोई पंक्ति नहीं लौटाता। अपने देखभाल समन्वयक से जोड़ने के लिए कहें।",
    noSummaryTitle: "अभी कोई सारांश नहीं",
    noSummaryBody:
      "सारांश हफ़्ते में एक बार लिखा जाता है, और तभी जब उसके लिए सहमति दर्ज हो। इस हफ़्ते के लिए अभी कुछ प्रकाशित नहीं हुआ है।",
    week: "सप्ताह",
  },
  checkin: {
    chrome: "फ़ोन चेक-इन सिम्युलेटर · जो बुज़ुर्ग सुनती हैं, कोई ऐप नहीं जो उन्हें लगाना पड़े",
    step: "प्रश्न {n} / {total}",
    noKey: "कोई बटन नहीं दबाया",
    noKeyPressed: "कोई बटन नहीं दबाया",
    recapNote:
      "जिस प्रश्न का उत्तर नहीं मिला, उसे अनुत्तरित ही दर्ज किया जाता है। चुप्पी एक प्रमाण है, भरने लायक़ ख़ाली जगह नहीं।",
    again: "फिर से चलाएँ",
    silent: "कुछ न दबाएँ (कॉल अपने आप कट जाती है)",
    hear: "प्रश्न सुनें",
    speaking: "बोल रहा है…",
    speak: "दबाकर बोलें",
    listening: "सुन रहे हैं… कहकर छोड़ दें",
    stop: "रोकें",
    transcribing: "आपकी बात लिखी जा रही है…",
    heard: "हमने सुना",
    unclear: "हम समझ नहीं पाए। दोबारा कहें, या नीचे कोई बटन दबाएँ।",
    silence: "हमें कुछ सुनाई नहीं दिया। दोबारा कहें, या नीचे कोई बटन दबाएँ।",
    micDenied: "इस ब्राउज़र में माइक बंद है, इसलिए नीचे के बटन इस्तेमाल करें।",
    micUnsupported: "यह ब्राउज़र आवाज़ रिकॉर्ड नहीं कर सकता, नीचे के बटन इस्तेमाल करें।",
    voiceNote:
      "असली कॉल पर यह फ़ोन पर बोला जाता है और बुज़ुर्ग बस जवाब देती हैं। यहाँ ब्राउज़र की आवाज़ और माइक इस्तेमाल होता है। बटन हमेशा दोनों के बिना भी चलते हैं।",
    orPress: "या कोई नंबर दबाएँ",
  },
  ops: {
    emptyTitle: "दिखाने के लिए कोई आँकड़ा नहीं",
    emptyBody:
      "संचालन दृश्य से कोई पंक्ति नहीं आई। या तो अभी कोई अलर्ट नहीं उठा है, या इस परिनियोजन में कोई डेटाबेस सेट नहीं है। कुछ छिपाया नहीं जा रहा और कुछ चुपचाप विफल नहीं हुआ — जोड़ने को कुछ है ही नहीं।",
    city: "सभी शहर",
    period: "पिछले {days} दिन",
    title: "संचालन",
    sub: "{coordinators} समन्वयकों और {seniors} बुज़ुर्गों में अलर्ट की संख्या, पहली कार्रवाई तक का समय, परिणामों का मिश्रण और ग़लत अलर्ट की दर। कोई नाम नहीं, कोई रीडिंग नहीं, कोई स्कोर नहीं।",
    raised: "अलर्ट उठाए गए",
    raisedNote: "{actioned} पर कार्रवाई, {open} पर नहीं",
    median: "पहली कार्रवाई तक माध्यिका",
    medianNote: "अलर्ट उठने से समन्वयक के निर्णय तक",
    falseAlarm: "ग़लत अलर्ट की दर",
    falseAlarmNote: "जिन्हें लेने वाले समन्वयक ने उठाने लायक़ नहीं माना",
    precision: "शुद्धता @ K",
    precisionNote: "सीमित सूची में से वह हिस्सा जो सही चिंता निकला",
    volume: "दैनिक संख्या",
    keyRaised: "उठाए गए",
    keyActioned: "कार्रवाई हुई",
    volumeNote:
      "अकेली संख्या कोई स्वास्थ्य माप नहीं है। यह यहाँ इसलिए है ताकि कोई स्कोरिंग बदलाव पकड़ा जाए जो अचानक सूची को भर दे या ख़ाली कर दे।",
    outcomes: "परिणामों का मिश्रण",
    outcomeLabels: [
      "सही चिंता, निर्णय दर्ज",
      "ग़लत अलर्ट, समन्वयक द्वारा चिह्नित",
      "बुज़ुर्ग से संपर्क नहीं हो सका",
      "अभी कार्रवाई नहीं हुई",
    ],
    outcomesNote:
      "यहाँ हर पंक्ति इसलिए है क्योंकि किसी समन्वयक ने निर्णय दर्ज किया। वही निर्णय शुद्धता को मापने लायक़ बनाता है — इसीलिए आख़िरी पंक्ति गिनी तो जाती है, पर शुद्धता के हर में नहीं रखी जाती।",
    privacyTitle: "संचालन क्या नहीं देख सकता",
    privacyBody:
      "यह पेज एक जोड़ा हुआ दृश्य है। संचालन भूमिका के पास vitals, call_notes, note_cues या risk_scores पर कोई अनुमति नहीं है, इसलिए यहाँ से ऐसी कोई क्वेरी नहीं जो किसी बुज़ुर्ग को लौटाए। यह रोक स्कीमा में एक अनुपस्थिति है, इस कोड में लिखी कोई जाँच नहीं जो ग़लत हो सके — संचालन के रूप में साइन इन करने पर ये तालिकाएँ शून्य पंक्तियाँ देती हैं।",
  },
};

export const APP_COPY: Record<Lang, AppCopy> = { en, hi };
