/* Online-Speicher (Supabase). Leer lassen = App läuft nur lokal auf einem Gerät.
   Beide Werte stehen in Supabase unter: Project Settings → API (bzw. "API Keys").
   Der "anon"/"publishable" Schlüssel ist für die Veröffentlichung gedacht – geschützt wird über die Regeln in supabase/setup.sql. */
window.HUFPFLEGE_CONFIG = {
  supabaseUrl: '',   // z. B. 'https://abcdefgh.supabase.co'
  supabaseKey: ''    // anon / publishable key
};
