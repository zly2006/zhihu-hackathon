import 'server-only';
import {Pool, type PoolClient} from 'pg';
import type {NextRequest} from 'next/server';
import {currentSession} from './zhihu-auth';
import type {State} from './story';

const globalStore = globalThis as typeof globalThis & {lamplightDb?: Pool; lamplightCleanupAt?: number};
function connectionString() { return process.env.LAMPLIGHT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || ''; }
function pool() {
  const url = connectionString();
  if (!url) return null;
  return globalStore.lamplightDb ??= new Pool({connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000, ssl: process.env.LAMPLIGHT_DATABASE_SSL === 'require' ? {rejectUnauthorized: false} : undefined});
}
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T | null> {
  const db = pool(); if (!db) return null;
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}
export async function cleanupExpiredData() {
  const db = pool(); if (!db) return;
  const now = Date.now(); if ((globalStore.lamplightCleanupAt ?? 0) > now - 15 * 60_000) return;
  globalStore.lamplightCleanupAt = now;
  await db.query('SELECT cleanup_lamplight_demo_data()').catch(error => console.error('[db cleanup]', error instanceof Error ? error.message : 'failed'));
}
type EventInput = {type: string; payload?: Record<string, unknown>; storyId?: string};
export async function recordInteraction(request: NextRequest, event: EventInput) {
  const session = currentSession(request); if (!session) return;
  await cleanupExpiredData();
  const profile = session.profile; const providerId = profile?.id || `session:${session.id}`;
  try {
    await withTransaction(async client => {
      const account = await client.query<{id: string}>(`INSERT INTO zhihu_accounts (id, provider_user_id, display_name, avatar_url, headline, profile_url) VALUES ($1,$1,$2,$3,$4,$5) ON CONFLICT (provider_user_id) DO UPDATE SET display_name=EXCLUDED.display_name, avatar_url=EXCLUDED.avatar_url, headline=EXCLUDED.headline, profile_url=EXCLUDED.profile_url, last_seen_at=now(), expires_at=now()+interval '30 days' RETURNING id`, [providerId, profile?.name, profile?.avatarUrl, profile?.headline, profile?.url]);
      if (event.storyId) await client.query(`INSERT INTO game_sessions (id, account_id, mode) VALUES ($1,$2,'live') ON CONFLICT (id) DO UPDATE SET account_id=EXCLUDED.account_id, updated_at=now(), expires_at=now()+interval '30 days'`, [event.storyId, account.rows[0]?.id]);
      await client.query(`INSERT INTO interaction_events (account_id, game_session_id, event_type, payload) VALUES ($1,$2,$3,$4::jsonb)`, [account.rows[0]?.id, event.storyId || null, event.type.slice(0, 100), JSON.stringify(event.payload || {})]);
    });
  } catch (error) { console.error('[db event]', error instanceof Error ? error.message : 'failed'); }
}
export async function recordChat(request: NextRequest, input: {storyId?: string; character: string; messages: {role: string; text: string}[]}) {
  await recordInteraction(request, {type: 'chat_exchange', storyId: input.storyId, payload: {character: input.character, messageCount: input.messages.length, messages: input.messages}});
  const session = currentSession(request); if (!session || !input.storyId) return;
  const providerId = session.profile?.id || `session:${session.id}`;
  try { await withTransaction(async client => {
    const account = await client.query<{id:string}>('SELECT id FROM zhihu_accounts WHERE provider_user_id=$1', [providerId]);
    if (!account.rows[0]) return;
    await client.query(`INSERT INTO game_sessions (id, account_id, mode) VALUES ($1,$2,'live') ON CONFLICT (id) DO NOTHING`, [input.storyId, account.rows[0].id]);
    for (const [index, message] of input.messages.entries()) await client.query('INSERT INTO chat_messages (account_id,game_session_id,character_id,role,message_text,sequence_no) VALUES ($1,$2,$3,$4,$5,$6)', [account.rows[0].id, input.storyId, input.character, message.role, message.text, index]);
  }); } catch (error) { console.error('[db chat]', error instanceof Error ? error.message : 'failed'); }
}
export async function recordStorySnapshot(request: NextRequest, storyId: string, state: State, mode: 'live' | 'demo' = 'live') {
  const session = currentSession(request); if (!session) return;
  await cleanupExpiredData();
  const profile = session.profile; const providerId = profile?.id || `session:${session.id}`;
  try {
    await withTransaction(async client => {
      const account = await client.query<{id: string}>(`INSERT INTO zhihu_accounts (id, provider_user_id, display_name, avatar_url, headline, profile_url) VALUES ($1,$1,$2,$3,$4,$5) ON CONFLICT (provider_user_id) DO UPDATE SET last_seen_at=now(), expires_at=now()+interval '30 days' RETURNING id`, [providerId, profile?.name, profile?.avatarUrl, profile?.headline, profile?.url]);
      await client.query(`INSERT INTO game_sessions (id, account_id, mode, background_id, player_name, player_gender, state) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, updated_at=now(), expires_at=now()+interval '30 days'`, [storyId, account.rows[0]?.id, mode, state.backgroundId, state.player.name, state.player.gender, JSON.stringify(state)]);
      await client.query('DELETE FROM story_nodes WHERE game_session_id=$1', [storyId]);
      for (const [index, node] of state.nodes.entries()) await client.query('INSERT INTO story_nodes (game_session_id,node_index,node) VALUES ($1,$2,$3::jsonb)', [storyId, index, JSON.stringify(node)]);
      await client.query('DELETE FROM story_choices WHERE game_session_id=$1', [storyId]);
      for (const selection of state.selections) await client.query('INSERT INTO story_choices (game_session_id,node_index,choice_index,choice_text,expected_node) VALUES ($1,$2,$3,$4,$5)', [storyId, selection.node, selection.index, selection.text, null]);
      await client.query('INSERT INTO interaction_events (account_id, game_session_id, event_type, payload) VALUES ($1,$2,$3,$4::jsonb)', [account.rows[0]?.id, storyId, 'story_snapshot', JSON.stringify({nodeCount: state.nodes.length, selectionCount: state.selections.length, mode})]);
    });
  } catch (error) { console.error('[db snapshot]', error instanceof Error ? error.message : 'failed'); }
}
