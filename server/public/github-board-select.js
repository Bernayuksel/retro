// Board formu her açıldığında çağrılır. GitHub yapılandırılmamışsa manuel başlık korunur.
(() => {
  let selection = null;
  window.getGithubSelection = () => selection;

  window.initGithubBoardSelect = async () => {
    selection = null;
    const input = document.getElementById('title');
    if (!input) return;
    const area = document.getElementById('githubSelectionArea');
    const note = document.getElementById('githubSelectionNote');
    const setNote = message => { if (note) note.textContent = message; };

    const load = async () => {
      const response = await fetch('/api/github/board-sprints', { credentials: 'same-origin' });
      if (response.status === 401) return 'unauthorized';
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'GitHub bağlantısı kurulamadı.');
      const groups = await response.json();
      const select = document.createElement('select');
      select.id = 'title';
      select.className = input.className;
      select.required = true;
      select.appendChild(new Option('Board ve sprint seçin...', ''));
      for (const group of groups) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.board;
        for (const sprint of group.sprints) {
          const option = new Option(`${sprint.title}${sprint.state === 'current' ? ' (aktif)' : ''}`, `${group.board} – ${sprint.title}`);
          option.dataset.board = group.board;
          option.dataset.iterationId = sprint.id;
          optgroup.appendChild(option);
        }
        select.appendChild(optgroup);
      }
      select.onchange = () => {
        const selected = select.selectedOptions[0];
        selection = selected?.dataset.iterationId
          ? { board: selected.dataset.board, iterationId: selected.dataset.iterationId }
          : null;
      };
      if (input.isConnected) input.replaceWith(select);
      area.replaceChildren();
      setNote(groups.length ? 'GitHub Project içindeki mevcut sprintlerden seçim yapın.' : 'Seçilebilecek sprint bulunamadı.');
      return 'ready';
    };

    try {
      const availability = await fetch('/api/github/availability').then(res => res.json());
      if (!availability.enabled) {
        setNote('GitHub bağlantısı henüz ayarlanmadı. Board başlığını elle yazabilirsiniz.');
        return;
      }
      input.disabled = true;
      setNote('GitHub sprintleri yükleniyor...');
      if (await load() === 'ready') return;

      setNote('GitHub Project erişim anahtarını girin.');
      const access = document.createElement('input');
      access.type = 'password';
      access.className = 'modern-input';
      access.placeholder = 'Erişim anahtarı';
      access.autocomplete = 'off';
      const button = document.createElement('button');
      button.className = 'secondary-button';
      button.textContent = 'Bağlan';
      button.onclick = async () => {
        button.disabled = true;
        try {
          const response = await fetch('/api/github/access', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_key: access.value })
          });
          access.value = '';
          if (!response.ok) throw new Error('Erişim anahtarı kabul edilmedi.');
          await load();
        } catch (error) { setNote(error.message); }
        finally { button.disabled = false; }
      };
      area.append(access, button);
    } catch (error) {
      setNote(error.message);
    }
  };
})();
