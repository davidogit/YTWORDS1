export interface DictionaryResult { word: string; ipa: string; definition: string; }

export async function lookupWord(word: string): Promise<DictionaryResult | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
  if (!res.ok) return null;
  const data = await res.json();
  
  const entry = data[0];
  const ipa = entry.phonetics.find((p: any) => p.text)?.text || '';
  const definition = entry.meanings[0]?.definitions[0]?.definition || '';
  
  if (!definition) return null;
  return { word, ipa, definition };
}
