/*
 * Rendezvous '26 — site configuration
 *
 * Supabase is REQUIRED: paste your project URL and anon key
 * (Dashboard → Settings → API) below. Until you do, pages show a
 * "Supabase not configured" state and admin shows a setup banner.
 *
 * ADMIN_PASSWORD guards the /admin panel. Change it before going live
 * (see README for the security caveats).
 */
window.RV26 = window.RV26 || {};

Object.assign(window.RV26, {
  CONFIG: {
    SUPABASE_URL: 'https://ewedxrgefabskidccuhp.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_oeLc_yclJQcOO3NrrsAb1Q_Rz1oqyAx',
    ADMIN_PASSWORD: 'rendezvous26',
    STORE_PIN: 'store2026',
    STORAGE_BUCKETS: {
      gallery: 'gallery',
      results: 'results',
    },
  },
});

(function () {
  const cfg = window.RV26.CONFIG;
  const placeholders = [
    '',
    'your-project.supabase.co',
    'https://your-project.supabase.co',
    'your-anon-key',
  ];
  const ok = Boolean(
    cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      !placeholders.includes(cfg.SUPABASE_URL) &&
      !placeholders.includes(cfg.SUPABASE_ANON_KEY)
  );
  cfg.isSupabaseConfigured = ok;
  window.RV26.isSupabaseConfigured = ok;
})();