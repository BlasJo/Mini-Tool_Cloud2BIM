  /* ═══ Dark Mode Toggle — Standard-Layout-Script (G4), kein Tool-Code:
     eigene IIFE, nicht in die Tool-IIFE (P1) mergen und nicht veraendern ═══ */
  (function() {
    const root = document.documentElement;
    const btn = document.getElementById('themeToggle');

    /* S5: tolerante Lese-/Schreibzugriffe. Das Theme bleibt persistent in
       localStorage; ist der Storage blockiert (Unternehmensrichtlinie,
       Privatmodus), funktioniert der Umschalter trotzdem — nur ohne
       Persistenz ueber die Sitzung hinaus (saubere Degradation, P4). */
    function readTheme() {
      try { return localStorage.getItem('bs-theme'); } catch (e) { return null; }
    }
    function writeTheme(value) {
      try { localStorage.setItem('bs-theme', value); } catch (e) { /* Storage blockiert — keine Persistenz, kein Absturz */ }
    }

    if (readTheme() === 'dark') root.setAttribute('data-theme', 'dark');

    btn.addEventListener('click', function() {
      const isDark = root.getAttribute('data-theme') === 'dark';
      if (isDark) {
        root.removeAttribute('data-theme');
        writeTheme('light');
      } else {
        root.setAttribute('data-theme', 'dark');
        writeTheme('dark');
      }
    });
  })();

  /* ═══ Tastatur-Navigation — Standard-Layout-Script (G4), kein Tool-Code:
     sichtbarer Fokusring (.bs-btn) erst nach Tab, nicht bei Maus/Esc ═══ */
  (function() {
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') document.body.classList.add('bs-kbd-nav');
    });
    document.addEventListener('mousedown', function() {
      document.body.classList.remove('bs-kbd-nav');
    });
  })();

  /* ═══ Einstellungen-Schublade — Standard-Layout-Script (G4), kein Tool-Code:
     eigene IIFE, nicht in die Tool-IIFE (P1) mergen und nicht veraendern ═══ */
  (function() {
    const drawer = document.getElementById('settingsDrawer');
    const backdrop = document.getElementById('settingsBackdrop');
    const toggle = document.getElementById('settingsToggle');
    const content = document.querySelector('.sidebar-content');

    function setOpen(open) {
      drawer.classList.toggle('open', open);
      backdrop.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      /* Restliche Sidebar inaktiv (auch fuer Tastatur), solange offen */
      if (open) content.setAttribute('inert', ''); else content.removeAttribute('inert');
    }

    toggle.addEventListener('click', function() {
      setOpen(!drawer.classList.contains('open'));
    });

    backdrop.addEventListener('click', function() { setOpen(false); });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return; /* Esc gehoert dem Dialog */
      if (drawer.classList.contains('open')) {
        setOpen(false);
        toggle.blur(); /* kein "selektierter" Zustand nach Esc */
      }
    });
  })();

  /* ═══ Log kopieren — Standard-Layout-Script (G4), kein Tool-Code:
     eigene IIFE, nicht in die Tool-IIFE (P1) mergen und nicht veraendern ═══ */
  (function() {
    const btn = document.getElementById('logCopy');
    const log = document.getElementById('log');

    function feedback() {
      btn.classList.add('copied');
      setTimeout(function() { btn.classList.remove('copied'); }, 1200);
    }

    function fallbackCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); feedback(); } catch (e) { /* leise scheitern */ }
      document.body.removeChild(ta);
    }

    btn.addEventListener('click', function() {
      const text = log.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(feedback, function() { fallbackCopy(text); });
      } else {
        fallbackCopy(text);
      }
    });
  })();

  /* ═══ Standard-Dialog (BSDialog) — Standard-Layout-Script (G4), kein Tool-Code:
     eigene IIFE, nicht in die Tool-IIFE (P1) mergen und nicht veraendern.
     API: BSDialog.show({title, message, buttons:[{label, value, variant:'red'|'gray',
          disabled, focus}]}) -> Promise<value|null (Esc)>
          BSDialog.confirm({title, message, confirmLabel, cancelLabel, danger}) -> Promise<boolean>
     Der destruktive Button erhaelt nie den Default-Fokus. ═══ */
  (function() {
    const dlg = document.getElementById('bsDialog');
    const elTitle = document.getElementById('bsDialogTitle');
    const elBody = document.getElementById('bsDialogBody');
    const elActions = document.getElementById('bsDialogActions');
    let resolver = null;

    function settle(value) {
      if (!resolver) return;
      const r = resolver;
      resolver = null;
      if (dlg.open) dlg.close();
      r(value);
    }

    dlg.addEventListener('cancel', function(e) { e.preventDefault(); settle(null); }); /* Esc */

    function show(opts) {
      elTitle.textContent = opts.title || '';
      elBody.textContent = opts.message || '';
      elActions.innerHTML = '';
      let focusBtn = null;
      (opts.buttons || []).forEach(function(b) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bs-btn ' + (b.variant === 'red' ? 'bs-btn--red' : 'bs-btn--gray');
        btn.textContent = b.label;
        if (b.disabled) btn.disabled = true;
        btn.addEventListener('click', function() { settle(b.value); });
        elActions.appendChild(btn);
        if (b.focus && !b.disabled) focusBtn = btn;
      });
      return new Promise(function(res) {
        resolver = res;
        dlg.showModal();
        if (focusBtn) focusBtn.focus();
      });
    }

    function confirm(opts) {
      return show({
        title: opts.title || 'Best\u00e4tigen',
        message: opts.message || '',
        buttons: [
          { label: opts.cancelLabel || 'Abbrechen', value: false, variant: 'gray', focus: true },
          { label: opts.confirmLabel || 'OK', value: true, variant: opts.danger ? 'red' : 'gray' }
        ]
      }).then(function(v) { return v === true; });
    }

    window.BSDialog = { show: show, confirm: confirm };
  })();
