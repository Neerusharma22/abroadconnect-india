import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) return dbInstance;
  const dbPath = customPath || process.env.ABROADCONNECT_DB_PATH || path.resolve(process.cwd(), 'data', 'abroadconnect.db');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seedDatabaseIfEmpty(db);
  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function resetDbForTests(customPath: string): Database.Database {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
  const db = new Database(customPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seedDatabaseIfEmpty(db);
  dbInstance = db;
  return db;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version)
  );

  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        username TEXT UNIQUE,
        avatar_url TEXT,
        bio TEXT NOT NULL DEFAULT '',
        current_country TEXT NOT NULL DEFAULT 'India',
        state TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        preferred_language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'suspended', 'banned')),
        email_verified INTEGER NOT NULL DEFAULT 0,
        phone_verified INTEGER NOT NULL DEFAULT 0,
        verification_level TEXT NOT NULL DEFAULT 'none' CHECK (verification_level IN ('none', 'email', 'phone', 'mentor_reviewed', 'institution_reviewed', 'official_moderator')),
        verification_badge_label TEXT NOT NULL DEFAULT '',
        password_hash TEXT,
        is_demo_data INTEGER NOT NULL DEFAULT 0,
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        assigned_by TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, role)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        user_agent TEXT NOT NULL DEFAULT '',
        ip_address TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS otp_challenges (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        expires_at TEXT NOT NULL,
        resend_available_at TEXT NOT NULL,
        verified_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_profiles_extended (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        highest_qualification TEXT NOT NULL DEFAULT '',
        degree_specialization TEXT NOT NULL DEFAULT '',
        graduation_year TEXT NOT NULL DEFAULT '',
        institution TEXT NOT NULL DEFAULT '',
        academic_score_private TEXT NOT NULL DEFAULT '',
        english_proficiency TEXT NOT NULL DEFAULT '',
        other_language_proficiency TEXT NOT NULL DEFAULT '',
        employment_status TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        skills_json TEXT NOT NULL DEFAULT '[]',
        experience_level TEXT NOT NULL DEFAULT '',
        preferred_job_categories_json TEXT NOT NULL DEFAULT '[]',
        primary_destination_country TEXT NOT NULL DEFAULT '',
        secondary_countries_json TEXT NOT NULL DEFAULT '[]',
        purpose TEXT NOT NULL DEFAULT '',
        intended_intake TEXT NOT NULL DEFAULT '',
        budget_range_private TEXT NOT NULL DEFAULT '',
        application_stage TEXT NOT NULL DEFAULT 'Explore',
        interested_cities_json TEXT NOT NULL DEFAULT '[]',
        interested_universities_json TEXT NOT NULL DEFAULT '[]',
        wants_mentor INTEGER NOT NULL DEFAULT 0,
        discoverable_buddy INTEGER NOT NULL DEFAULT 1,
        profile_visibility TEXT NOT NULL DEFAULT 'members' CHECK (profile_visibility IN ('public', 'members', 'connections')),
        messaging_permission TEXT NOT NULL DEFAULT 'anyone' CHECK (messaging_permission IN ('anyone', 'connections_only', 'none')),
        show_online_presence INTEGER NOT NULL DEFAULT 1,
        show_read_receipts INTEGER NOT NULL DEFAULT 1,
        consent_tos_at TEXT,
        consent_privacy_at TEXT,
        profile_completion_pct INTEGER NOT NULL DEFAULT 20
      );

      CREATE TABLE IF NOT EXISTS countries (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        flag_code TEXT NOT NULL,
        hero_image TEXT,
        overview TEXT NOT NULL,
        education_pathways TEXT NOT NULL,
        job_pathways TEXT NOT NULL,
        apprenticeship_pathways TEXT NOT NULL,
        scholarship_summary TEXT NOT NULL,
        language_requirements TEXT NOT NULL,
        visa_disclaimer_info TEXT NOT NULL,
        living_cost_estimate TEXT NOT NULL,
        popular_cities_json TEXT NOT NULL DEFAULT '[]',
        official_links_json TEXT NOT NULL DEFAULT '[]',
        last_updated TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        country_slug TEXT,
        purpose TEXT NOT NULL DEFAULT '',
        privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private', 'invite_only')),
        description TEXT NOT NULL,
        rules_json TEXT NOT NULL DEFAULT '[]',
        banner_url TEXT,
        pinned_announcement TEXT NOT NULL DEFAULT '',
        moderator_only_chat INTEGER NOT NULL DEFAULT 0,
        member_limit INTEGER,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_memberships (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator')),
        is_muted INTEGER NOT NULL DEFAULT 0,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS group_join_requests (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_type TEXT NOT NULL DEFAULT 'discussion' CHECK (post_type IN ('discussion', 'question', 'experience', 'poll', 'announcement')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        link_url TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        is_answered INTEGER NOT NULL DEFAULT 0,
        safety_signals_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_votes (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS post_reactions (
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reaction_type TEXT NOT NULL DEFAULT 'helpful',
        PRIMARY KEY (post_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS saved_items (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK (item_type IN ('post', 'university', 'job', 'apprenticeship', 'scholarship', 'resource')),
        item_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, item_type, item_id)
      );

      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (requester_id, addressee_id)
      );

      CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
        group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'request_pending', 'rejected')),
        initiated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at TEXT,
        is_muted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reply_to_id TEXT,
        body TEXT NOT NULL,
        attachment_name TEXT,
        attachment_type TEXT,
        is_edited INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        safety_signals_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mentors (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        mentor_type TEXT NOT NULL,
        current_country TEXT NOT NULL,
        current_city TEXT NOT NULL,
        institution_or_employer TEXT NOT NULL DEFAULT '',
        expertise_json TEXT NOT NULL DEFAULT '[]',
        languages_json TEXT NOT NULL DEFAULT '[]',
        years_experience INTEGER NOT NULL DEFAULT 1,
        bio TEXT NOT NULL,
        topics_json TEXT NOT NULL DEFAULT '[]',
        availability_slots_json TEXT NOT NULL DEFAULT '[]',
        verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected', 'revoked')),
        verification_reviewed_at TEXT,
        is_suspended INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mentor_applications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mentor_type TEXT NOT NULL,
        current_country TEXT NOT NULL,
        current_city TEXT NOT NULL,
        institution_or_employer TEXT NOT NULL DEFAULT '',
        evidence_summary TEXT NOT NULL,
        expertise_json TEXT NOT NULL DEFAULT '[]',
        languages_json TEXT NOT NULL DEFAULT '[]',
        years_experience INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        reviewer_notes TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mentor_sessions (
        id TEXT PRIMARY KEY,
        mentor_id TEXT NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
        mentee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        scheduled_slot TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
        review_rating INTEGER,
        review_comment TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS universities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country_slug TEXT NOT NULL,
        city TEXT NOT NULL,
        institution_type TEXT NOT NULL,
        official_website TEXT NOT NULL,
        programs_json TEXT NOT NULL DEFAULT '[]',
        duration TEXT NOT NULL,
        language_of_instruction TEXT NOT NULL,
        tuition_info TEXT NOT NULL,
        deadlines TEXT NOT NULL,
        eligibility TEXT NOT NULL,
        application_method TEXT NOT NULL,
        source_url TEXT NOT NULL,
        last_verified TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        employer TEXT NOT NULL,
        country_slug TEXT NOT NULL,
        city TEXT NOT NULL,
        employment_type TEXT NOT NULL,
        required_experience TEXT NOT NULL,
        skills_json TEXT NOT NULL DEFAULT '[]',
        language_req TEXT NOT NULL,
        salary_info TEXT NOT NULL DEFAULT 'Not disclosed',
        visa_sponsorship_info TEXT NOT NULL DEFAULT 'Check official listing',
        official_url TEXT NOT NULL,
        source TEXT NOT NULL,
        published_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'official_source',
        safety_signals_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS apprenticeships (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        country_slug TEXT NOT NULL,
        training_provider TEXT NOT NULL,
        duration TEXT NOT NULL,
        language_req TEXT NOT NULL,
        eligibility TEXT NOT NULL,
        allowance_info TEXT NOT NULL,
        official_source_url TEXT NOT NULL,
        application_process TEXT NOT NULL,
        last_verified TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scholarships (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        country_slug TEXT NOT NULL,
        eligible_nationalities TEXT NOT NULL,
        study_level TEXT NOT NULL,
        subject_area TEXT NOT NULL,
        funding_type TEXT NOT NULL CHECK (funding_type IN ('full', 'partial', 'unspecified')),
        funding_details TEXT NOT NULL,
        eligibility TEXT NOT NULL,
        deadline TEXT NOT NULL,
        official_url TEXT NOT NULL,
        last_checked TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        country_slug TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        author_name TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('official_editorial', 'community_contributed')),
        sources_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        last_reviewed TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journeys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        destination_country TEXT NOT NULL DEFAULT 'Germany',
        purpose TEXT NOT NULL DEFAULT 'Study',
        target_intake TEXT NOT NULL DEFAULT 'Winter 2027',
        current_stage TEXT NOT NULL DEFAULT 'Explore',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journey_tasks (
        id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        stage TEXT NOT NULL DEFAULT 'Explore',
        due_date TEXT NOT NULL DEFAULT '',
        is_completed INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS university_applications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        university_id TEXT NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
        program_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Researching',
        deadline TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        checklist_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        link_target TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reported_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        category TEXT NOT NULL,
        details TEXT NOT NULL,
        safety_signals_json TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed', 'escalated')),
        assigned_moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        resolution_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'support',
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
        agent_response TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_groups_country_privacy ON groups(country_slug, privacy);
      CREATE INDEX IF NOT EXISTS idx_posts_group_created ON posts(group_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, priority);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_profiles_dest ON user_profiles_extended(primary_destination_country, purpose, intended_intake);
    `);

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      1,
      'initial_abroadconnect_schema',
      nowIso()
    );
  }
}

function seedDatabaseIfEmpty(db: Database.Database): void {
  const countryCount = (db.prepare('SELECT COUNT(*) as c FROM countries').get() as { c: number }).c;
  if (countryCount > 0) return;

  const ts = nowIso();

  const countriesData = [
    {
      slug: 'germany',
      name: 'Germany',
      region: 'Europe',
      flag_code: 'DE',
      hero_image: '/src/assets/images/country_germany_hub_1795454653767.jpg',
      overview: 'Public universities in most German federal states charge zero tuition fees for consecutive Master’s programs, alongside structured Ausbildung vocational training and the EU Blue Card / Chancenkarte work pathways.',
      education_pathways: 'Public Universities (TU9, Universities of Applied Sciences / Fachhochschulen) offering English-taught & German-taught Master’s and Bachelor’s degrees. APS India verification is required prior to student visa application.',
      job_pathways: 'EU Blue Card for qualified graduates (threshold updated annually by BMI), Opportunity Card (Chancenkarte) points-based job-seeker permit, and 18-month post-study job search residence permit.',
      apprenticeship_pathways: 'Dual Vocational Training (Ausbildung) in Nursing, Mechatronics, IT Systems Integration, Hospitality, and Logistics—combining paid company training with vocational school.',
      scholarship_summary: 'DAAD Development-Related Postgraduate Courses, Deutschlandstipendium, and Erasmus+ mobility grants.',
      language_requirements: 'English-taught Master’s typically require IELTS 6.5+ or TOEFL iBT 88+. German-taught programs & Ausbildung generally require B1–C1 German (Goethe/TestDaF/telc).',
      visa_disclaimer_info: 'Official student visa rules, blocked account (Sperrkonto) thresholds, and APS certificate processes are published exclusively by the German Missions in India and Auswärtiges Amt. Estimates here are community-summarized reference points, not legal guarantees.',
      living_cost_estimate: 'Estimated €992/month reference benchmark (verify current statutory Sperrkonto amount on official mission websites); actual costs vary significantly between Munich, Berlin, and smaller university towns.',
      popular_cities_json: JSON.stringify(['Munich', 'Berlin', 'Aachen', 'Stuttgart', 'Frankfurt', 'Hamburg']),
      official_links_json: JSON.stringify([
        { label: 'Make it in Germany (Official Portal)', url: 'https://www.make-it-in-germany.com/en/' },
        { label: 'DAAD Study in Germany', url: 'https://www.daad.de/en/' },
        { label: 'German Missions in India (Visa & APS)', url: 'https://india.diplo.de/' },
      ]),
    },
    {
      slug: 'united-kingdom',
      name: 'United Kingdom',
      region: 'Europe',
      flag_code: 'GB',
      hero_image: '/src/assets/images/country_uk_hub_1795454653841.jpg',
      overview: 'Home to 1-year taught Master’s degrees, research institutions, and the Skilled Worker & Graduate Route frameworks across London, Manchester, Edinburgh, and Bristol.',
      education_pathways: '1-year Master’s (MSc/MA/MBA), 3–4 year Undergraduate degrees via UCAS, and funded PhDs.',
      job_pathways: 'Skilled Worker Visa (requires licensed sponsor and occupation-specific salary threshold), Health & Care Worker Visa, and Graduate Route post-study work permission.',
      apprenticeship_pathways: 'Degree Apprenticeships primarily target domestic residents; international graduates generally enter via Graduate Schemes or Skilled Worker roles.',
      scholarship_summary: 'Chevening Scholarships, Commonwealth Scholarships, GREAT Scholarships (British Council India), and university merit bursaries.',
      language_requirements: 'IELTS Academic (typically 6.5–7.0 overall) or UKVI-approved Secure English Language Tests.',
      visa_disclaimer_info: 'UK Visas and Immigration (UKVI) rules, Immigration Health Surcharge (IHS), and sponsor lists change periodically. Always verify directly on GOV.UK.',
      living_cost_estimate: 'UKVI maintenance guidelines distinguish London vs outside London; real rent varies sharply by city and shared housing.',
      popular_cities_json: JSON.stringify(['London', 'Manchester', 'Edinburgh', 'Birmingham', 'Bristol', 'Leeds']),
      official_links_json: JSON.stringify([
        { label: 'GOV.UK Student & Work Visas', url: 'https://www.gov.uk/browse/visas-immigration' },
        { label: 'British Council Study UK', url: 'https://study-uk.britishcouncil.org/' },
      ]),
    },
    {
      slug: 'canada',
      name: 'Canada',
      region: 'North America',
      flag_code: 'CA',
      hero_image: '/src/assets/images/country_canada_hub_1795454654613.jpg',
      overview: 'Popular for research-based Master’s programs, co-op education, and Express Entry / Provincial Nominee immigration pathways across Ontario, British Columbia, and Quebec.',
      education_pathways: 'Designated Learning Institutions (DLIs) with Provincial Attestation Letter (PAL) requirements for applicable study permits.',
      job_pathways: 'Post-Graduation Work Permit (PGWP, subject to eligible institution & field rules), Express Entry (CEC/FSW), and Provincial Nominee Programs.',
      apprenticeship_pathways: 'Red Seal skilled trades apprenticeships generally require Canadian PR/citizenship or employer-sponsored LMIA work permits.',
      scholarship_summary: 'Vanier Canada Graduate Scholarships, Ontario Graduate Scholarship (OGS), and university teaching/research assistantships.',
      language_requirements: 'IELTS General/Academic or CELPIP; French (TEF/TCF) adds significant Express Entry points.',
      visa_disclaimer_info: 'IRCC policies on study permit caps, PGWP eligibility, and proof-of-funds update frequently. Confirm directly on Canada.ca.',
      living_cost_estimate: 'IRCC proof-of-funds baseline is separate from tuition; Toronto and Vancouver housing costs are significantly higher than Halifax or Winnipeg.',
      popular_cities_json: JSON.stringify(['Toronto', 'Vancouver', 'Montreal', 'Waterloo', 'Ottawa', 'Calgary']),
      official_links_json: JSON.stringify([
        { label: 'IRCC Official Immigration & Study', url: 'https://www.canada.ca/en/services/immigration-citizenship.html' },
        { label: 'EduCanada', url: 'https://www.educanada.ca/' },
      ]),
    },
    {
      slug: 'united-states',
      name: 'United States',
      region: 'North America',
      flag_code: 'US',
      hero_image: null,
      overview: 'Extensive graduate research funding, STEM OPT practical training frameworks, and global technology and biotech ecosystems.',
      education_pathways: 'F-1 / J-1 academic programs across public state universities and private research institutions; GRE/GMAT varies by department.',
      job_pathways: 'OPT & 24-month STEM OPT extension for eligible degrees, H-1B specialty occupation lottery/cap-exempt employers, and O-1 for extraordinary ability.',
      apprenticeship_pathways: 'Registered apprenticeships and structured rotational new-grad analyst programs.',
      scholarship_summary: 'Fulbright-Nehru Fellowships, Inlaks, university TA/RA stipends, and PhD fellowships.',
      language_requirements: 'TOEFL iBT, IELTS Academic, or Duolingo English Test depending on university.',
      visa_disclaimer_info: 'USCIS and U.S. Department of State issue binding regulations; no platform can predict visa interview outcomes.',
      living_cost_estimate: 'Varies widely between Midwest college towns ($900–$1,400/mo) and coastal metros like NYC/Bay Area ($2,000–$3,200/mo).',
      popular_cities_json: JSON.stringify(['Boston', 'San Francisco', 'New York', 'Seattle', 'Austin', 'Chicago']),
      official_links_json: JSON.stringify([
        { label: 'EducationUSA India', url: 'https://educationusa.state.gov/' },
        { label: 'USCIS Official Portal', url: 'https://www.uscis.gov/' },
      ]),
    },
    {
      slug: 'australia',
      name: 'Australia',
      region: 'Oceania',
      flag_code: 'AU',
      hero_image: null,
      overview: 'Group of Eight research universities, Temporary Graduate (Subclass 485) work rights, and regional skilled migration pathways.',
      education_pathways: 'Bachelor’s, Master’s by Coursework/Research, and PhD programs under Subclass 500 Student Visa.',
      job_pathways: 'Subclass 485 post-study work, Skills in Demand (Subclass 482) employer sponsorship, and points-tested Subclass 189/190/491.',
      apprenticeship_pathways: 'VET sector diplomas and trade pathways in hospitality, nursing, and engineering trades.',
      scholarship_summary: 'Australia Awards, Destination Australia, and Research Training Program (RTP) stipends.',
      language_requirements: 'IELTS, PTE Academic, or TOEFL iBT.',
      visa_disclaimer_info: 'Department of Home Affairs updates Genuine Student (GS) criteria and financial capacity thresholds regularly.',
      living_cost_estimate: 'Home Affairs living-cost benchmark plus city-specific shared rental costs in Sydney, Melbourne, or Adelaide.',
      popular_cities_json: JSON.stringify(['Melbourne', 'Sydney', 'Brisbane', 'Adelaide', 'Perth']),
      official_links_json: JSON.stringify([
        { label: 'Study Australia', url: 'https://www.studyaustralia.gov.au/' },
        { label: 'Australian Home Affairs', url: 'https://immi.homeaffairs.gov.au/' },
      ]),
    },
    {
      slug: 'ireland',
      name: 'Ireland',
      region: 'Europe',
      flag_code: 'IE',
      hero_image: null,
      overview: 'English-speaking EU hub with strong software, pharma, and fintech employers plus a 2-year Stay Back Option for Level 9 Master’s graduates.',
      education_pathways: '1-year Master’s degrees at Trinity College Dublin, UCD, UCC, University of Galway, and Technological Universities.',
      job_pathways: 'Third Level Graduate Programme (Stamp 1G), Critical Skills Employment Permit, and General Employment Permit.',
      apprenticeship_pathways: 'SOLAS/FIT tech apprenticeships (eligibility generally depends on existing residence permission).',
      scholarship_summary: 'Government of Ireland International Education Scholarships (GOI-IES).',
      language_requirements: 'IELTS 6.5, TOEFL, or Duolingo English Test.',
      visa_disclaimer_info: 'Irish Immigration Service Delivery (ISD) and DETE publish official permit occupation lists.',
      living_cost_estimate: 'Dublin housing availability is tight; plan early and verify landlord legitimacy to avoid rental scams.',
      popular_cities_json: JSON.stringify(['Dublin', 'Cork', 'Galway', 'Limerick']),
      official_links_json: JSON.stringify([
        { label: 'Education in Ireland', url: 'https://www.educationinireland.com/' },
        { label: 'Irish Immigration Service', url: 'https://www.irishimmigration.ie/' },
      ]),
    },
    {
      slug: 'france',
      name: 'France',
      region: 'Europe',
      flag_code: 'FR',
      hero_image: null,
      overview: 'Grandes Écoles, affordable public university tuition, and the 2-year APS post-study search permit under the India–France mobility agreement.',
      education_pathways: 'Campus France procedure (Études en France) for Master’s, MiM, MSc, and engineering programs.',
      job_pathways: 'Talent Passport (Passeport Talent) and APS (Autorisation Provisoire de Séjour) for Indian Master’s graduates.',
      apprenticeship_pathways: 'Alternance (work-study contracts) widely available after completing an initial year of French higher education.',
      scholarship_summary: 'Charpak Scholarship (French Embassy in India) and Eiffel Excellence Scholarship.',
      language_requirements: 'English-taught programs accept IELTS/TOEFL; French A2–B2 significantly boosts alternance and job prospects.',
      visa_disclaimer_info: 'Verify Campus France India timelines and VFS documentation checklists directly.',
      living_cost_estimate: 'CAF housing subsidy can offset student rent; Paris costs noticeably more than Lyon, Toulouse, or Grenoble.',
      popular_cities_json: JSON.stringify(['Paris', 'Lyon', 'Toulouse', 'Grenoble', 'Lille']),
      official_links_json: JSON.stringify([
        { label: 'Campus France India', url: 'https://www.inde.campusfrance.org/' },
      ]),
    },
    {
      slug: 'netherlands',
      name: 'Netherlands',
      region: 'Europe',
      flag_code: 'NL',
      hero_image: null,
      overview: 'High concentration of English-taught technical & business Master’s programs and the 1-year Orientation Year (Zoekjaar) permit.',
      education_pathways: 'Research Universities (WO) and Universities of Applied Sciences (HBO) via Studielink.',
      job_pathways: 'Orientation Year (Zoekjaar) and Highly Skilled Migrant (Kennismigrant) via IND-recognized sponsors.',
      apprenticeship_pathways: 'Applied graduation internships (afstudeerstage) embedded inside HBO and TU Master’s curricula.',
      scholarship_summary: 'NL Scholarship (formerly Holland Scholarship) and Justus & Louise van Effen Excellence Scholarships.',
      language_requirements: 'IELTS 6.5+ or TOEFL iBT 90+.',
      visa_disclaimer_info: 'IND publishes official recognized sponsor lists and monthly income thresholds.',
      living_cost_estimate: 'Student housing shortage in Amsterdam, Delft, and Eindhoven requires applying 4–6 months ahead.',
      popular_cities_json: JSON.stringify(['Amsterdam', 'Delft', 'Eindhoven', 'Utrecht', 'Rotterdam']),
      official_links_json: JSON.stringify([
        { label: 'Study in NL', url: 'https://www.studyinnl.org/' },
        { label: 'IND Netherlands', url: 'https://ind.nl/en' },
      ]),
    },
    {
      slug: 'italy',
      name: 'Italy',
      region: 'Europe',
      flag_code: 'IT',
      hero_image: null,
      overview: 'Income-based public university tuition and regional DSU need-based scholarships covering tuition, accommodation, and meal allowances.',
      education_pathways: 'Politecnico di Milano, Politecnico di Torino, Sapienza, Bologna, and Padua with CIMEA/DOV verification.',
      job_pathways: 'Post-study job search permit (Permesso di soggiorno per attesa occupazione) and EU Blue Card.',
      apprenticeship_pathways: 'Curricular internships and industrial design/automotive partnerships.',
      scholarship_summary: 'Regional DSU Scholarships (EDISU, ER.GO, DSU Toscana), Invest Your Talent in Italy, and MAECI.',
      language_requirements: 'IELTS 6.0+ or Medium of Instruction certificate where accepted by individual universities.',
      visa_disclaimer_info: 'Universitaly pre-enrollment and Italian Consulate in India rules govern visa issuance.',
      living_cost_estimate: 'Comparable to Southern/Central Europe; Milan rent is higher than Turin, Padua, or Bologna.',
      popular_cities_json: JSON.stringify(['Milan', 'Turin', 'Rome', 'Bologna', 'Padua']),
      official_links_json: JSON.stringify([
        { label: 'Universitaly Official Portal', url: 'https://www.universitaly.it/' },
      ]),
    },
    {
      slug: 'japan',
      name: 'Japan',
      region: 'Asia',
      flag_code: 'JP',
      hero_image: null,
      overview: 'MEXT government scholarships, engineering & robotics research labs, and the Specified Skilled Worker / Engineer visa pathways.',
      education_pathways: 'G30/English-track degrees and Japanese-language school + university transfer pathways.',
      job_pathways: 'Engineer / Specialist in Humanities / International Services visa and J-Find / J-Skip frameworks.',
      apprenticeship_pathways: 'Technical Intern Training & Specified Skilled Worker (SSW) programs via official bilateral frameworks.',
      scholarship_summary: 'MEXT Scholarship (Embassy & University tracks) and JASSO.',
      language_requirements: 'JLPT N2/N1 strongly preferred for full-time corporate roles; N5/N4 for SSW tracks.',
      visa_disclaimer_info: 'Verify Certificate of Eligibility (COE) and bilateral SSW rules with Embassy of Japan in India.',
      living_cost_estimate: 'Reasonable transit & food; Tokyo housing requires upfront key-money/guarantor planning.',
      popular_cities_json: JSON.stringify(['Tokyo', 'Osaka', 'Kyoto', 'Fukuoka', 'Tsukuba']),
      official_links_json: JSON.stringify([
        { label: 'Study in Japan (JASSO)', url: 'https://www.studyinjapan.go.jp/en/' },
      ]),
    },
    {
      slug: 'singapore',
      name: 'Singapore',
      region: 'Asia',
      flag_code: 'SG',
      hero_image: null,
      hero_note: '',
      overview: 'Leading Asian finance, AI, and semiconductor hub close to India with NUS, NTU, and SMU research degrees.',
      education_pathways: 'Graduate coursework & PhD programs, plus MOE Tuition Grant obligations where applicable.',
      job_pathways: 'Employment Pass (COMPASS points framework) and ONE Pass for senior specialists.',
      apprenticeship_pathways: 'Structured graduate analyst rotations in banking, cloud, and supply chain.',
      scholarship_summary: 'SINGA (Singapore International Graduate Award) for PhD research in science & engineering.',
      language_requirements: 'English-medium instruction; IELTS/TOEFL for international applicants.',
      visa_disclaimer_info: 'Ministry of Manpower (MOM) administers COMPASS criteria and salary thresholds.',
      living_cost_estimate: 'Rent is the primary expense; campus housing or HDB room sharing helps control costs.',
      popular_cities_json: JSON.stringify(['Singapore']),
      official_links_json: JSON.stringify([
        { label: 'Ministry of Manpower Singapore', url: 'https://www.mom.gov.sg/' },
      ]),
    },
    {
      slug: 'new-zealand',
      name: 'New Zealand',
      region: 'Oceania',
      flag_code: 'NZ',
      hero_image: null,
      overview: 'Eight public universities with Post-Study Work Visas (up to 3 years for Master’s/PhD) and Green List skilled occupations.',
      education_pathways: 'Level 9 Master’s and Level 10 Doctoral degrees.',
      job_pathways: 'Post Study Work Visa and Accredited Employer Work Visa (AEWV).',
      apprenticeship_pathways: 'Trade and agri-tech pathways tied to Green List roles.',
      scholarship_summary: 'Manaaki New Zealand Scholarships and University of Auckland/Otago doctoral awards.',
      language_requirements: 'IELTS Academic 6.5 overall.',
      visa_disclaimer_info: 'Immigration New Zealand (INZ) sets Green List tiers and funds verification.',
      living_cost_estimate: 'Auckland and Wellington rents are highest; Christchurch and Dunedin are more affordable.',
      popular_cities_json: JSON.stringify(['Auckland', 'Wellington', 'Christchurch', 'Dunedin']),
      official_links_json: JSON.stringify([
        { label: 'Immigration New Zealand', url: 'https://www.immigration.govt.nz/' },
      ]),
    },
    {
      slug: 'sweden',
      name: 'Sweden',
      region: 'Europe',
      flag_code: 'SE',
      hero_image: null,
      overview: 'Innovation-driven Master’s programs with 12-month residence permit to seek employment or start a business after graduation.',
      education_pathways: 'Centralized UniversityAdmissions.se application portal.',
      job_pathways: 'Work Permit (Migrationsverket) and post-study 1-year job-seeker permit.',
      apprenticeship_pathways: 'Paid master’s thesis projects (exjobb) with Swedish engineering firms.',
      scholarship_summary: 'Swedish Institute (SI) Scholarships for Global Professionals.',
      language_requirements: 'English 6 equivalence (IELTS 6.5 / TOEFL 90).',
      visa_disclaimer_info: 'Check Migrationsverket salary thresholds and university application rounds.',
      living_cost_estimate: 'Student queues for housing in Stockholm and Gothenburg require early registration.',
      popular_cities_json: JSON.stringify(['Stockholm', 'Gothenburg', 'Lund', 'Uppsala']),
      official_links_json: JSON.stringify([
        { label: 'Study in Sweden', url: 'https://studyinsweden.se/' },
      ]),
    },
    {
      slug: 'finland',
      name: 'Finland',
      region: 'Europe',
      flag_code: 'FI',
      hero_image: null,
      overview: 'Strong R&D ecosystem, 2-year post-study job-seeker residence permit, and generous university tuition-waiver scholarships.',
      education_pathways: 'Studyinfo.fi joint applications for Aalto, University of Helsinki, Tampere, and Oulu.',
      job_pathways: '2-year residence permit to look for work or start a business after graduation.',
      apprenticeship_pathways: 'Applied research projects and UAS practical training placements.',
      scholarship_summary: 'Finland Scholarship (tuition waiver + relocation grant) and university merit waivers.',
      language_requirements: 'IELTS 6.5 / TOEFL iBT 92; Finnish/Swedish helpful for non-tech local jobs.',
      visa_disclaimer_info: 'Migri (Finnish Immigration Service) publishes official income thresholds.',
      living_cost_estimate: 'HOAS/student housing cooperatives offer comparatively affordable rooms.',
      popular_cities_json: JSON.stringify(['Helsinki', 'Espoo', 'Tampere', 'Oulu']),
      official_links_json: JSON.stringify([
        { label: 'Study in Finland', url: 'https://www.studyinfinland.fi/' },
      ]),
    },
    {
      slug: 'austria',
      name: 'Austria',
      region: 'Europe',
      flag_code: 'AT',
      hero_image: null,
      overview: 'Low public university tuition (~€726/semester for non-EU students) and the Red-White-Red Card skilled migration framework.',
      education_pathways: 'TU Wien, University of Vienna, TU Graz, and Universities of Applied Sciences.',
      job_pathways: 'Red-White-Red Card (Rot-Weiß-Rot – Karte) for graduates and shortage occupations.',
      apprenticeship_pathways: 'Dual vocational tracks and paid Fachhochschule internships.',
      scholarship_summary: 'OeAD Ernst Mach Grants and university merit awards.',
      language_requirements: 'B2/C1 German for many Bachelor’s; IELTS/TOEFL for English-taught Master’s.',
      visa_disclaimer_info: 'Verify OeAD and Austrian Embassy New Delhi legalization requirements.',
      living_cost_estimate: 'Vienna public transit & student dorms offer high quality of life at moderate European cost.',
      popular_cities_json: JSON.stringify(['Vienna', 'Graz', 'Innsbruck', 'Linz']),
      official_links_json: JSON.stringify([
        { label: 'OeAD Study in Austria', url: 'https://studyinaustria.at/en/' },
      ]),
    },
    {
      slug: 'switzerland',
      name: 'Switzerland',
      region: 'Europe',
      flag_code: 'CH',
      hero_image: null,
      overview: 'ETH Zurich, EPFL, and precision life-sciences / robotics research hubs with low public tuition relative to living expenses.',
      education_pathways: 'ETH Zurich, EPFL, University of Zurich, and cantonal universities.',
      job_pathways: '6-month post-graduation job-search permit; non-EU work quotas are competitive and employer-sponsored.',
      apprenticeship_pathways: 'Swiss dual-track system primarily for residents; university research assistantships open to international students.',
      scholarship_summary: 'Swiss Government Excellence Scholarships (ESKAS) for PhD & postdoc researchers.',
      language_requirements: 'English for many STEM Master’s; German or French depending on canton.',
      visa_disclaimer_info: 'Cantonal migration offices and SEM manage work permit quotas.',
      living_cost_estimate: 'High monthly living expenses (Zurich/Geneva); verify cantonal financial proof requirements.',
      popular_cities_json: JSON.stringify(['Zurich', 'Lausanne', 'Geneva', 'Basel']),
      official_links_json: JSON.stringify([
        { label: 'studyinswitzerland+', url: 'https://www.studyinswitzerland.plus/' },
      ]),
    },
    {
      slug: 'united-arab-emirates',
      name: 'United Arab Emirates',
      region: 'Middle East',
      flag_code: 'AE',
      hero_image: null,
      overview: 'Proximity to India, tax-free salary structures, Golden Visa talent categories, and international university branch campuses.',
      education_pathways: 'UAE national universities and international branch campuses in Dubai and Abu Dhabi.',
      job_pathways: 'Employer-sponsored Standard Work Visa, Green Visa for skilled professionals, and 10-year Golden Visa.',
      apprenticeship_pathways: 'Graduate trainee cohorts in aviation, logistics, construction, and fintech.',
      scholarship_summary: 'MBZUAI full graduate AI scholarships and campus merit scholarships.',
      language_requirements: 'English in corporate & tech roles; Arabic is an advantage in public sector.',
      visa_disclaimer_info: 'MOHRE and ICP issue binding employment visa rules; never pay recruitment agents for UAE job visas.',
      living_cost_estimate: 'Shared housing in Dubai/Abu Dhabi vs private studio rents vary significantly by district.',
      popular_cities_json: JSON.stringify(['Dubai', 'Abu Dhabi', 'Sharjah']),
      official_links_json: JSON.stringify([
        { label: 'UAE ICP Official Portal', url: 'https://icp.gov.ae/en/' },
      ]),
    },
  ];

  const insertCountry = db.prepare(`
    INSERT INTO countries (
      id, slug, name, region, flag_code, hero_image, overview, education_pathways, job_pathways,
      apprenticeship_pathways, scholarship_summary, language_requirements, visa_disclaimer_info,
      living_cost_estimate, popular_cities_json, official_links_json, last_updated, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  for (const c of countriesData) {
    insertCountry.run(
      uuid(),
      c.slug,
      c.name,
      c.region,
      c.flag_code,
      c.hero_image,
      c.overview,
      c.education_pathways,
      c.job_pathways,
      c.apprenticeship_pathways,
      c.scholarship_summary,
      c.language_requirements,
      c.visa_disclaimer_info,
      c.living_cost_estimate,
      c.popular_cities_json,
      c.official_links_json,
      '2026-11-15'
    );
  }

  // Demonstration community members (clearly marked is_demo_data = 1)
  const demoUsers = [
    {
      id: uuid(),
      display_name: 'Ananya Sharma (Demo)',
      username: 'ananya_tum_munich',
      bio: 'MSc Informatics student in Munich (formerly Bengaluru). Happy to share honest experience on APS, TU9 applications, and student dorms.',
      current_country: 'Germany',
      state: 'Bavaria',
      city: 'Munich',
      preferred_language: 'en',
      verification_level: 'institution_reviewed',
      verification_badge_label: 'Verified Student · Evidence Reviewed (Demo)',
      roles: ['registered_member', 'verified_member', 'abroad_student', 'verified_mentor'],
      profile: {
        highest_qualification: 'B.Tech Computer Science',
        degree_specialization: 'Informatics / Distributed Systems',
        graduation_year: '2024',
        institution: 'Technical University of Munich',
        english_proficiency: 'IELTS 7.5',
        other_language_proficiency: 'German B1',
        employment_status: 'Student',
        industry: 'Software & AI',
        skills_json: JSON.stringify(['Python', 'Distributed Systems', 'APS Prep', 'SOP Review']),
        experience_level: '2 years',
        primary_destination_country: 'germany',
        purpose: 'Study',
        intended_intake: 'Winter 2027',
        application_stage: 'Settle Abroad',
        interested_cities_json: JSON.stringify(['Munich', 'Berlin']),
        wants_mentor: 0,
      },
    },
    {
      id: uuid(),
      display_name: 'Karthik Subramanian (Demo)',
      username: 'karthik_chennai_de',
      bio: 'Final-year ECE student from Chennai preparing for Master’s in Embedded Systems in Germany for Winter 2027.',
      current_country: 'India',
      state: 'Tamil Nadu',
      city: 'Chennai',
      preferred_language: 'ta',
      verification_level: 'email',
      verification_badge_label: 'Email Verified (Demo)',
      roles: ['registered_member'],
      profile: {
        highest_qualification: 'B.E. Electronics & Communication',
        degree_specialization: 'Embedded Systems',
        graduation_year: '2026',
        institution: 'Anna University',
        english_proficiency: 'IELTS 7.0',
        other_language_proficiency: 'German A2',
        employment_status: 'Student',
        industry: 'Semiconductors',
        skills_json: JSON.stringify(['Embedded C', 'RTOS', 'VHDL']),
        experience_level: 'Fresher',
        primary_destination_country: 'germany',
        purpose: 'Study',
        intended_intake: 'Winter 2027',
        application_stage: 'Prepare',
        interested_cities_json: JSON.stringify(['Munich', 'Aachen', 'Stuttgart']),
        wants_mentor: 1,
      },
    },
    {
      id: uuid(),
      display_name: 'Rohan Kulkarni (Demo)',
      username: 'rohan_ausbildung_berlin',
      bio: 'IT-Systemintegration Ausbildung apprentice in Berlin from Pune. Ask me about German B2 prep and Ausbildung interviews.',
      current_country: 'Germany',
      state: 'Berlin',
      city: 'Berlin',
      preferred_language: 'hi',
      verification_level: 'mentor_reviewed',
      verification_badge_label: 'Mentor Reviewed (Demo)',
      roles: ['registered_member', 'verified_member', 'verified_mentor'],
      profile: {
        highest_qualification: 'B.Sc IT',
        degree_specialization: 'System Administration',
        graduation_year: '2023',
        institution: 'Pune University',
        english_proficiency: 'IELTS 6.5',
        other_language_proficiency: 'German B2',
        employment_status: 'Apprentice',
        industry: 'Cloud & Networking',
        skills_json: JSON.stringify(['Linux', 'German B2', 'Ausbildung CV']),
        experience_level: '2 years',
        primary_destination_country: 'germany',
        purpose: 'Apprenticeship',
        intended_intake: 'Winter 2027',
        application_stage: 'Settle Abroad',
        interested_cities_json: JSON.stringify(['Berlin', 'Hamburg']),
        wants_mentor: 0,
      },
    },
    {
      id: uuid(),
      display_name: 'Priya Nair (Demo)',
      username: 'priya_london_fin',
      bio: 'Data Analyst in London (Chevening Alumna). Helping Indian applicants understand UK Skilled Worker realities & Chevening essays.',
      current_country: 'United Kingdom',
      state: 'Greater London',
      city: 'London',
      preferred_language: 'en',
      verification_level: 'mentor_reviewed',
      verification_badge_label: 'Mentor Reviewed (Demo)',
      roles: ['registered_member', 'verified_member', 'working_professional', 'verified_mentor'],
      profile: {
        highest_qualification: 'MSc Data Science',
        degree_specialization: 'Data Science & Econometrics',
        graduation_year: '2022',
        institution: 'University College London',
        english_proficiency: 'IELTS 8.0',
        other_language_proficiency: '',
        employment_status: 'Employed Full-Time',
        industry: 'FinTech & Analytics',
        skills_json: JSON.stringify(['SQL', 'Chevening Essays', 'UK CV Review']),
        experience_level: '4 years',
        primary_destination_country: 'united-kingdom',
        purpose: 'Job',
        intended_intake: 'Moving Abroad in 2027',
        application_stage: 'Settle Abroad',
        interested_cities_json: JSON.stringify(['London', 'Edinburgh']),
        wants_mentor: 0,
      },
    },
    {
      id: uuid(),
      display_name: 'Vikramjit Gill (Demo)',
      username: 'vikram_toronto_coop',
      bio: 'Senior Software Engineer in Toronto (former Waterloo co-op student). Sharing realistic Canadian housing & tech market insights.',
      current_country: 'Canada',
      state: 'Ontario',
      city: 'Toronto',
      preferred_language: 'en',
      verification_level: 'institution_reviewed',
      verification_badge_label: 'Employment Evidence Reviewed (Demo)',
      roles: ['registered_member', 'verified_member', 'working_professional', 'verified_mentor'],
      profile: {
        highest_qualification: 'MMath Computer Science',
        degree_specialization: 'Systems Engineering',
        graduation_year: '2021',
        institution: 'University of Waterloo',
        english_proficiency: 'IELTS 8.0',
        other_language_proficiency: 'French A2',
        employment_status: 'Employed Full-Time',
        industry: 'Cloud Infrastructure',
        skills_json: JSON.stringify(['Go', 'Kubernetes', 'Canadian Co-op']),
        experience_level: '5 years',
        primary_destination_country: 'canada',
        purpose: 'Job',
        intended_intake: 'Moving Abroad in 2027',
        application_stage: 'Settle Abroad',
        interested_cities_json: JSON.stringify(['Toronto', 'Waterloo']),
        wants_mentor: 0,
      },
    },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (
      id, email, phone, display_name, username, avatar_url, bio, current_country, state, city,
      preferred_language, status, email_verified, phone_verified, verification_level, verification_badge_label,
      is_demo_data, onboarding_completed, created_at, updated_at
    ) VALUES (?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 'active', 1, 0, ?, ?, 1, 1, ?, ?)
  `);
  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)');
  const insertProf = db.prepare(`
    INSERT INTO user_profiles_extended (
      user_id, highest_qualification, degree_specialization, graduation_year, institution,
      english_proficiency, other_language_proficiency, employment_status, industry, skills_json,
      experience_level, primary_destination_country, purpose, intended_intake, application_stage,
      interested_cities_json, wants_mentor, discoverable_buddy, profile_visibility, messaging_permission,
      consent_tos_at, consent_privacy_at, profile_completion_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'members', 'anyone', ?, ?, 90)
  `);

  for (const u of demoUsers) {
    insertUser.run(
      u.id,
      u.display_name,
      u.username,
      u.bio,
      u.current_country,
      u.state,
      u.city,
      u.preferred_language,
      u.verification_level,
      u.verification_badge_label,
      ts,
      ts
    );
    for (const r of u.roles) {
      insertRole.run(u.id, r, 'system_seed', ts);
    }
    insertProf.run(
      u.id,
      u.profile.highest_qualification,
      u.profile.degree_specialization,
      u.profile.graduation_year,
      u.profile.institution,
      u.profile.english_proficiency,
      u.profile.other_language_proficiency,
      u.profile.employment_status,
      u.profile.industry,
      u.profile.skills_json,
      u.profile.experience_level,
      u.profile.primary_destination_country,
      u.profile.purpose,
      u.profile.intended_intake,
      u.profile.application_stage,
      u.profile.interested_cities_json,
      u.profile.wants_mentor,
      ts,
      ts
    );
  }

  // Mentors linked to demo verified mentors
  const insertMentor = db.prepare(`
    INSERT INTO mentors (
      id, user_id, mentor_type, current_country, current_city, institution_or_employer,
      expertise_json, languages_json, years_experience, bio, topics_json, availability_slots_json,
      verification_status, verification_reviewed_at, is_suspended, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, 0, ?)
  `);

  insertMentor.run(
    uuid(),
    demoUsers[0].id,
    'International Student',
    'Germany',
    'Munich',
    'Technical University of Munich (TUM)',
    JSON.stringify(['MS Informatics Germany', 'APS India Process', 'Uni-Assist & SOPs']),
    JSON.stringify(['English', 'Hindi']),
    3,
    'Currently pursuing MSc Informatics at TUM. Happy to review SOP structures and answer realistic questions about Munich living costs and student housing.',
    JSON.stringify(['Public University Admissions', 'APS Certificate Prep', 'Blocked Account & Dorms']),
    JSON.stringify(['Sat 10:00 AM CET', 'Sun 04:00 PM IST']),
    ts,
    ts
  );

  insertMentor.run(
    uuid(),
    demoUsers[2].id,
    'Apprenticeship Participant',
    'Germany',
    'Berlin',
    'Berlin IT Systems Partner (Demo)',
    JSON.stringify(['Ausbildung IT', 'German B2 Prep', 'Europass CV']),
    JSON.stringify(['English', 'Hindi', 'Marathi', 'German']),
    2,
    'Moved from Pune to Berlin on an IT-Systemintegration Ausbildung contract without paying any consultant. Can guide on authentic employer outreach.',
    JSON.stringify(['Ausbildung Applications', 'German Language Roadmap', 'Contract Verification']),
    JSON.stringify(['Sat 06:00 PM IST', 'Wed 07:30 PM IST']),
    ts,
    ts
  );

  insertMentor.run(
    uuid(),
    demoUsers[3].id,
    'Scholarship Recipient',
    'United Kingdom',
    'London',
    'London FinTech (Chevening Alumna)',
    JSON.stringify(['Chevening Scholarship', 'UK Data Science Jobs', 'Graduate Route Transition']),
    JSON.stringify(['English', 'Malayalam']),
    4,
    'Chevening Alumna and London Data Analyst. Focused on transparent, scam-free advice for UK MSc applicants and post-study career planning.',
    JSON.stringify(['Chevening Leadership Essays', 'UK Skilled Worker Reality', 'London Budgeting']),
    JSON.stringify(['Sun 05:30 PM IST', 'Thu 08:00 PM IST']),
    ts,
    ts
  );

  insertMentor.run(
    uuid(),
    demoUsers[4].id,
    'Working Professional',
    'Canada',
    'Toronto',
    'Cloud Infrastructure Engineer, Toronto',
    JSON.stringify(['Canadian Co-op', 'Tech Resume Adaptation', 'Express Entry Basics']),
    JSON.stringify(['English', 'Punjabi', 'Hindi']),
    5,
    'Waterloo alumnus working in Toronto. Can share grounded insights on Canadian software interviews and winter relocation.',
    JSON.stringify(['Waterloo & Canadian Co-ops', 'Tech Job Search in Canada', 'Rental Safety']),
    JSON.stringify(['Sat 08:30 PM IST']),
    ts,
    ts
  );

  // Groups across all 5 categories (Public, Private, Invite-only)
  const groupsSeed = [
    {
      slug: 'germany-masters-students',
      name: "Germany — Master's Students",
      category: 'Country + Purpose',
      country_slug: 'germany',
      purpose: 'Study',
      privacy: 'public',
      description: 'Peer-reviewed community for Indian applicants and current students pursuing Master’s degrees across German public & applied sciences universities.',
      rules_json: JSON.stringify([
        'No consultant promotions or guaranteed-visa claims.',
        'Never post your passport number, APS receipt PDF, or bank statements publicly.',
        'Cite official university or DAAD links whenever quoting eligibility rules.',
      ]),
      pinned_announcement: 'Winter 2027 applicants: Check APS India processing timelines at least 5 months before uni-assist deadlines.',
    },
    {
      slug: 'germany-ausbildung',
      name: 'Germany — Ausbildung',
      category: 'Country + Purpose',
      country_slug: 'germany',
      purpose: 'Apprenticeship',
      privacy: 'public',
      description: 'Vocational dual-training community covering Nursing, IT, Mechatronics, and Hospitality Ausbildung pathways directly with German employers.',
      rules_json: JSON.stringify([
        'Zero-fee principle: Legitimate Ausbildung contracts never charge applicants upfront placement fees.',
        'Share verified German B1/B2 study resources.',
      ]),
      pinned_announcement: 'Reminder: Report any recruiter asking for money before an employer interview.',
    },
    {
      slug: 'germany-it-jobs',
      name: 'Germany — IT Jobs',
      category: 'Country + Purpose',
      country_slug: 'germany',
      purpose: 'Job',
      privacy: 'public',
      description: 'Software, Data, DevOps, and Embedded engineering professionals targeting EU Blue Card or Chancenkarte roles in Germany.',
      rules_json: JSON.stringify(['Keep salary discussions factual with city and gross/net context.']),
      pinned_announcement: 'Verify current EU Blue Card salary thresholds on Make-it-in-Germany before applying.',
    },
    {
      slug: 'uk-study',
      name: 'UK — Study',
      category: 'Country + Purpose',
      country_slug: 'united-kingdom',
      purpose: 'Study',
      privacy: 'public',
      description: 'Prospective and current Indian students exploring UK Master’s, Chevening, Commonwealth scholarships, and campus housing.',
      rules_json: JSON.stringify(['Distinguish personal opinions from official UKVI guidance.']),
      pinned_announcement: 'Always double-check UKVI Financial Requirement updates directly on GOV.UK.',
    },
    {
      slug: 'canada-scholarships',
      name: 'Canada — Scholarships',
      category: 'Country + Purpose',
      country_slug: 'canada',
      purpose: 'Scholarship',
      privacy: 'public',
      description: 'Funding strategies, RA/TA assistantships, Vanier, and OGS discussions for Indian graduate applicants to Canada.',
      rules_json: JSON.stringify(['Include official university funding page URLs when sharing awards.']),
      pinned_announcement: 'Tip: Reach out to thesis supervisors early for funded MASc/MMath/PhD openings.',
    },
    {
      slug: 'ireland-graduate-jobs',
      name: 'Ireland — Graduate Jobs',
      category: 'Country + Purpose',
      country_slug: 'ireland',
      purpose: 'Job',
      privacy: 'public',
      description: 'Navigating Stamp 1G, Critical Skills Employment Permits, and tech/pharma graduate programs in Dublin, Cork, and Galway.',
      rules_json: JSON.stringify(['Verify Critical Skills occupation lists via enterprise.gov.ie.']),
      pinned_announcement: 'Beware of fake Dublin rental listings asking for wire transfers before viewings.',
    },
    {
      slug: 'berlin-indian-community',
      name: 'Berlin Indian Community',
      category: 'City',
      country_slug: 'germany',
      purpose: 'Relocation',
      privacy: 'public',
      description: 'City settlement tips: Anmeldung registration, TK/AOK health insurance, WG-Gesucht housing safety, and local meetups in Berlin.',
      rules_json: JSON.stringify(['No commercial spam or unverified sublet broker fees.']),
      pinned_announcement: 'Never pay a deposit for a Berlin apartment before seeing the contract and verifying the landlord.',
    },
    {
      slug: 'munich-students-verified',
      name: 'Munich Students (Private Cohort)',
      category: 'City',
      country_slug: 'germany',
      purpose: 'Study',
      privacy: 'private',
      description: 'Private peer group for admitted and current Munich university students coordinating safe shared housing, semester tickets, and arrivals.',
      rules_json: JSON.stringify(['Private group content must stay within the cohort.', 'Moderator approval required before joining.']),
      pinned_announcement: 'Welcome to the Munich Cohort! Introduce your university and intake after approval.',
    },
    {
      slug: 'winter-2027-applicants',
      name: 'Winter 2027 Applicants',
      category: 'Timeline',
      country_slug: 'germany',
      purpose: 'Study',
      privacy: 'public',
      description: 'Cross-country accountability cohort for Indian applicants targeting the September–October 2027 intake.',
      rules_json: JSON.stringify(['Share deadline milestones and constructive feedback.']),
      pinned_announcement: 'Cohort milestone: Shortlist 6–8 programs and check IELTS/APS lead times this month.',
    },
    {
      slug: 'ielts-and-german-prep',
      name: 'IELTS & German Language Learning',
      category: 'Interest',
      country_slug: null,
      purpose: 'Study',
      privacy: 'public',
      description: 'Free study partners, speaking practice rooms, and honest Goethe/TestDaF/IELTS preparation strategies.',
      rules_json: JSON.stringify(['No paid coaching spam or leaked test claims.']),
      pinned_announcement: 'Weekly peer speaking practice threads open every Saturday.',
    },
    {
      slug: 'visa-documentation-scam-watch',
      name: 'Visa Documentation & Scam Watch',
      category: 'Interest',
      country_slug: null,
      purpose: 'Relocation',
      privacy: 'public',
      description: 'Peer checklist reviews and community warnings about fake job offers, advance-fee scams, and document forgery risks.',
      rules_json: JSON.stringify(['Never upload personal identity scans here—redact all PII.']),
      pinned_announcement: 'Zero tolerance for forged bank statements or fake experience letters.',
    },
  ];

  const insertGroup = db.prepare(`
    INSERT INTO groups (
      id, slug, name, category, country_slug, purpose, privacy, description, rules_json,
      banner_url, pinned_announcement, moderator_only_chat, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)
  `);
  const insertMembership = db.prepare('INSERT OR IGNORE INTO group_memberships (group_id, user_id, role, is_muted, joined_at) VALUES (?, ?, ?, 0, ?)');
  const insertConv = db.prepare('INSERT INTO conversations (id, type, group_id, status, initiated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertConvPart = db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, last_read_at, is_muted) VALUES (?, ?, ?, 0)');

  const groupIds: Record<string, string> = {};
  for (const g of groupsSeed) {
    const gid = uuid();
    groupIds[g.slug] = gid;
    insertGroup.run(
      gid,
      g.slug,
      g.name,
      g.category,
      g.country_slug,
      g.purpose,
      g.privacy,
      g.description,
      g.rules_json,
      g.pinned_announcement,
      demoUsers[0].id,
      ts
    );
    // Add demo members to groups
    insertMembership.run(gid, demoUsers[0].id, 'moderator', ts);
    if (g.privacy === 'public') {
      insertMembership.run(gid, demoUsers[1].id, 'member', ts);
      insertMembership.run(gid, demoUsers[2].id, 'member', ts);
    }
    // Create group chat conversation
    const convId = uuid();
    insertConv.run(convId, 'group', gid, 'active', demoUsers[0].id, ts);
    insertConvPart.run(convId, demoUsers[0].id, ts);
    if (g.privacy === 'public') {
      insertConvPart.run(convId, demoUsers[1].id, ts);
      insertConvPart.run(convId, demoUsers[2].id, ts);
    }
  }

  // Sample Posts & Comments
  const insertPost = db.prepare(`
    INSERT INTO posts (
      id, group_id, author_id, post_type, title, body, tags_json, link_url,
      is_pinned, is_hidden, is_answered, safety_signals_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', ?, ?)
  `);
  const insertComment = db.prepare(`
    INSERT INTO comments (id, post_id, parent_id, author_id, body, is_hidden, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);

  const p1 = uuid();
  insertPost.run(
    p1,
    groupIds['germany-masters-students'],
    demoUsers[0].id,
    'experience',
    'Honest checklist: APS India + Uni-Assist timeline for Winter 2027',
    'Sharing what actually worked for me from Bengaluru: apply for APS verification as soon as your 6th/7th semester transcripts are available rather than waiting for final degree certificates. Also verify whether your target TU requires a VPD from uni-assist at least 6 weeks before the portal closes.',
    JSON.stringify(['APS India', 'Uni-Assist', 'Winter 2027']),
    'https://aps-india.de/',
    1,
    1,
    ts,
    ts
  );
  insertComment.run(
    uuid(),
    p1,
    null,
    demoUsers[1].id,
    'Thank you! For Anna University students, did you need DigiLocker verified marksheets for APS or sealed university envelopes?',
    ts
  );

  const p2 = uuid();
  insertPost.run(
    p2,
    groupIds['germany-ausbildung'],
    demoUsers[2].id,
    'question',
    'PSA: Never pay an agency ₹3–5 Lakhs for a German Ausbildung contract',
    'Every authentic German employer covers training costs and pays a monthly Ausbildungsvergütung. If an agency asks for large upfront placement fees or guarantees a visa, please verify the company directly on Bundesagentur für Arbeit or IHK.',
    JSON.stringify(['Anti-Scam', 'Ausbildung', 'Germany']),
    'https://www.make-it-in-germany.com/en/',
    1,
    1,
    ts,
    ts
  );

  const p3 = uuid();
  insertPost.run(
    p3,
    groupIds['munich-students-verified'],
    demoUsers[0].id,
    'announcement',
    'Private Cohort Thread: Studentenwerk Dorm Waitlist & Safe Sublet Tips',
    'This private thread is visible only to approved Munich cohort members. Always ask for a live video walkthrough and verify the main tenant’s Wohnungsgeberbestätigung eligibility before transferring any deposit.',
    JSON.stringify(['Munich', 'Housing', 'Private Cohort']),
    null,
    1,
    0,
    ts,
    ts
  );

  // Sample Poll Post
  const p4 = uuid();
  insertPost.run(
    p4,
    groupIds['winter-2027-applicants'],
    demoUsers[1].id,
    'poll',
    'Which stage are you at right now for Winter 2027?',
    'Trying to form a weekly accountability study circle for SOP reviews and IELTS/German practice.',
    JSON.stringify(['Winter 2027', 'Accountability']),
    null,
    0,
    0,
    ts,
    ts
  );
  const opt1 = uuid(), opt2 = uuid(), opt3 = uuid();
  const insertPollOpt = db.prepare('INSERT INTO poll_options (id, post_id, label) VALUES (?, ?, ?)');
  insertPollOpt.run(opt1, p4, 'Shortlisting universities & preparing IELTS/German');
  insertPollOpt.run(opt2, p4, 'Waiting on APS / transcripts & drafting SOP');
  insertPollOpt.run(opt3, p4, 'Ready to submit applications');

  // Universities
  const insertUni = db.prepare(`
    INSERT INTO universities (
      id, name, country_slug, city, institution_type, official_website, programs_json,
      duration, language_of_instruction, tuition_info, deadlines, eligibility,
      application_method, source_url, last_verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const uniSeeds = [
    ['Technical University of Munich (TUM)', 'germany', 'Munich', 'Public Technical University', 'https://www.tum.de/en/', ['MSc Informatics', 'MSc Robotics, Cognition, Intelligence', 'MSc Power Engineering'], '24 months', 'English / German', 'Check TUM official fee schedule for non-EU Master’s tuition & semester contribution', 'Winter intake: Jan–May (varies by program)', 'Relevant Bachelor’s degree, curriculum analysis, APS certificate, IELTS/TOEFL', 'TUMonline + uni-assist VPD', 'https://www.tum.de/en/studies/application', '2026-11-10'],
    ['RWTH Aachen University', 'germany', 'Aachen', 'Public Technical University', 'https://www.rwth-aachen.de/', ['MSc Simulation Sciences', 'MSc Automotive Engineering', 'MSc Data Science'], '24 months', 'English / German', 'No general tuition fee; ~€300 semester social contribution', 'Winter intake: March 1 (non-EU)', 'Strong quantitative B.Tech/B.E., GRE required for select tracks, APS', 'RWTHonline Portal', 'https://www.rwth-aachen.de/cms/a/studium/en/', '2026-11-10'],
    ['University of Stuttgart', 'germany', 'Stuttgart', 'Public Research University', 'https://www.uni-stuttgart.de/en/', ['MSc INFOTECH', 'MSc Computational Mechanics of Materials', 'MSc COMMAS'], '24 months', 'English', 'Baden-Württemberg non-EU tuition €1,500/semester + admin fee (verify exemptions)', 'Winter intake: Jan 15 / Feb 15', 'B.Tech/B.E. with >75% equivalent, IELTS 6.5+, APS', 'C@MPUS Portal', 'https://www.uni-stuttgart.de/en/study/', '2026-11-10'],
    ['University College London (UCL)', 'united-kingdom', 'London', 'Public Research University', 'https://www.ucl.ac.uk/', ['MSc Data Science & Machine Learning', 'MSc Financial Risk Management'], '12 months', 'English', 'Published international fee £34,000–£41,000 (program dependent)', 'Rolling / Oct–March', 'First Class / High 2:1 equivalent Bachelor’s + IELTS 7.0', 'UCL Direct Applicant Portal', 'https://www.ucl.ac.uk/prospective-students/graduate/', '2026-11-10'],
    ['University of Waterloo', 'canada', 'Waterloo', 'Public Research University', 'https://uwaterloo.ca/', ['MMath Computer Science', 'MEng Electrical & Computer Engineering'], '16–24 months', 'English', 'Published international graduate tuition varies by research/coursework', 'Dec–Feb for Fall', 'Strong GPA, 2–3 academic references, IELTS 7.0+', 'Waterloo Graduate Application', 'https://uwaterloo.ca/graduate-studies-postdoctoral-affairs/', '2026-11-10'],
    ['Trinity College Dublin', 'ireland', 'Dublin', 'Public Research University', 'https://www.tcd.ie/', ['MSc Computer Science (Intelligent Systems)', 'MSc Finance'], '12 months', 'English', 'Published non-EU tuition €21,000–€27,500', 'Oct–June (rolling)', 'Honours Bachelor’s degree + IELTS 6.5', 'TCD Postgraduate Portal', 'https://www.tcd.ie/study/postgraduate/', '2026-11-10'],
    ['Delft University of Technology (TU Delft)', 'netherlands', 'Delft', 'Public Technical University', 'https://www.tudelft.nl/en/', ['MSc Computer Science', 'MSc Sustainable Energy Technology'], '24 months', 'English', 'Published non-EU statutory institutional fee ~€21,515/yr', 'Oct–Jan 15 (scholarship deadline Dec 1)', 'CGPA >= 75% from recognized Indian university + GRE + IELTS 6.5', 'Studielink + Osiaan', 'https://www.tudelft.nl/en/education/admission-and-application', '2026-11-10'],
    ['Politecnico di Milano', 'italy', 'Milan', 'Public Technical University', 'https://www.polimi.it/en/', ['MSc Computer Science & Engineering', 'MSc Architecture & Urban Design'], '24 months', 'English', 'Income-adjusted or standard non-EU fee ~€3,900/yr (eligible for DSU)', 'Early & Second Call (Sep–March)', 'Bachelor’s GPA, portfolio for Architecture/Design, IELTS 6.0', 'Polimi Online Services + Universitaly', 'https://www.polimi.it/en/prospective-students/', '2026-11-10'],
  ];
  for (const row of uniSeeds) {
    insertUni.run(uuid(), row[0], row[1], row[2], row[3], row[4], JSON.stringify(row[5]), row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13]);
  }

  // Official Jobs & Apprenticeships (clearly sourced official career portals—no fabricated claims)
  const insertJob = db.prepare(`
    INSERT INTO jobs (
      id, title, employer, country_slug, city, employment_type, required_experience,
      skills_json, language_req, salary_info, visa_sponsorship_info, official_url,
      source, published_at, expires_at, verification_status, safety_signals_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official_source', '[]')
  `);
  insertJob.run(
    uuid(),
    'Junior Embedded Software Engineer (Verify Open Roles)',
    'German Engineering & Mobility Employers (Make-it-in-Germany Job Board)',
    'germany',
    'Stuttgart / Munich',
    'Full-time',
    '1–3 years',
    JSON.stringify(['C/C++', 'AUTOSAR', 'Embedded Linux']),
    'English + German A2/B1 preferred',
    'Disclosed per employer listing',
    'Eligible employers support EU Blue Card for qualified degrees',
    'https://www.make-it-in-germany.com/en/working-in-germany/job-listings',
    'Make it in Germany Official Portal',
    '2026-11-10',
    '2027-03-31'
  );
  insertJob.run(
    uuid(),
    'Software & Cloud Engineering Roles (NHS Digital / UK Licensed Sponsors)',
    'UK Home Office Licensed Sponsor Employers',
    'united-kingdom',
    'London / Manchester',
    'Full-time',
    '2+ years',
    JSON.stringify(['TypeScript', 'Python', 'Cloud Architecture']),
    'English (Skilled Worker B1)',
    'Subject to UK Skilled Worker salary threshold',
    'Check active sponsor status on official GOV.UK Register',
    'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers',
    'GOV.UK Official Sponsor Register',
    '2026-11-12',
    '2027-06-30'
  );
  insertJob.run(
    uuid(),
    'Critical Skills Tech & Pharma Vacancies',
    'Irish Enterprise & IDA Partner Employers',
    'ireland',
    'Dublin / Cork',
    'Full-time',
    '2–5 years',
    JSON.stringify(['Java', 'Kubernetes', 'Data Engineering', 'Biopharma QA']),
    'English',
    'Meets DETE Critical Skills salary benchmark where eligible',
    'Critical Skills Employment Permit eligible occupations',
    'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/',
    'Ireland DETE Official Guidance',
    '2026-11-08',
    '2027-04-30'
  );

  const insertApprenticeship = db.prepare(`
    INSERT INTO apprenticeships (
      id, title, country_slug, training_provider, duration, language_req, eligibility,
      allowance_info, official_source_url, application_process, last_verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertApprenticeship.run(
    uuid(),
    'Fachinformatiker für Systemintegration (IT Systems Integration Ausbildung)',
    'germany',
    'German IHK-Accredited IT Employers & Berufsschule',
    '36 months (Dual Track)',
    'German B1–B2 (verified via Goethe/telc)',
    '12th Pass / Graduate equivalent + recognized school certificate + German B1/B2',
    'Standard training allowance varies by federal state and year (verify exact contract)',
    'https://www.make-it-in-germany.com/en/study-vocational-training/training-in-germany',
    'Apply directly to German companies via Bundesagentur für Arbeit or IHK Lehrstellenbörse; obtain training contract before visa.',
    '2026-11-12'
  );
  insertApprenticeship.run(
    uuid(),
    'Pflegefachmann / Pflegefachfrau (General Nursing Ausbildung)',
    'germany',
    'German University Hospitals & Care Institutions',
    '36 months (Dual Track)',
    'German B2 mandatory in most federal states',
    'Higher secondary completion + medical fitness + German B2 certificate',
    'Public tariff training allowance published by hospital employers (TVAöD)',
    'https://www.anerkennung-in-deutschland.de/html/en/index.php',
    'Direct hospital application or verified Triple Win / Bundesagentur official channels.',
    '2026-11-12'
  );

  // Scholarships
  const insertSch = db.prepare(`
    INSERT INTO scholarships (
      id, title, provider, country_slug, eligible_nationalities, study_level, subject_area,
      funding_type, funding_details, eligibility, deadline, official_url, last_checked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSch.run(
    uuid(),
    'DAAD Development-Related Postgraduate Courses (EPOS)',
    'German Academic Exchange Service (DAAD)',
    'germany',
    'Indian & eligible developing-country graduates',
    'Master’s / PhD',
    'Engineering, Public Health, Sustainability, Urban Planning',
    'full',
    'Full funding: Monthly stipend, health/accident insurance, and travel allowance as published by DAAD.',
    'Bachelor’s degree (normally within 6 years) + at least 2 years of relevant professional experience.',
    'Varies by course (Aug–Nov annually)',
    'https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/',
    '2026-11-14'
  );
  insertSch.run(
    uuid(),
    'Chevening Scholarships (India)',
    'UK Foreign, Commonwealth & Development Office',
    'united-kingdom',
    'Indian citizens',
    '1-Year Taught Master’s',
    'All eligible subjects',
    'full',
    'Full funding: University tuition fees, monthly living stipend, and return airfare.',
    'Undergraduate degree, minimum 2 years (2,800 hours) work experience, return to India for 2 years post-award.',
    'Typically November annually (check official portal)',
    'https://www.chevening.org/scholarship/india/',
    '2026-11-14'
  );
  insertSch.run(
    uuid(),
    'Charpak Master’s Scholarship',
    'French Embassy in India / Campus France',
    'france',
    'Indian nationals residing in India',
    'Master’s (1–2 years)',
    'All disciplines',
    'partial',
    'Partial/structured support: Monthly living allowance + student visa fee waiver (tuition waiver at public institutions per rules).',
    'Age limit and academic excellence criteria specified on Campus France India.',
    'Usually March–April',
    'https://www.inde.campusfrance.org/charpak-master-s-scholarship',
    '2026-11-14'
  );
  insertSch.run(
    uuid(),
    'SINGA (Singapore International Graduate Award)',
    'A*STAR, NUS, NTU, SUTD, SMU',
    'singapore',
    'All international graduates including India',
    'PhD',
    'Biomedical Sciences, Computing, Physical Sciences & Engineering',
    'full',
    'Full funding: Full tuition fees, monthly stipend, settling-in allowance, and airfare grant.',
    'Strong academic background and research interest; English proficiency.',
    'December 1 & June 1 cycles',
    'https://www.a-star.edu.sg/Scholarships/for-graduate-studies/singapore-international-graduate-award-singa',
    '2026-11-14'
  );
  insertSch.run(
    uuid(),
    'NL Scholarship (Study in NL)',
    'Dutch Ministry of Education & Participating Universities',
    'netherlands',
    'Non-EEA nationals including India',
    'Bachelor’s & Master’s',
    'All eligible programs at participating universities',
    'partial',
    'Partial funding: One-time €5,000 award towards first-year study costs (not a full tuition waiver).',
    'First-time degree applicant in the Netherlands meeting host university criteria.',
    'Feb 1 or May 1 (university dependent)',
    'https://www.studyinnl.org/finances/nl-scholarship',
    '2026-11-14'
  );

  // Resource Library
  const insertRes = db.prepare(`
    INSERT INTO resources (
      id, title, category, country_slug, summary, body, author_name, source_type,
      sources_json, version, last_reviewed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertRes.run(
    uuid(),
    'APS India Verification Guide for Germany Applicants',
    'Visa Documentation',
    'germany',
    'Step-by-step official document checklist for Academic Evaluation Centre (APS) New Delhi without relying on middlemen.',
    '1. Register exclusively on the official aps-india.de portal.\n2. Prepare Class 10, Class 12, university semester transcripts, and DigiLocker/university-verified credentials.\n3. Pay the official APS fee only via the listed bank/payment instructions on aps-india.de.\n4. Track processing calmly—do not purchase expedited promises from unverified third parties.',
    'AbroadConnect Editorial Review',
    'official_editorial',
    JSON.stringify(['https://aps-india.de/', 'https://india.diplo.de/']),
    '2026-11-15',
    ts
  );
  insertRes.run(
    uuid(),
    'Anti-Scam Checklist: Identifying Fake Overseas Job & Visa Offers',
    'Scam Prevention',
    'all',
    'How to spot advance-fee fraud, fake embassy letters, and unauthorized overseas recruitment agents in India.',
    'Warning signals to watch for:\n• Anyone promising a "100% guaranteed visa" or "guaranteed PR" before eligibility review.\n• Requests to pay an interview fee, embassy processing fee, or job-letter fee to a personal UPI ID or WhatsApp contact.\n• Requests to mail your original passport to an unverified agency.\n\nAlways verify licensed Indian overseas recruitment agencies on the Ministry of External Affairs eMigrate portal (emigrate.gov.in).',
    'AbroadConnect Trust & Safety Team',
    'official_editorial',
    JSON.stringify(['https://emigrate.gov.in/', 'https://www.make-it-in-germany.com/en/']),
    '2026-11-16',
    ts
  );
  insertRes.run(
    uuid(),
    'Europass CV & German Tabular Lebenslauf Structure',
    'CV and Resume Templates',
    'germany',
    'Community-contributed formatting notes comparing academic CVs for German Master’s vs Ausbildung applications.',
    '• Keep it reverse-chronological, 1–2 pages max.\n• Quantify engineering projects and internships clearly.\n• For German-taught roles or Ausbildung, use clean tabular Lebenslauf formatting without decorative graphics.',
    'Rohan Kulkarni (Demo Member)',
    'community_contributed',
    JSON.stringify(['https://europa.eu/europass/en']),
    '2026-11-10',
    ts
  );

  // Platform settings & feature flags
  const insertSetting = db.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
  insertSetting.run('payments_enabled', JSON.stringify(false), ts);
  insertSetting.run('paid_mentorship_enabled', JSON.stringify(false), ts);
  insertSetting.run('demo_notice_enabled', JSON.stringify(true), ts);
  insertSetting.run('grievance_officer', JSON.stringify({
    name: 'Grievance Redressal Desk — AbroadConnect India',
    email: 'grievance@abroadconnect.in',
    note: 'Acknowledges safety, privacy, and takedown grievances under applicable Indian IT & DPDP frameworks.',
  }), ts);
}
