import config from '../src/config/config.js';
import { buildAuthUrl } from '../src/auth/oauth_client.js';

function extractRedirectUri(url) {
  const u = new URL(url);
  return u.searchParams.get('redirect_uri');
}

async function main() {
  const redirectUri = `http://localhost:${config.server.port}/oauth-callback`;
  const url = buildAuthUrl(redirectUri, 'TEST_STATE');
  const embedded = extractRedirectUri(url);

  console.log('Expected redirect_uri:', redirectUri);
  console.log('Embedded redirect_uri:', embedded);

  if (embedded !== redirectUri) {
    console.error('❌ redirect_uri mismatch');
    process.exit(1);
  } else {
    console.log('✅ redirect_uri matches expected pattern');
  }
}

main().catch(err => {
  console.error('Error in OAuth URL test:', err);
  process.exit(1);
});

