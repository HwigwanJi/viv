import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const workspaceHeads = sqliteTable('workspace_heads', {
  ownerId: text('owner_id').primaryKey(), revision: integer('revision').notNull(),
  metadata: text('metadata').notNull(), lastCommandId: text('last_command_id').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const workspaceObjects = sqliteTable('workspace_objects', {
  ownerId: text('owner_id').notNull(), kind: text('kind').notNull(), objectId: text('object_id').notNull(),
  ordinal: integer('ordinal').notNull(), payload: text('payload').notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.kind, t.objectId] })]);
export const operationClaims = sqliteTable('operation_claims', {
  ownerId: text('owner_id').notNull(), resourceId: text('resource_id').notNull(),
  commandKey: text('command_key').notNull(), fingerprint: text('fingerprint').notNull(),
  claimToken: text('claim_token').notNull(), status: text('status').notNull(),
  baseRevision: integer('base_revision').notNull(), leaseUntil: integer('lease_until').notNull(),
  startedAt: text('started_at').notNull(), finishedAt: text('finished_at'),
}, t => [primaryKey({ columns: [t.ownerId, t.resourceId] })]);
