import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | null = null;

export function ensureChatLogDatabase() {
  if (!schemaReady) {
    schemaReady = (async () => {
      if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");

      await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          visitor_name TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          visitor_name TEXT NOT NULL,
          application_id TEXT,
          status TEXT DEFAULT 'active' NOT NULL,
          consent_at TEXT NOT NULL,
          integration_status TEXT DEFAULT 'local_only' NOT NULL,
          integration_error TEXT,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ended_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions (updated_at)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_sessions_application_id_idx ON chat_sessions (application_id)"),
      ]);

      const messageColumns = await env.DB.prepare("PRAGMA table_info(chat_messages)").all<{ name: string }>();
      if (!(messageColumns.results ?? []).some((column) => column.name === "session_id")) {
        await env.DB.prepare("ALTER TABLE chat_messages ADD COLUMN session_id TEXT").run();
      }
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages (session_id)").run();
      await env.DB.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
