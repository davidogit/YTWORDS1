import Filter from 'bad-words';

const filter = new Filter();

// Add custom blocked terms beyond the default list
filter.addWords(
  'slur1', 'slur2' // placeholder — add any domain-specific terms to block
);

/** Returns true if the word or text contains profanity */
export function isProfane(text: string): boolean {
  return filter.isProfane(text);
}

/** Clean profanity from text (replaces with asterisks) */
export function cleanText(text: string): string {
  return filter.clean(text);
}
