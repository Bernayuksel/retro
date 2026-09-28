// Board başlığı textbox'ını GitHub board/sprint dropdown'una çevirir.
// Kullanım (index.html içinde, uygulama script'inden ÖNCE):
//   <script src="github-board-select.js" data-input="#boardTitle"></script>
// data-input: mevcut board başlığı input'unun CSS seçicisi.
// Input'un id/name değerleri korunur; mevcut kod .value ile "Team – Sprint 75" metnini okumaya devam eder.
// Board ve sprint bilgisi için: window.getGithubSelection() -> { board, iterationId, iterationTitle } | null

(function () {
  const script = document.currentScript;
  const selector = (script && script.dataset.input) || '#boardTitle';

  function build(input) {
    const select = document.createElement('select');
    for (const attr of ['id', 'name', 'class', 'required']) {
      if (input.hasAttribute(attr)) select.setAttribute(attr, input.getAttribute(attr));
    }
    select.innerHTML = '<option value="">Yükleniyor...</option>';
    input.replaceWith(select);
    return select;
  }

  function fallback(select, input, message) {
    // GitHub'a ulaşılamazsa eski textbox'a geri dön
    console.warn('[github-board-select]', message);
    input.placeholder = 'GitHub bağlantısı yok, başlığı elle yazın';
    select.replaceWith(input);
  }

  async function init() {
    const input = document.querySelector(selector);
    if (!input) return console.warn('[github-board-select] input bulunamadı:', selector);
    const original = input.cloneNode(true);
    const select = build(input);

    try {
      const res = await fetch('/api/github/board-sprints');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      const groups = await res.json();

      select.innerHTML = '<option value="">Board ve sprint seçin</option>';
      for (const g of groups) {
        const og = document.createElement('optgroup');
        og.label = g.board;
        for (const s of g.sprints) {
          const opt = document.createElement('option');
          opt.value = `${g.board} – ${s.title}`;
          opt.textContent = `${s.title}${s.state === 'current' ? ' (aktif)' : ''}`;
          opt.dataset.board = g.board;
          opt.dataset.iterationId = s.id;
          opt.dataset.iterationTitle = s.title;
          og.appendChild(opt);
        }
        select.appendChild(og);
      }
    } catch (e) {
      fallback(select, original, e.message || e);
    }
  }

  window.getGithubSelection = function () {
    const el = document.querySelector(selector);
    if (!el || el.tagName !== 'SELECT') return null;
    const opt = el.selectedOptions[0];
    if (!opt || !opt.dataset.iterationId) return null;
    return { board: opt.dataset.board, iterationId: opt.dataset.iterationId, iterationTitle: opt.dataset.iterationTitle };
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
