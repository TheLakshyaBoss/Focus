// lib/supabase.js
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// Replace these with your actual project values (Supabase Dashboard > Settings > API)
const SUPABASE_URL = 'https://sbecqicloleqctdurosi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Ves_0BcI2yx1XxY9z9DEjQ_s3lX-H5e';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false, // no auth/users needed for this simple use case
  },
});