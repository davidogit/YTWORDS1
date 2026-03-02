export async function getCandidateWords(): Promise<string[]> {
  const auth = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=password&username=${process.env.REDDIT_USERNAME}&password=${process.env.REDDIT_PASSWORD}`
  });
  const tokenData = await tokenRes.json();
  
  const res = await fetch('https://oauth.reddit.com/r/logophilia/hot?limit=25', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'Node:YTShortsAuto:v1.0' }
  });
  const data = await res.json();
  
  return data.data.children.map((child: any) => {
    const title = child.data.title;
    const match = title.match(/^([A-Za-z]+)/);
    return match ? match[1].toLowerCase() : null;
  }).filter(Boolean);
}
