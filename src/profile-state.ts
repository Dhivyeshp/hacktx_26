import type { InterestSuggestion } from "../shared/types";

export function interestSelectionChanged(
  interests: InterestSuggestion[],
  selectedIds: string[],
  manualLabels: string[],
) {
  // Rejecting a pending suggestion is also a change that must be saved.
  if (
    interests.some((interest) => !interest.approved) ||
    manualLabels.some((label) => label.trim())
  )
    return true;
  const approved = interests
    .filter((interest) => interest.approved)
    .map((interest) => interest.id)
    .sort();
  return JSON.stringify([...selectedIds].sort()) !== JSON.stringify(approved);
}
