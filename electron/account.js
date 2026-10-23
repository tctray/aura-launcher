// AURA — deleting your account. Runs in the main process; the window asks for it through
// preload.js (window.auraCloud.deleteAccount) after you type your password.
//
//   1. Your password is checked, so nobody else at your PC can delete your account.
//   2. Your files in storage (profile pictures, pictures and videos you sent) are removed.
//   3. Supabase deletes the account and everything saved to it (supabase/aura-account-delete.sql).
//   4. You're logged out on this PC. Games, clips and settings on this PC stay.
//
// Added by aura-account-delete-setup.cjs. Wired up from the main file with one line:
//   ipcMain.handle("auth:deleteAccount", cloudHandler((password) => require("./account").deleteAccount(auraCloud, password)));
"use strict";

const SETUP = "Deleting accounts isn't set up yet: run supabase/aura-account-delete.sql in Supabase (SQL Editor), then try again. Nothing was deleted.";
const notSetUp = (e) => e?.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(e?.message || "");
const offline = (e) => /fetch failed|network|timed out|enotfound|econn/i.test(e?.message || "");

async function deleteAccount(cloud, password) {
  if (typeof password !== "string" || !password) throw new Error("Enter your password.");
  const sb = cloud.internals.client();
  const user = await cloud.internals.currentUser(); // "You're not logged in." if no one is
  if (!user.email) throw new Error("This account has no email address, so its password can't be checked.");

  // 1. The password
  const { error: wrong } = await sb.auth.signInWithPassword({ email: user.email, password });
  if (wrong) throw new Error(/invalid login credentials/i.test(wrong.message || "") ? "That password isn't right." : wrong.message);

  // 2. The files (if this stops part-way, trying again carries on: only what's left is listed)
  const { data: files, error: listError } = await sb.rpc("account_files");
  if (listError) throw new Error(notSetUp(listError) ? SETUP : offline(listError) ? "Can't reach AURA's servers. Check your internet connection. Nothing was deleted." : listError.message);
  const byBucket = new Map();
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f.bucket !== "string" || typeof f.path !== "string") continue;
    if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
    byBucket.get(f.bucket).push(f.path);
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error("Couldn't remove your pictures and videos (" + (error.message || "storage error") + "). Your account wasn't deleted. Try again.");
    }
  }

  // 3. The account
  const { error } = await sb.rpc("delete_my_account");
  if (error) throw new Error(notSetUp(error) ? SETUP : error.message);

  // 4. Logged out on this PC
  try { await cloud.logOut(); } catch {}
  return true;
}

module.exports = { deleteAccount };
