import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'http://127.0.0.1:54321',
  supabaseAnonKey || 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

const tableNames = {
  AiLearnedLessons: 'ai_learned_lessons',
  AiPromptConfig: 'ai_prompt_configs',
  Document: 'documents',
  InspectionStandard: 'inspection_standards',
  IssueArchive: 'issue_archives',
  PicklistOption: 'picklist_options',
  ProductionBatch: 'production_batches',
  ProductionIssue: 'production_issues',
  StandupMeeting: 'standup_meetings',
  StandupPoint: 'standup_points',
  User: 'profiles',
  VisualInspectionEntry: 'visual_inspection_entries',
};

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function mapProfile(profile) {
  if (!profile) return profile;
  return { ...profile, full_name: profile.full_name || profile.display_name || profile.email };
}

function applyOrder(query, order) {
  if (!order) return query;
  const descending = order.startsWith('-');
  const column = descending ? order.slice(1) : order;
  return query.order(column, { ascending: !descending, nullsFirst: false });
}

function createEntity(name) {
  const table = tableNames[name];
  if (!table) throw new Error(`Unknown data collection: ${name}`);
  const isProfile = name === 'User';
  const resultRows = (data) => isProfile
    ? (Array.isArray(data) ? data.map(mapProfile) : mapProfile(data))
    : data;

  const applyFilters = (query, filters = {}) => {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) query = query.eq(key, value);
    });
    return query;
  };

  const list = async (order, limit) => {
    assertConfigured();
    let query = supabase.from(table).select('*');
    query = applyOrder(query, order);
    if (Number.isFinite(limit)) query = query.limit(limit);
    return resultRows(unwrap(await query));
  };

  return {
    list,
    filter: async (filters = {}, order, limit) => {
      assertConfigured();
      let query = applyFilters(supabase.from(table).select('*'), filters);
      query = applyOrder(query, order);
      if (Number.isFinite(limit)) query = query.limit(limit);
      return resultRows(unwrap(await query));
    },
    create: async (values) => {
      assertConfigured();
      const created = resultRows(unwrap(await supabase.from(table).insert(values).select().single()));
      if (name === 'ProductionIssue' && 'severity' in created && created.severity === 'critical') {
        try {
          await invoke('critical-issue-alert', { data: created });
        } catch (error) {
          console.error('Critical issue alert could not be sent:', error);
        }
      }
      return created;
    },
    bulkCreate: async (values) => {
      assertConfigured();
      return resultRows(unwrap(await supabase.from(table).insert(values).select()));
    },
    update: async (id, values) => {
      assertConfigured();
      let shouldSendCriticalAlert = false;
      if (name === 'ProductionIssue' && values.severity === 'critical') {
        const previous = unwrap(await supabase.from(table).select('severity').eq('id', id).maybeSingle());
        shouldSendCriticalAlert = previous?.severity !== 'critical';
      }
      const updated = resultRows(unwrap(await supabase.from(table).update(values).eq('id', id).select().single()));
      if (shouldSendCriticalAlert) {
        try {
          await invoke('critical-issue-alert', { data: updated });
        } catch (error) {
          console.error('Critical issue alert could not be sent:', error);
        }
      }
      if (name === 'VisualInspectionEntry' &&
        values.human_validated === true &&
        values.human_agrees_with_ai === false) {
        try {
          await invoke('regenerateLearnedLessons', { automatic: true });
        } catch (error) {
          console.error('Learned inspection lessons could not be refreshed:', error);
        }
      }
      return updated;
    },
    bulkUpdate: async (rows) => {
      assertConfigured();
      return Promise.all(rows.map(({ id, ...values }) =>
        supabase.from(table).update(values).eq('id', id).select().single().then(unwrap)
      ));
    },
    delete: async (id) => {
      assertConfigured();
      if (isProfile) return invoke('delete-account', { user_id: id });
      return unwrap(await supabase.from(table).delete().eq('id', id).select().maybeSingle());
    },
    subscribe: (callback) => {
      assertConfigured();
      const channel = supabase
        .channel(`${table}-changes`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const event = payload.eventType.toLowerCase();
          callback({
            type: event,
            id: Object.getOwnPropertyDescriptor(payload.old, 'id')?.value ||
              Object.getOwnPropertyDescriptor(payload.new, 'id')?.value,
            data: payload.new ? resultRows(payload.new) : null,
          });
        })
        .subscribe();
      return () => { void supabase.removeChannel(channel); };
    },
  };
}

const entities = Object.fromEntries(
  Object.keys(tableNames).map((name) => [name, createEntity(name)])
);

async function upload(bucket, file, isPublic) {
  assertConfigured();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Sign in before uploading files.');
  const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[\\/]/g, '_')}`;
  unwrap(await supabase.storage.from(bucket).upload(path, file, { upsert: false }));
  if (isPublic) {
    return { file_url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl };
  }
  return { file_uri: path };
}

async function invoke(action, body = {}) {
  assertConfigured();
  const { data, error } = await supabase.functions.invoke('app-api', {
    body: { ...body, action },
  });
  if (error) throw error;
  return { data };
}

export const backend = {
  entities,
  auth: {
    me: async () => {
      assertConfigured();
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error('Not signed in.');
      const profile = unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single());
      return mapProfile({ ...profile, email: user.email });
    },
    logout: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    redirectToLogin: () => { window.location.assign('/login'); },
  },
  functions: {
    invoke,
  },
  users: {
    inviteUser: (email, role) => invoke('invite-user', { email, role }),
  },
  integrations: {
    Core: {
      UploadFile: ({ file }) => upload('app-files', file, true),
      UploadPublicFile: ({ file }) => upload('app-files', file, true),
      UploadPrivateFile: ({ file }) => upload('private-uploads', file, false),
      CreateFileSignedUrl: async ({ file_uri, expires_in }) => {
        assertConfigured();
        const signed = unwrap(await supabase.storage.from('private-uploads').createSignedUrl(file_uri, expires_in));
        return { signed_url: signed.signedUrl };
      },
      InvokeLLM: async (body) => (await invoke('invoke-llm', body)).data,
      SendEmail: (body) => invoke('send-email', body),
      ExtractDataFromUploadedFile: async (body) => (await invoke('extract-uploaded-data', body)).data,
    },
  },
};
