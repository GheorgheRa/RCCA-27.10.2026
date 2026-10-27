import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';
import { pdf } from 'npm:pdfjs-dist@4.7.76/build/pdf.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function requireValue(value: unknown, name: string): asserts value {
  if (!value) throw new Response(`${name} is required`, { status: 400 });
}

async function getProfile(userId: string) {
  const { data, error } = await service.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

async function requireAdmin(userId: string) {
  const profile = await getProfile(userId);
  if (profile.role !== 'admin') throw new Response('Forbidden', { status: 403 });
  return profile;
}

function schemaForPrompt(schema: unknown) {
  return schema && typeof schema === 'object'
    ? JSON.stringify(schema)
    : JSON.stringify({ type: 'object', additionalProperties: true });
}

async function callModel(input: Record<string, unknown>) {
  const apiKey = Deno.env.get('AI_API_KEY');
  if (!apiKey) throw new Response('AI_API_KEY is not configured in Supabase secrets.', { status: 503 });

  const apiUrl = Deno.env.get('AI_API_URL') || 'https://api.openai.com/v1/chat/completions';
  const requestedModel = String(input.model || '');
  const model = requestedModel === 'gemini_3_flash'
    ? Deno.env.get('AI_FAST_MODEL') || Deno.env.get('AI_MODEL') || 'gpt-4o-mini'
    : requestedModel === 'claude_sonnet_4_6'
      ? Deno.env.get('AI_ACCURATE_MODEL') || Deno.env.get('AI_MODEL') || 'gpt-4o-mini'
      : requestedModel || Deno.env.get('AI_MODEL') || 'gpt-4o-mini';
  const prompt = String(input.prompt || '');
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  const imageUrls = Array.isArray(input.file_urls) ? input.file_urls : [];
  for (const url of imageUrls) {
    if (typeof url === 'string') {
      content.push({ type: 'image_url', image_url: { url } });
    }
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: imageUrls.length ? content : prompt }],
      ...(input.response_json_schema ? {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'application_response',
            strict: false,
            schema: input.response_json_schema,
          },
        },
      } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Response(`AI provider returned ${response.status}: ${detail}`, { status: 502 });
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('AI provider returned no text content.');
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return text;
  }
}

async function sendMail(payload: Record<string, unknown>, cron = false) {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) throw new Response('RESEND_API_KEY and EMAIL_FROM must be configured.', { status: 503 });

  const configuredRecipient = Deno.env.get('CRITICAL_ALERT_EMAIL');
  const to = cron ? payload.to : configuredRecipient;
  if (typeof to !== 'string' || !to.trim()) {
    throw new Response('CRITICAL_ALERT_EMAIL must be configured.', { status: 503 });
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: String(payload.from_name || 'AEE RCCA Tracker') + ` <${from}>`,
      to: [to],
      subject: String(payload.subject || 'AEE RCCA Tracker notification'),
      ...(typeof payload.body === 'string' && /<\/?[a-z][\s\S]*>/i.test(payload.body)
        ? { html: payload.body }
        : { text: String(payload.body || '') }),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Response(`Email provider returned ${response.status}: ${detail}`, { status: 502 });
  }
  return await response.json();
}

async function extractPdfRows(fileUrl: string): Promise<Record<string, unknown>[]> {
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Response(`Uploaded file could not be read (${fileResponse.status}).`, { status: 422 });
  }
  const buffer = await fileResponse.arrayBuffer();
  const doc = await pdf({ data: buffer }, { useWorker: false, isEvalSupported: false });
  const rows: Record<string, unknown>[] = [];
  const numPages = doc.numPages;
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; transform: number[]; width: number }>;
    const lines = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push({ x, str: item.str });
    }
    const sortedY = [...lines.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const parts = lines.get(y)!.sort((a, b) => a.x - b.x);
      const text = parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const cells = text.split(/\s{2,}|\t/).map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        rows.push(Object.fromEntries(cells.map((c, idx) => [`col${idx}`, c])));
      }
    }
  }
  await doc.destroy();
  return rows.slice(0, 500);
}

function normalizePicklistRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const aliases: Record<string, string[]> = {
    value: ['value', 'part_number', 'partnumber', 'part number', 'pn', 'part_num', 'part', 'utilaj', 'serial', 'serial#', 'serial_number'],
    label: ['label', 'alias', 'alias (optional)', 'description', 'name', 'secondary', 'alias(optional)'],
    client: ['client', 'customer', 'client_code', 'clientcode'],
    active: ['active', 'is_active', 'enabled'],
  };
  const findKey = (row: Record<string, unknown>, targets: string[]): string | undefined => {
    const lowerKeys = Object.keys(row).map((k) => ({ k, lower: k.toLowerCase().replace(/[\s_()-]/g, '') }));
    for (const target of targets) {
      const cleanTarget = target.toLowerCase().replace(/[\s_()-]/g, '');
      const match = lowerKeys.find(({ lower }) => lower === cleanTarget);
      if (match) return match.k;
    }
    for (const target of targets) {
      const cleanTarget = target.toLowerCase().replace(/[\s_()-]/g, '');
      const match = lowerKeys.find(({ lower }) => lower.includes(cleanTarget) || cleanTarget.includes(lower));
      if (match) return match.k;
    }
    return undefined;
  };
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [target, candidates] of Object.entries(aliases)) {
      const sourceKey = findKey(row, candidates);
      if (sourceKey !== undefined) normalized[target] = row[sourceKey];
    }
    if (normalized.value === undefined && normalized.label !== undefined) {
      normalized.value = normalized.label;
    }
    if (normalized.label === undefined && normalized.value !== undefined) {
      const firstExtra = Object.entries(row).find(([k]) => !findKey(row, aliases.value) || k !== findKey(row, aliases.value));
      if (firstExtra) normalized.label = firstExtra[1];
    }
    Object.assign(normalized, row);
    return normalized;
  });
}

async function extractRows(fileUrl: string, schema: Record<string, unknown>) {
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Response(`Uploaded file could not be read (${fileResponse.status}).`, { status: 422 });
  }
  const fileType = fileResponse.headers.get('content-type') || '';
  const extension = new URL(fileUrl).pathname.split('.').pop()?.toLowerCase();
  if (['csv', 'tsv', 'xls', 'xlsx'].includes(extension || '') || /spreadsheet|csv|excel/.test(fileType)) {
    const workbook = XLSX.read(await fileResponse.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).slice(0, 500);
  }
  if (extension === 'json' || fileType.includes('application/json')) {
    const data = await fileResponse.json();
    return Array.isArray(data) ? data.slice(0, 500) : [data];
  }
  if (extension === 'txt' || fileType.startsWith('text/plain')) {
    const text = await fileResponse.text();
    return text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 500)
      .map((value) => ({ label: value, value }));
  }
  if (extension === 'pdf' || fileType.includes('application/pdf')) {
    return await extractPdfRows(fileUrl);
  }

  const rowSchema = schema.type === 'array' ? schema.items : schema;
  const result = await callModel({
    prompt: `Extract every row from the uploaded file. Return the rows in a JSON array named "rows", matching this schema: ${schemaForPrompt(schema)}. Preserve values exactly; do not invent missing fields.`,
    file_urls: [fileUrl],
    response_json_schema: {
      type: 'object',
      properties: { rows: { type: 'array', items: rowSchema } },
      required: ['rows'],
    },
  });
  if (Array.isArray(result?.rows)) return result.rows;
  return Array.isArray(result) ? result : [result];
}

async function sendCorrectiveReminders() {
  const [{ data: issues, error: issuesError }, { data: profiles, error: profilesError }] = await Promise.all([
    service.from('production_issues').select('*').neq('status', 'closed'),
    service.from('profiles').select('email,display_name,full_name'),
  ]);
  if (issuesError) throw issuesError;
  if (profilesError) throw profilesError;
  const today = new Date().toISOString().slice(0, 10);
  const users = new Map<string, string>();
  for (const profile of profiles || []) {
    if (!profile.email) continue;
    users.set(String(profile.display_name || profile.full_name || profile.email).toLowerCase(), profile.email);
    users.set(String(profile.email).toLowerCase(), profile.email);
  }

  const sent = [];
  for (const issue of issues || []) {
    let actions = [];
    try { actions = JSON.parse(issue.corrective_actions_json || '[]'); } catch { actions = []; }
    for (const action of actions) {
      if (!action.owner || !action.due_date || action.completed_date || action.due_date > today) continue;
      const email = users.get(String(action.owner).toLowerCase());
      if (!email) continue;
      const issueRef = issue.issue_number || issue.id;
      const actionDesc = action.action || action.description || action.corrective_action || '(no description)';
      await sendMail({
        to: email,
        subject: `Action reminder - ${issueRef}: ${issue.title || issueRef}`,
        body: `An open corrective action is due.\n\nIssue: ${issueRef}\nOwner: ${action.owner}\nDue date: ${action.due_date}\nAction: ${actionDesc}`,
      }, true);
      sent.push({ email, issue: issueRef, action: actionDesc, due_date: action.due_date });
    }
  }
  return { sent, count: sent.length };
}

