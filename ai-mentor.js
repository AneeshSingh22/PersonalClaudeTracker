// =============================================================
// Shared AI Mentor engine — one swappable brain for the whole dashboard.
//
// Default provider: WebLLM (@mlc-ai/web-llm), a small open-source model
// that runs entirely in the browser via WebGPU. No signup, no API key,
// completely free. First reply on a device downloads the model once
// (cached by the browser after that); replies stream token-by-token.
//
// Swap to Anthropic later by calling AIMentor.setProvider('anthropic')
// and AIMentor.setAnthropicKey('sk-ant-...') — same chat() call site,
// same context-building code on every page, nothing else changes.
// =============================================================
window.AIMentor = (function () {
  'use strict';

  const PROVIDER_LS = 'ai_mentor_provider'; // 'webllm' | 'anthropic'
  const ANTHROPIC_KEY_LS = 'ai_mentor_anthropic_key';
  const WEBLLM_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

  function getProvider() {
    try { return localStorage.getItem(PROVIDER_LS) || 'webllm'; } catch (e) { return 'webllm'; }
  }
  function setProvider(p) { try { localStorage.setItem(PROVIDER_LS, p); } catch (e) {} }
  function getAnthropicKey() { try { return localStorage.getItem(ANTHROPIC_KEY_LS) || ''; } catch (e) { return ''; } }
  function setAnthropicKey(k) { try { localStorage.setItem(ANTHROPIC_KEY_LS, k); } catch (e) {} }
  function hasWebGPU() { return !!(navigator && navigator.gpu); }

  let enginePromise = null;
  function getEngine(onProgress) {
    if (!enginePromise) {
      enginePromise = import('https://esm.run/@mlc-ai/web-llm').then(function (webllm) {
        return webllm.CreateMLCEngine(WEBLLM_MODEL, {
          initProgressCallback: function (p) { if (onProgress) onProgress(p); },
        });
      }).catch(function (err) {
        enginePromise = null; // let a future call retry instead of staying broken forever
        throw err;
      });
    }
    return enginePromise;
  }

  // opts: { system, messages: [{role,content}], onToken(delta, full), onProgress(p) }
  async function chat(opts) {
    const system = opts.system || '';
    const messages = opts.messages || [];
    const onToken = opts.onToken;
    const onProgress = opts.onProgress;
    const provider = getProvider();

    if (provider === 'anthropic') {
      const key = getAnthropicKey();
      if (!key) throw new Error('No Anthropic key saved yet — add one in AI Mentor settings, or switch back to the free local model.');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1024, system: system, messages: messages }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || 'Anthropic error');
      const text = (json.content && json.content[0] && json.content[0].text) || '';
      if (onToken) onToken(text, text);
      return text;
    }

    if (!hasWebGPU()) {
      throw new Error('This browser doesn\'t support WebGPU, which the free local AI mentor needs. Try Chrome or Edge on a laptop/desktop, or add an Anthropic key in settings instead.');
    }
    const engine = await getEngine(onProgress);
    const chunks = await engine.chat.completions.create({
      messages: [{ role: 'system', content: system }].concat(messages),
      stream: true,
    });
    let full = '';
    for await (const chunk of chunks) {
      const delta = (chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || '';
      full += delta;
      if (onToken) onToken(delta, full);
    }
    return full;
  }

  return {
    getProvider: getProvider,
    setProvider: setProvider,
    getAnthropicKey: getAnthropicKey,
    setAnthropicKey: setAnthropicKey,
    hasWebGPU: hasWebGPU,
    chat: chat,
    WEBLLM_MODEL: WEBLLM_MODEL,
  };
})();
