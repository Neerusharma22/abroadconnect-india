import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  Flag,
  Lock,
  MessageSquare,
  Pin,
  Plus,
  Search,
  ThumbsUp,
  Trash2,
  Users,
  VolumeX,
} from 'lucide-react';
import { apiFetch, safeExternalUrl } from '../api';
import type { Group, Post, User } from '../types';

interface GroupWorkspaceProps {
  user: User;
  selectedGroupSlug: string | null;
  onSelectGroup: (slug: string | null) => void;
  onOpenChat: (conversationId: string) => void;
  onReportTarget: (targetType: string, targetId: string, reportedUserId?: string, groupId?: string) => void;
}

export const GroupWorkspace: React.FC<GroupWorkspaceProps> = ({
  user,
  selectedGroupSlug,
  onSelectGroup,
  onOpenChat,
  onReportTarget,
}) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [recommended, setRecommended] = useState<Group[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQ, setSearchQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');

  // Group detail state
  const [detail, setDetail] = useState<{
    group: Group;
    accessGranted: boolean;
    isMember: boolean;
    isMuted: boolean;
    canModerate: boolean;
    joinRequestPending: boolean;
    posts: Post[];
    members: Array<{ id: string; display_name: string; username: string; city: string; verification_badge_label: string; group_role: string }>;
    joinRequests: Array<{ id: string; user_id: string; display_name: string; username: string; city: string; note: string }>;
  } | null>(null);
  const [postSort, setPostSort] = useState<'newest' | 'active'>('newest');
  const [postFilter, setPostFilter] = useState<'all' | 'unanswered'>('all');
  const [groupSearch, setGroupSearch] = useState('');
  const [joinNote, setJoinNote] = useState('');

  // Composer state
  const [showComposer, setShowComposer] = useState(false);
  const [postType, setPostType] = useState<'discussion' | 'question' | 'experience' | 'poll'>('discussion');
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postTags, setPostTags] = useState('');
  const [pollOptionsText, setPollOptionsText] = useState('Option 1\nOption 2');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const loadGroups = async () => {
    setLoading(true);
    try {
      const [allRes, recRes] = await Promise.all([
        apiFetch<{ groups: Group[] }>(`/groups?category=${encodeURIComponent(categoryFilter)}&q=${encodeURIComponent(searchQ)}`),
        apiFetch<{ recommendations: Group[] }>('/groups/recommendations'),
      ]);
      setGroups(allRes.groups);
      setRecommended(recRes.recommendations);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (slug: string) => {
    const res = await apiFetch<typeof detail>(
      `/groups/${encodeURIComponent(slug)}?sort=${postSort}&filter=${postFilter}&q=${encodeURIComponent(groupSearch)}`
    );
    setDetail(res);
  };

  useEffect(() => {
    if (!selectedGroupSlug) {
      loadGroups();
    }
  }, [categoryFilter, searchQ, selectedGroupSlug]);

  useEffect(() => {
    if (selectedGroupSlug) {
      loadDetail(selectedGroupSlug);
    } else {
      setDetail(null);
    }
  }, [selectedGroupSlug, postSort, postFilter, groupSearch]);

  const handleJoin = async (groupId: string, note = '') => {
    setFeedback('');
    const res = await apiFetch<{ status: string; message: string }>(`/groups/${groupId}/join`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    setFeedback(res.message);
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
    else await loadGroups();
  };

  const handleLeave = async (groupId: string) => {
    await apiFetch(`/groups/${groupId}/leave`, { method: 'POST' });
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
    else await loadGroups();
  };

  const handleReviewRequest = async (groupId: string, requestId: string, decision: 'approved' | 'rejected') => {
    await apiFetch(`/groups/${groupId}/requests/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setFeedback('');
    const tags = postTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    const pollOptions =
      postType === 'poll'
        ? pollOptionsText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const res = await apiFetch<{ safetySignalsFlagged?: string[] }>('/posts', {
      method: 'POST',
      body: JSON.stringify({
        group_id: detail.group.id,
        post_type: postType,
        title: postTitle,
        body: postBody,
        tags,
        poll_options: pollOptions,
      }),
    });
    if (res.safetySignalsFlagged && res.safetySignalsFlagged.length > 0) {
      setFeedback('Post published and queued for safety review due to sensitive keywords.');
    }
    setPostTitle('');
    setPostBody('');
    setPostTags('');
    setShowComposer(false);
    await loadDetail(detail.group.slug);
  };

  const handleComment = async (postId: string) => {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    await apiFetch(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: text }),
    });
    setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
  };

  const handleReact = async (postId: string) => {
    await apiFetch(`/posts/${postId}/react`, { method: 'POST' });
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
  };

  const handleSavePost = async (postId: string) => {
    await apiFetch('/saved', {
      method: 'POST',
      body: JSON.stringify({ item_type: 'post', item_id: postId }),
    });
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
  };

  const handleVote = async (postId: string, optionId: string) => {
    await apiFetch(`/posts/${postId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    });
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
  };

  const handleDeletePost = async (postId: string) => {
    await apiFetch(`/posts/${postId}`, { method: 'DELETE' });
    if (selectedGroupSlug) await loadDetail(selectedGroupSlug);
  };

  if (selectedGroupSlug && detail) {
    const g = detail.group;
    const rules = (() => {
      try {
        return JSON.parse(g.rules_json) as string[];
      } catch {
        return [];
      }
    })();

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onSelectGroup(null)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] dark:text-blue-400 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Communities</span>
          </button>
          <button
            type="button"
            onClick={() => onReportTarget('group', g.id, undefined, g.id)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 dark:text-slate-400"
          >
            <Flag className="w-3.5 h-3.5" />
            <span>Report Group</span>
          </button>
        </div>

        {/* Group Header */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <span>{g.category}</span>
                <span aria-hidden="true"> · </span>
                <span className="capitalize">{g.privacy.replace('_', '-')} group</span>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">{g.member_count || 0} members</span>
              </div>
              <h1 className="mt-1.5 font-display text-2xl font-bold text-[#0F172A] dark:text-white">{g.name}</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 max-w-2xl">{g.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {detail.isMember ? (
                <>
                  {g.conversation_id && (
                    <button
                      type="button"
                      onClick={() => onOpenChat(g.conversation_id!)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] hover:bg-[#1d4ed8] px-3.5 py-2 text-xs font-semibold text-white"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Group Chat</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/groups/${g.id}/mute`, {
                        method: 'POST',
                        body: JSON.stringify({ muted: !detail.isMuted }),
                      });
                      await loadDetail(g.slug);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    <span>{detail.isMuted ? 'Unmute' : 'Mute'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLeave(g.id)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Leave
                  </button>
                </>
              ) : detail.joinRequestPending ? (
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Join Request Pending Moderator Review</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleJoin(g.id, joinNote)}
                  className="rounded-lg bg-[#142B5F] hover:bg-[#1e3f8a] dark:bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white"
                >
                  {g.privacy === 'public' ? 'Join Public Group' : 'Request Access'}
                </button>
              )}
            </div>
          </div>

          {g.pinned_announcement && detail.accessGranted && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 p-3.5 text-xs text-slate-800 dark:text-blue-100">
              <Pin className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Pinned Announcement: </span>
                <span>{g.pinned_announcement}</span>
              </div>
            </div>
          )}
        </div>

        {feedback && (
          <div className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/40 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
            {feedback}
          </div>
        )}

        {/* Private Group Locked View */}
        {!detail.accessGranted ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center max-w-xl mx-auto">
            <Lock className="w-8 h-8 text-slate-400 mx-auto" />
            <h2 className="mt-3 font-display text-lg font-bold text-[#0F172A] dark:text-white">Private Cohort Space</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Discussions, member lists, and files in this private group are hidden from non-members and excluded from public search.
            </p>
            {!detail.joinRequestPending && (
              <div className="mt-5 space-y-3 text-left">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  Optional note for moderators (e.g. your university / intake)
                </label>
                <input
                  type="text"
                  value={joinNote}
                  onChange={(e) => setJoinNote(e.target.value)}
                  placeholder="Admitted for Winter 2027 MSc Informatics"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => handleJoin(g.id, joinNote)}
                  className="w-full rounded-lg bg-[#142B5F] dark:bg-[#2563EB] py-2.5 text-sm font-semibold text-white"
                >
                  Submit Private Group Join Request
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Main Feed */}
            <div className="lg:col-span-8 space-y-5">
              {/* Feed Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-3.5">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="search"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Search posts inside this group..."
                    className="w-full bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={postSort}
                    onChange={(e) => setPostSort(e.target.value as 'newest' | 'active')}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium"
                  >
                    <option value="newest">Newest</option>
                    <option value="active">Most Active</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setPostFilter((f) => (f === 'all' ? 'unanswered' : 'all'))}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                      postFilter === 'unanswered'
                        ? 'border-[#2563EB] bg-blue-50 dark:bg-blue-950/40 text-[#2563EB] dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Unanswered Questions
                  </button>
                  {detail.isMember && (
                    <button
                      type="button"
                      onClick={() => setShowComposer((s) => !s)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Post</span>
                    </button>
                  )}
                </div>
              </div>

              {showComposer && (
                <form
                  onSubmit={handleCreatePost}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3.5"
                >
                  <div className="flex flex-wrap gap-2">
                    {(['discussion', 'question', 'experience', 'poll'] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setPostType(pt)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                          postType === pt
                            ? 'bg-[#142B5F] text-white dark:bg-[#2563EB]'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {pt}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    required
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    placeholder="Clear post title..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm"
                  />
                  <textarea
                    required
                    rows={4}
                    value={postBody}
                    onChange={(e) => setPostBody(e.target.value)}
                    placeholder="Share your question or verified experience (avoid posting passport numbers or phone numbers publicly)..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm"
                  />
                  {postType === 'poll' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Poll Options (one per line)
                      </label>
                      <textarea
                        rows={3}
                        value={pollOptionsText}
                        onChange={(e) => setPollOptionsText(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs"
                      />
                    </div>
                  )}
                  <input
                    type="text"
                    value={postTags}
                    onChange={(e) => setPostTags(e.target.value)}
                    placeholder="Tags separated by comma (e.g. APS, Winter 2027)"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowComposer(false)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-medium"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white">
                      Publish to Group
                    </button>
                  </div>
                </form>
              )}

              {/* Posts Feed */}
              {detail.posts.length === 0 ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500">
                  No posts match this filter yet. Start the conversation!
                </div>
              ) : (
                detail.posts.map((p) => {
                  const totalVotes = (p.pollOptions || []).reduce((acc, o) => acc + o.votes, 0);
                  return (
                    <article
                      key={p.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-800 dark:text-slate-200">{p.author_name}</span>
                            {p.author_badge && (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span className="text-[#0D9488] dark:text-teal-400">{p.author_badge}</span>
                              </>
                            )}
                            <span aria-hidden="true"> · </span>
                            <span className="capitalize">{p.post_type}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{new Date(p.created_at).toLocaleDateString()}</span>
                          </div>
                          <h3 className="mt-1.5 font-display text-base font-semibold text-[#0F172A] dark:text-white">
                            {p.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1">
                          {(p.author_id === user.id || detail.canModerate) && (
                            <button
                              type="button"
                              onClick={() => handleDeletePost(p.id)}
                              aria-label="Delete post"
                              className="p-1.5 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onReportTarget('post', p.id, p.author_id, g.id)}
                            aria-label="Report post"
                            className="p-1.5 text-slate-400 hover:text-amber-600"
                          >
                            <Flag className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">{p.body}</p>

                      {safeExternalUrl(p.link_url) && (
                        <a
                          href={safeExternalUrl(p.link_url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs font-medium text-[#2563EB] dark:text-blue-400 underline break-all"
                        >
                          {p.link_url}
                        </a>
                      )}

                      {p.pollOptions && p.pollOptions.length > 0 && (
                        <div className="space-y-2 pt-2">
                          {p.pollOptions.map((opt) => {
                            const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleVote(p.id, opt.id)}
                                className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 text-xs hover:border-[#2563EB] transition-colors"
                              >
                                <div className="flex justify-between font-medium">
                                  <span>{opt.label}</span>
                                  <span className="tabular-nums text-slate-500">
                                    {opt.votes} ({pct}%)
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-center gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                        <button
                          type="button"
                          onClick={() => handleReact(p.id)}
                          className={`inline-flex items-center gap-1.5 font-medium ${
                            p.userReacted ? 'text-[#2563EB]' : 'hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span className="tabular-nums">Helpful ({p.reaction_count})</span>
                        </button>
                        <span className="tabular-nums">{p.comment_count} replies</span>
                        <button
                          type="button"
                          onClick={() => handleSavePost(p.id)}
                          className={`inline-flex items-center gap-1 font-medium ml-auto ${
                            p.userSaved ? 'text-[#0D9488]' : 'hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <Bookmark className="w-3.5 h-3.5" />
                          <span>{p.userSaved ? 'Saved' : 'Save'}</span>
                        </button>
                      </div>

                      {/* Comments */}
                      <div className="space-y-2.5 pt-2">
                        {(p.comments || []).map((c) => (
                          <div key={c.id} className="rounded-lg bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-xs">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {c.author_name} <span className="font-normal text-slate-400">· {new Date(c.created_at).toLocaleDateString()}</span>
                            </p>
                            <p className="mt-1 text-slate-700 dark:text-slate-300">{c.body}</p>
                          </div>
                        ))}
                        {detail.isMember && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={commentDrafts[p.id] || ''}
                              onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              placeholder="Write a helpful reply..."
                              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleComment(p.id)}
                              className="rounded-lg bg-slate-900 dark:bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white"
                            >
                              Reply
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            {/* Sidebar: Rules, Moderator Queue & Members */}
            <aside className="lg:col-span-4 space-y-5">
              {detail.canModerate && detail.joinRequests.length > 0 && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-white dark:bg-[#111827] p-5">
                  <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white mb-3">
                    Pending Join Requests ({detail.joinRequests.length})
                  </h2>
                  <div className="space-y-3">
                    {detail.joinRequests.map((jr) => (
                      <div key={jr.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-2">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {jr.display_name} {jr.city && `· ${jr.city}`}
                        </p>
                        {jr.note && <p className="text-slate-600 dark:text-slate-300">{jr.note}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleReviewRequest(g.id, jr.id, 'approved')}
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-[#0D9488] py-1.5 text-white font-medium"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewRequest(g.id, jr.id, 'rejected')}
                            className="flex-1 rounded border border-slate-300 dark:border-slate-700 py-1.5 font-medium"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
                <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white mb-3">Group Rules</h2>
                <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                  {rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
                <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-white mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#2563EB]" />
                  <span>Members ({detail.members.length})</span>
                </h2>
                <div className="space-y-2.5">
                  {detail.members.slice(0, 10).map((m) => (
                    <div key={m.id} className="text-xs">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {m.display_name} {m.group_role === 'moderator' && <span className="text-[#0D9488]">· Moderator</span>}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {m.city || 'India'} {m.verification_badge_label && `· ${m.verification_badge_label}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white">Communities & Cohorts</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Country, city, timeline, and preparation groups moderated against misinformation and scams.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search groups..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      {recommended.length > 0 && (
        <section>
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white mb-3">
            Recommended for Your Plan ({user.profile?.primary_destination_country || 'Global'} · {user.profile?.purpose || 'Study'})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recommended.slice(0, 3).map((g) => (
              <div
                key={g.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between"
              >
                <div>
                  <p className="text-xs text-[#0D9488] dark:text-teal-400 font-medium">{g.match_reason}</p>
                  <h3 className="mt-1.5 font-display text-base font-semibold text-[#0F172A] dark:text-white">{g.name}</h3>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{g.description}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-500 capitalize">{g.privacy}</span>
                  <button
                    type="button"
                    onClick={() => onSelectGroup(g.slug)}
                    className="text-xs font-semibold text-[#2563EB] dark:text-blue-400 hover:underline"
                  >
                    {g.is_member ? 'Open Group' : 'View & Join'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit">
        {['all', 'Country + Purpose', 'City', 'Timeline', 'Interest'].map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              categoryFilter === cat
                ? 'bg-white dark:bg-slate-900 text-[#0F172A] dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {cat === 'all' ? 'All Categories' : cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-32 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((g) => (
            <div
              key={g.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 flex flex-col justify-between"
            >
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <span>{g.category}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="capitalize">{g.privacy}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums">{g.member_count || 0} members</span>
                </div>
                <h3 className="mt-1.5 font-display text-base font-semibold text-[#0F172A] dark:text-white">{g.name}</h3>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{g.description}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onSelectGroup(g.slug)}
                  className="text-xs font-semibold text-[#2563EB] dark:text-blue-400 hover:underline"
                >
                  Open Feed
                </button>
                {g.is_member ? (
                  <span className="text-xs font-medium text-[#0D9488] dark:text-teal-400">Member</span>
                ) : g.join_request_pending ? (
                  <span className="text-xs text-amber-600">Request Pending</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => (g.privacy === 'public' ? handleJoin(g.id) : onSelectGroup(g.slug))}
                    className="rounded-lg bg-[#142B5F] dark:bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    {g.privacy === 'public' ? 'Join Group' : 'Request Access'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
