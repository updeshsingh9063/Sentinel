/**
 * Medication review flags, from the 2023 AGS Beers Criteria.
 *
 * The brief's stretch goal is "medication interaction or missed-dose pattern
 * flags". Missed-dose patterns are computed in lib/report.ts from the logs.
 * This file is the other half: combinations and single agents that the
 * geriatrics literature says are worth a second look in someone over 65.
 *
 * SOURCE. American Geriatrics Society 2023 Updated AGS Beers Criteria for
 * Potentially Inappropriate Medication Use in Older Adults,
 * J Am Geriatr Soc, doi:10.1111/jgs.18372. Table 5 covers the drug-drug
 * interactions; Tables 2 and 3 cover agents to avoid or use with caution.
 * Every rule below names the criterion it came from, because an unsourced
 * clinical rule in a hackathon demo is worth less than no rule at all.
 *
 * WHAT THIS IS NOT. It is not a prescribing tool, it does not know the dose,
 * the indication, the renal function or what else has been tried, and Beers
 * itself is explicit that a flagged medicine is not a forbidden one — only
 * one whose risks more often outweigh its benefits in an older adult. So
 * every string here asks for a REVIEW by a person who can see the chart. None
 * of them says to stop anything, none names a condition, and none is shown to
 * the senior or the family. This is a note on a coordinator's screen that
 * says: worth asking the doctor about.
 *
 * Matching is on generic names, lowercased, as the medication log records
 * them. Brand names are not resolved — that needs a real drug dictionary, and
 * pretending otherwise would hide the gap.
 */

export type FlagSeverity = "review" | "caution";

export interface MedicationFlag {
  /** Stable code, for logging and for the UI to key off. */
  code: string;
  severity: FlagSeverity;
  /** The drugs in this senior's list that triggered it. */
  drugs: string[];
  /** What the criterion says, in a coordinator's language. */
  text: string;
  /** What to actually do about it. Always routed to a clinician. */
  action: string;
  /** Which part of the criteria this came from. */
  source: string;
}

/* ---- drug classes ------------------------------------------------------- */

const CLASS: Record<string, string[]> = {
  // Strongly anticholinergic agents named in Beers Table 7. Amitriptyline and
  // chlorpheniramine are both common and cheap in India, which is exactly why
  // they turn up in an older person's bag.
  anticholinergic: [
    "amitriptyline", "chlorpheniramine", "hydroxyzine", "oxybutynin",
    "promethazine", "dicyclomine", "trihexyphenidyl", "paroxetine",
  ],
  // CNS-active: Beers asks that fewer than three be used together.
  cns_active: [
    "amitriptyline", "alprazolam", "clonazepam", "diazepam", "lorazepam",
    "zolpidem", "tramadol", "gabapentin", "pregabalin", "quetiapine",
    "risperidone", "olanzapine", "sertraline", "fluoxetine", "escitalopram",
    "paroxetine", "baclofen", "phenobarbitone",
  ],
  ssri: ["sertraline", "fluoxetine", "escitalopram", "paroxetine", "citalopram"],
  nsaid: ["diclofenac", "ibuprofen", "naproxen", "indomethacin", "aceclofenac", "piroxicam"],
  sulfonylurea: ["glimepiride", "glibenclamide", "glyburide", "gliclazide", "chlorpropamide"],
  benzodiazepine: ["alprazolam", "clonazepam", "diazepam", "lorazepam", "chlordiazepoxide"],
  arb: ["losartan", "telmisartan", "valsartan", "olmesartan", "irbesartan"],
  anticoagulant: ["warfarin", "acenocoumarol"],
  ppi: ["pantoprazole", "omeprazole", "esomeprazole", "rabeprazole"],
};

const norm = (d: string) => d.trim().toLowerCase();

function matching(drugs: string[], group: string): string[] {
  const set = new Set(CLASS[group] ?? []);
  return drugs.filter((d) => set.has(norm(d)));
}

