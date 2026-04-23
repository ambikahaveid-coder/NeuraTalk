import { execSync } from 'child_process';
import fs from 'fs';

try {
  const url = execSync('npx neonctl connection-string --project-id dark-firefly-64796207').toString().trim();
  fs.writeFileSync('.env', `DATABASE_URL="${url}"\n`);
  console.log('Database URL saved to .env successfully!');
} catch (err) {
  console.error('Error:', err.message);
}
