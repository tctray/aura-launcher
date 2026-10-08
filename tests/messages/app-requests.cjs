// Runs the real social.js with the REAL supabase-js client, pointed at a stand-in for the network,
// to check that every request it makes is the one Supabase's API expects.
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "electron" && parent && /social\.js$/.test(parent.filename)) return { app: { isPackaged: false }, Notification: class { static isSupported() { return false; } } };
  return realLoad.call(this, request, parent, ...rest);
};
const { createClient } = require("@supabase/supabase-js");
const { register } = require(require("path").resolve(process.argv[2]));
const CALL = "12121212-1212-1212-1212-121212121212";
const ME = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", CONV = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const requests = [];
const fakeFetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const headers = Object.fromEntries(new Headers(opts.headers || {}).entries());
  requests.push({ method: opts.method || "GET", path: u.pathname, query: decodeURIComponent(u.search), body: !opts.body ? null : typeof opts.body === "string" ? JSON.parse(opts.body) : { bytes: Buffer.from(opts.body) }, contentType: headers["content-type"] || "", upsert: headers["x-upsert"], cache: headers["cache-control"] || "", apikey: headers.apikey || "", prefer: headers.prefer || "", accept: headers.accept || "", auth: headers.authorization || "" });
  const sentRow = opts.method === "POST" && u.pathname.endsWith("/messages") && typeof opts.body === "string" ? JSON.parse(opts.body) : {};
  const row = { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", conversation_id: CONV, sender_id: ME, content: "hi", created_at: "2026-10-06T01:00:00+00:00", read_at: null, media_path: null, ...sentRow };
  let body = [];
  if (u.pathname.startsWith("/storage/v1/object/sign/")) {
    const asked = JSON.parse(opts.body);
    return new Response(JSON.stringify(asked.paths.map((p) => (p.includes("9999") ? { path: p, error: "Either the object does not exist or you do not have access to it", signedURL: null } : { path: p, error: null, signedURL: "/object/sign/message-media/" + p + "?token=tok" }))), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.pathname === "/storage/v1/object/message-media" && opts.method === "DELETE") return new Response(JSON.stringify(JSON.parse(opts.body).prefixes.map((name) => ({ name }))), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.pathname.startsWith("/storage/v1/object/")) {
    if (u.pathname.includes("toobig")) return new Response(JSON.stringify({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" }), { status: 400, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ Key: u.pathname.replace("/storage/v1/object/", ""), Id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.pathname.endsWith("/rpc/request_friend")) body = "sent";
  else if (u.pathname.endsWith("/rpc/open_conversation")) body = CONV;
  else if (u.pathname.endsWith("/rpc/mark_conversation_read")) body = 2;
  else if (u.pathname.endsWith("/rpc/accept_friend")) body = true;
  else if (u.pathname.endsWith("/messages") && opts.method === "POST") body = row;
  else if (u.pathname.endsWith("/messages") && decodeURIComponent(u.search).includes("select=id,sender_id,media_path")) body = [{ id: row.id, sender_id: ME, media_path: CONV + "/33333333-3333-3333-3333-333333333333.png" }];
  else if (u.pathname.endsWith("/rpc/list_blocked")) body = [{ user_id: OTHER, username: "Alex", avatar_url: null, blocked_at: "2026-10-06T01:00:00+00:00" }];
  else if (/\/rpc\/(delete_message|block_user|unblock_user|report_user)$/.test(u.pathname)) body = true;
  else if (u.pathname.endsWith("/messages")) body = [row];
  else if (u.pathname.endsWith("/message_reactions")) body = [{ message_id: row.id, user_id: OTHER, reaction: "like" }, { message_id: row.id, user_id: ME, reaction: null }, { message_id: row.id, user_id: ME, reaction: "shrug" }];
  else if (u.pathname.endsWith("/rpc/react_to_message")) body = "like";
  else if (u.pathname.endsWith("/profiles")) body = /vnd\.pgrst\.object/.test(headers.accept || "") ? { id: OTHER, username: "Alex", avatar_url: null } : [{ id: OTHER, username: "Alex", avatar_url: null }];
  else if (u.pathname.endsWith("/friendships")) body = [{ id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }];
  else if (u.pathname.endsWith("/conversation_backgrounds")) body = [{ conversation_id: CONV, path: CONV + "/22222222-2222-2222-2222-222222222222.jpg", set_by: OTHER }];
  else if (u.pathname.endsWith("/rpc/list_conversations_v2")) body = [{ id: CONV, other_id: OTHER, username: "Alex", avatar_url: null, last_seen_at: null, is_friend: true, last_message: "hi", last_sender_id: OTHER, last_message_at: "2026-10-06T01:00:00+00:00", unread: 0, last_media_kind: null, last_media_mime: null }];
  else if (u.pathname.endsWith("/rpc/set_conversation_background")) body = true;
  else if (/\/rpc\/(start_call|answer_call|end_call)$/.test(u.pathname)) body = { id: CALL, caller_id: ME, callee_id: OTHER, status: u.pathname.endsWith("start_call") ? "ringing" : u.pathname.endsWith("answer_call") ? "active" : "ended", end_reason: u.pathname.endsWith("end_call") ? "hangup" : null, created_at: "2026-10-07T01:00:00+00:00", answered_at: null, ended_at: null };
  else if (u.pathname.endsWith("/rpc/current_call")) body = [{ id: CALL, caller_id: OTHER, callee_id: ME, status: "ringing", end_reason: null, created_at: "2026-10-07T01:00:00+00:00" }];
  else if (u.pathname.endsWith("/rpc/send_call_signal")) body = 41;
  else if (u.pathname.endsWith("/rpc/call_heartbeat")) body = "active";
  else if (u.pathname.endsWith("/voice_calls")) body = { id: CALL, caller_id: ME, callee_id: OTHER, status: "active", end_reason: null, created_at: "2026-10-07T01:00:00+00:00" };
  else if (u.pathname.endsWith("/voice_signals")) body = [{ id: 42, kind: "ice", payload: "[]" }];
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
// A stand-in WebSocket that records what the client says when it joins the live channel
const sent = [];
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; FakeSocket.url = url; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 5); }
  send(data) { sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose && this.onclose({}); }
  addEventListener() {} removeEventListener() {}
}
FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;

let failed = 0;
const check = (name, ok, extra) => { if (!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok ? "" : "  " + JSON.stringify(extra))); };
(async () => {
  const supabase = createClient("https://proj.supabase.co", "sb_publishable_test", { global: { fetch: fakeFetch }, realtime: { transport: FakeSocket }, auth: { persistSession: false, autoRefreshToken: false } });
  const handlers = {};
  const cloudHandler = (fn) => async (_e, ...args) => { try { return { success: true, data: (await fn(...args)) ?? null }; } catch (e) { return { success: false, error: e.message }; } };
  register({ ipcMain: { handle: (c, f) => (handlers[c] = f) }, cloudHandler, cloud: { internals: { client: () => supabase, currentUser: async () => ({ id: ME, user_metadata: { username: "tctray" } }) } }, getWindow: () => null });
  const call = (n, ...a) => handlers["social:" + n](null, ...a);
  const last = () => requests[requests.length - 1];
  const lastTo = (path) => requests.filter((q) => q.path === path).pop() || { query: "", body: null }; // the newest request to one address

  let r = await call("findUser", "Al_ex%");
  check("find user: exact, case-insensitive match with wildcards escaped", r.success && last().path === "/rest/v1/profiles" && last().query.includes("username=ilike.Al\\_ex\\%") && last().query.includes("limit=1") && last().query.includes("select=id,username,avatar_url"), last());
  r = await call("requestFriend", OTHER);
  check("friend request: calls request_friend with the target", r.data === "sent" && last().path === "/rest/v1/rpc/request_friend" && last().body.target === OTHER, last());
  r = await call("acceptFriend", OTHER);
  check("accept: calls accept_friend", r.data === true && last().path === "/rest/v1/rpc/accept_friend" && last().body.request_id === OTHER, last());
  r = await call("removeFriend", OTHER);
  check("remove: deletes that one friendship and asks for it back", r.data === true && last().method === "DELETE" && last().query.includes("id=eq." + OTHER) && /return=representation/.test(last().prefer), last());
  r = await call("openConversation", OTHER);
  check("open conversation: calls open_conversation", r.data === CONV && last().path === "/rest/v1/rpc/open_conversation" && last().body.other === OTHER, last());
  r = await call("getMessages", CONV);
  const history = () => lastTo("/rest/v1/messages");
  check("messages: this conversation only, newest first, one page", r.success && r.data.messages[0].conversationId === CONV && history().query.includes("conversation_id=eq." + CONV) && history().query.includes("order=created_at.desc,id.desc") && history().query.includes("limit=41"), history());
  const LIKES = !!handlers["social:react"]; // an AURA from before likes and GIF search has none of this
  if (LIKES) {
    check("likes: asked for in one request, for just the messages on this page", last().path === "/rest/v1/message_reactions" && last().method === "GET" && last().query.includes("select=message_id,user_id,reaction") && last().query.includes("message_id=in.(dddddddd-dddd-dddd-dddd-dddddddddddd)"), last());
    check("likes: each message carries who liked or disliked it (taken-back and unknown ones are left out)", JSON.stringify(r.data.messages[0].reactions) === JSON.stringify([{ userId: OTHER, reaction: "like" }]), r.data.messages[0].reactions);
    r = await call("react", "dddddddd-dddd-dddd-dddd-dddddddddddd", "like");
    check("like: calls react_to_message with the message and the feeling", r.success && last().path === "/rest/v1/rpc/react_to_message" && JSON.stringify(last().body) === JSON.stringify({ message: "dddddddd-dddd-dddd-dddd-dddddddddddd", feeling: "like" }) && r.data.reaction === "like" && r.data.userId === ME, [last().body, r]);
    r = await call("react", "dddddddd-dddd-dddd-dddd-dddddddddddd", null);
    check("taking a like back sends no feeling", r.success && JSON.stringify(last().body) === JSON.stringify({ message: "dddddddd-dddd-dddd-dddd-dddddddddddd", feeling: null }) && r.data.reaction === null, [last().body, r]);
    const before = requests.length;
    r = await call("react", "dddddddd-dddd-dddd-dddd-dddddddddddd", "love");
    check("an unknown reaction is refused before asking Supabase", r.success === false && requests.length === before, r);
  }
  r = await call("getMessages", CONV, "2026-10-06T01:00:00.000Z");
  check("older messages: adds 'before this time'", history().query.includes("created_at=lt.2026-10-06T01:00:00.000Z"), history());
  r = await call("sendMessage", CONV, "  hello\n\nthere  \n");
  check("send: inserts as the signed-in user, tidied, and gets the saved row back", r.success && last().method === "POST" && last().path === "/rest/v1/messages" && last().body.sender_id === ME && last().body.conversation_id === CONV && last().body.content === "hello\n\nthere" && /return=representation/.test(last().prefer), last());
  r = await call("markRead", CONV);
  check("mark read: calls mark_conversation_read", r.data === 2 && last().path === "/rest/v1/rpc/mark_conversation_read" && last().body.conversation === CONV, last());
  const nl = requests.length;
  r = await call("listConversations"); const lc = requests[nl].path, lb = requests[nl + 1]; await call("listFriends");
  check("lists: call list_conversations_v2 and list_friends", lc === "/rest/v1/rpc/list_conversations_v2" && last().path === "/rest/v1/rpc/list_friends");
  check("lists: one more request reads the chats' shared backgrounds", requests.length === nl + 3 && lb.method === "GET" && lb.path === "/rest/v1/conversation_backgrounds" && lb.query.includes("select=conversation_id,path,set_by"), lb);
  check("lists: a chat with a shared background carries it", r.success && r.data[0] && r.data[0].background && r.data[0].background.path === CONV + "/22222222-2222-2222-2222-222222222222.jpg" && r.data[0].background.by === OTHER, r.data && r.data[0]);

  // Deleting, blocking, reporting
  const MSG = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  let nd = requests.length;
  r = await call("deleteMessage", MSG);
  check("delete: looks the message up, removes its file from storage, then one call deletes it", r.success && requests.length === nd + 3 && requests[nd].method === "GET" && requests[nd].query.includes("id=eq." + MSG)
    && requests[nd + 1].method === "DELETE" && requests[nd + 1].path === "/storage/v1/object/message-media" && JSON.stringify(requests[nd + 1].body.prefixes) === JSON.stringify([CONV + "/33333333-3333-3333-3333-333333333333.png"])
    && requests[nd + 2].path === "/rest/v1/rpc/delete_message" && requests[nd + 2].body.message === MSG, requests.slice(nd).map((q) => [q.method, q.path, q.body]));
  r = await call("blockUser", OTHER);
  check("block: calls block_user with the person", r.success && last().path === "/rest/v1/rpc/block_user" && last().body.target === OTHER, last());
  r = await call("unblockUser", OTHER);
  check("unblock: calls unblock_user", r.success && last().path === "/rest/v1/rpc/unblock_user" && last().body.target === OTHER, last());
  r = await call("listBlocked");
  check("blocked list: calls list_blocked and shapes it", r.success && last().path === "/rest/v1/rpc/list_blocked" && r.data.length === 1 && r.data[0].userId === OTHER && r.data[0].username === "Alex", r);
  nd = requests.length;
  r = await call("reportUser", OTHER, { reason: "harassment", details: "  rude  ", messageId: MSG, block: true });
  check("report: report_user with reason, details and the message, then block_user", r.success && requests.length === nd + 2 && requests[nd].path === "/rest/v1/rpc/report_user" && JSON.stringify(requests[nd].body) === JSON.stringify({ target: OTHER, why: "harassment", more: "rude", message: MSG }) && requests[nd + 1].path === "/rest/v1/rpc/block_user", requests.slice(nd).map((q) => [q.path, q.body]));
  nd = requests.length;
  r = await call("reportUser", OTHER, { reason: "nonsense" });
  check("report: a made-up reason never leaves the PC", r.success === false && requests.length === nd, r);

  // A chat's shared background
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(80, 5)]);
  const nb = requests.length;
  r = await call("setBackground", CONV, { name: "wall.jpg", bytes: new Uint8Array(jpg) });
  const bgUp = requests[nb + 1], bgSet = requests[nb + 2];
  check("background: checks the table, uploads the picture, then one call sets it", requests.length === nb + 3 && requests[nb].path === "/rest/v1/conversation_backgrounds" && bgUp.method === "POST" && new RegExp("^/storage/v1/object/message-media/" + CONV + "/[0-9a-f-]{36}\\.jpg$").test(bgUp.path) && bgUp.body.bytes.equals(jpg) && bgUp.contentType === "image/jpeg" && bgUp.upsert === "false", requests.slice(nb).map((q) => [q.method, q.path]));
  check("background: set_conversation_background gets the chat and that picture's path", bgSet.path === "/rest/v1/rpc/set_conversation_background" && bgSet.body.conversation === CONV && bgSet.body.picture === bgUp.path.replace("/storage/v1/object/message-media/", "") && r.success && r.data.path === bgSet.body.picture && r.data.by === ME, bgSet);
  r = await call("setBackground", CONV, null);
  check("background: removing is one call with no picture", last().path === "/rest/v1/rpc/set_conversation_background" && last().body.conversation === CONV && last().body.picture === null && r.success && r.data === null && requests.length === nb + 4, last());

  // Pictures and videos
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
  const n = requests.length;
  r = await call("sendMedia", CONV, { name: "shot.png", bytes: new Uint8Array(png), width: 640, height: 360 }, " nice ");
  const up = requests[n], ins = requests[n + 1];
  check("upload: one POST to the private bucket, inside the conversation's folder", requests.length === n + 2 && up.method === "POST" && new RegExp("^/storage/v1/object/message-media/" + CONV + "/[0-9a-f-]{36}\\.png$").test(up.path), up && [up.method, up.path]);
  check("upload: the file's bytes exactly, as a PNG, never overwriting, signed in", up.body.bytes.equals(png) && up.contentType === "image/png" && up.upsert === "false" && /^Bearer /.test(up.auth) && !!up.apikey, { ct: up.contentType, upsert: up.upsert, cache: up.cache });
  check("then the message row points at that file", ins.path === "/rest/v1/messages" && ins.body.media_path === up.path.replace("/storage/v1/object/message-media/", "") && ins.body.media_kind === "image" && ins.body.media_mime === "image/png" && ins.body.media_size === png.length && ins.body.media_width === 640 && ins.body.media_name === "shot.png" && ins.body.content === "nice" && ins.body.sender_id === ME, ins.body);
  check("and comes back shaped for the window", r.success && r.data.media && r.data.media.path === ins.body.media_path && r.data.media.kind === "image" && r.data.content === "nice", r);
  const good = CONV + "/11111111-1111-1111-1111-111111111111.png", gone = CONV + "/99999999-9999-9999-9999-999999999999.mp4";
  r = await call("mediaUrls", [good, gone, "../etc/passwd"]);
  check("viewing links: one request for the valid paths only", last().method === "POST" && last().path === "/storage/v1/object/sign/message-media" && JSON.stringify(last().body.paths) === JSON.stringify([good, gone]) && last().body.expiresIn === 43200, last());
  check("viewing links: full addresses for the ones Supabase allows, nothing for the rest", r.success && Object.keys(r.data.urls).length === 1 && /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/sign\/message-media\/.+token=tok/.test(r.data.urls[good]), r);
  getMessagesCols: {
    await call("getMessages", CONV);
    check("history asks for the file columns too", history().query.includes("media_path") && history().query.includes("media_kind") && history().query.includes("media_name"), history().query);
  }


  const VOICE = !!handlers["social:startCall"]; // an AURA from before voice calls has none of this
  if (VOICE) {
    r = await call("startCall", OTHER);
    check("call: start_call with the friend, shaped for the window", r.success && last().path === "/rest/v1/rpc/start_call" && JSON.stringify(last().body) === JSON.stringify({ target: OTHER }) && r.data.id === CALL && r.data.outgoing === true && r.data.peerId === OTHER && r.data.status === "ringing", [last().body, r]);
    r = await call("answerCall", CALL);
    check("call: answer_call with the call", r.success && last().path === "/rest/v1/rpc/answer_call" && JSON.stringify(last().body) === JSON.stringify({ the_call: CALL }) && r.data.status === "active", [last().body, r]);
    r = await call("callSignal", CALL, "ice", "[1]");
    check("call: send_call_signal with the kind and the details as text", r.success && r.data === 41 && last().path === "/rest/v1/rpc/send_call_signal" && JSON.stringify(last().body) === JSON.stringify({ the_call: CALL, what: "ice", body: "[1]" }), [last().body, r]);
    let nc = requests.length;
    r = await call("callState", CALL, 41);
    check("call: checking on it reads the call, then only newer details, oldest first", r.success && requests.length === nc + 2 && requests[nc].path === "/rest/v1/voice_calls" && requests[nc].query.includes("id=eq." + CALL) && requests[nc + 1].path === "/rest/v1/voice_signals" && requests[nc + 1].query.includes("call_id=eq." + CALL) && requests[nc + 1].query.includes("id=gt.41") && requests[nc + 1].query.includes("order=id.asc") && requests[nc + 1].query.includes("select=id,kind,payload") && r.data.call.status === "active" && r.data.signals[0].id === 42, requests.slice(nc).map((q) => [q.path, q.query]));
    r = await call("callBeat", CALL);
    check("call: heartbeat", r.data === "active" && last().path === "/rest/v1/rpc/call_heartbeat" && last().body.the_call === CALL, last());
    r = await call("endCall", CALL, "missed");
    check("call: end_call with the reason", r.success && last().path === "/rest/v1/rpc/end_call" && JSON.stringify(last().body) === JSON.stringify({ the_call: CALL, why: "missed" }) && r.data.status === "ended" && r.data.reason === "hangup", [last().body, r]);
    r = await call("endCall", CALL);
    check("call: hanging up sends no reason", JSON.stringify(last().body) === JSON.stringify({ the_call: CALL, why: null }), last().body);
    r = await call("currentCall");
    check("call: current_call, shaped as a call ringing for you", r.success && last().path === "/rest/v1/rpc/current_call" && last().method === "POST" && r.data.id === CALL && r.data.outgoing === false && r.data.peerId === OTHER, [last().method, r]);
    nc = requests.length;
    r = await call("callConfig");
    check("call: without the AURA server, the direct-connection servers and no outside request", r.success && r.data.relay === false && /^stun:/.test(r.data.iceServers[0].urls[0]) && requests.length === nc, r);
  }

  r = await call("start"); await new Promise((res) => setTimeout(res, 300));
  const joins = sent.filter((m) => (Array.isArray(m) ? m[3] : m.event) === "phx_join").map((m) => ({ topic: Array.isArray(m) ? m[2] : m.topic, changes: (Array.isArray(m) ? m[4] : m.payload)?.config?.postgres_changes || [] }));
  const mainJoin = joins.find((j) => j.topic === "realtime:aura-social:" + ME), bgJoin = joins.find((j) => j.topic === "realtime:aura-social-bg:" + ME);
  const changes = mainJoin ? mainJoin.changes : [];
  check("live: opens Supabase's realtime socket", /^wss:\/\/proj\.supabase\.co\/realtime\/v1\/websocket/.test(String(FakeSocket.url)), FakeSocket.url);
  const callJoin = joins.find((j) => j.topic === "realtime:aura-social-calls:" + ME);
  const likeJoin = joins.find((j) => j.topic === "realtime:aura-social-reactions:" + ME);
  const CHANNELS = 2 + (VOICE ? 1 : 0) + (LIKES ? 1 : 0);
  check("live: joins " + CHANNELS + " channels for this user (messages and friends; chat backgrounds" + (VOICE ? "; calls" : "") + (LIKES ? "; likes" : "") + ")", r.success && joins.length === CHANNELS && !!mainJoin && !!bgJoin && !!callJoin === VOICE && !!likeJoin === LIKES, joins.map((j) => j.topic));
  if (LIKES) check("live: the likes channel watches likes being added and changed, and nothing else", likeJoin && likeJoin.changes.length === 2 && likeJoin.changes.some((c) => c.event === "INSERT" && c.table === "message_reactions") && likeJoin.changes.some((c) => c.event === "UPDATE" && c.table === "message_reactions") && likeJoin.changes.every((c) => c.schema === "public"), likeJoin && likeJoin.changes);
  if (VOICE) check("live: the third channel watches calls starting and changing, and connection details arriving", callJoin && callJoin.changes.length === 3 && callJoin.changes.some((c) => c.event === "INSERT" && c.table === "voice_calls") && callJoin.changes.some((c) => c.event === "UPDATE" && c.table === "voice_calls") && callJoin.changes.some((c) => c.event === "INSERT" && c.table === "voice_signals") && callJoin.changes.every((c) => c.schema === "public"), callJoin && callJoin.changes);
  check("live: asks for new messages, changed messages (deletions) and all friendship changes", changes.length === 3 && changes.some((c) => c.event === "INSERT" && c.table === "messages" && c.schema === "public") && changes.some((c) => c.event === "UPDATE" && c.table === "messages") && changes.some((c) => c.event === "*" && c.table === "friendships"), changes);
  check("live: the second channel only watches chat backgrounds", bgJoin && bgJoin.changes.length === 1 && bgJoin.changes[0].table === "conversation_backgrounds" && bgJoin.changes[0].schema === "public", bgJoin && bgJoin.changes);
  const beats = requests.filter((q) => q.path === "/rest/v1/rpc/aura_heartbeat").length;
  check("live: sends an 'online' heartbeat", beats === 1, beats);
  await call("start"); await new Promise((res) => setTimeout(res, 100));
  check("starting again doesn't join twice", sent.filter((m) => (Array.isArray(m) ? m[3] : m.event) === "phx_join").length === CHANNELS);
  await call("stop");
  console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("CRASHED", e); process.exit(2); });
