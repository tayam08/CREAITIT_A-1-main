import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  visitorName: text("visitor_name").notNull(),
  applicationId: text("application_id"),
  status: text("status").notNull().default("active"),
  consentAt: text("consent_at").notNull(),
  integrationStatus: text("integration_status").notNull().default("local_only"),
  integrationError: text("integration_error"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: text("ended_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("chat_sessions_updated_at_idx").on(table.updatedAt),
  index("chat_sessions_application_id_idx").on(table.applicationId),
]);

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id"),
  visitorName: text("visitor_name").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("chat_messages_session_id_idx").on(table.sessionId)]);
