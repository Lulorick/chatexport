// ==UserScript==
// @name         Xoul.ai Chat Bubble Exporter
// @namespace    xoul.chatexporter
// @version      0.3
// @description  Export chat text as plain text or JSONL for SillyTavern.
// @author       Lulorick
// @match        https://xoul.ai/*
// @match        https://*.xoul.ai/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Lulorick/chatexport/main/chat-exporter.user.js
// @downloadURL  https://raw.githubusercontent.com/Lulorick/chatexport/main/chat-exporter.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    scrollContainerSelector: '#chat-container',

    bubbleContainerSelector: '[class*="ChatBubble_container__"]',

    senderInfoSelector: '[class*="ChatBubble_sender_info__"]',

    nameSelector: '[class*="ChatBubble_name__"]',

    textSelector: '[class*="ChatBubble_messagecontainer__"]',
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getChatName() {
    const nameEl = document.querySelector(
      '[class*="ChatUI_info__"] [class*="LineClamp_paragraph__"]'
    );
    const name = nameEl ? nameEl.textContent.trim() : '';
    return name || 'Xoul Chat';
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function timestampSuffix() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
      d.getHours()
    )}${pad(d.getMinutes())}`;
  }

  function buildFilename(extension) {
    const base = sanitizeFilename(getChatName());
    return `${base} - ${timestampSuffix()}.${extension}`;
  }

  function scrapeBubble(bubbleEl) {
    const senderInfo = bubbleEl.querySelector(CONFIG.senderInfoSelector);
    const isBot = senderInfo ? senderInfo.getAttribute('data-is-bot') === 'true' : null;

    const nameEl = bubbleEl.querySelector(CONFIG.nameSelector);
    const name = nameEl ? nameEl.textContent.trim() : (isBot ? 'Character' : 'You');

    const textEl = bubbleEl.querySelector(CONFIG.textSelector);
    const text = textEl ? textEl.innerText.trim() : '';

    return { name, isUser: isBot === false, text };
  }

  async function collectAllMessages(onProgress) {
    const scrollContainer = document.querySelector(CONFIG.scrollContainerSelector);
    if (!scrollContainer) {
      alert('Could not find the chat scroll container. The site layout may have changed — this script needs an update.');
      return [];
    }

    const collected = new Map();

    function captureVisible() {
      document.querySelectorAll(CONFIG.bubbleContainerSelector).forEach((bubbleEl) => {
        const wrapper = bubbleEl.parentElement;
        const key = wrapper && wrapper.style && wrapper.style.top ? wrapper.style.top : null;
        if (!key || collected.has(key)) return;
        const msg = scrapeBubble(bubbleEl);
        if (msg.text) collected.set(key, msg);
      });
      if (onProgress) onProgress(collected.size);
    }

    scrollContainer.scrollTop = 0;
    await sleep(400);
    captureVisible();

    let stableRounds = 0;
    const maxStableRounds = 3;

    while (stableRounds < maxStableRounds) {
      const before = collected.size;
      scrollContainer.scrollTop += Math.floor(scrollContainer.clientHeight * 0.7);
      await sleep(350);
      captureVisible();

      const reachedBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 5;

      if (collected.size === before) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }

      if (reachedBottom) {
        await sleep(350);
        captureVisible();
        break;
      }
    }

    return Array.from(collected.entries())
      .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .map(([, msg]) => msg);
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function formatAsText(messages) {
    return messages.map((m) => `${m.name}: ${m.text}`).join('\n\n');
  }

  function formatAsSillyTavernJSONL(messages) {
    const characterName = (messages.find((m) => !m.isUser) || {}).name || 'Character';
    const userName = (messages.find((m) => m.isUser) || {}).name || 'User';

    const header = {
      user_name: userName,
      character_name: characterName,
      create_date: new Date().toISOString(),
      chat_metadata: {},
    };

    const lines = [JSON.stringify(header)];
    messages.forEach((m) => {
      lines.push(
        JSON.stringify({
          name: m.name,
          is_user: m.isUser,
          is_system: false,
          send_date: new Date().toISOString(),
          mes: m.text,
          extra: {},
        })
      );
    });

    return lines.join('\n');
  }

  function injectUI() {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: #222; border: 1px solid #555; border-radius: 8px;
      padding: 10px; display: flex; flex-direction: column; gap: 8px;
      font-family: sans-serif; align-items: stretch;
    `;

    const status = document.createElement('div');
    status.style.cssText = 'color: #ccc; font-size: 12px; text-align: center;';
    status.textContent = 'Ready to export';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px;';

    const btnText = document.createElement('button');
    btnText.textContent = 'Export .txt';

    const btnJSON = document.createElement('button');
    btnJSON.textContent = 'Export .jsonl (SillyTavern)';

    [btnText, btnJSON].forEach((btn) => {
      btn.style.cssText = `
        padding: 6px 10px; background: #444; color: #fff; border: 1px solid #666;
        border-radius: 4px; cursor: pointer; font-size: 13px; flex: 1;
      `;
      btnRow.appendChild(btn);
    });

    async function runExport(formatFn, extension, mime) {
      btnText.disabled = true;
      btnJSON.disabled = true;
      status.textContent = 'Scrolling through chat...';

      const messages = await collectAllMessages((count) => {
        status.textContent = `Found ${count} messages so far...`;
      });

      if (messages.length === 0) {
        status.textContent = 'No messages found. Try scrolling manually first, then retry.';
      } else {
        const content = formatFn(messages);
        const filename = buildFilename(extension);
        downloadFile(filename, content, mime);
        status.textContent = `Done — saved as "${filename}"`;
      }

      btnText.disabled = false;
      btnJSON.disabled = false;
    }

    btnText.onclick = () => runExport(formatAsText, 'txt', 'text/plain');
    btnJSON.onclick = () => runExport(formatAsSillyTavernJSONL, 'jsonl', 'application/jsonl');

    panel.appendChild(status);
    panel.appendChild(btnRow);
    document.body.appendChild(panel);
  }

  window.addEventListener('load', () => {
    setTimeout(injectUI, 1500);
  });
})();
