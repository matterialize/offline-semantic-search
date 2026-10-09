import type { Passage } from '../types';

export interface SectionInput { text: string; section: string }

/** The closest local section heading describes the body; H1 titles do not. */
export function sectionInput(passage: Passage, lookup: ReadonlyMap<string, Passage>): SectionInput {
  const body = passage.kind !== 'heading' && (passage.role === 'body' || passage.role === undefined);
  const heading = body ? [...(passage.sectionHeadingIds ?? [])].reverse().map((id) => lookup.get(id))
    .find((item) => item?.kind === 'heading' && item.headingLevel !== 1
      && (item.role === 'body' || item.role === undefined)) : undefined;
  return { text: passage.text, section: heading?.text ?? '' };
}

export function sectionKey(input: SectionInput): string {
  return JSON.stringify([input.section, input.text]);
}
