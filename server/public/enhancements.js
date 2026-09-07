(() => {
  const EMOJIS = ['👍', '❤️', '😂', '😮', '🎯', '👏', '👎'];
  let replyParentId = null;
  let commentAnonymous = false;
  let wsBound = null;

  const originalSend = window.send;
  if (typeof originalSend === 'function') {
    window.send = payload => {
      if (payload?.type === 'comment_add') {
        payload = {
          ...payload,
          anonymous: commentAnonymous,
          parent_id: replyParentId
        };
        replyParentId = null;
        commentAnonymous = false;
      }
      return originalSend(payload);
    };
  }

  function boardIdFromHash() {
    const match = location.hash.match(/^#\/board\/([a-zA-Z0-9-]+)$/);
    return match ? match[1] : null;
  }

  async function getBoard() {
    const id = boardIdFromHash();
    if (!id) return null;
    const response = await fetch(`/api/boards/${id}`);
    if (!response.ok) return null;
    return response.json();
  }

  function bindSocket() {
    if (!window.state?.ws || wsBound === window.state.ws) return;
    wsBound = window.state.ws;
    wsBound.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        if (['comment_added', 'comment_deleted', 'comment_reactions_changed', 'hidden', 'revealed'].includes(message.type)) {
          setTimeout(() => window.refreshBoardData?.(), 80);
        }
      } catch (_) {}
    });
  }

  function depthFor(comment, commentsById, cache = new Map(), trail = new Set()) {
    if (!comment?.parent_id || trail.has(comment.id)) return 0;
    if (cache.has(comment.id)) return cache.get(comment.id);
    const parent = commentsById.get(comment.parent_id);
    if (!parent) return 0;
    trail.add(comment.id);
    const depth = Math.min(depthFor(parent, commentsById, cache, trail) + 1, 4);
    trail.delete(comment.id);
    cache.set(comment.id, depth);
    return depth;
  }

  async function enhance() {
    bindSocket();
    const board = await getBoard();
    if (!board) return;

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
        const row = document.createElement('label');
        row.className = 'comment-anonymous-row';
        row.innerHTML = '<input type="checkbox" class="comment-anonymous"><span>Anonim yorum</span>';
        panel.querySelector('.comments-header')?.after(row);
        anonymous = row.querySelector('.comment-anonymous');
      }

      anonymous.checked = commentAnonymous;
      anonymous.onchange = () => {
        commentAnonymous = anonymous.checked;
      };

      let cancel = panel.querySelector('.reply-cancel');
      if (replyParentId && !cancel) {
        cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'reply-cancel small-secondary';
        cancel.textContent = 'Yanıtı iptal et';
        input.parentElement.before(cancel);
        cancel.onclick = () => {
          replyParentId = null;
          input.placeholder = 'Yorum yaz...';
          cancel.remove();
        };
      }
      if (replyParentId) input.placeholder = 'Yanıt yaz...';

      panel.querySelectorAll('.comment-row').forEach(row => {
        const deleteButton = row.querySelector('.delete-comment');
        if (!deleteButton) return;
        const comment = commentsById.get(deleteButton.dataset.commentId);
        if (!comment) return;

        row.dataset.commentId = comment.id;
        row.style.marginLeft = `${depthFor(comment, commentsById) * 18}px`;
        row.style.minWidth = '0';
        row.style.maxWidth = '100%';
        row.style.overflowWrap = 'anywhere';

        const author = row.querySelector('strong');
        if (author) author.textContent = comment.is_anonymous ? 'Anonim' : (comment.author_name || 'Anonim');

        const header = row.firstElementChild;
        if (header && !header.querySelector('.reply-comment')) {
          const reply = document.createElement('button');
          reply.type = 'button';
          reply.className = 'reply-comment small-secondary';
          reply.textContent = '↩ Yanıtla';
          reply.onclick = () => {
            replyParentId = comment.id;
            commentAnonymous = !!anonymous.checked;
            input.placeholder = 'Yanıt yaz...';
            input.focus();
            enhance();
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
          button.onclick = () => window.send({ type: 'comment_reaction_add', comment_id: comment.id, emoji });
          reactions.appendChild(button);
        });
        row.appendChild(reactions);
      });
    });

    const actionForm = document.querySelector('.action-form');
    if (actionForm) actionForm.classList.add('action-form-enhanced');

    const revealButton = document.getElementById('adminReveal');
    if (revealButton && board.status === 'revealed' && window.state?.role === 'admin') {
      const strong = revealButton.querySelector('strong');
      const small = revealButton.querySelector('small');
      if (strong) strong.textContent = 'Kartları Gizle';
      if (small) small.textContent = 'Kartların içeriğini tekrar gizle';
      revealButton.onclick = () => {
        if (confirm('Kartlar tekrar gizlenecek. Emin misiniz?')) window.send({ type: 'hide' });
      };
    }
  }

  const observer = new MutationObserver(() => setTimeout(enhance, 50));
  const app = document.getElementById('app');
  if (app) observer.observe(app, { childList: true, subtree: true });

  window.addEventListener('hashchange', () => setTimeout(enhance, 100));
  setInterval(enhance, 1000);
  setTimeout(enhance, 150);
})();
