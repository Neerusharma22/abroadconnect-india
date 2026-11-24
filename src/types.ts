export type AppTab =
  | 'home'
  | 'countries'
  | 'globe3d'
  | 'campusmap'
  | 'advisor'
  | 'cloudsync'
  | 'communities'
  | 'people'
  | 'messages'
  | 'universities'
  | 'jobs'
  | 'apprenticeships'
  | 'scholarships'
  | 'resources'
  | 'mentors'
  | 'journey'
  | 'saved'
  | 'notifications'
  | 'moderation'
  | 'admin'
  | 'settings'
  | 'legal';

export type LanguageCode = 'en' | 'hi' | 'ta';

export interface UserProfileExtended {
  user_id: string;
  highest_qualification: string;
  degree_specialization: string;
  graduation_year: string;
  institution: string;
  academic_score_private: string;
  english_proficiency: string;
  other_language_proficiency: string;
  employment_status: string;
  industry: string;
  skills_json: string;
  experience_level: string;
  primary_destination_country: string;
  secondary_countries_json: string;
  purpose: string;
  intended_intake: string;
  budget_range_private: string;
  application_stage: string;
  interested_cities_json: string;
  wants_mentor: number;
  discoverable_buddy: number;
  profile_visibility: 'public' | 'members' | 'connections';
  messaging_permission: 'anyone' | 'connections_only' | 'none';
  show_online_presence: number;
  show_read_receipts: number;
  profile_completion_pct: number;
}

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  username: string;
  bio: string;
  current_country: string;
  state: string;
  city: string;
  preferred_language: LanguageCode;
  status: string;
  email_verified: number;
  phone_verified: number;
  verification_level: string;
  verification_badge_label: string;
  is_demo_data: number;
  onboarding_completed: number;
  roles: string[];
  profile: UserProfileExtended;
}

export interface Country {
  id: string;
  slug: string;
  name: string;
  region: string;
  flag_code: string;
  hero_image: string | null;
  overview: string;
  education_pathways: string;
  job_pathways: string;
  apprenticeship_pathways: string;
  scholarship_summary: string;
  language_requirements: string;
  visa_disclaimer_info: string;
  living_cost_estimate: string;
  popular_cities_json: string;
  official_links_json: string;
  last_updated: string;
}

export interface Group {
  id: string;
  slug: string;
  name: string;
  category: string;
  country_slug: string | null;
  purpose: string;
  privacy: 'public' | 'private' | 'invite_only';
  description: string;
  rules_json: string;
  pinned_announcement: string;
  member_count?: number;
  post_count?: number;
  is_member?: boolean;
  join_request_pending?: boolean;
  match_reason?: string;
  conversation_id?: string | null;
}

export interface PostComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_username: string;
  author_badge: string;
  body: string;
  created_at: string;
}

export interface Post {
  id: string;
  group_id: string;
  author_id: string;
  author_name: string;
  author_username: string;
  author_badge: string;
  author_is_demo?: number;
  post_type: 'discussion' | 'question' | 'experience' | 'poll' | 'announcement';
  title: string;
  body: string;
  tags_json: string;
  link_url: string | null;
  is_pinned: number;
  is_answered: number;
  safety_signals_json: string;
  comment_count: number;
  reaction_count: number;
  userReacted?: boolean;
  userSaved?: boolean;
  comments?: PostComment[];
  pollOptions?: Array<{ id: string; label: string; votes: number }>;
  created_at: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  group_id: string | null;
  group_name?: string;
  status: 'active' | 'request_pending' | 'rejected';
  initiated_by: string | null;
  peer: {
    id: string;
    display_name: string;
    username: string;
    verification_badge_label: string;
    show_online_presence: number;
  } | null;
  lastMessage: {
    body: string;
    created_at: string;
    sender_id: string;
  } | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_username: string;
  reply_to_id: string | null;
  body: string;
  safety_signals_json: string;
  created_at: string;
}