async function sendStandupReminders() {
  const [{ data: points, error: pointsError }, { data: profiles, error: profilesError }] = await Promise.all([
    service.from('standup_points').select('*').eq('is_archived', false).neq('status', 'Resolved'),
    service.from('profiles').select('email'),
  ]);
  if (pointsError) throw pointsError;
  if (profilesError) throw profilesError;
  const knownEmails = new Set((profiles || []).map((profile) => String(profile.email || '').toLowerCase()));
  const today = new Date().toISOString().slice(0, 10);
  const sent = [];

  for (const point of points || []) {
    const recipients: Array<{ email: string; due: string; subject: string; body: string }> = [];
    if (point.category === 'Materiale') {
      let rows = [];
      try { rows = JSON.parse(point.description || '[]'); } catch { rows = []; }
      if (!Array.isArray(rows)) rows = [];
      for (const row of rows) {
        const email = String(row.responsabil || '').toLowerCase();
        const due = String(row.termen || '');
        if (email && knownEmails.has(email) && row.actiune && due && due <= today) {
          recipients.push({
            email, due, subject: 'Memento punct standup - Materiale',
            body: `P/N blocat: ${row.pn_blocat || '-'}\nMaterial lipsă: ${row.mat_lipsa || '-'}\nTermen limită: ${due}\nAcțiune: ${row.actiune}`,
          });
        }
      }
    } else {
      const email = String(point.owner_email || '').toLowerCase();
      const due = String(point.due_date || '');
      if (email && knownEmails.has(email) && point.action && due && due <= today) {
        recipients.push({
          email, due, subject: `Memento punct standup - ${point.category}`,
          body: `Categorie: ${point.category}\nDescriere: ${point.description || '-'}\nTermen limită: ${due}\nAcțiune: ${point.action}`,
        });
      }
    }
    for (const recipient of recipients) {
      await sendMail(recipient, true);
      sent.push({ email: recipient.email, due_date: recipient.due, category: point.category });
    }
  }
  return { sent, count: sent.length };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json();
    const action = String(body.action || '');

    if (action === 'correctiveActionReminder' || action === 'sendStandupReminders') {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) {
        return json({ error: 'Unauthorized' }, 401);
      }
      return json(action === 'correctiveActionReminder'
        ? await sendCorrectiveReminders()
        : await sendStandupReminders());
    }

    const auth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: request.headers.get('Authorization') || '' } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await auth.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    switch (action) {
      case 'getUsers': {
        const { data: users, error } = await service.from('profiles').select('*').order('created_date').limit(500);
        if (error) throw error;
        const full = (users || []).map((profile) => ({
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          display_name: profile.display_name || null,
          role: profile.role,
          page_permissions: profile.page_permissions || null,
        }));
        return json({
          users: full.map((profile) => ({
            value: profile.display_name || profile.full_name || profile.email,
            label: profile.display_name || profile.full_name || profile.email,
            email: profile.email,
          })).filter((profile) => profile.value),
          full,
        });
      }

      case 'invite-user': {
        await requireAdmin(user.id);
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email address' }, 400);
        const role = body.role === 'admin' ? 'admin' : 'user';
        const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
          data: { full_name: email },
        });
        if (error) throw error;
        const { error: profileError } = await service.from('profiles').update({ role }).eq('id', data.user.id);
        if (profileError) throw profileError;
        return json({ invited: true, user_id: data.user.id });
      }

      case 'create-user-with-password': {
        await requireAdmin(user.id);
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Invalid email address' }, 400);
        const password = String(body.password || '');
        if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
        const role = body.role === 'admin' ? 'admin' : 'user';
        const name = String(body.name || '').trim();
        const { data, error } = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: name ? { full_name: name, display_name: name } : { full_name: email },
        });
        if (error) throw error;
        const { error: profileError } = await service.from('profiles')
          .update({ role, ...(name ? { full_name: name, display_name: name } : {}) })
          .eq('id', data.user.id);
        if (profileError) throw profileError;
        return json({ created: true, user_id: data.user.id });
      }

      case 'bulk-create-users': {
        await requireAdmin(user.id);
        const users = Array.isArray(body.users) ? body.users : [];
        if (!users.length) return json({ error: 'No users provided' }, 400);
        const defaultPassword = String(body.default_password || '');
        const results = { created: 0, failed: 0, errors: [] as string[] };
        const createdUserIds: { id: string; role: string; name: string }[] = [];

        for (const entry of users.slice(0, 200)) {
          const email = String(entry.email || '').trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            results.failed++;
            results.errors.push(`${email || '(empty)'}: invalid email`);
            continue;
          }
          const role = entry.role === 'admin' ? 'admin' : 'user';
          const name = String(entry.name || '').trim();
          const password = String(entry.password || defaultPassword || '');
          try {
            let userId: string;
            if (password.length >= 6) {
              const { data, error } = await service.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: name ? { full_name: name, display_name: name } : { full_name: email },
              });
              if (error) {
                results.failed++;
                results.errors.push(`${email}: ${error.message}`);
                continue;
              }
              userId = data.user.id;
            } else {
              const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
                data: { full_name: name || email },
              });
              if (error) {
                results.failed++;
                results.errors.push(`${email}: ${error.message}`);
                continue;
              }
              userId = data.user.id;
            }
            createdUserIds.push({ id: userId, role, name });
            results.created++;
          } catch (err) {
            results.failed++;
            results.errors.push(`${email}: ${err instanceof Error ? err.message : 'unknown error'}`);
          }
        }

        // Batch-update profiles: group by role, set name via individual update
        const adminIds = createdUserIds.filter(u => u.role === 'admin').map(u => u.id);
        const userIds = createdUserIds.filter(u => u.role !== 'admin').map(u => u.id);
        if (adminIds.length) {
          const { error } = await service.from('profiles').update({ role: 'admin' }).in('id', adminIds);
          if (error) results.errors.push(`Batch admin role update failed: ${error.message}`);
        }
        if (userIds.length) {
          const { error } = await service.from('profiles').update({ role: 'user' }).in('id', userIds);
          if (error) results.errors.push(`Batch user role update failed: ${error.message}`);
        }
        // Update names individually (only where a name was provided)
        const namedUsers = createdUserIds.filter(u => u.name);
        for (const u of namedUsers) {
          await service.from('profiles').update({ full_name: u.name, display_name: u.name }).eq('id', u.id);
        }

        return json(results);
      }

      case 'delete-account': {
        const userId = String(body.user_id || '');
        if (userId !== user.id) await requireAdmin(user.id);
        requireValue(userId, 'user_id');
        const { error } = await service.auth.admin.deleteUser(userId);
        if (error) throw error;
        return json({ deleted: true });
      }

      case 'saveOwnerFeedback': {
        requireValue(body.issue_id, 'issue_id');
        if (!Array.isArray(body.actions)) return json({ error: 'actions must be an array' }, 400);
        const { data: issue, error: issueError } = await service
          .from('production_issues').select('*').eq('id', body.issue_id).maybeSingle();
        if (issueError) throw issueError;
        if (!issue) return json({ error: 'Issue not found' }, 404);
        const profile = await getProfile(user.id);
        const myName = profile.display_name || profile.full_name || user.email;
        let current = [];
        try { current = JSON.parse(issue.corrective_actions_json || '[]'); } catch { current = []; }
        if (!current.some((item) => item.owner === myName) && profile.role !== 'admin') {
          return json({ error: 'You do not own an action on this issue.' }, 403);
        }
        const merged = current.map((item, index) => {
          const incoming = body.actions[index];
          if (!incoming || (profile.role !== 'admin' && item.owner !== myName)) return item;
          return {
            ...item,
            owner_feedback: incoming.owner_feedback ?? item.owner_feedback,
            feedback_date: incoming.feedback_date ?? item.feedback_date,
          };
        });
        const feedbackPending = merged.some((item) => String(item.owner_feedback || '').trim());
        const { error } = await service.from('production_issues').update({
          corrective_actions_json: JSON.stringify(merged),
          feedback_pending: feedbackPending,
        }).eq('id', body.issue_id);
        if (error) throw error;
        return json({ success: true, corrective_actions_json: JSON.stringify(merged) });
      }

      case 'invoke-llm':
        return json(await callModel(body));

      case 'extract-uploaded-data': {
        await requireAdmin(user.id);
        requireValue(body.file_url, 'file_url');
        const rows = await extractRows(String(body.file_url), body.json_schema || {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        });
        return json({ status: 'success', output: rows });
      }

      case 'importPicklistFile':
      case 'importUsersFile': {
        await requireAdmin(user.id);
        requireValue(body.file_url, 'file_url');
        const userImport = action === 'importUsersFile';
        const schema = userImport
          ? {
              type: 'array',
              items: { type: 'object', properties: {
                email: { type: 'string' }, role: { type: 'string' }, name: { type: 'string' },
              }, required: ['email'] },
            }
          : {
              type: 'array',
              items: { type: 'object', properties: {
                label: { type: 'string' }, value: { type: 'string' },
                client: { type: 'string' }, active: { type: 'boolean' },
              }, required: ['value'] },
            };
        const rows = await extractRows(String(body.file_url), schema);
        return json({
          rows: userImport
            ? rows.filter((row) => row && typeof row.email === 'string' && row.email.trim())
                .slice(0, 200).map((row) => ({
                  email: row.email.trim(),
                  role: String(row.role || '').toLowerCase() === 'admin' ? 'admin' : 'user',
                  name: String(row.name || '').trim(),
                }))
            : normalizePicklistRows(rows.filter((row) => row && typeof row === 'object').slice(0, 500)),
        });
      }

      case 'send-email': {
        const profile = await getProfile(user.id);
        if (profile.role !== 'admin') {
          const configured = Deno.env.get('CRITICAL_ALERT_EMAIL')?.toLowerCase();
          if (!configured || (body.to && String(body.to).toLowerCase() !== configured)) {
            return json({ error: 'Email recipient is not authorized.' }, 403);
          }
        }
        const sent = await sendMail(body);
        return json({ sent: true, id: sent.id });
      }

      case 'critical-issue-alert': {
        const issue = body.data;
        if (!issue || issue.severity !== 'critical') return json({ skipped: true });
        const issueNumber = String(issue.issue_number || issue.id || '—');
        const sent = await sendMail({
          subject: `Critical production issue: ${issueNumber}`,
          body: [
            'A critical production issue has been reported.',
            `Issue: ${issueNumber}`,
            `Defect: ${issue.title || '—'}`,
            `Description: ${issue.defect_description || '—'}`,
            `Downtime start: ${issue.downtime_start || '—'}`,
          ].join('\n'),
        });
        return json({ sent: true, issue_number: issueNumber, id: sent.id });
      }

      case 'regenerateLearnedLessons': {
        const profile = await getProfile(user.id);
        if (profile.role !== 'admin') {
          if (body.automatic !== true) return json({ error: 'Forbidden' }, 403);
          const { data: previousRun, error: previousRunError } = await service
            .from('ai_job_runs').select('last_run_at').eq('user_id', user.id).maybeSingle();
          if (previousRunError) throw previousRunError;
          if (previousRun && Date.now() - new Date(previousRun.last_run_at).getTime() < 60 * 60 * 1000) {
            return json({ skipped: true, message: 'A recent automatic refresh already ran.' });
          }
          const { error: runError } = await service.from('ai_job_runs').upsert({
            user_id: user.id,
            last_run_at: new Date().toISOString(),
          });
          if (runError) throw runError;
        }
        const { data: entries, error } = await service
          .from('visual_inspection_entries')
          .select('*')
          .eq('human_validated', true)
          .eq('human_agrees_with_ai', false)
          .order('validated_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        const corrections = (entries || []).filter((entry) =>
          entry.human_corrected_label?.trim() || entry.human_feedback?.trim());
        const { data: existing, error: existingError } = await service
          .from('ai_learned_lessons').select('*').order('generated_at', { ascending: false }).limit(1);
        if (existingError) throw existingError;
        const now = new Date().toISOString();
        if (!corrections.length) {
          if (existing?.[0]) {
            const { error: updateError } = await service.from('ai_learned_lessons').update({
              summary_text: '', corrections_count: 0, last_correction_id: null,
              generated_at: now, generated_by: user.email || '',
            }).eq('id', existing[0].id);
            if (updateError) throw updateError;
          }
          return json({ summary: '', count: 0, message: 'No corrections to summarize' });
        }
        const correctionText = corrections.map((entry, index) =>
          `${index + 1}. Part: ${entry.part_number || '—'}, Client: ${entry.client || '—'}\n` +
          `Human correction: ${entry.human_corrected_label || ''}\nFeedback: ${entry.human_feedback || ''}`
        ).join('\n');
        const result = await callModel({
          prompt: `Summarize these ${corrections.length} aviation visual inspection corrections as compact, specific, actionable lessons (maximum 500 words). Return JSON with a "summary" string.\n\n${correctionText}`,
          response_json_schema: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          },
        });
        const summary = typeof result === 'string' ? result : String(result?.summary || '');
        const values = {
          summary_text: summary,
          corrections_count: corrections.length,
          last_correction_id: corrections[0].id,
          generated_at: now,
          generated_by: profile.email || user.email || '',
        };
        const saveResult = existing?.[0]
          ? await service.from('ai_learned_lessons').update(values).eq('id', existing[0].id)
          : await service.from('ai_learned_lessons').insert(values);
        if (saveResult.error) throw saveResult.error;
        return json({ summary, count: corrections.length, message: 'Lessons regenerated successfully' });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 404);
    }
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    console.error('app-api request failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected server error' }, 500);
  }
});
