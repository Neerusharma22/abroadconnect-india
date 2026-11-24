import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  Cloud,
  Compass,
  Globe2,
  GraduationCap,
  Home,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, setInMemoryToken } from './api';
import { useFirebase } from './contexts/FirebaseContext';
import { t } from './i18n';
import type { AppTab, Country, Group, LanguageCode, User } from './types';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import { PublicLanding } from './components/PublicLanding';
import { AuthModal } from './components/AuthModal';
import { CountryHubView } from './components/CountryHubView';
import { GroupWorkspace } from './components/GroupWorkspace';
import { MessagesWorkspace } from './components/MessagesWorkspace';
import { DiscoverPeopleView, MentorsView } from './components/DiscoverAndMentors';
import { JourneyAndSavedView, OpportunitiesPortalView, UniversitiesView } from './components/OpportunitiesAndJourney';
import { AdminConsoleView, ModerationQueueView } from './components/AdminAndModeration';
import { LegalAndSupportView, ReportModal, SettingsPrivacyView } from './components/LegalSupportModals';
import { Globe3DExplorer } from './components/Globe3DExplorer';
import { GlobalCampusMap } from './components/GlobalCampusMap';
import { AIAssistantHub } from './components/AIAssistantHub';
import { CloudSyncWorkspace } from './components/CloudSyncWorkspace';