function has(drugs: string[], name: string): string[] {
  return drugs.filter((d) => norm(d) === name);
}

/* ---- the rules ---------------------------------------------------------- */

/**
 * Review one senior's current medicine list.
 *
 * Deliberately stateless and synchronous: it takes the names and returns the
 * flags, so it is trivially testable and has no opinion about where the list
 * came from.
 */
export function reviewRegimen(drugNames: string[]): MedicationFlag[] {
  const drugs = [...new Set(drugNames.map((d) => d.trim()).filter(Boolean))];
  const flags: MedicationFlag[] = [];

  // --- Table 5: interactions to avoid -----------------------------------

  const anticholinergics = matching(drugs, "anticholinergic");
  if (anticholinergics.length >= 2) {
    flags.push({
      code: "two_anticholinergics",
      severity: "review",
      drugs: anticholinergics,
      text: "Two or more medicines with strong anticholinergic effects are being taken together.",
      action: "Worth asking the doctor whether both are still needed. Beers flags this combination for older adults.",
      source: "AGS Beers 2023, Table 5 (drug-drug interactions to avoid)",
    });
  }

  const cns = matching(drugs, "cns_active");
  if (cns.length >= 3) {
    flags.push({
      code: "three_cns_active",
      severity: "review",
      drugs: cns,
      text: "Three or more medicines that act on the central nervous system are being taken together.",
      action: "Beers asks that older adults be kept under three. Worth raising at the next medicine review.",
      source: "AGS Beers 2023, Table 5",
    });
  }

  const ssri = matching(drugs, "ssri");
  const warfarin = has(drugs, "warfarin");
  if (ssri.length && warfarin.length) {
    flags.push({
      code: "ssri_with_warfarin",
      severity: "review",
      drugs: [...ssri, ...warfarin],
      text: "An SSRI is being taken alongside warfarin.",
      action: "Beers says avoid where possible. Flag to the prescribing doctor rather than changing anything.",
      source: "AGS Beers 2023, Table 5",
    });
  }

  const arb = matching(drugs, "arb");
  const lithium = has(drugs, "lithium");
  if (arb.length && lithium.length) {
    flags.push({
      code: "arb_with_lithium",
      severity: "review",
      drugs: [...arb, ...lithium],
      text: "A blood-pressure medicine of the ARB group is being taken alongside lithium.",
      action: "Beers lists this pairing as one to avoid. Needs a doctor's review, not a coordinator's.",
      source: "AGS Beers 2023, Table 5",
    });
  }

  // --- Tables 2 and 3: single agents ------------------------------------

  const nsaids = matching(drugs, "nsaid");
  if (nsaids.length) {
    flags.push({
      code: "chronic_nsaid",
      severity: "caution",
      drugs: nsaids,
      text: "An anti-inflammatory painkiller is on the regular list rather than being taken occasionally.",
      action: "Beers advises against long-term use in older adults without stomach protection. Worth confirming it is still meant to be daily.",
      source: "AGS Beers 2023, Table 2 (avoid chronic use)",
    });
  }

  const sulfonylureas = matching(drugs, "sulfonylurea");
  if (sulfonylureas.length) {
    flags.push({
      code: "sulfonylurea",
      severity: "caution",
      drugs: sulfonylureas,
      text: "A sulfonylurea is on the list.",
      action: "Beers prefers shorter-acting alternatives in older adults. Mention it at the next review; do not advise any change.",
      source: "AGS Beers 2023, Table 2",
    });
  }

  const benzos = matching(drugs, "benzodiazepine");
  if (benzos.length) {
    flags.push({
      code: "benzodiazepine",
      severity: "caution",
      drugs: benzos,
      text: "A benzodiazepine is on the list.",
      action: "Beers advises avoiding these in older adults. A doctor decides; this is only a prompt to ask.",
      source: "AGS Beers 2023, Table 2",
    });
  }

  // Sorted so the interaction findings lead: a pairing is more actionable
  // than a standing caution about one agent.
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "review" ? -1 : 1));
}
