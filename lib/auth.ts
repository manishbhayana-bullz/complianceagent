import { createClient } from './supabase/server';

/** Returns the logged-in user, or null if no valid session. */
export async function getAuthedUser() {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}
