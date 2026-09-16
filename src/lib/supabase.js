import { createClient } from "@supabase/supabase-js";

// بيانات النشر العامة فقط. يمكن استبدالها بمتغيرات Vite عند الحاجة.
// لا يُستخدم هنا مفتاح service_role أو كلمة مرور قاعدة البيانات.
const url = import.meta.env.VITE_SUPABASE_URL || "https://ymignitrqjfyqqdxnyxo.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_sv-5iRG9oS5x2V4vXQllpg_E0hZhE53";

export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : null;
