# GitHub-copilot-27.10.2026

Independent AEE production quality and RCCA tracker built with React, Vite, and Supabase. The existing screens and workflows are retained; Supabase now provides authentication, PostgreSQL, file storage, and server-side actions. There is no runtime dependency on Base44.

## Features

- Production issues, corrective actions, batches, analytics, archives, and document management
- Daily production meeting board and visual inspection workflow
- Per-user page permissions and administrator-managed accounts and picklists
- Supabase realtime updates, file uploads, private archive storage, and email/AI integrations
- Responsive dashboard and layouts retained from the original application

## Local development and Bolt.new

1. Create a Supabase project and connect it to Bolt.new (or use the Supabase CLI).
2. Link the CLI to the new project and apply the database migration:

   ```sh
   supabase login
   supabase link --project-ref your-project-ref
   supabase db push
   ```

3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the Supabase project API settings.
4. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

5. In Supabase Authentication settings, set the application URL and allowed redirect URLs. Keep public sign-up disabled for an invite-only deployment.
6. Deploy the server-side API and configure its secrets:

   ```sh
   supabase functions deploy app-api
   supabase secrets set AI_API_KEY=your_ai_provider_key
   supabase secrets set AI_API_URL=https://api.openai.com/v1/chat/completions
   supabase secrets set AI_MODEL=gpt-4o-mini
   supabase secrets set RESEND_API_KEY=your_resend_key
   supabase secrets set EMAIL_FROM=tracker@example.com
   supabase secrets set CRITICAL_ALERT_EMAIL=quality@example.com
   supabase secrets set CRON_SECRET=use-a-long-random-secret
   ```

   `AI_API_URL` must be an OpenAI-compatible chat-completions endpoint. Optional `AI_FAST_MODEL` and `AI_ACCURATE_MODEL` secrets map the visual-inspection model choices to provider model names. AI and email features stay unavailable until their provider secrets are configured.

## First administrator

Create the first account using Supabase Dashboard → Authentication → Users → Invite user. The migration automatically creates its profile. Then promote that account from the SQL Editor:

```sql
update public.profiles
set role = 'admin'
where email = 'admin@example.com';
```

Administrators can invite subsequent users from Settings. The application stores each account's role and page permissions in `public.profiles`.

## Data and reminders

The migration creates the application tables, row-level security policies, storage buckets, realtime issue feed, and baseline issue/process/department picklists. Upload production-specific part-number and machine-serial picklists through the existing Settings import tools. Existing Base44 records are not copied automatically; export them from the original service and import the applicable CSV/XLSX data into this Supabase project.

The Edge Function also exposes the scheduled actions `correctiveActionReminder` and `sendStandupReminders`. Configure a Supabase Cron job to POST `{"action":"correctiveActionReminder"}` or `{"action":"sendStandupReminders"}` to `/functions/v1/app-api` with `Authorization: Bearer <CRON_SECRET>`. Email actions use Resend; `CRITICAL_ALERT_EMAIL` is the configured notification recipient.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Create the production bundle |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm run preview` | Preview the production bundle |
