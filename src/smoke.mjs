// Real Chromium renderer + IPC, using isolated demo data. No game files or screen capture.
export async function verifyUI(window, panels, demo) {
  const scenario = async () => {
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async predicate => {
      for (let i = 0; i < 120; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)); }
      throw new Error('Timed out waiting for renderer update: ' + predicate);
    };
    const $ = selector => document.querySelector(selector);
    const click = async node => { assert(node, 'Missing action'); await wait(() => !node.disabled); node.click(); };
    const button = (root, title) => [...root.querySelectorAll('button')].find(b => b.textContent === title);
    const submit = async (root, values) => {
      const form = root.querySelector('form.bench-form'); assert(form, 'Missing form');
      for (const [name, value] of Object.entries(values)) form.querySelector('[name="' + name + '"]').value = value;
      await wait(() => !form.querySelector('button[type=submit]').disabled); form.requestSubmit();
    };
    await wait(() => $('#mode-badge').textContent === 'DEMO DATA' && $('#goal-preview')?.children.length);
    $('#day-select').value = ''; $('#day-select').dispatchEvent(new Event('change'));
    assert($('#stat-items').textContent === '6', 'Demo totals must initialize');
    assert($('.sidebar nav').querySelectorAll('button').length === 5, 'Keep the five deliberate destinations, including the requested Market tab');
    assert(window.require === undefined, 'Renderer must not have Node');
    const initial = await window.companion.getSnapshot();
    assert(initial.ok && initial.value.demo && initial.value.sourceId === 'demo', 'Demo bridge must initialize');
    assert(initial.value.sessions.some(s => s.kind === 'automatic'), 'Sessions must be logged without manual start/stop');
    const info = await window.companion.appInfo();
    assert(info.ok && info.value.update.state === 'disabled', 'Smoke builds must never request app updates');
    await wait(() => $('#app-version').textContent.includes(info.value.version));
    const diagnostics = await window.companion.exportDiagnostics();
    assert(diagnostics.ok && diagnostics.value.version === info.value.version, 'Diagnostics must contain the real app version');
    assert(!JSON.stringify(diagnostics.value).includes('Rowan') && !('directory' in diagnostics.value), 'Diagnostics must exclude character data and paths');
    assert(!(await window.companion.openAppLink('https://example.invalid')).ok, 'Support bridge must reject arbitrary links');
    await click($('[data-page=settings]'));
    assert($('#workbench').textContent.includes('About & updates') && $('#workbench').textContent.includes('Unsigned build'), 'Preferences must show update controls and accurate signing status');
    await click($('[data-view=All]'));
    await click($('[data-page=market]'));
    await wait(() => $('#workbench .market-results')?.textContent.includes('Rat Tooth'));
    await click(button($('#workbench'), 'Buying'));
    assert($('#workbench .market-results').textContent.includes('40 cp'), 'Market must show player bids');
    await click(button($('#workbench'), 'Your recorded loot'));
    assert($('#workbench .market-results').textContent.includes('50 cp'), 'Market must match own recorded loot');
    await click($('[data-view=All]'));

    // Understand a find and turn it into an actionable collection goal.
    const tooth = [...document.querySelectorAll('#items .item-link')].find(b => b.textContent === 'Rat Tooth');
    await click(tooth);
    await wait(() => $('#detail-dialog').open);
    assert($('#detail-dialog').textContent.includes('Leila Ghasem'), 'Item context must explain a quest use');
    assert($('#detail-dialog').textContent.includes('9 cp'), 'Item context must show observed vendor value');
    await wait(() => $('#detail-dialog .item-market')?.textContent.includes('50 cp'));
    assert($('#detail-dialog .item-market').textContent.includes('40 cp'), 'Item context must show same-server player asks and bids separately from vendors');
    assert(button($('#detail-dialog'), 'Open item wiki ↗'), 'The item must have an external wiki action');
    await click(button($('#detail-dialog'), 'See matching listings'));
    assert($('#detail-dialog').textContent.includes('Invented seller') && $('#detail-dialog').textContent.includes('Invented buyer'), 'Matching seller and buyer observations must be accessible from a find');
    await click(button($('#detail-dialog'), 'Item uses & your notes'));
    await click(button($('#detail-dialog'), 'Add collection goal'));
    await submit($('#detail-dialog'), { target: '2' });
    await wait(() => !$('#detail-dialog').open);
    await click($('[data-page=goals]'));
    assert($('#workbench').textContent.includes('Rat Tooth'), 'Goal must appear as a task');
    assert(!$('#workbench table'), 'Goals must not be a database table');
    await click(button($('#workbench'), 'Adjust progress'));
    await submit($('#detail-dialog'), { adjustment: '1' });
    await wait(() => !$('#detail-dialog').open);
    const goal = (await window.companion.getSnapshot()).value.goals[0];
    assert(goal.progress.current === 1 && goal.target === 2, 'Corrections must update useful goal progress');
    await click(button($('#workbench'), 'Item details'));
    assert($('#detail-dialog .goal-progress').textContent.includes('1 / 2'), 'The item decision must include current goal progress');
    $('#detail-dialog').close();

    // Notes render as text, never executable HTML.
    await click($('[data-page=notebook]'));
    await click(button($('#workbench'), 'Write a note'));
    await submit($('#detail-dialog'), { subject: 'A useful memory', body: '<img src=x onerror=alert(1)> keep as text' });
    await wait(() => !$('#detail-dialog').open);
    assert($('#workbench').textContent.includes('<img src=x'), 'Note must remain plain text');
    assert(!$('#workbench img'), 'Note must not become an image element');

    // Correct automatic grouping through the same controls a player uses.
    await click($('[data-view=All]')); await click($('#past-adventures'));
    await click(button($('#detail-dialog'), 'Split session…'));
    assert($('#detail-dialog').textContent.includes('records in the first session'), 'Split must preview both sides');
    await submit($('#detail-dialog'), {});
    await wait(() => Boolean(button($('#detail-dialog'), 'Merge with previous…')));
    assert((await window.companion.getSnapshot()).value.sessions.filter(s => s.kind === 'automatic').length === 2, 'Split must create two automatic sessions');
    await click(button($('#detail-dialog'), 'Merge with previous…'));
    await click(button($('#detail-dialog'), 'Merge these sessions'));
    await wait(() => Boolean(button($('#detail-dialog'), 'Restore automatic grouping')));
    assert((await window.companion.getSnapshot()).value.sessions.filter(s => s.kind === 'automatic').length === 1, 'Merge must join neighbouring sessions');
    await click(button($('#detail-dialog'), 'Restore automatic grouping'));
    await wait(() => !button($('#detail-dialog'), 'Restore automatic grouping'));
    $('#detail-dialog').close();

    // Solo hunts default to one member; a completed hunt can become a group settlement.
    await click($('[data-view=All]'));
    await click($('#start-adventure'));
    const yesterday = new Date(Date.now() - 86400000);
    const local = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await submit($('#detail-dialog'), { name: 'Smoke adventure', start: local });
    await wait(() => !$('#detail-dialog').open && !$('#end-adventure').hidden);
    assert(!$('#ledger-dashboard').hidden && $('#session-select').value, 'Starting a hunt must open its dashboard');
    await click($('#end-adventure'));
    await wait(() => $('#end-adventure').hidden && $('#detail-dialog').textContent.includes('Solo hunt'));
    assert(!button($('#detail-dialog'), 'Copy settlement'), 'Solo hunts must not offer group settlement');
    await click(button($('#detail-dialog'), 'Add group members'));
    await submit($('#detail-dialog'), { members: 'Rowan\nMira\nThorne\nElowen\nBram\nSable' });
    await wait(() => $('#detail-dialog').textContent.includes('6 hunt members'));
    assert($('#detail-dialog').textContent.includes('Sable'), 'Members with no loot must remain in the split');
    assert(!button($('#detail-dialog'), 'Copy settlement'), 'Unpriced items must block settlement copying');
    for (const item of ['Rat Tooth', 'Bone Chips', 'Wool Scraps', 'Crocodile Tooth', 'Weathered Medallion']) {
      const form = [...document.querySelectorAll('#detail-dialog form.bench-form')].find(f => f.textContent.includes(item));
      form.closest('details').open = true;
      form.querySelector('[name=mode]').value = 'custom'; form.querySelector('[name=unit]').value = '100';
      form.requestSubmit(); await wait(() => !form.isConnected);
    }
    const preview = $('#detail-dialog .hunt-message');
    assert(preview && preview.textContent.includes('Loot value 6s (1s each)'), 'The copied summary must use the group item total and equal share');
    assert(preview.textContent.length <= 240 && !preview.textContent.includes('coin'), 'Game chat must be short and item-only');
    assert(button($('#detail-dialog'), 'Copy settlement'), 'A priced group hunt must offer a settlement');
    // Inspect the preview only: smoke tests must never write to the real clipboard.
    $('#detail-dialog').close();
    await click($('#past-adventures'));
    await click(button($('#detail-dialog'), 'Revisit'));
    assert(!$('#detail-dialog').open && !$('#ledger-dashboard').hidden, 'Revisit must open the run, not leave a data table');
    assert($('#stat-items').textContent === '6', 'The saved run must retain its finds');

    await click($('#start-adventure'));
    await submit($('#detail-dialog'), { name: 'A second run' });
    await wait(() => !$('#detail-dialog').open && !$('#end-adventure').hidden);
    await click($('#end-adventure')); await wait(() => $('#end-adventure').hidden);
    await wait(() => $('#detail-dialog').textContent.includes('Solo hunt'));
    assert(button($('#detail-dialog'), 'Copy hunt summary'), 'An empty solo hunt can copy a summary without payments');
    $('#detail-dialog').close();
    await click($('#past-adventures'));
    const saved = (await window.companion.getSnapshot()).value.sessions.filter(s => s.kind !== 'automatic');
    await submit($('#detail-dialog'), { a: saved[0].id, b: saved[1].id });
    assert($('#detail-dialog .comparison-result').textContent.includes('Smoke adventure'), 'Comparison must include the chosen first run');
    assert($('#detail-dialog .comparison-result').textContent.includes('A second run'), 'Comparison must include the chosen second run');
    $('#detail-dialog').close();
    $('#session-select').value = saved[0].id; $('#session-select').dispatchEvent(new Event('change'));

    await click(button($('#feed'), 'Save moment'));
    await submit($('#detail-dialog'), { label: 'First evening together' });
    await wait(() => !$('#detail-dialog').open);
    assert((await window.companion.getSnapshot()).value.bookmarks.length === 1, 'Moments must be saved');
    $('#activity-filter').value = 'Harvest'; $('#activity-filter').dispatchEvent(new Event('change'));
    assert($('#activity-summary').textContent.includes('gathered'), 'Gathering filter must explain pace and value');

    // Quick timer access, with setup kept out of the main navigation.
    await click($('#open-timers'));
    await click(button($('#detail-dialog'), 'Set up timers & alerts'));
    await submit($('#detail-dialog'), { name: 'Smoke timer', seconds: '1' });
    await wait(() => $('#detail-dialog table')?.textContent.includes('Smoke timer'));
    await click(button($('#detail-dialog'), 'Start / reset'));
    await wait(() => [...document.querySelectorAll('.timer-remaining')].some(e => e.textContent === 'Ended'));
    const expired = await window.companion.getSnapshot();
    assert(expired.value.notifications.some(n => n.message.includes('Smoke timer ended')), 'Expired timers must notify');
    $('#detail-dialog').close();
    assert(!(await window.companion.action('follow:set', { enabled: true })).ok, 'Demo must never follow real characters');
    assert(!(await window.companion.action('arbitrary:command', {})).ok, 'Unknown operations must be rejected');
    assert(!(await window.companion.action('note:save', { kind: 'item', subject: 'Wrong character', body: 'Do not save' }, 'stale-source')).ok,
      'A stale panel must not write to a different character');
    assert((await window.companion.action('session:start', { name: 'Overlay hunt', startedAt: yesterday.getTime(), members: ['Mira'] }, 'demo')).ok, 'Prepare an invented live hunt for the overlay');
    for (const kind of ['loot', 'hunt', 'session', 'timers', 'map']) {
      assert((await window.companion.getSnapshot()).value.overlaySettings[kind].background === 100, 'New overlays must default to fully opaque backgrounds');
      assert((await window.companion.openPanel(kind)).ok, 'Compact panel must open');
      assert((await window.companion.configurePanel(kind, 20, true)).ok, 'Overlay background preferences must apply');
    }
    const audio = new Audio('app://neverquest/sounds/bell'); audio.muted = true; audio.load();
    await wait(() => audio.readyState >= 2);
    return true;
  };
  await window.webContents.executeJavaScript('(' + scenario.toString() + ')()');
  window.setBounds({ width: 1050, height: 760 });
  await new Promise(r => setTimeout(r, 750));
  const layout = await window.webContents.executeJavaScript('window.companion.getSnapshot()');
  if (layout.value.profile.bounds?.width !== 1050) throw new Error('Own-window layout must be saved');
  await window.webContents.executeJavaScript("window.companion.action('profile:save', { opacity: 90, pinned: false })");
  if (Math.abs(window.getOpacity() - 0.9) > 0.01) throw new Error('Main-window appearance preference did not apply');
  for (const [kind, panel] of panels) {
    const deadline = Date.now() + 5000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      ready = await panel.webContents.executeJavaScript("document.querySelector('#overlay')?.dataset.shade === '20' && document.querySelector('#overlay-source')?.textContent.includes('Rowan')").catch(() => false);
      if (!ready) await new Promise(r => setTimeout(r, 50));
    }
    if (!ready) throw new Error('Compact ' + kind + ' panel did not render');
    if (!panel.isAlwaysOnTop() || panel.getOpacity() !== 1) throw new Error('Background settings must never fade the whole overlay');
    const appearance = await panel.webContents.executeJavaScript(`({
      background: getComputedStyle(document.querySelector('#overlay')).backgroundColor,
      opacity: getComputedStyle(document.querySelector('#overlay')).opacity,
      overflow: getComputedStyle(document.body).overflow,
      dashboard: !!document.querySelector('#ledger-dashboard'),
      controls: ['overlay-close', 'overlay-pin', 'overlay-settings', 'resize-grip'].every(id => !!document.getElementById(id))
    })`);
    if (!appearance.background.endsWith('0.2)') || appearance.opacity !== '1' || appearance.overflow !== 'hidden'
        || appearance.dashboard || !appearance.controls) throw new Error('Overlay must have solid content, a faint background and its own minimal controls');
    const fullBackground = await panel.webContents.executeJavaScript(`(async () => {
      const slider = document.querySelector('#background-opacity');
      if (slider.max !== '100') throw new Error('Background slider must allow 100 percent');
      slider.value = '100'; slider.dispatchEvent(new Event('input'));
      const result = await window.companion.configurePanel(new URL(location.href).searchParams.get('panel'), 100, true);
      return result.ok && result.value.background === 100
        && getComputedStyle(document.querySelector('#overlay')).backgroundColor === 'rgb(5, 13, 15)';
    })()`);
    if (!fullBackground || panel.getOpacity() !== 1) throw new Error('Every overlay must support an opaque background with solid content');
    const stablePoll = await panel.webContents.executeJavaScript(`(async () => {
      const content = document.querySelector('#overlay-content'), first = content.firstElementChild;
      document.querySelector('#overlay-settings').click();
      const settings = document.querySelector('#background-settings');
      await new Promise(resolve => setTimeout(resolve, 2300));
      return content.firstElementChild === first && !settings.hidden
        && getComputedStyle(document.querySelector('.overlay-controls')).opacity === '1';
    })()`);
    if (!stablePoll) throw new Error('Polling must preserve overlay content, open settings and solid controls');
    if (kind === 'hunt') {
      const huntChecks = await panel.webContents.executeJavaScript(`(async () => {
        const wait = async predicate => {
          for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
          throw new Error('Hunt overlay did not update');
        };
        const content = document.querySelector('#overlay-content');
        if (!content.textContent.includes('Overlay hunt') || !content.textContent.includes('Mira')
          || !content.textContent.includes('Copy running summary')) throw new Error('Live hunt must show its members and running copy action');
        if (content.querySelector('.hunt-payment')) throw new Error('Unpriced loot must not produce payments');
        const input = content.querySelector('.hunt-member-form input');
        input.focus(); input.value = 'Thorne';
        const state = (await window.companion.getSnapshot()).value;
        const hunt = state.sessions.find(s => s.kind !== 'automatic' && s.endedAt === null);
        await window.companion.action('hunt:add-member', { id: hunt.id, name: 'Elowen' }, state.sourceId);
        await new Promise(resolve => setTimeout(resolve, 2300));
        if (!input.isConnected || document.activeElement !== input || input.value !== 'Thorne')
          throw new Error('Polling must preserve a member name being typed');
        input.form.requestSubmit();
        await wait(() => content.textContent.includes('Thorne') && content.textContent.includes('Elowen'));
        const remove = content.querySelector('[aria-label="Remove Thorne from hunt"]');
        if (!remove) throw new Error('Overlay must offer member removal'); remove.click();
        await wait(() => !content.querySelector('[aria-label="Remove Thorne from hunt"]'));
        for (const item of ['Rat Tooth', 'Bone Chips', 'Wool Scraps', 'Weathered Medallion']) {
          const result = await window.companion.action('hunt:price', { id: hunt.id, item, mode: 'custom', unit: 100 }, state.sourceId);
          if (!result.ok) throw new Error(result.error);
        }
        await wait(() => !!content.querySelector('.hunt-payment'));
        const details = [...content.querySelectorAll('button')].find(b => b.textContent === 'Hunt details'); details.click();
        return true;
      })()`);
      if (!huntChecks) throw new Error('Hunt overlay controls failed');
      let opened = false;
      for (let i = 0; i < 100 && !opened; i++) {
        opened = await window.webContents.executeJavaScript("document.querySelector('#detail-dialog').open && document.querySelector('#detail-dialog').textContent.includes('Overlay hunt') && !![...document.querySelectorAll('#detail-dialog button')].find(b => b.textContent === 'Copy running summary')");
        if (!opened) await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!opened) throw new Error('Overlay must open the matching live hunt in the companion');
      await window.webContents.executeJavaScript("document.querySelector('#detail-dialog').close()");
    }
    if (kind === 'map') {
      const mapReady = await panel.webContents.executeJavaScript(`(async () => {
        for (let i = 0; i < 100; i++) {
          if (document.querySelector('.map-stage image')) break;
          await new Promise(r => setTimeout(r, 50));
        }
        const svg = document.querySelector('.map-stage svg');
        if (!svg?.querySelector('image')) throw new Error('Map overlay must render its cached map');
        const cached = await window.companion.mapCatalogue();
        if (!cached.ok || cached.value.online || document.querySelector('.map-network input').checked)
          throw new Error('Smoke maps must remain offline');
        const image = new Image(); image.src = svg.querySelector('image').getAttribute('href');
        await image.decode();
        if (!image.src.startsWith('app://maps/') || image.naturalWidth !== 100)
          throw new Error('The checked fixture must decode from the isolated image origin');
        const before = svg.getAttribute('viewBox');
        [...document.querySelectorAll('.map-controls button')].find(b => b.textContent === '+').click();
        if (svg.getAttribute('viewBox') === before) throw new Error('Map zoom must change the viewport');
        [...document.querySelectorAll('.map-controls button')].find(b => b.textContent === 'Add pin').click();
        const rect = svg.getBoundingClientRect();
        svg.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
        document.querySelector('.map-pin-form input').value = 'Smoke private pin';
        document.querySelector('.map-pin-form').requestSubmit();
        for (let i = 0; i < 100; i++) {
          if (document.querySelectorAll('.map-stage circle').length >= 2) return true;
          await new Promise(r => setTimeout(r, 50));
        }
        throw new Error('Private map pin did not appear');
      })()`);
      if (!mapReady) throw new Error('Map overlay workflow did not complete');
      const original = demo.source.events;
      try {
        demo.source.events = [{ ...original[0], identity: 'smoke-zone-change', at: Date.now(), zone: 'shadeddunes' }, ...original];
        let missing = false;
        for (let i = 0; i < 100 && !missing; i++) {
          missing = await panel.webContents.executeJavaScript(`(() => {
            const empty = document.querySelector('.map-empty');
            return !empty.hidden && empty.textContent.includes('No cached map found')
              && !document.querySelector('.map-stage image') && !document.querySelector('.map-stage circle')
              && [...document.querySelectorAll('.map-controls button')].find(b => b.textContent === 'Add pin').disabled;
          })()`);
          if (!missing) await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!missing) throw new Error('A zone without a cached image must replace the old map and pins with an empty state');
      } finally { demo.source.events = original; }
    }
  }
}
