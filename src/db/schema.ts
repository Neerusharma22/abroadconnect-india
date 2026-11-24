import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').default('').notNull(),
  targetCountry: text('target_country').default('germany').notNull(),
  preferredLanguage: text('preferred_language').default('en').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sqlApplications = pgTable('sql_applications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  institutionName: text('institution_name').notNull(),
  countrySlug: text('country_slug').notNull(),
  programTitle: text('program_title').notNull(),
  intake: text('intake').default('Winter 2027').notNull(),
  status: text('status').default('researching').notNull(),
  deadlineDate: text('deadline_date').default('').notNull(),
  notes: text('notes').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sqlNotes = pgTable('sql_notes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  category: text('category').default('general').notNull(),
  content: text('content').notNull(),
  countrySlug: text('country_slug').default('germany').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  applications: many(sqlApplications),
  notes: many(sqlNotes),
}));

export const sqlApplicationsRelations = relations(sqlApplications, ({ one }) => ({
  owner: one(users, {
    fields: [sqlApplications.userId],
    references: [users.id],
  }),
}));

export const sqlNotesRelations = relations(sqlNotes, ({ one }) => ({
  owner: one(users, {
    fields: [sqlNotes.userId],
    references: [users.id],
  }),
}));
