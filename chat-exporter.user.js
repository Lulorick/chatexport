// ==UserScript==
// @name         Xoul.ai Chat Bubble Exporter
// @namespace    xoul.chatexporter
// @version      0.6
// @description  Tool which exports xoul.ai chats into plain text files, hmtl files or JSONL files for SillyTavern. Also contains a simple chat stat display.
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

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function walkFormattedNode(node) {
    let html = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        html += escapeHtml(child.textContent);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          html += '<br>';
        } else if (tag === 'i' || tag === 'em') {
          html += `<em>${walkFormattedNode(child)}</em>`;
        } else if (tag === 'b' || tag === 'strong') {
          html += `<strong>${walkFormattedNode(child)}</strong>`;
        } else if (tag === 'script' || tag === 'style') {
        } else {
          html += walkFormattedNode(child);
        }
      }
    });
    return html;
  }

  function getFormattedHtml(textEl) {
    if (!textEl) return '';
    return walkFormattedNode(textEl);
  }

  function scrapeBubble(bubbleEl) {
    const senderInfo = bubbleEl.querySelector(CONFIG.senderInfoSelector);
    const isBot = senderInfo ? senderInfo.getAttribute('data-is-bot') === 'true' : null;

    const nameEl = bubbleEl.querySelector(CONFIG.nameSelector);
    const name = nameEl ? nameEl.textContent.trim() : (isBot ? 'Character' : 'You');

    const textEl = bubbleEl.querySelector(CONFIG.textSelector);
    const text = textEl ? textEl.innerText.trim() : '';
    const html = getFormattedHtml(textEl);

    return { name, isUser: isBot === false, text, html };
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

  function computeAnalytics(messages) {
    const bySpeaker = {};
    let totalWords = 0;
    let totalChars = 0;
    let longest = null;

    messages.forEach((m) => {
      const words = m.text.trim().split(/\s+/).filter(Boolean).length;
      const chars = m.text.length;

      totalWords += words;
      totalChars += chars;

      if (!bySpeaker[m.name]) {
        bySpeaker[m.name] = { count: 0, words: 0, chars: 0 };
      }
      bySpeaker[m.name].count += 1;
      bySpeaker[m.name].words += words;
      bySpeaker[m.name].chars += chars;

      if (!longest || words > longest.words) {
        longest = {
          name: m.name,
          words,
          preview: m.text.length > 100 ? m.text.slice(0, 100) + '…' : m.text,
        };
      }
    });

    return {
      totalMessages: messages.length,
      totalWords,
      totalChars,
      avgWordsPerMessage: messages.length ? Math.round(totalWords / messages.length) : 0,
      bySpeaker,
      longest,
    };
  }

  function formatAnalyticsReport(messages, chatName) {
    const a = computeAnalytics(messages);
    const lines = [];

    lines.push(`Chat Stats: ${chatName}`);
    lines.push('='.repeat(40));
    lines.push('');
    lines.push(`Total messages: ${a.totalMessages}`);
    lines.push(`Total words: ${a.totalWords.toLocaleString()}`);
    lines.push(`Total characters: ${a.totalChars.toLocaleString()}`);
    lines.push(`Average words per message: ${a.avgWordsPerMessage}`);
    lines.push('');
    lines.push('By speaker:');
    lines.push('-'.repeat(40));

    Object.entries(a.bySpeaker).forEach(([name, s]) => {
      const avg = s.count ? Math.round(s.words / s.count) : 0;
      lines.push(`${name}:`);
      lines.push(`  Messages: ${s.count}`);
      lines.push(`  Words: ${s.words.toLocaleString()}`);
      lines.push(`  Characters: ${s.chars.toLocaleString()}`);
      lines.push(`  Avg words/message: ${avg}`);
      lines.push('');
    });

    if (a.longest) {
      lines.push('Longest message:');
      lines.push('-'.repeat(40));
      lines.push(`${a.longest.name} (${a.longest.words} words)`);
      lines.push(`"${a.longest.preview}"`);
    }

    return lines.join('\n');
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

  function formatAsHTML(messages, chatName) {
    const rows = messages
      .map((m) => {
        const side = m.isUser ? 'user' : 'character';
        return `    <div class="message ${side}">
      <div class="speaker">${escapeHtml(m.name)}</div>
      <div class="bubble">${m.html || escapeHtml(m.text)}</div>
    </div>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(chatName)}</title>
<style>
  body {
    font-family: Georgia, 'Times New Roman', serif;
    background: #1b1b1f;
    color: #e8e8e8;
    margin: 0;
    padding: 32px 16px;
  }
  h1 {
    font-family: -apple-system, sans-serif;
    font-size: 18px;
    font-weight: 600;
    color: #aaa;
    max-width: 700px;
    margin: 0 auto 24px auto;
    padding-bottom: 12px;
    border-bottom: 1px solid #3a3a40;
  }
  .message {
    max-width: 700px;
    margin: 0 auto 18px auto;
  }
  .speaker {
    font-family: -apple-system, sans-serif;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.02em;
    margin-bottom: 4px;
    color: #9ecbff;
  }
  .message.user .speaker {
    color: #ffd479;
    text-align: right;
  }
  .bubble {
    background: #26262c;
    border-radius: 10px;
    padding: 14px 18px;
    line-height: 1.65;
    font-size: 15.5px;
  }
  .message.user .bubble {
    background: #2f2a1f;
  }
  em { color: #d7d7d7; }
  strong { color: #ffffff; }
</style>
</head>
<body>
  <h1>${escapeHtml(chatName)}</h1>
${rows}
</body>
</html>`;
  }

  function injectUI() {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      font-family: sans-serif;
    `;

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '⇩ Export';
    toggleBtn.style.cssText = `
      padding: 8px 14px; background: #333; color: #fff; border: 1px solid #555;
      border-radius: 20px; cursor: pointer; font-size: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      display: none; background: #222; border: 1px solid #555; border-radius: 8px;
      padding: 10px; flex-direction: column; gap: 8px; align-items: stretch;
      width: 280px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;

    let expanded = false;
    function setExpanded(next) {
      expanded = next;
      panel.style.display = expanded ? 'flex' : 'none';
      toggleBtn.textContent = expanded ? '✕ Close' : '⇩ Export';
    }
    toggleBtn.onclick = () => setExpanded(!expanded);

    const status = document.createElement('div');
    status.style.cssText = 'color: #ccc; font-size: 12px; text-align: center;';
    status.textContent = 'Ready to export';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const btnText = document.createElement('button');
    btnText.textContent = 'Export .txt';

    const btnJSON = document.createElement('button');
    btnJSON.textContent = 'Export .jsonl (SillyTavern)';

    const btnHTML = document.createElement('button');
    btnHTML.textContent = 'Export .html';

    const btnStats = document.createElement('button');
    btnStats.textContent = 'Message Stats';

    const allButtons = [btnText, btnJSON, btnHTML, btnStats];
    allButtons.forEach((btn) => {
      btn.style.cssText = `
        padding: 6px 10px; background: #444; color: #fff; border: 1px solid #666;
        border-radius: 4px; cursor: pointer; font-size: 13px; flex: 1 1 auto;
        white-space: nowrap;
      `;
      btnRow.appendChild(btn);
    });

    const statsBox = document.createElement('pre');
    statsBox.style.cssText = `
      display: none; margin: 0; max-height: 260px; overflow-y: auto;
      background: #1a1a1a; border: 1px solid #444; border-radius: 4px;
      padding: 8px; color: #ddd; font-size: 11px; white-space: pre-wrap;
      font-family: monospace; max-width: 320px;
    `;

    const btnDownloadReport = document.createElement('button');
    btnDownloadReport.textContent = 'Download full report (.txt)';
    btnDownloadReport.style.cssText = `
      display: none; padding: 6px 10px; background: #444; color: #fff;
      border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 12px;
    `;

    function setButtonsDisabled(disabled) {
      allButtons.forEach((btn) => (btn.disabled = disabled));
    }

    async function runExport(formatFn, extension, mime) {
      setButtonsDisabled(true);
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

      setButtonsDisabled(false);
    }

    async function runStats() {
      setButtonsDisabled(true);
      statsBox.style.display = 'none';
      btnDownloadReport.style.display = 'none';
      status.textContent = 'Scrolling through chat...';

      const messages = await collectAllMessages((count) => {
        status.textContent = `Found ${count} messages so far...`;
      });

      if (messages.length === 0) {
        status.textContent = 'No messages found. Try scrolling manually first, then retry.';
        setButtonsDisabled(false);
        return;
      }

      const a = computeAnalytics(messages);
      const speakerLines = Object.entries(a.bySpeaker)
        .map(([name, s]) => `  ${name}: ${s.count} msgs, ${s.words.toLocaleString()} words`)
        .join('\n');

      statsBox.textContent =
        `Messages: ${a.totalMessages}\n` +
        `Words: ${a.totalWords.toLocaleString()}\n` +
        `Characters: ${a.totalChars.toLocaleString()}\n` +
        `Avg words/message: ${a.avgWordsPerMessage}\n\n` +
        `By speaker:\n${speakerLines}` +
        (a.longest ? `\n\nLongest message: ${a.longest.name} (${a.longest.words} words)` : '');

      statsBox.style.display = 'block';
      btnDownloadReport.style.display = 'block';
      btnDownloadReport.onclick = () => {
        const report = formatAnalyticsReport(messages, getChatName());
        downloadFile(buildFilename('txt').replace(/\.txt$/, ' - stats.txt'), report, 'text/plain');
      };

      status.textContent = `Done — analyzed ${messages.length} messages.`;
      setButtonsDisabled(false);
    }

    btnText.onclick = () => runExport(formatAsText, 'txt', 'text/plain');
    btnJSON.onclick = () => runExport(formatAsSillyTavernJSONL, 'jsonl', 'application/jsonl');
    btnHTML.onclick = () =>
      runExport((messages) => formatAsHTML(messages, getChatName()), 'html', 'text/html');
    btnStats.onclick = () => runStats();

    panel.appendChild(status);
    panel.appendChild(btnRow);
    panel.appendChild(statsBox);
    panel.appendChild(btnDownloadReport);

    container.appendChild(panel);
    container.appendChild(toggleBtn);
    document.body.appendChild(container);
  }

  window.addEventListener('load', () => {
    setTimeout(injectUI, 1500);
  });
})();
