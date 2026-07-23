// =============================================================
// Floating "AI Mentor" chat bubble — drop into any page with:
//
//   <script src="ai-mentor.js"></script>
//   <script>
//     window.AI_MENTOR_LABEL = 'your fitness coach';      // shown under the name
//     window.AI_MENTOR_CONTEXT = function () {            // page-specific data
//       return { ... };                                    // plain JSON-able object
//     };
//   </script>
//   <script src="ai-mentor-widget.js"></script>
//
// Uses window.AIMentor (ai-mentor.js) for the actual model call, so the
// provider (free local WebLLM vs. an Anthropic key added later) is the
// same everywhere without touching this file. Conversations here are
// per-visit only — the dedicated "AI Mentor" tab is where history/memory
// actually lives.
// =============================================================
(function () {
  'use strict';
  if (document.getElementById('amFab')) return; // don't double-inject

  const LABEL = window.AI_MENTOR_LABEL || 'your AI mentor';
  // If the host page didn't define a tailored context function, fall back to
  // reading everything the dashboard has saved (same approach the dedicated
  // AI Mentor tab uses) so the widget is still useful out of the box.
  function defaultContext() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/ai_mentor/i.test(k)) continue;
      try { out[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { out[k] = localStorage.getItem(k); }
    }
    return out;
  }
  const contextFn = typeof window.AI_MENTOR_CONTEXT === 'function' ? window.AI_MENTOR_CONTEXT : defaultContext;

  const css = `
#amFab {
  position: fixed; bottom: calc(88px + env(safe-area-inset-bottom)); right: 16px; z-index: 45;
  width: 50px; height: 50px; border-radius: 50%; border: 0; cursor: pointer; padding: 0;
  overflow: hidden; -webkit-tap-highlight-color: transparent; transition: transform 0.12s;
  background: radial-gradient(circle at 50% 58%, #8A6CFF, #4C2EC9 80%);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 6px 22px rgba(124,92,255,0.5),
              inset 0 -6px 14px rgba(38,10,86,0.65);
}
#amFab:active { transform: scale(0.93); }
#amFab::before {
  content: ''; position: absolute; inset: -28%; border-radius: 50%;
  background: conic-gradient(from 0deg, #6D4AE0, #C9B8FF, #7C5CFF, #B98AFF, #8A6CFF, #6D4AE0);
  filter: blur(2px); opacity: 0.92; animation: amspin 7s linear infinite;
}
#amFab::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 34% 26%, rgba(255,255,255,0.92), rgba(255,255,255,0) 40%),
              radial-gradient(circle at 72% 82%, rgba(18,7,40,0.5), transparent 55%);
}
@keyframes amspin { to { transform: rotate(360deg); } }
#amFab .am-online { position: absolute; right: 2px; bottom: 2px; z-index: 2; width: 11px; height: 11px; border-radius: 50%; background: #6ee7b7; border: 2px solid #0a0a0b; box-shadow: 0 0 6px rgba(110,231,183,0.7); }
#amPanel {
  position: fixed; bottom: calc(148px + env(safe-area-inset-bottom)); right: 16px; z-index: 45;
  width: min(340px, calc(100vw - 28px)); max-height: 60vh; display: none; flex-direction: column;
  background: #111016; border: 1px solid rgba(255,255,255,0.10); border-radius: 18px;
  box-shadow: 0 24px 70px rgba(0,0,0,0.65); overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
#amPanel.open { display: flex; }
.am-head { display: flex; align-items: center; gap: 9px; padding: 13px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.am-head .am-av { position: relative; overflow: hidden; width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  background: radial-gradient(circle at 34% 26%, rgba(255,255,255,0.85), rgba(255,255,255,0) 42%),
             conic-gradient(from 0deg, #6D4AE0, #C9B8FF, #7C5CFF, #B98AFF, #6D4AE0); }
.am-head .am-name { font-size: 14px; font-weight: 700; color: #FAFAFA; }
.am-head .am-sub { font-size: 10.5px; color: #76746E; }
.am-head .am-x { margin-left: auto; border: 0; background: transparent; color: #76746E; font-size: 20px; cursor: pointer; line-height: 1; }
.am-head .am-settings { border: 0; background: transparent; color: #76746E; font-size: 14px; cursor: pointer; line-height: 1; padding: 2px 4px; }
.am-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.am-msg { font-size: 13px; line-height: 1.5; max-width: 90%; padding: 9px 12px; border-radius: 13px; }
.am-msg.coach { background: rgba(255,255,255,0.05); color: #E9E7E2; align-self: flex-start; border-bottom-left-radius: 4px; }
.am-msg.user { background: rgba(124,92,255,0.22); color: #FAFAFA; align-self: flex-end; border-bottom-right-radius: 4px; }
.am-msg.sys { background: rgba(255,255,255,0.03); color: #9c9a94; align-self: center; font-size: 11.5px; text-align: center; }
.am-msg b { color: #FAFAFA; } .am-msg ul { margin: 4px 0; padding-left: 18px; } .am-msg li { margin: 2px 0; } .am-msg code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.am-foot { display: flex; gap: 7px; padding: 11px 12px; border-top: 1px solid rgba(255,255,255,0.07); }
.am-input { flex: 1; min-width: 0; padding: 9px 12px; border-radius: 11px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.32); color: #FAFAFA; font-family: inherit; font-size: 13px; outline: none; }
.am-input::placeholder { color: #6c6a64; }
.am-send { border: 0; border-radius: 11px; padding: 0 14px; background: linear-gradient(180deg,#C9B8FF,#7C5CFF); color: #14081f; font-weight: 700; font-size: 15px; cursor: pointer; }
.am-dots i { display:inline-block; width:5px; height:5px; margin:0 1px; border-radius:50%; background:#9b8aff; animation: amb 1s infinite; }
.am-dots i:nth-child(2){animation-delay:.15s} .am-dots i:nth-child(3){animation-delay:.3s}
@keyframes amb { 0%,100%{opacity:.3;transform:translateY(0)} 50%{opacity:1;transform:translateY(-3px)} }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const fab = document.createElement('button');
  fab.id = 'amFab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Open AI mentor');
  fab.innerHTML = '<span class="am-online"></span>';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'amPanel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'AI mentor chat');
  panel.innerHTML =
    '<div class="am-head">' +
      '<div class="am-av"></div>' +
      '<div><div class="am-name">AI Mentor</div><div class="am-sub">' + LABEL.replace(/[<>&]/g, '') + '</div></div>' +
      '<button class="am-settings" id="amSettings" type="button" title="Provider settings">⚙</button>' +
      '<button class="am-x" id="amClose" type="button" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="am-body" id="amBody"></div>' +
    '<div class="am-foot">' +
      '<input class="am-input" id="amInput" type="text" placeholder="Ask your AI mentor…" autocomplete="off">' +
      '<button class="am-send" id="amSend" type="button">↑</button>' +
    '</div>';
  document.body.appendChild(panel);

  const body = panel.querySelector('#amBody');
  const input = panel.querySelector('#amInput');
  let busy = false, greeted = false, history = [];

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function md(t) {
    let h = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
    const lines = h.split('\n'); let out = '', inUl = false;
    for (const ln of lines) {
      if (/^\s*[-*]\s+/.test(ln)) { if (!inUl) { out += '<ul>'; inUl = true; } out += '<li>' + ln.replace(/^\s*[-*]\s+/, '') + '</li>'; }
      else { if (inUl) { out += '</ul>'; inUl = false; } out += ln.trim() ? '<div>' + ln + '</div>' : ''; }
    }
    if (inUl) out += '</ul>';
    return out;
  }
  function addMsg(who, html) {
    const d = document.createElement('div'); d.className = 'am-msg ' + who; d.innerHTML = html;
    body.appendChild(d); body.scrollTop = body.scrollHeight; return d;
  }

  function sanitize(v, depth) {
    if (depth > 6) return null;
    if (typeof v === 'string') return v.length > 180 ? '[omitted]' : v;
    if (Array.isArray(v)) return v.slice(-60).map(function (x) { return sanitize(x, depth + 1); });
    if (v && typeof v === 'object') { const o = {}; for (const k in v) { if (/img|photo|image|data|base64|url|thumb|key/i.test(k)) continue; o[k] = sanitize(v[k], depth + 1); } return o; }
    return v;
  }

  const SYS_BASE = 'You are the user\'s AI Mentor, embedded directly inside a page of their personal life-tracking dashboard (' + LABEL + '). ' +
    'You can see the data below from THIS page. Answer the specific question asked, concisely and specifically — a couple short markdown bullets, ' +
    'wrap key numbers/words in **double asterisks**. Be honest and encouraging, not generic. Keep replies under ~150 words. Page data as JSON: ';

  async function ask(text) {
    text = (text || '').trim(); if (!text || busy) return;
    addMsg('user', md(text));
    history.push({ role: 'user', content: text });
    busy = true;
    const loading = addMsg('coach', '<span class="am-dots"><i></i><i></i><i></i></span>');
    let system = SYS_BASE;
    try { system += JSON.stringify(sanitize(contextFn(), 0)); } catch (e) {}

    let progressShown = false;
    try {
      const reply = await window.AIMentor.chat({
        system: system,
        messages: history.slice(-8),
        onProgress: function (p) {
          if (!progressShown) { progressShown = true; }
          loading.innerHTML = '<span style="opacity:.7">Loading free local model' + (p && p.text ? ' — ' + esc(p.text) : '…') + '</span>';
        },
        onToken: function (delta, full) { loading.innerHTML = md(full || '…'); body.scrollTop = body.scrollHeight; },
      });
      loading.innerHTML = md(reply || 'Hmm, no reply.');
      history.push({ role: 'assistant', content: reply || '' });
    } catch (e) {
      loading.innerHTML = md('- ' + (e && e.message ? e.message : 'Something went wrong. Try again.'));
    }
    body.scrollTop = body.scrollHeight; busy = false;
  }

  function openPanel() {
    panel.classList.add('open');
    if (!greeted) {
      greeted = true;
      const provider = window.AIMentor.getProvider();
      const note = provider === 'webllm'
        ? 'I’m running as a free local model in your browser — the first reply loads the model, then it’s fast. Ask me anything about this page.'
        : 'Ask me anything about this page.';
      addMsg('coach', md(note));
    }
    setTimeout(function () { input.focus(); }, 50);
  }
  function closePanel() { panel.classList.remove('open'); }

  fab.addEventListener('click', function () { panel.classList.contains('open') ? closePanel() : openPanel(); });
  panel.querySelector('#amClose').addEventListener('click', closePanel);
  panel.querySelector('#amSettings').addEventListener('click', function () { window.location.href = 'ai-mentor.html'; });
  panel.querySelector('#amSend').addEventListener('click', function () { const t = input.value; input.value = ''; ask(t); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { const t = input.value; input.value = ''; ask(t); } });
})();
