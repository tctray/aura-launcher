// Deleting your account from AURA (electron/account.js): the password is checked first, files
// are removed before the account, and a problem stops it before anything is lost.
// Uses a pretend Supabase. (The database side is checked in messages/sql-account-delete.mjs.)
// Added by aura-account-delete-setup.cjs.
const path = require("path");
const { deleteAccount } = require(path.resolve(process.argv[2] || path.join(__dirname, "..", "electron", "account.js")));
let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
const err = async (p) => { try { await p; return ""; } catch (e) { return e.message; } };

function world(opts = {}) {
  const w = { steps: [], loggedOut: false };
  const files = opts.files || [{ bucket: "avatars", path: "me/pic.png" }, ...Array.from({ length: 150 }, (_, i) => ({ bucket: "message-media", path: "c/" + i + ".png" }))];
  const client = {
    auth: { async signInWithPassword({ email, password }) { w.steps.push("password:" + email); return password === "right" ? { data: {}, error: null } : { data: null, error: { message: "Invalid login credentials" } }; } },
    async rpc(name) {
      w.steps.push("rpc:" + name);
      if (opts.notSetUp) return { data: null, error: { code: "PGRST202", message: "Could not find the function public." + name + " without parameters in the schema cache" } };
      if (name === "account_files") return { data: files, error: null };
      return opts.deleteFails ? { data: null, error: { message: "The account couldn't be deleted because of something saved to it that AURA doesn't know about (x). Nothing was deleted." } } : { data: true, error: null };
    },
    storage: { from: (bucket) => ({ async remove(paths) { w.steps.push("remove:" + bucket + ":" + paths.length); return opts.storageFails ? { data: null, error: { message: "Bad gateway" } } : { data: paths, error: null }; } }) },
  };
  w.cloud = {
    internals: { client: () => client, currentUser: async () => { if (opts.loggedOut) throw new Error("You're not logged in."); return { id: "me", email: "t@example.com" }; } },
    logOut: async () => { w.loggedOut = true; w.steps.push("logOut"); return true; },
  };
  return w;
}

(async () => {
  console.log("1. Checks first");
  let w = world();
  check("no password: asked for it, nothing happens", (await err(deleteAccount(w.cloud, ""))) === "Enter your password." && w.steps.length === 0);
  check("the wrong password: says so, nothing is deleted", (await err(deleteAccount(w.cloud, "wrong"))) === "That password isn't right." && w.steps.join() === "password:t@example.com");
  w = world({ loggedOut: true });
  check("not logged in: says so", (await err(deleteAccount(w.cloud, "right"))) === "You're not logged in.");

  console.log("2. Deleting");
  w = world();
  check("the right password deletes the account", (await err(deleteAccount(w.cloud, "right"))) === "");
  check("...in order: password, files (100 at a time), then the account, then logged out on this PC",
    w.steps.join() === "password:t@example.com,rpc:account_files,remove:avatars:1,remove:message-media:100,remove:message-media:50,rpc:delete_my_account,logOut", w.steps);

  console.log("3. When something goes wrong");
  w = world({ storageFails: true });
  const s = await err(deleteAccount(w.cloud, "right"));
  check("files can't be removed: the account is kept, and it says to try again", /Your account wasn't deleted\. Try again\./.test(s) && !w.steps.includes("rpc:delete_my_account") && !w.loggedOut, [s, w.steps]);
  w = world({ notSetUp: true });
  check("the Supabase update isn't run yet: says which file to run, nothing deleted", /aura-account-delete\.sql/.test(await err(deleteAccount(w.cloud, "right"))) && !w.steps.some((x) => x.startsWith("remove")) && !w.loggedOut);
  w = world({ deleteFails: true });
  check("Supabase refuses: its reason is shown, and you stay logged in", /Nothing was deleted/.test(await err(deleteAccount(w.cloud, "right"))) && !w.loggedOut);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
