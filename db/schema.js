import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const portfolio = sqliteTable('portfolio', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