export default function App() {
  const { signOutFirebase } = useFirebase();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);
  const [lang, setLang] = useState<LanguageCode>('en');
  const [darkMode, setDarkMode] = useState(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  // Public subview routing (landing vs exploring country/legal before sign-in)
  const [publicCountrySlug, setPublicCountrySlug] = useState<string | null>(null);
  const [publicLegalSection, setPublicLegalSection] = useState<string | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'otp' | 'admin' | null>(null);

  // Authenticated workspace navigation
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [selectedCountrySlug, setSelectedCountrySlug] = useState<string | null>(null);
  const [selectedGroupSlug, setSelectedGroupSlug] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [legalSection, setLegalSection] = useState<string>('about');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global search & notifications
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Record<string, Array<Record<string, unknown>>> | null>(null);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; is_read: number; created_at: string }>>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recommendedGroups, setRecommendedGroups] = useState<Group[]>([]);
  const [dashboardMentors, setDashboardMentors] = useState<Array<{ id: string; display_name: string; mentor_type: string; current_country: string }>>([]);
  const [reportTarget, setReportTarget] = useState<{ targetType: string; targetId: string; reportedUserId?: string; groupId?: string } | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const onQuota = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const loadBootstrap = async () => {
    const [cRes, gRes, meRes] = await Promise.all([
      apiFetch<{ countries: Country[] }>('/countries'),
      apiFetch<{ groups: Group[] }>('/groups'),
      apiFetch<{ authenticated: boolean; user: User | null }>('/auth/me'),
    ]);
    setCountries(cRes.countries);
    setPublicGroups(gRes.groups);
    if (meRes.authenticated && meRes.user) {
      setUser(meRes.user);
      setLang(meRes.user.preferred_language || 'en');
    }
    setAuthChecked(true);
  };

  useEffect(() => {
    loadBootstrap().catch(() => setAuthChecked(true));
  }, []);

  const loadDashboardExtras = async () => {
    if (!user) return;
    const [recRes, notifRes, mentorRes] = await Promise.all([
      apiFetch<{ recommendations: Group[] }>('/groups/recommendations'),
      apiFetch<{ notifications: typeof notifications; unreadCount: number }>('/notifications'),
      apiFetch<{ mentors: typeof dashboardMentors }>('/mentors'),
    ]);
    setRecommendedGroups(recRes.recommendations);
    setNotifications(notifRes.notifications);
    setUnreadCount(notifRes.unreadCount);
    setDashboardMentors(mentorRes.mentors);
  };

  useEffect(() => {
    if (user) {
      loadDashboardExtras();
    }
  }, [user]);

  useEffect(() => {
    if (!user || globalQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<Record<string, Array<Record<string, unknown>>>>(`/search?q=${encodeURIComponent(globalQuery)}`).then(setSearchResults);
    }, 200);
    return () => clearTimeout(timer);
  }, [globalQuery, user]);

  const handleLogout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    await signOutFirebase();
    setInMemoryToken(null);
    setUser(null);
    setActiveTab('home');
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0B1120]">
        <div className="text-sm font-medium text-slate-500">Loading AbroadConnect India...</div>
      </div>
    );
  }

  // PUBLIC WEBSITE FLOW (Guest)
  if (!user) {
    return (
      <>
        {publicCountrySlug ? (
          <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] p-4 sm:p-8 max-w-6xl mx-auto">
            <CountryHubView
              countries={countries}
              selectedSlug={publicCountrySlug}
              onSelectCountry={(slug) => setPublicCountrySlug(slug)}
              onOpenGroup={() => setAuthModalMode('otp')}
              onJoinPrompt={() => setAuthModalMode('otp')}
              isAuthenticated={false}
            />
          </div>
        ) : publicLegalSection ? (
          <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] p-4 sm:p-8 max-w-5xl mx-auto space-y-4">
            <button
              type="button"
              onClick={() => setPublicLegalSection(null)}
              className="text-xs font-semibold text-[#2563EB] hover:underline"
            >
              ← Back to Homepage
            </button>
            <LegalAndSupportView initialSection={publicLegalSection} />
          </div>
        ) : (
          <PublicLanding
            countries={countries}
            groups={publicGroups}
            lang={lang}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode((d) => !d)}
            onChangeLang={setLang}
            onOpenAuth={(mode = 'otp') => setAuthModalMode(mode)}
            onExploreCountry={(slug) => setPublicCountrySlug(slug)}
            onOpenLegal={(sec) => setPublicLegalSection(sec)}
          />
        )}

        {authModalMode && (
          <AuthModal
            initialMode={authModalMode}
            countries={countries}
            onClose={() => setAuthModalMode(null)}
            onAuthenticated={(u) => {
              setUser(u);
              setLang(u.preferred_language || 'en');
              setAuthModalMode(null);
              setPublicCountrySlug(null);
              setPublicLegalSection(null);
            }}
          />
        )}
        <OfflineIndicator />
      </>
    );
  }

  // AUTHENTICATED MEMBER WORKSPACE
  const isModerator = user.roles.some((r) => ['group_moderator', 'platform_admin', 'super_admin'].includes(r));
  const isAdmin = user.roles.some((r) => ['platform_admin', 'super_admin'].includes(r));

  const sidebarItems: Array<{ id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: t(lang, 'navHome'), icon: Home },
    { id: 'countries', label: t(lang, 'navCountries'), icon: Globe2 },
    { id: 'globe3d', label: '3D Globe Hub', icon: Compass },
    { id: 'campusmap', label: 'Campus & Consulate Map', icon: MapPin },
    { id: 'advisor', label: 'AI Abroad Advisor', icon: Sparkles },
    { id: 'cloudsync', label: 'Cloud Tracker & Notes', icon: Cloud },
    { id: 'communities', label: t(lang, 'navCommunities'), icon: Users },
    { id: 'people', label: t(lang, 'navPeople'), icon: UserCheck },
    { id: 'messages', label: t(lang, 'navMessages'), icon: MessageSquare },
    { id: 'universities', label: t(lang, 'navUniversities'), icon: GraduationCap },
    { id: 'jobs', label: t(lang, 'navJobs'), icon: Briefcase },
    { id: 'apprenticeships', label: t(lang, 'navApprenticeships'), icon: Wrench },
    { id: 'scholarships', label: t(lang, 'navScholarships'), icon: Award },
    { id: 'resources', label: t(lang, 'navResources'), icon: BookOpen },
    { id: 'mentors', label: t(lang, 'navMentors'), icon: ShieldCheck },
    { id: 'journey', label: t(lang, 'navJourney'), icon: Compass },
    { id: 'saved', label: t(lang, 'navSaved'), icon: Bookmark },
    { id: 'notifications', label: t(lang, 'navNotifications'), icon: Bell },
    ...(isModerator ? [{ id: 'moderation' as AppTab, label: t(lang, 'navModeration'), icon: ShieldAlert }] : []),
    ...(isAdmin ? [{ id: 'admin' as AppTab, label: t(lang, 'navAdmin'), icon: Sliders }] : []),
    { id: 'settings', label: t(lang, 'navSettings'), icon: Settings },
    { id: 'legal', label: t(lang, 'navSafety'), icon: ShieldCheck },
  ];

  const navigateTab = (tab: AppTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
    if (tab !== 'countries') setSelectedCountrySlug(null);
    if (tab !== 'communities') setSelectedGroupSlug(null);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] z-30">
        <div className="h-16 flex items-center px-5 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => navigateTab('home')}
            className="font-display text-base font-bold tracking-tight text-[#142B5F] dark:text-white whitespace-nowrap"
          >
            AbroadConnect India
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5" aria-label="Workspace Navigation">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[#142B5F] text-white dark:bg-[#2563EB]'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className="ml-auto font-mono text-[11px] font-semibold">{unreadCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 pb-20 md:pb-6">
        {/* Top Workspace Header */}
        <header className="sticky top-0 z-20 h-14 md:h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Global Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="search"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="Search countries, groups, universities, scholarships..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 pl-9 pr-3 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              {searchResults && (
                <div className="absolute left-0 right-0 mt-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-lg p-3 z-40 max-h-80 overflow-y-auto space-y-2 text-xs">
                  {(searchResults.countries || []).map((c) => (
                    <button
                      key={String(c.slug)}
                      type="button"
                      onClick={() => {
                        setSelectedCountrySlug(String(c.slug));
                        setActiveTab('countries');
                        setGlobalQuery('');
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Country · <strong>{String(c.name)}</strong>
                    </button>
                  ))}
                  {(searchResults.groups || []).map((g) => (
                    <button
                      key={String(g.id)}
                      type="button"
                      onClick={() => {
                        setSelectedGroupSlug(String(g.slug));
                        setActiveTab('communities');
                        setGlobalQuery('');
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Group · <strong>{String(g.name)}</strong>
                    </button>
                  ))}
                  {(searchResults.universities || []).map((u) => (
                    <button
                      key={String(u.id)}
                      type="button"
                      onClick={() => {
                        setActiveTab('universities');
                        setGlobalQuery('');
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      University · <strong>{String(u.name)}</strong>
                    </button>
                  ))}
                  {(searchResults.scholarships || []).map((s) => (
                    <button
                      key={String(s.id)}
                      type="button"
                      onClick={() => {
                        setActiveTab('scholarships');
                        setGlobalQuery('');
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Scholarship · <strong>{String(s.title)}</strong>
                    </button>
                  ))}
                  {(searchResults.posts || []).map((p) => (
                    <button
                      key={String(p.id)}
                      type="button"
                      onClick={() => {
                        setSelectedGroupSlug(String(p.group_slug));
                        setActiveTab('communities');
                        setGlobalQuery('');
                      }}
                      className="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Discussion · <strong>{String(p.title)}</strong>
                    </button>
                  ))}
                  {Object.values(searchResults).every((arr) => arr.length === 0) && (
                    <p className="text-slate-500 px-2 py-1">No matching public records found.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Language selector"
              value={lang}
              onChange={(e) => setLang(e.target.value as LanguageCode)}
              className="hidden sm:block rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-medium"
            >
              <option value="en">EN</option>
              <option value="hi">हिन्दी</option>
              <option value="ta">தமிழ்</option>
            </select>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label="Toggle theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => navigateTab('notifications')}
              aria-label="Notifications"
              className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 rounded-full bg-[#2563EB] px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            <div className="hidden md:block">
              <PWAInstallButton compact />
            </div>

            <button
              type="button"
              onClick={() => navigateTab('settings')}
              className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-[#0F172A] dark:text-white"
            >
              <span className="max-w-[120px] truncate">{user.display_name}</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {toast && (
            <div className="mb-4 rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/40 px-4 py-2.5 text-xs text-teal-900 dark:text-teal-200">
              {toast}
            </div>
          )}

          {activeTab === 'home' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-[#0D9488] dark:text-teal-400 font-medium">
                      {user.verification_badge_label || 'Registered Member'} · {user.roles.join(' · ')}
                    </p>
                    <h1 className="mt-1 font-display text-2xl font-bold text-[#0F172A] dark:text-white">
                      {t(lang, 'welcomeBack')}, {user.display_name}
                    </h1>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Target: <span className="capitalize font-medium">{user.profile?.primary_destination_country || 'Germany'}</span> ·{' '}
                      {user.profile?.purpose || 'Study'} · {user.profile?.intended_intake || 'Winter 2027'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-4 py-3 text-right shrink-0">
                    <p className="text-xs text-slate-500">{t(lang, 'profileCompletion')}</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[#142B5F] dark:text-blue-400">
                      {user.profile?.profile_completion_pct || 20}%
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 space-y-6">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-white">
                        {t(lang, 'recommendedGroups')}
                      </h2>
                      <button type="button" onClick={() => navigateTab('communities')} className="text-xs font-semibold text-[#2563EB]">
                        Browse All
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {recommendedGroups.slice(0, 4).map((g) => (
                        <div key={g.id} className="py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#0F172A] dark:text-white truncate">{g.name}</p>
                            <p className="text-xs text-[#0D9488] dark:text-teal-400 truncate">{g.match_reason}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedGroupSlug(g.slug);
                              setActiveTab('communities');
                            }}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium shrink-0"
                          >
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <button
                      type="button"
                      onClick={() => navigateTab('people')}
                      className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 hover:border-[#2563EB]"
                    >
                      <p className="font-display text-sm font-semibold">Find My Abroad Buddy</p>
                      <p className="mt-1 text-xs text-slate-500">Match with consenting peers in your intake.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTab('universities')}
                      className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 hover:border-[#2563EB]"
                    >
                      <p className="font-display text-sm font-semibold">Compare Universities</p>
                      <p className="mt-1 text-xs text-slate-500">Compare up to 5 sourced institutions.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTab('journey')}
                      className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 hover:border-[#2563EB]"
                    >
                      <p className="font-display text-sm font-semibold">My Abroad Journey</p>
                      <p className="mt-1 text-xs text-slate-500">Track tasks & private applications.</p>
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-6">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-display text-base font-semibold">Suggested Mentors</h2>
                      <button type="button" onClick={() => navigateTab('mentors')} className="text-xs font-semibold text-[#2563EB]">
                        Directory
                      </button>
                    </div>
                    <div className="space-y-3">
                      {dashboardMentors.slice(0, 3).map((m) => (
                        <div key={m.id} className="text-xs border-b border-slate-100 dark:border-slate-800 pb-2.5">
                          <p className="font-semibold text-[#0F172A] dark:text-white">{m.display_name}</p>
                          <p className="text-slate-500">{m.mentor_type} · {m.current_country}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 text-xs text-slate-600 dark:text-slate-300 space-y-2">
                    <p className="font-semibold text-[#0F172A] dark:text-white">Safety & Transparency Reminder</p>
                    <p>{t(lang, 'officialDisclaimer')}</p>
                    <p className="text-slate-400">{t(lang, 'demoNotice')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'countries' && (
            <CountryHubView
              countries={countries}
              selectedSlug={selectedCountrySlug}
              onSelectCountry={setSelectedCountrySlug}
              onOpenGroup={(slug) => {
                setSelectedGroupSlug(slug);
                setActiveTab('communities');
              }}
              isAuthenticated={true}
            />
          )}

          {activeTab === 'globe3d' && (
            <Globe3DExplorer
              countries={countries}
              onSelectCountryHub={(slug) => {
                setSelectedCountrySlug(slug);
                setActiveTab('countries');
              }}
            />
          )}

          {activeTab === 'campusmap' && <GlobalCampusMap countries={countries} />}

          {activeTab === 'advisor' && (
            <AIAssistantHub
              countries={countries}
              defaultCountry={user.profile?.primary_destination_country || 'Germany'}
            />
          )}

          {activeTab === 'cloudsync' && <CloudSyncWorkspace countries={countries} />}

          {activeTab === 'communities' && (
            <GroupWorkspace
              user={user}
              selectedGroupSlug={selectedGroupSlug}
              onSelectGroup={setSelectedGroupSlug}
              onOpenChat={(convId) => {
                setActiveConversationId(convId);
                setActiveTab('messages');
              }}
              onReportTarget={(targetType, targetId, reportedUserId, groupId) =>
                setReportTarget({ targetType, targetId, reportedUserId, groupId })
              }
            />
          )}

          {activeTab === 'people' && (
            <DiscoverPeopleView
              countries={countries}
              onOpenDirectChat={(convId) => {
                setActiveConversationId(convId);
                setActiveTab('messages');
              }}
              onReportTarget={(targetType, targetId, reportedUserId) =>
                setReportTarget({ targetType, targetId, reportedUserId })
              }
            />
          )}

          {activeTab === 'messages' && (
            <MessagesWorkspace
              user={user}
              activeConversationId={activeConversationId}
              onSelectConversation={setActiveConversationId}
              onReportTarget={(targetType, targetId, reportedUserId) =>
                setReportTarget({ targetType, targetId, reportedUserId })
              }
            />
          )}

          {activeTab === 'universities' && <UniversitiesView countries={countries} />}
          {(activeTab === 'jobs' || activeTab === 'apprenticeships' || activeTab === 'scholarships' || activeTab === 'resources') && (
            <OpportunitiesPortalView
              mode={activeTab}
              countries={countries}
              onReportTarget={(targetType, targetId) => setReportTarget({ targetType, targetId })}
            />
          )}

          {(activeTab === 'journey' || activeTab === 'saved') && <JourneyAndSavedView mode={activeTab} />}

          {activeTab === 'mentors' && (
            <MentorsView onReportTarget={(targetType, targetId, reportedUserId) => setReportTarget({ targetType, targetId, reportedUserId })} />
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center justify-between">
                <h1 className="font-display text-2xl font-bold">Notifications</h1>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/notifications/read-all', { method: 'POST' });
                    loadDashboardExtras();
                  }}
                  className="text-xs font-semibold text-[#2563EB] hover:underline"
                >
                  Mark all as read
                </button>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                {notifications.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500">You are all caught up.</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className={`p-4 text-xs ${n.is_read ? 'opacity-75' : 'bg-blue-50/40 dark:bg-blue-950/20'}`}>
                      <p className="font-semibold text-sm text-[#0F172A] dark:text-white">{n.title}</p>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">{n.body}</p>
                      <p className="mt-1 text-slate-400">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'moderation' && isModerator && <ModerationQueueView />}
          {activeTab === 'admin' && isAdmin && (
            <AdminConsoleView
              onCountryCreated={() => apiFetch<{ countries: Country[] }>('/countries').then((r) => setCountries(r.countries))}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPrivacyView
              user={user}
              countries={countries}
              onUpdated={(updated) => {
                setUser(updated);
                setLang(updated.preferred_language || 'en');
              }}
              onDeleted={() => {
                setInMemoryToken(null);
                setUser(null);
              }}
            />
          )}

          {activeTab === 'legal' && <LegalAndSupportView initialSection={legalSection} userEmail={user.email} />}
        </main>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-white dark:bg-[#111827] h-full flex flex-col z-10 border-r border-slate-200 dark:border-slate-800">
            <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
              <span className="font-display font-bold text-[#142B5F] dark:text-white">AbroadConnect India</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu" className="p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {sidebarItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTab(item.id)}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      activeTab === item.id ? 'bg-[#142B5F] text-white' : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 mt-4"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation (Home, Explore, Communities, Messages, Profile) */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md grid grid-cols-5 items-center"
      >
        {(
          [
            ['home', 'Home', Home],
            ['countries', 'Explore', Globe2],
            ['communities', 'Groups', Users],
            ['messages', 'Messages', MessageSquare],
            ['settings', 'Profile', Settings],
          ] as Array<[AppTab, string, React.ComponentType<{ className?: string }>]>
        ).map(([tabId, label, Icon]) => {
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => navigateTab(tabId)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] ${
                active ? 'text-[#2563EB] dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium mt-0.5">{label}</span>
            </button>
          );
        })}
      </nav>

      {reportTarget && (
        <ReportModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={(msg) => showToast(msg)}
        />
      )}

      <OfflineIndicator />
      </div>
    </div>
  );
}
