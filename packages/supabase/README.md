# Supabase Setup for TabFlow

This directory contains the database schema and configuration for TabFlow, a browser tab manager with encryption support and real-time synchronization.

## Quick Start

Follow these steps to set up Supabase for TabFlow:

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up or log in
2. Click "New Project"
3. Fill in the form:
   - **Project Name**: TabFlow (or your preferred name)
   - **Database Password**: Create a strong password and save it securely
   - **Region**: Choose the region closest to you or your users
4. Click "Create New Project" and wait for it to finish (2-3 minutes)

### Step 2: Apply the Database Migration

1. In the Supabase dashboard, click on your project name
2. In the left sidebar, click **SQL Editor**
3. Click "New Query"
4. Open the file `migrations/001_initial_schema.sql` in this repository
5. Copy the entire SQL code
6. Paste it into the SQL Editor
7. Click the "Run" button (or press Ctrl+Enter)
8. You should see a message confirming the tables were created

If you see any errors, check that you're using the correct Supabase project and that there are no syntax errors.

### Step 3: Get Your API Credentials

1. In the Supabase dashboard, click on **Settings** (gear icon) in the left sidebar
2. Click on **API** in the submenu
3. You'll see several keys displayed:
   - **Project URL**: This is your Supabase API endpoint
   - **anon key**: This is your anonymous public key
4. Copy both values somewhere safe (you'll need them in the next step)

### Step 4: Configure the Chrome Extension

1. Open `packages/chrome-extension/src/config.ts`
2. Update the configuration with your credentials:

```typescript
export const SUPABASE_URL = "https://your-project-ref.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key-here";
```

Replace:
- `your-project-ref` with the subdomain from your Project URL
- `your-anon-key-here` with the anon key from Step 3

### Step 5: Enable Real-time Subscriptions

The migration already configures real-time for the `workspaces` and `tabs` tables, but you can verify it's enabled:

1. In the Supabase dashboard, go to **Database** → **Publications**
2. Click on `supabase_realtime`
3. Verify that `workspaces` and `tabs` are checked

This enables real-time synchronization so changes sync instantly across browser tabs and devices.

## Database Schema Overview

### user_settings
Stores encryption metadata for each user. The `encryption_salt` is used for client-side key derivation.

### workspaces
Represents a collection of tabs organized by the user. Supports multiple workspaces for different contexts (work, personal, projects, etc.).

- **Fields**: id, user_id, name (encrypted), color, icon, sort_order, is_active, version, created_at, updated_at

### tabs
Individual browser tabs stored in workspaces. The `user_id` is denormalized for efficient filtering.

- **Fields**: id, workspace_id, user_id, url (encrypted), title (encrypted), favicon_url, sort_order, is_pinned, last_accessed, created_at, updated_at

### sessions
Snapshots of tab arrangements for session management and recovery.

- **Fields**: id, user_id, name, snapshot (JSONB, encrypted), created_at

## Security Features

### Row Level Security (RLS)
All tables have RLS enabled. Users can only access their own data through:
- `SELECT`: View only own rows
- `INSERT`: Create only own rows
- `UPDATE`: Modify only own rows
- `DELETE`: Delete only own rows

Policies use `auth.uid()` to verify user identity.

### Encryption
The schema supports client-side encryption:
- Sensitive fields (names, URLs, titles, snapshots) are encrypted before being sent to the database
- The `encryption_salt` in `user_settings` enables client-side key derivation
- The server never has access to decryption keys or plaintext data

### Auto-Timestamps
- `created_at`: Set automatically when a row is created
- `updated_at`: Automatically updated whenever a row is modified

## Useful SQL Queries

### View all your workspaces
```sql
SELECT id, name, color, is_active, created_at
FROM workspaces
WHERE user_id = auth.uid()
ORDER BY sort_order;
```

### View all tabs in a workspace
```sql
SELECT id, title, url, is_pinned, created_at
FROM tabs
WHERE workspace_id = '...' AND user_id = auth.uid()
ORDER BY sort_order;
```

### Check your encryption salt
```sql
SELECT encryption_salt, created_at
FROM user_settings
WHERE user_id = auth.uid();
```

## Troubleshooting

### "Error: permission denied for schema public"
- Make sure you're running the migration with a Supabase admin user (you should be by default in the SQL Editor)
- Check that you're in the correct Supabase project

### "Error: relation 'auth.users' does not exist"
- This shouldn't happen. Supabase creates the `auth.users` table automatically
- Try refreshing the page and re-running the migration

### Tables not appearing after running migration
- Go to the **Table Editor** in Supabase and refresh the page
- Check the **Database** → **Tables** section to confirm the tables exist

### Real-time not working
- Verify that `workspaces` and `tabs` are checked in **Database** → **Publications** → `supabase_realtime`
- Make sure you're subscribing to real-time in your client code using the Supabase JS client

## Next Steps

1. Install the Supabase JavaScript client in your chrome extension:
   ```bash
   npm install @supabase/supabase-js
   ```

2. Initialize the Supabase client in your extension code:
   ```typescript
   import { createClient } from '@supabase/supabase-js';
   
   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
   ```

3. Implement authentication (Email/Password, OAuth, Magic Links, etc.)

4. Build the tab management features using the Supabase client

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Realtime Subscriptions](https://supabase.com/docs/guides/realtime)
- [Encryption Best Practices](https://supabase.com/docs/guides/auth/encryption)
