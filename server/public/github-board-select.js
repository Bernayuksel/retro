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
      const picker = document.createElement('div');
      picker.className = 'github-project-picker';
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'github-board-options';
      const legend = document.createElement('legend');
      legend.textContent = 'Boardlar (birden fazla seçebilirsiniz)';
      fieldset.append(legend);
      const select = document.createElement('select');
      select.id = 'title';
      select.className = input.className;
      select.required = true;
      select.setAttribute('aria-label', 'Sprint');
      const updateSelection = () => {
        const boards = [...fieldset.querySelectorAll('input:checked')].map(box => box.value);
        selection = select.value && boards.length
          ? { boards, iterationId: select.value }
          : null;
      };
      const updateSprints = () => {
        const previous = select.value;
        const boards = [...fieldset.querySelectorAll('input:checked')].map(box => box.value);
        const selectedGroups = groups.filter(group => boards.includes(group.board));
        const sprints = selectedGroups.length ? selectedGroups[0].sprints.filter(sprint =>
          selectedGroups.every(group => group.sprints.some(s => s.id === sprint.id))) : [];
        select.replaceChildren(new Option('Sprint seçin...', ''));
        for (const sprint of sprints) {
          select.appendChild(new Option(`${sprint.title}${sprint.state === 'current' ? ' (aktif)' : ''}`, sprint.id));
        }
        select.disabled = !boards.length;
        if (sprints.some(sprint => sprint.id === previous)) select.value = previous;
        updateSelection();
      };
      for (const group of groups) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = group.board;
        checkbox.onchange = updateSprints;
        label.append(checkbox, document.createTextNode(group.board));
        fieldset.append(label);
      }
      select.onchange = updateSelection;
      picker.append(fieldset, select);
      if (input.isConnected) input.replaceWith(picker);
      area.replaceChildren();
      updateSprints();
      setNote(groups.length ? 'Boardları işaretleyin, ardından ortak sprinti seçin.' : 'Seçilebilecek board bulunamadı.');
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
