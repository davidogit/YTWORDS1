import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateScript(word: string, definition: string) {
  const prompt = `Write a 1-sentence engaging hook for a YouTube short about the weird word "${word}". Then define it simply. Keep it under 40 words total.`;
  
  const completion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'gpt-3.5-turbo',
  });

  const hook = completion.choices[0].message.content || `Did you know there's a specific word for this?`;
  const fullScript = `${hook}. The word is ${word}. It means ${definition}. Subscribe for more weird words!`;
  
  return { hook, fullScript };
}
