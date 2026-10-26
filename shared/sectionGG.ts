// Functional outcome scoring modeled on CMS Section GG (self-care + mobility), the measure
// PDPM/MDS 3.0 uses for case-mix and quality reporting. This tool does NOT submit MDS data to
// CMS and is not a certified assessment instrument -- item codes/labels below are a commonly
// used reference set for internal tracking only. Verify against the current RAI User's Manual
// before relying on these for actual MDS completion or PDPM classification.
export const SECTION_GG_SCALE = [
  { value: 6, label: "6 - Independent" },
  { value: 5, label: "5 - Setup or clean-up assistance" },
  { value: 4, label: "4 - Supervision or touching assistance" },
  { value: 3, label: "3 - Partial/moderate assistance" },
  { value: 2, label: "2 - Substantial/maximal assistance" },
  { value: 1, label: "1 - Dependent" },
  { value: 0, label: "Not attempted / not scored" },
] as const;

export interface SectionGGItem {
  code: string;
  label: string;
  group: "self_care" | "mobility";
}

export const SECTION_GG_ITEMS: SectionGGItem[] = [
  { code: "GG0130A", label: "Eating", group: "self_care" },
  { code: "GG0130B", label: "Oral hygiene", group: "self_care" },
  { code: "GG0130C", label: "Toileting hygiene", group: "self_care" },
  { code: "GG0130E", label: "Shower/bathe self", group: "self_care" },
  { code: "GG0130F", label: "Upper body dressing", group: "self_care" },
  { code: "GG0130G", label: "Lower body dressing", group: "self_care" },
  { code: "GG0130H", label: "Putting on/taking off footwear", group: "self_care" },
  { code: "GG0170B", label: "Sit to lying", group: "mobility" },
  { code: "GG0170C", label: "Lying to sitting on side of bed", group: "mobility" },
  { code: "GG0170D", label: "Sit to stand", group: "mobility" },
  { code: "GG0170E", label: "Chair/bed-to-chair transfer", group: "mobility" },
  { code: "GG0170F", label: "Toilet transfer", group: "mobility" },
  { code: "GG0170I", label: "Walk 10 feet", group: "mobility" },
  { code: "GG0170J", label: "Walk 50 feet with two turns", group: "mobility" },
  { code: "GG0170K", label: "Walk 150 feet", group: "mobility" },
  { code: "GG0170M", label: "1 step (curb)", group: "mobility" },
  { code: "GG0170P", label: "Picking up object off floor", group: "mobility" },
];
