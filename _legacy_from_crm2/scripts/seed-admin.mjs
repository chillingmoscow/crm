import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

function parseEnvFromStatus() {
  const raw = execSync('supabase status -o env', { encoding: 'utf-8' });
  const map = new Map();

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1).replace(/^"|"$/g, '');
    map.set(key, value);
  }

  return {
    apiUrl: map.get('API_URL') ?? '',
    serviceRoleKey: map.get('SERVICE_ROLE_KEY') ?? '',
    anonKey: map.get('ANON_KEY') ?? ''
  };
}

async function main() {
  const { apiUrl, serviceRoleKey, anonKey } = parseEnvFromStatus();

  if (!apiUrl || !serviceRoleKey || !anonKey) {
    throw new Error('Cannot read API_URL/SERVICE_ROLE_KEY/ANON_KEY from `supabase status -o env`.');
  }

  const adminEmail = 'admin@crm2.local';
  const adminPassword = 'admin11';

  const adminClient = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const usersRes = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;

  let adminUser = usersRes.data.users.find((user) => (user.email ?? '').toLowerCase() === adminEmail);

  if (!adminUser) {
    const createRes = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { first_name: 'Admin', last_name: 'Default' }
    });
    if (createRes.error) throw createRes.error;
    adminUser = createRes.data.user;
  } else {
    const updateRes = await adminClient.auth.admin.updateUserById(adminUser.id, {
      password: adminPassword,
      email_confirm: true
    });
    if (updateRes.error) throw updateRes.error;
    adminUser = updateRes.data.user;
  }

  const anonClient = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const signInRes = await anonClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword
  });

  if (signInRes.error || !signInRes.data.session?.access_token) {
    throw signInRes.error ?? new Error('Cannot sign in as admin after seeding user.');
  }

  const userClient = createClient(apiUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${signInRes.data.session.access_token}`
      }
    },
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const bootstrapRes = await userClient.rpc('bootstrap_owner', {
    p_account_name: 'Default Admin Account',
    p_venue_name: 'Default Admin Venue',
    p_venue_type: 'restaurant',
    p_currency: 'USD',
    p_timezone: 'UTC'
  });

  if (bootstrapRes.error && !bootstrapRes.error.message.includes('already exists')) {
    throw bootstrapRes.error;
  }

  console.log('Seeded default admin credentials:');
  console.log('login: admin (or admin@crm2.local)');
  console.log('password: admin');
  console.log('note: Supabase stores a technical password with minimum length; UI keeps admin:admin compatibility.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
