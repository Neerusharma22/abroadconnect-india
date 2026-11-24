import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { sqlApplications, sqlNotes, users } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string, displayName = '') {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          ...(displayName ? { displayName } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Unable to synchronize user account.', { cause: error });
  }
}

export async function getUserApplications(uid: string) {
  try {
    const rows = await db
      .select({
        id: sqlApplications.id,
        institutionName: sqlApplications.institutionName,
        countrySlug: sqlApplications.countrySlug,
        programTitle: sqlApplications.programTitle,
        intake: sqlApplications.intake,
        status: sqlApplications.status,
        deadlineDate: sqlApplications.deadlineDate,
        notes: sqlApplications.notes,
        createdAt: sqlApplications.createdAt,
        updatedAt: sqlApplications.updatedAt,
      })
      .from(sqlApplications)
      .innerJoin(users, eq(sqlApplications.userId, users.id))
      .where(eq(users.uid, uid))
      .orderBy(desc(sqlApplications.createdAt));

    return rows;
  } catch (error) {
    console.error('Database query failed:', error);
    throw new Error('Unable to load applications right now.', { cause: error });
  }
}

export async function createUserApplication(
  uid: string,
  email: string,
  displayName: string,
  payload: {
    institutionName: string;
    countrySlug: string;
    programTitle: string;
    intake: string;
    status: string;
    deadlineDate: string;
    notes: string;
  }
) {
  try {
    const user = await getOrCreateUser(uid, email, displayName);
    const inserted = await db
      .insert(sqlApplications)
      .values({
        userId: user.id,
        institutionName: payload.institutionName,
        countrySlug: payload.countrySlug,
        programTitle: payload.programTitle,
        intake: payload.intake,
        status: payload.status,
        deadlineDate: payload.deadlineDate,
        notes: payload.notes,
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database insert failed:', error);
    throw new Error('Unable to save application record.', { cause: error });
  }
}

export async function updateUserApplicationStatus(uid: string, applicationId: number, status: string) {
  try {
    const existingUser = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (!existingUser[0]) {
      return null;
    }

    const updated = await db
      .update(sqlApplications)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(sqlApplications.id, applicationId), eq(sqlApplications.userId, existingUser[0].id)))
      .returning();

    return updated[0] || null;
  } catch (error) {
    console.error('Database update failed:', error);
    throw new Error('Unable to update application status.', { cause: error });
  }
}

export async function deleteUserApplication(uid: string, applicationId: number) {
  try {
    const existingUser = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (!existingUser[0]) {
      return false;
    }

    const deleted = await db
      .delete(sqlApplications)
      .where(and(eq(sqlApplications.id, applicationId), eq(sqlApplications.userId, existingUser[0].id)))
      .returning();

    return deleted.length > 0;
  } catch (error) {
    console.error('Database delete failed:', error);
    throw new Error('Unable to delete application record.', { cause: error });
  }
}

export async function getUserStudyNotes(uid: string) {
  try {
    return await db
      .select({
        id: sqlNotes.id,
        title: sqlNotes.title,
        category: sqlNotes.category,
        content: sqlNotes.content,
        countrySlug: sqlNotes.countrySlug,
        createdAt: sqlNotes.createdAt,
      })
      .from(sqlNotes)
      .innerJoin(users, eq(sqlNotes.userId, users.id))
      .where(eq(users.uid, uid))
      .orderBy(desc(sqlNotes.createdAt));
  } catch (error) {
    console.error('Database query failed:', error);
    throw new Error('Unable to load study notes right now.', { cause: error });
  }
}

export async function createUserStudyNote(
  uid: string,
  email: string,
  displayName: string,
  payload: { title: string; category: string; content: string; countrySlug: string }
) {
  try {
    const user = await getOrCreateUser(uid, email, displayName);
    const inserted = await db
      .insert(sqlNotes)
      .values({
        userId: user.id,
        title: payload.title,
        category: payload.category,
        content: payload.content,
        countrySlug: payload.countrySlug,
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database insert failed:', error);
    throw new Error('Unable to save study note.', { cause: error });
  }
}

export async function deleteUserStudyNote(uid: string, noteId: number) {
  try {
    const existingUser = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (!existingUser[0]) {
      return false;
    }

    const deleted = await db
      .delete(sqlNotes)
      .where(and(eq(sqlNotes.id, noteId), eq(sqlNotes.userId, existingUser[0].id)))
      .returning();

    return deleted.length > 0;
  } catch (error) {
    console.error('Database delete failed:', error);
    throw new Error('Unable to delete study note.', { cause: error });
  }
}
