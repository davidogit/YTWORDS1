import { google } from 'googleapis';
import fs from 'fs';

export async function uploadToYouTube(videoPath: string, metadata: any) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET
  );
  
  oauth2Client.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: ['shorts', 'vocabulary', 'words', 'education'],
        categoryId: '27',
      },
      status: { privacyStatus: 'private' }, // change to public for prod
    },
    media: { body: fs.createReadStream(videoPath) },
  });

  return res.data;
}
