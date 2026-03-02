/**
 * setup-oauth.ts — Interactive YouTube OAuth2 token setup.
 *
 * Run: npm run setup:oauth
 *
 * Opens a browser for Google sign-in, captures the auth code,
 * exchanges it for tokens, and prints the refresh_token to add to .env.
 */

import 'dotenv/config';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { getAuthUrl, exchangeCode } from '../src/modules/uploader.js';

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║       YouTube OAuth2 Setup                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('This will open your browser for Google sign-in.');
  console.log('After authorizing, you\'ll be redirected back here.');
  console.log('');

  const authUrl = getAuthUrl();

  // Start a temporary HTTP server to capture the callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:3000`);

    if (url.pathname === '/oauth2callback') {
      const code = url.searchParams.get('code');

      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        return;
      }

      try {
        const tokens = await exchangeCode(code);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>✅ Authorization successful!</h1><p>You can close this tab.</p>');

        console.log('');
        console.log('✅ Authorization successful!');
        console.log('');
        console.log('Add this to your .env file:');
        console.log('');
        console.log(`YT_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('');

        server.close();
        process.exit(0);
      } catch (err) {
        res.writeHead(500);
        res.end('Token exchange failed');
        console.error('Token exchange failed:', (err as Error).message);
        server.close();
        process.exit(1);
      }
    }
  });

  server.listen(3000, () => {
    console.log('Opening browser for authorization...');
    console.log(`If it doesn't open, visit: ${authUrl}`);
    open(authUrl);
  });
}

main().catch(console.error);
