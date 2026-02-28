/**
 * Revive Exterior Cleaning - Chat Widget
 *
 * Self-contained embeddable chat widget with:
 * - Conversation persistence (survives page reloads)
 * - Lead capture UI feedback
 * - Session management via localStorage
 *
 * Embed on any site with:
 * <script src="https://your-backend-url/chat-widget.js"></script>
 */
(function () {
  'use strict';

  // Prevent multiple initializations (Aura can load the script multiple times)
  if (window.__reviveChatLoaded) return;
  window.__reviveChatLoaded = true;

  // Clean up any pre-existing chat elements baked into the page by Aura
  // Aura serialises dynamically-created DOM into static HTML, creating dead
  // duplicates with no event listeners. Remove them all before we create fresh ones.
  document.querySelectorAll('#revive-chat-bubble').forEach(function(el) { el.remove(); });
  document.querySelectorAll('#revive-chat-window').forEach(function(el) { el.remove(); });

  // Detect API base URL from script source
  var scriptEl = document.currentScript;
  var API_BASE = scriptEl ? new URL(scriptEl.src).origin : '';

  // Session management
  var SESSION_KEY = 'revive-chat-session';
  var sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = 'cs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  // Conversation state
  var messages = [];
  var isOpen = false;
  var isLoading = false;
  var hasRestored = false;
  var leadAlreadyCaptured = false;

  // ========================
  // STYLES (matches Revive site: dark theme, lime-400 accent, Poppins font)
  // ========================
  var styles = document.createElement('style');
  styles.textContent = `
    #revive-chat-bubble {
      position: fixed;
      bottom: 80px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: #a3e635;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(163, 230, 53, 0.4);
      z-index: 99998;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #revive-chat-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(163, 230, 53, 0.5);
    }
    #revive-chat-bubble svg {
      width: 28px;
      height: 28px;
      fill: #000000;
    }

    #revive-chat-window {
      position: fixed;
      bottom: 152px;
      right: 24px;
      width: 380px;
      height: 520px;
      background: #0a0a0a;
      border: 1px solid #262626;
      border-radius: 16px;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
      z-index: 99999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #revive-chat-window.revive-chat-open {
      display: flex;
    }

    #revive-chat-header {
      background: #000000;
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      border-bottom: 1px solid #262626;
    }
    #revive-chat-header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #revive-chat-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #a3e635;
      color: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      flex-shrink: 0;
    }
    #revive-chat-header-text h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    #revive-chat-header-text p {
      margin: 2px 0 0;
      font-size: 11px;
      color: #a3e635;
    }
    #revive-chat-close {
      background: none;
      border: none;
      color: #737373;
      cursor: pointer;
      padding: 4px;
      font-size: 20px;
      line-height: 1;
      transition: color 0.2s;
    }
    #revive-chat-close:hover {
      color: #ffffff;
    }

    #revive-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #0a0a0a;
    }
    #revive-chat-messages::-webkit-scrollbar {
      width: 4px;
    }
    #revive-chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    #revive-chat-messages::-webkit-scrollbar-thumb {
      background: #262626;
      border-radius: 2px;
    }

    .revive-chat-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
      letter-spacing: -0.01em;
    }
    .revive-chat-msg-bot {
      align-self: flex-start;
      background: #171717;
      color: #d4d4d4;
      border: 1px solid #262626;
      border-bottom-left-radius: 4px;
    }
    .revive-chat-msg-user {
      align-self: flex-end;
      background: #a3e635;
      color: #000000;
      font-weight: 500;
      border-bottom-right-radius: 4px;
    }

    .revive-chat-lead-confirm {
      align-self: center;
      background: #1a2e05;
      border: 1px solid #a3e635;
      color: #a3e635;
      font-size: 11px;
      padding: 6px 14px;
      border-radius: 20px;
      text-align: center;
      font-weight: 500;
    }

    .revive-chat-typing {
      align-self: flex-start;
      background: #171717;
      border: 1px solid #262626;
      padding: 12px 18px;
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .revive-chat-typing-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #525252;
      animation: revive-bounce 1.4s infinite ease-in-out;
    }
    .revive-chat-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .revive-chat-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes revive-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    #revive-chat-input-area {
      padding: 12px 16px;
      border-top: 1px solid #262626;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
      background: #000000;
    }
    #revive-chat-input {
      flex: 1;
      border: 1px solid #262626;
      border-radius: 24px;
      padding: 10px 16px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
      background: #171717;
      color: #e5e5e5;
      transition: border-color 0.2s;
      letter-spacing: -0.01em;
    }
    #revive-chat-input:focus {
      border-color: #a3e635;
    }
    #revive-chat-input::placeholder {
      color: #525252;
    }
    #revive-chat-send {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #a3e635;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s, box-shadow 0.2s;
    }
    #revive-chat-send:hover {
      background: #bef264;
      box-shadow: 0 0 12px rgba(163, 230, 53, 0.3);
    }
    #revive-chat-send:disabled {
      background: #262626;
      cursor: not-allowed;
      box-shadow: none;
    }
    #revive-chat-send svg {
      width: 18px;
      height: 18px;
      fill: #000000;
    }

    #revive-chat-footer {
      padding: 6px 16px 8px;
      text-align: center;
      font-size: 10px;
      color: #404040;
      background: #000000;
      flex-shrink: 0;
      letter-spacing: -0.01em;
    }

    .revive-chat-cta-btn {
      display: block;
      margin: 8px 0 4px;
      padding: 10px 16px;
      background: #a3e635;
      color: #000000;
      font-weight: 600;
      font-size: 13px;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      text-align: center;
      transition: background 0.2s, box-shadow 0.2s;
      max-width: 85%;
      font-family: inherit;
      letter-spacing: -0.01em;
    }
    .revive-chat-cta-btn:hover {
      background: #bef264;
      box-shadow: 0 0 12px rgba(163, 230, 53, 0.3);
    }

    /* Mobile responsive */
    @media (max-width: 480px) {
      #revive-chat-window {
        bottom: 0;
        right: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border-radius: 0;
        border: none;
      }
      #revive-chat-bubble {
        bottom: 110px;
        right: 16px;
      }
    }
  `;
  document.head.appendChild(styles);

  // ========================
  // DOM ELEMENTS
  // ========================

  // Chat bubble button
  var bubble = document.createElement('button');
  bubble.id = 'revive-chat-bubble';
  bubble.setAttribute('aria-label', 'Open chat');
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>';

  // Chat window
  var chatWindow = document.createElement('div');
  chatWindow.id = 'revive-chat-window';
  chatWindow.innerHTML = `
    <div id="revive-chat-header">
      <div id="revive-chat-header-info">
        <div id="revive-chat-avatar">R</div>
        <div id="revive-chat-header-text">
          <h3>Revive Assistant</h3>
          <p>Online</p>
        </div>
      </div>
      <button id="revive-chat-close">&times;</button>
    </div>
    <div id="revive-chat-messages"></div>
    <div id="revive-chat-input-area">
      <input id="revive-chat-input" type="text" placeholder="Ask us anything..." autocomplete="off" />
      <button id="revive-chat-send" aria-label="Send message">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
    <div id="revive-chat-footer">Revive Exterior Cleaning Solutions</div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(chatWindow);

  // Get references
  var messagesContainer = document.getElementById('revive-chat-messages');
  var input = document.getElementById('revive-chat-input');
  var sendBtn = document.getElementById('revive-chat-send');
  var closeBtn = document.getElementById('revive-chat-close');

  // ========================
  // FUNCTIONS
  // ========================

  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      chatWindow.classList.add('revive-chat-open');
      bubble.style.display = 'none';
      input.focus();
      // Restore conversation or show welcome on first open
      if (!hasRestored) {
        hasRestored = true;
        restoreConversation();
      }
    } else {
      chatWindow.classList.remove('revive-chat-open');
      bubble.style.display = 'flex';
    }
  }

  async function restoreConversation() {
    try {
      var response = await fetch(API_BASE + '/api/chat/history?sessionId=' + encodeURIComponent(sessionId));
      var data = await response.json();

      if (data.success && data.messages && data.messages.length > 0) {
        leadAlreadyCaptured = data.leadCaptured || false;
        // Rebuild UI from stored messages
        data.messages.forEach(function(msg) {
          var content = typeof msg.content === 'string' ? msg.content : '';
          if (!content) return;
          if (msg.role === 'user') {
            messages.push({ role: 'user', content: content });
            addUserMessage(content);
          } else if (msg.role === 'assistant') {
            messages.push({ role: 'assistant', content: content });
            addBotMessage(content);
          }
        });
      } else {
        // No stored conversation, show welcome
        addBotMessage("Hi! I'm the Revive assistant. Ask me about our services, pricing, or anything else. How can I help?");
      }
    } catch (err) {
      // If restore fails, just show welcome
      addBotMessage("Hi! I'm the Revive assistant. Ask me about our services, pricing, or anything else. How can I help?");
    }
  }

  function addBotMessage(text) {
    var div = document.createElement('div');
    div.className = 'revive-chat-msg revive-chat-msg-bot';
    div.textContent = text;
    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  function addUserMessage(text) {
    var div = document.createElement('div');
    div.className = 'revive-chat-msg revive-chat-msg-user';
    div.textContent = text;
    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  function showLeadConfirmation() {
    var div = document.createElement('div');
    div.className = 'revive-chat-lead-confirm';
    div.innerHTML = '&#10003; Details sent to our team';
    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  function showFormCTA() {
    var btn = document.createElement('button');
    btn.className = 'revive-chat-cta-btn';
    btn.textContent = 'Get Instant Estimate \u2192';
    btn.addEventListener('click', function() {
      window.location.href = '/instant-quote-page';
    });
    messagesContainer.appendChild(btn);
    scrollToBottom();
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'revive-chat-typing';
    div.id = 'revive-chat-typing-indicator';
    div.innerHTML = '<div class="revive-chat-typing-dot"></div><div class="revive-chat-typing-dot"></div><div class="revive-chat-typing-dot"></div>';
    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    var indicator = document.getElementById('revive-chat-typing-indicator');
    if (indicator) indicator.remove();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function setLoading(loading) {
    isLoading = loading;
    sendBtn.disabled = loading;
    input.disabled = loading;
  }

  async function sendMessage() {
    var text = input.value.trim();
    if (!text || isLoading) return;

    // Add user message to UI
    addUserMessage(text);
    input.value = '';

    // Add to conversation history
    messages.push({ role: 'user', content: text });

    // Show typing indicator
    setLoading(true);
    showTyping();

    try {
      var response = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          sessionId: sessionId
        })
      });

      hideTyping();

      if (!response.ok) {
        var errData = await response.json().catch(function () { return {}; });
        if (response.status === 429) {
          addBotMessage("You're sending messages quite quickly! Please wait a moment and try again.");
        } else {
          addBotMessage("Sorry, I'm having trouble connecting right now. You can reach us directly by submitting a quote request on our website.");
        }
        setLoading(false);
        return;
      }

      var data = await response.json();

      if (data.success && data.response) {
        // Add bot response to conversation history
        messages.push({ role: 'assistant', content: data.response });
        addBotMessage(data.response);

        // Show lead capture confirmation
        if (data.leadCaptured && !leadAlreadyCaptured) {
          leadAlreadyCaptured = true;
          showLeadConfirmation();
        }

        // Show form CTA button if chatbot prepared form data
        if (data.formData) {
          localStorage.setItem('revive-chat-prefill', JSON.stringify(data.formData));
          showFormCTA();
        }
      } else {
        addBotMessage("Sorry, something went wrong. Please try again or contact us directly.");
      }
    } catch (err) {
      hideTyping();
      addBotMessage("Sorry, I couldn't connect to our server. Please check your internet connection or contact us directly.");
    }

    setLoading(false);
  }

  // ========================
  // FORM PRE-FILL
  // ========================

  function tryPrefillForm() {
    var raw = localStorage.getItem('revive-chat-prefill');
    if (!raw) return;

    try {
      var data = JSON.parse(raw);
      localStorage.removeItem('revive-chat-prefill');

      // Wait for DOM to be fully ready (Aura renders client-side)
      setTimeout(function() {
        var form = document.getElementById('quote-form');
        if (!form) return;

        var textInputs = document.querySelectorAll('input[type="text"]');
        var selects = document.querySelectorAll('select');

        // Property type (first select)
        if (data.propertyType && selects[0]) {
          var propVal = data.propertyType.toLowerCase();
          for (var i = 0; i < selects[0].options.length; i++) {
            if (selects[0].options[i].value.toLowerCase() === propVal ||
                selects[0].options[i].text.toLowerCase().indexOf(propVal) !== -1) {
              selects[0].selectedIndex = i;
              break;
            }
          }
        }

        // Address (text input [0])
        // Not typically collected in chat, skip

        // Postcode (text input [1])
        if (data.postcode && textInputs[1]) {
          textInputs[1].value = data.postcode.toUpperCase();
        }

        // Specific details (first textarea)
        if (data.specificDetails) {
          var textarea = document.querySelector('textarea');
          if (textarea) textarea.value = data.specificDetails;
        }

        // Services (checkboxes)
        if (data.services && data.services.length > 0) {
          data.services.forEach(function(svc) {
            var cb = document.querySelector('input[name="services"][value="' + svc + '"]');
            if (cb) {
              cb.checked = true;
              // Trigger change event for UI update (Aura styling)
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }

        // Rough size (select [1])
        if (data.roughSize && selects[1]) {
          for (var j = 0; j < selects[1].options.length; j++) {
            if (selects[1].options[j].value === data.roughSize) {
              selects[1].selectedIndex = j;
              break;
            }
          }
        }

        // Last cleaned (select [2])
        if (data.lastCleaned && selects[2]) {
          var cleanMap = {
            'less-than-1': 'less-than-1',
            '1-3-years': '1-3-years',
            '3-plus': '3-plus',
            'unknown': 'unknown'
          };
          var cleanVal = cleanMap[data.lastCleaned] || data.lastCleaned;
          for (var k = 0; k < selects[2].options.length; k++) {
            if (selects[2].options[k].value === cleanVal) {
              selects[2].selectedIndex = k;
              break;
            }
          }
        }

        // Name (text input [2]) — step 4
        if (data.name && textInputs[2]) {
          textInputs[2].value = data.name;
        }

        // Email
        if (data.email) {
          var emailInput = document.querySelector('input[type="email"]');
          if (emailInput) emailInput.value = data.email;
        }

        // Phone
        if (data.phone) {
          var phoneInput = document.querySelector('input[type="tel"]');
          if (phoneInput) phoneInput.value = data.phone;
        }

        console.log('[Revive Chat] Form pre-filled from chat conversation');
      }, 800);
    } catch(e) {
      // Silently fail if pre-fill doesn't work
    }
  }

  // ========================
  // EVENT LISTENERS
  // ========================

  bubble.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);

  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Try to pre-fill form if coming from chat
  tryPrefillForm();

})();
