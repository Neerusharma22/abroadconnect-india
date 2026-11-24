import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../server.ts';

let baseUrl = '';
let closeServer: () => Promise<void>;
let tempDbFile = '';

async function req(
  urlPath: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<{ status: number; data: Record<string, any> }> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'AbroadConnect',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}/api/v1${urlPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

before(async () => {
  tempDbFile = path.join(os.tmpdir(), `abroadconnect-test-${Date.now()}.db`);
  const { server, db } = await createAppServer({ customDbPath: tempDbFile, skipVite: true });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.close((err) => {
        try {
          db.close();
        } catch {
          // ignore
        }
        if (err) reject(err);
        else resolve();
      });
    });
});

after(async () => {
  await closeServer();
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(tempDbFile + suffix)) {
      fs.unlinkSync(tempDbFile + suffix);
    }
  }
});

describe('AbroadConnect India Critical Path Acceptance Tests', () => {
  let userAToken = '';
  let userAId = '';
  let userBToken = '';
  let userBId = '';
  let adminToken = '';

  it('rejects invalid OTP and succeeds on valid OTP registration + onboarding', async () => {
    const reqRes = await req('/auth/otp/request', {
      method: 'POST',
      body: { channel: 'email', identifier: 'chennai.student@example.in' },
    });
    assert.equal(reqRes.status, 200);
    assert.ok(reqRes.data.previewOtp);

    const badVerify = await req('/auth/otp/verify', {
      method: 'POST',
      body: { channel: 'email', identifier: 'chennai.student@example.in', code: '000000', acceptedTerms: true },
    });
    assert.equal(badVerify.status, 400);

    const okVerify = await req('/auth/otp/verify', {
      method: 'POST',
      body: {
        channel: 'email',
        identifier: 'chennai.student@example.in',
        code: reqRes.data.previewOtp,
        acceptedTerms: true,
      },
    });
    assert.equal(okVerify.status, 200);
    userAToken = okVerify.data.token;
    userAId = okVerify.data.user.id;

    const onboard = await req('/profiles/me', {
      method: 'PUT',
      token: userAToken,
      body: {
        display_name: 'Meera Krishnan',
        city: 'Chennai',
        primary_destination_country: 'germany',
        purpose: 'Study',
        intended_intake: 'Winter 2027',
        academic_score_private: '9.1 CGPA',
        budget_range_private: '14 Lakhs INR',
        onboarding_completed: true,
      },
    });
    assert.equal(onboard.status, 200);
    assert.equal(onboard.data.user.profile.primary_destination_country, 'germany');
  });

  it('recommends relevant Germany Master groups and protects private group content', async () => {
    const recRes = await req('/groups/recommendations', { token: userAToken });
    assert.equal(recRes.status, 200);
    assert.ok(recRes.data.recommendations.some((g: any) => g.country_slug === 'germany'));

    // Private group check before membership
    const privRes = await req('/groups/munich-students-verified', { token: userAToken });
    assert.equal(privRes.status, 200);
    assert.equal(privRes.data.accessGranted, false);
    assert.equal(privRes.data.posts.length, 0);

    // Private group posts must never appear in global search
    const searchRes = await req('/search?q=Studentenwerk', { token: userAToken });
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.data.posts.length, 0);

    // Join public group & request private group
    const pubGroup = recRes.data.recommendations.find((g: any) => g.privacy === 'public');
    const joinPub = await req(`/groups/${pubGroup.id}/join`, { method: 'POST', token: userAToken, body: {} });
    assert.equal(joinPub.status, 200);

    const joinPriv = await req(`/groups/${privRes.data.group.id}/join`, {
      method: 'POST',
      token: userAToken,
      body: { note: 'Admitted TUM Winter 2027' },
    });
    assert.equal(joinPriv.data.status, 'requested');
  });

  it('enforces post creation, commenting, ownership deletion, and buddy privacy', async () => {
    const groupsRes = await req('/groups', { token: userAToken });
    const targetGroup = groupsRes.data.groups.find((g: any) => g.slug === 'germany-masters-students');
    await req(`/groups/${targetGroup.id}/join`, { method: 'POST', token: userAToken, body: {} });

    const postRes = await req('/posts', {
      method: 'POST',
      token: userAToken,
      body: {
        group_id: targetGroup.id,
        post_type: 'question',
        title: 'APS verification timeline for Anna University transcripts',
        body: 'Has anyone recently received APS within 4 weeks?',
      },
    });
    assert.equal(postRes.status, 201);
    const postId = postRes.data.post.id;

    // Register User B
    const bOtp = await req('/auth/otp/request', {
      method: 'POST',
      body: { channel: 'email', identifier: 'pune.peer@example.in' },
    });
    const bVerify = await req('/auth/otp/verify', {
      method: 'POST',
      body: { channel: 'email', identifier: 'pune.peer@example.in', code: bOtp.data.previewOtp, acceptedTerms: true },
    });
    userBToken = bVerify.data.token;
    userBId = bVerify.data.user.id;
    await req('/profiles/me', {
      method: 'PUT',
      token: userBToken,
      body: {
        display_name: 'Siddharth Joshi',
        city: 'Pune',
        primary_destination_country: 'germany',
        purpose: 'Study',
        intended_intake: 'Winter 2027',
        onboarding_completed: true,
      },
    });

    // User B cannot delete User A's post
    const unauthDel = await req(`/posts/${postId}`, { method: 'DELETE', token: userBToken });
    assert.equal(unauthDel.status, 403);

    // User B comments on User A's post
    const commentRes = await req(`/posts/${postId}/comments`, {
      method: 'POST',
      token: userBToken,
      body: { body: 'Yes, DigiLocker verification sped it up for me.' },
    });
    assert.equal(commentRes.status, 201);

    // Buddy Match privacy check: never exposes private academic_score_private or budget_range_private or email
    const buddyRes = await req('/people/discover?buddy=1', { token: userBToken });
    assert.equal(buddyRes.status, 200);
    const meera = buddyRes.data.people.find((p: any) => p.id === userAId);
    assert.ok(meera);
    assert.equal(meera.academic_score_private, undefined);
    assert.equal(meera.budget_range_private, undefined);
    assert.equal(meera.email, undefined);
    assert.match(meera.match_explanation, /Germany/);

    // Owner deletes own post
    const ownDel = await req(`/posts/${postId}`, { method: 'DELETE', token: userAToken });
    assert.equal(ownDel.status, 200);
  });

  it('supports messaging, blocking, reporting, moderator review, and admin governance', async () => {
    // User B initiates DM to User A
    const dmRes = await req('/conversations/direct', {
      method: 'POST',
      token: userBToken,
      body: { user_id: userAId },
    });
    assert.equal(dmRes.status, 201);
    const convId = dmRes.data.conversationId;

    // Non-participant admin cannot read private DM without being participant
    const sendMsg = await req(`/conversations/${convId}/messages`, {
      method: 'POST',
      token: userBToken,
      body: { body: 'Hello, pay before interview for guaranteed visa!' },
    });
    assert.equal(sendMsg.status, 201);

    // User A reports message and blocks User B
    const reportRes = await req('/reports', {
      method: 'POST',
      token: userAToken,
      body: {
        target_type: 'message',
        target_id: sendMsg.data.message.id,
        reported_user_id: userBId,
        category: 'Scam',
        details: 'Soliciting upfront visa payment',
      },
    });
    assert.equal(reportRes.status, 201);

    const blockRes = await req(`/users/${userBId}/block`, {
      method: 'POST',
      token: userAToken,
      body: { reason: 'Abusive scam solicitation' },
    });
    assert.equal(blockRes.status, 200);

    // Subsequent message from blocked User B is rejected with 403
    const blockedMsg = await req(`/conversations/${convId}/messages`, {
      method: 'POST',
      token: userBToken,
      body: { body: 'Are you still there?' },
    });
    assert.equal(blockedMsg.status, 403);

    // Non-admin User A cannot access admin or moderation endpoints
    const nonAdmin = await req('/admin/overview', { token: userAToken });
    assert.equal(nonAdmin.status, 403);

    // First-run Admin Claim
    const adminClaim = await req('/auth/admin/claim', {
      method: 'POST',
      body: {
        email: 'admin.test@abroadconnect.in',
        displayName: 'Lead Admin',
        password: 'StrongTestPassword!99',
      },
    });
    assert.equal(adminClaim.status, 200);
    adminToken = adminClaim.data.token;

    // Moderator reviews report
    const queueRes = await req('/moderation/queue', { token: adminToken });
    assert.equal(queueRes.status, 200);
    assert.ok(queueRes.data.reports.length >= 1);

    const actRes = await req(`/moderation/reports/${reportRes.data.id}/action`, {
      method: 'POST',
      token: adminToken,
      body: { action: 'suspend_user', notes: 'Confirmed scam solicitation' },
    });
    assert.equal(actRes.status, 200);

    // Admin overview & audit logs
    const overviewRes = await req('/admin/overview', { token: adminToken });
    assert.equal(overviewRes.status, 200);
    assert.ok(overviewRes.data.metrics.totalMembers >= 7);

    const logsRes = await req('/admin/audit-logs', { token: adminToken });
    assert.equal(logsRes.status, 200);
    assert.ok(logsRes.data.logs.some((l: any) => l.action === 'moderation.suspend_user'));

    // Private group post reaction & bookmark isolation
    const adminPriv = await req('/groups/munich-students-verified', { token: adminToken });
    assert.equal(adminPriv.status, 200);
    const privPostId = adminPriv.data.posts[0]?.id;
    assert.ok(privPostId);

    const unauthReact = await req(`/posts/${privPostId}/react`, { method: 'POST', token: userAToken, body: {} });
    assert.equal(unauthReact.status, 403);

    const unauthSave = await req('/saved', {
      method: 'POST',
      token: userAToken,
      body: { item_type: 'post', item_id: privPostId },
    });
    assert.equal(unauthSave.status, 403);

    // Restricted account cannot create posts
    const restrictRes = await req(`/admin/users/${userAId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'restricted' },
    });
    assert.equal(restrictRes.status, 200);

    const groupsList = await req('/groups', { token: userAToken });
    const pubGroup = groupsList.data.groups.find((g: any) => g.privacy === 'public');
    const restrictedPost = await req('/posts', {
      method: 'POST',
      token: userAToken,
      body: { group_id: pubGroup.id, post_type: 'discussion', title: 'Test post', body: 'Should be blocked' },
    });
    assert.equal(restrictedPost.status, 403);

    // Invalid university ID returns 404 instead of 500
    const badApp = await req('/applications', {
      method: 'POST',
      token: userAToken,
      body: { university_id: 'nonexistent-uni', program_name: 'MSc CS' },
    });
    assert.equal(badApp.status, 404);
  });
});
