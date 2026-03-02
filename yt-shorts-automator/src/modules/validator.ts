export function isValid(word: string): boolean {
  const badWords = ['profanity1', 'profanity2']; // expand as needed
  if (badWords.includes(word.toLowerCase())) return false;
  if (word.length < 4 || word.length > 20) return false;
  return true;
}
