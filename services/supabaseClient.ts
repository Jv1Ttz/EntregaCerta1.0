import { createClient } from '@supabase/supabase-js';

// No Vite, usamos import.meta.env
const supabaseUrl = 'https://oomxnhgyxaimkvdllmao.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);