// supabase-config.js

// Replace these with your actual Supabase URL and Key
const SUPABASE_URL = 'https://zlxbgwcunehdeusunmeg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YhNWUOSVK8RV3jZjgKjpYw_vIX6cSSr';

// Initialize the connection
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);