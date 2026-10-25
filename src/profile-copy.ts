import type { Source } from "../shared/types";

export function interestLabel(label: string) {
  const text = label.trim();
  const sentence = text === text.toUpperCase() ? text.toLowerCase() : text;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function importSummary(sources: Source[]) {
  const bios = sources.filter((source) => source.kind === "bio").length;
  const captions = sources.filter((source) => source.kind === "caption").length;
  const parts = [
    bios === 1 ? "your bio" : bios ? `${bios} profile excerpts` : "",
    captions ? `${captions} ${captions === 1 ? "caption" : "captions"}` : "",
  ].filter(Boolean);
  return parts.length
    ? `We found ${parts.join(" and ")}.`
    : "Your imported profile is saved.";
}
