(() => {
  const EMOJIS = ['👍', '❤️', '😂', '😮', '🎯', '👏', '👎'];
  let lastSignature = '';
  let enhancing = false;
  let scheduled = false;

  window.__retroReplyParentId = null;
  window.__retroCommentAnonymous = false;

  // app.js'in mevcut send() fonksiyonuna dokunmadan yeni comment alanlarını ekle.
  const originalSend = window.send;
  if (typeof originalSend === 'function') {
    window.send = payload => {
      if (payload?.type === 'comment_add') {
        payload = {
          ...payload,
          anonymous: !!window.__retroCommentAnonymous,
          parent_id: window.__retroReplyParentId || null
        };

        const result = originalSend(payload);
        window.__retroReplyParentId = null;
        window.__retroCommentAnonymous = false;
        return result;
      }

      const result = originalSend(payload);
      if (payload?.type === 'hide') {
        setTimeout(() => forceEnhance(), 250);
      }
      return result;
    };
  }

  function boardIdFromHash() {
    const match = location.hash.match(/^#\/board\/([a-zA-Z0-9-]+)$/);
    return match ? match[1] : null;
  }

  async function getBoard() {
    const boardId = boardIdFromHash();
    if (!boardId) return null;
    const response = await fetch(`/api/boards/${boardId}`);
    if (!response.ok) return null;
    return response.json();
  }

  function scheduleEnhance(force = false) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      await enhance(force);
    }, 80);
  }

  async function forceEnhance() {
    lastSignature = '';
    await enhance(true);
  }

  async function enhance(force = false) {
    if (enhancing || !boardIdFromHash()) return;
    enhancing = true;

    try {
      const signature = [
        location.hash,
        document.querySelectorAll('.retro-card').length,
        document.querySelectorAll('.comment-row').length,
        document.getElementById('statusBadge')?.textContent || ''
      ].join('|');

      if (!force && signature === lastSignature) return;
      lastSignature = signature;

      const board = await getBoard();
      if (!board) return;

      enhanceComments(board);
      enhanceAdmin(board);
      updateActionFormLayout();
    } catch (error) {
      console.warn('Retro enhancement error:', error);
    } finally {
      enhancing = false;
    }
  }

  function enhanceComments(board) {
    const commentsById = new Map();
    for (const card of board.cards || []) {
      for (const comment of card.comments || []) commentsById.set(comment.id, comment);
    }

    document.querySelectorAll('.comments-panel').forEach(panel => {
      const input = panel.querySelector('.comment-input');
      const addButton = panel.querySelector('.add-comment');
      if (!input || !addButton) return;

      let anonymous = panel.querySelector('.comment-anonymous');
      if (!anonymous) {
        const label = document.createElement('label');
        label.className = 'comment-anonymous-row';
        label.innerHTML = `
          <input type="checkbox" class="comment-anonymous">
          <span>Anonim yorum</span>
        `;
        input.parentElement.before(label);
        anonymous = label.querySelector('.comment-anonymous');
      }

      anonymous.checked = !!window.__retroCommentAnonymous;
      anonymous.onchange = () => {
        window.__retroCommentAnonymous = anonymous.checked;
      };

      const activeReply = panel.querySelector('.reply-cancel');
      if (window.__retroReplyParentId) {
        if (!activeReply) {
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'reply-cancel small-secondary';
          cancel.textContent = 'Yanıtı iptal et';
          input.parentElement.prepend(cancel);
          cancel.onclick = () => {
            window.__retroReplyParentId = null;
            input.placeholder = 'Yorum yaz...';
            cancel.remove();
          };
        }
        input.placeholder = 'Yanıt yaz...';
      }

      const rows = [...panel.querySelectorAll('.comment-row')];
      const depthCache = new Map();
      const depth = id => {
        if (!id || depthCache.has(id)) return 0;
        const comment = commentsById.get(id);
        if (!comment?.parent_id) {
          depthCache.set(id, 0);
          return 0;
        }
        const value = Math.min(depth(comment.parent_id) + 1, 4);
        depthCache.set(id, value);
        return value;
      };

      rows.forEach(row => {
        const deleteButton = row.querySelector('.delete-comment');
        if (!deleteButton) return;
        const commentId = deleteButton.dataset.commentId;
        const comment = commentsById.get(commentId);
        if (!comment) return;

        row.dataset.commentId = commentId;
        row.style.marginLeft = `${depth(commentId) * 18}px`;
        row.style.minWidth = '0';
        row.style.maxWidth = '100%';

        const author = row.querySelector('strong');
        if (author) author.textContent = comment.is_anonymous ? 'Anonim' : (comment.author_name || 'Anonim');

        const header = row.firstElementChild;
        if (header && !header.querySelector('.reply-comment')) {
          const reply = document.createElement('button');
          reply.type = 'button';
          reply.className = 'reply-comment';
          reply.textContent = '↩ Yanıtla';
          reply.title = 'Bu yoruma yanıt ver';
          reply.onclick = () => {
            window.__retroReplyParentId = commentId;
            window.__retroCommentAnonymous = !!anonymous.checked;
            input.placeholder = 'Yanıt yaz...';
            if (!panel.querySelector('.reply-cancel')) {
              const cancel = document.createElement('button');
              cancel.type = 'button';
              cancel.className = 'reply-cancel small-secondary';
              cancel.textContent = 'Yanıtı iptal et';
              input.parentElement.prepend(cancel);
              cancel.onclick = () => {
                window.__retroReplyParentId = null;
                input.placeholder = 'Yorum yaz...';
                cancel.remove();
              };
            }
            input.focus();
          };
          header.appendChild(reply);
        }

        let reactions = row.querySelector('.comment-reactions');
        if (reactions) reactions.remove();
        reactions = document.createElement('div');
        reactions.className = 'comment-reactions';

        const counts = new Map((comment.reactions || []).map(item => [item.emoji, Number(item.count)]));
        EMOJIS.forEach(emoji => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'comment-reaction';
          button.textContent = `${emoji}${counts.get(emoji) ? ` ${counts.get(emoji)}` : ''}`;
          button.title = 'Tepki ekle/kaldır';
          button.onclick = () => {
            window.send({ type: 'comment_reaction_add', comment_id: commentId, emoji });
            setTimeout(() => forceEnhance(), 180);
          };
          reactions.appendChild(button);
        });

        row.appendChild(reactions);
      });
    });
  }

  function enhanceAdmin(board) {
    const panel = document.getElementById('adminPanel');
    const revealButton = document.getElementById('adminReveal');
    if (!panel || panel.style.display === 'none' || !revealButton) return;

    const strong = revealButton.querySelector('strong');
    const small = revealButton.querySelector('small');
    if (!strong || !small) return;

    if (board.status === 'revealed') {
      strong.textContent = 'Kartları Gizle';
      small.textContent = 'Kartların içeriğini tekrar gizle';
      revealButton.onclick = () => {
        if (confirm('Kartlar tekrar gizlenecek. Emin misiniz?')) {
          window.send({ type: 'hide' });
          setTimeout(() => forceEnhance(), 250);
        }
      };
    } else if (board.status === 'open') {
      strong.textContent = 'Kartları Aç';
      small.textContent = 'Tüm kartların içeriğini göster';
    }
  }

  function updateActionFormLayout() {
    const form = document.querySelector('.action-form');
    if (form) form.classList.add('action-form-enhanced');
  }

  // app.js yeniden render ettiğinde enhancement'ları tekrar uygula.
  const observer = new MutationObserver(() => scheduleEnhance());
  const app = document.getElementById('app');
  if (app) observer.observe(app, { childList: true, subtree: true });

  // app.js'in websocket'i 'hidden' mesajını bilmiyor; kısa polling ile diğer client'larda da gizlemeyi yakala.
  let lastStatus = '';
  setInterval(async () => {
    const boardId = boardIdFromHash();
    if (!boardId) return;
    try {
      const board = await getBoard();
      if (!board) return;
      if (lastStatus && board.status !== lastStatus) {
        await window.refreshBoardData?.();
        await forceEnhance();
      }
      lastStatus = board.status;
    } catch (_) {}
  }, 1200);

  window.addEventListener('hashchange', () => {
    lastSignature = '';
    setTimeout(() => scheduleEnhance(true), 150);
  });

  setTimeout(() => scheduleEnhance(true), 150);
})();
