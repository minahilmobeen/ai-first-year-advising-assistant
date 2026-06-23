/* ════════════════════════════════════════════════════════════════════
   apps.js — First-Year Advising Assistant
   All interactive behaviour: search, profile rendering, suggestions,
   detail panel, modal, and toast.
══════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════
   APP STATE
════════════════════════════════════════════════════════════════ */
let currentStudent     = null;
let currentSuggestions = null;
let genedFilterState   = {};     // code → bool
let currentGenedTab    = 'courses';
const selectedItems    = new Map(); // itemId → { name, displayType }
const majorCoursePanelsOpen         = new Set();
const majorConcentrationPanelsOpen  = new Set();
const genedAreaCoursePanelsOpen     = new Set();
let fySearchQuery      = '';

// Multi-select component state
const msState  = {};   // containerId → { options, selected: Set, max }
let   _msOpenId = null; // id of currently open dropdown


/* ════════════════════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════════════════════ */
function extractGenedCode(name) {
  const m = String(name).match(/\(([^)]+)\)$/);
  return m ? m[1] : name;
}


function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function genedBadgesHtml(geneds) {
  if (!geneds || geneds.length === 0) return '';
  return geneds.map(g => `<span class="badge badge-green gened-code-badge">${escHtml(g)}</span>`).join(' ');
}


/* ════════════════════════════════════════════════════════════════
   SUGGESTION GENERATOR
════════════════════════════════════════════════════════════════ */
function generateSuggestions(student) {
  const recs = student.recommendations;

  function formatMajors(options) {
    const seen = new Set();
    return (options || []).filter(opt => {
      const key = (opt.option_name || '').trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(opt => ({
      name:                   opt.option_name,
      level:                  opt.level || '',
      description:            '',
      whyRecommended:         [opt.reasons],
      additionalNotes:        opt.additional_notes || null,
      concentrations:         opt.concentrations || [],
      suggestedConcentration: opt.suggested_concentration || null,
      courses: (opt.courses || []).map(c => ({
        code:   c.code,
        name:   c.name,
        number: '',
        gen_ed: c.gen_ed || '',
      })),
    }));
  }

  function formatFys(options) {
    return (options || []).map(opt => ({
      name:            opt.option_name,
      description:     opt.description || '',
      whyRecommended:  opt.reasons ? [opt.reasons] : [],
      additionalNotes: null,
      courses:         [],
    }));
  }

  function formatGenedAreas(options) {
    return (options || []).map(opt => {
      const code = extractGenedCode(opt.option_name);
      return {
        name:            opt.option_name,
        code:            code,
        description:     opt.description || '',
        whyRecommended:  [opt.reasons],
        additionalNotes: null,
        courses:         [],
      };
    });
  }

  function formatGenedCourses(options) {
    return (options || []).map(opt => ({
      name:           opt.option_name,
      description:    opt.description || '',
      geneds:         opt.geneds || [],
      whyRecommended: [opt.reasons],
    }));
  }

  return {
    majors:       formatMajors(recs.majors),
    fys:          formatFys(recs.fys),
    geneds:       formatGenedAreas(recs.genedAreas),
    genedCourses: formatGenedCourses(recs.genedCourses || []),
  };
}




/* ════════════════════════════════════════════════════════════════
   MULTI-SELECT COMPONENT
════════════════════════════════════════════════════════════════ */
function initMs(id, options, selected, max) {
  msState[id] = { options, selected: new Set(selected), max };
  _renderMs(id);
}

function _renderMs(id) {
  const state = msState[id];
  const el    = document.getElementById(id);
  if (!el) return;

  const tags = [...state.selected].map(v => `
    <span class="ms-tag">
      ${escHtml(v)}
      <button class="ms-tag-rm" type="button"
              data-ms-id="${escHtml(id)}" data-ms-val="${escHtml(v)}"
              onclick="msRemoveTag(this); event.stopPropagation()">×</button>
    </span>
  `).join('');

  el.innerHTML = `
    <div class="ms-control" onclick="msToggle(this.parentElement.id)">
      <div class="ms-tags-wrap">
        ${tags || `<span class="ms-placeholder">Select…</span>`}
      </div>
      <span class="ms-chevron" aria-hidden="true">⌄</span>
    </div>
    <div class="ms-dropdown" id="${id}-drop" style="display:none">
      <div class="ms-search-wrap">
        <input class="ms-search" type="text" placeholder="Search…" id="${id}-search"
               data-ms-id="${escHtml(id)}"
               oninput="msSearchInput(this)"
               onclick="event.stopPropagation()">
      </div>
      <div class="ms-list" id="${id}-list"></div>
    </div>
  `;
  _renderMsOptions(id, '');
}

function _renderMsOptions(id, query) {
  const state = msState[id];
  const list  = document.getElementById(`${id}-list`);
  if (!list) return;

  const q        = (query || '').toLowerCase();
  const filtered = state.options.filter(opt => !q || opt.toLowerCase().includes(q));

  list.innerHTML = filtered.map(opt => {
    const chk = state.selected.has(opt);
    const dis = !chk && state.selected.size >= state.max;
    return `
      <label class="ms-option${chk ? ' ms-selected' : ''}${dis ? ' ms-disabled' : ''}">
        <input type="checkbox" ${chk ? 'checked' : ''} ${dis ? 'disabled' : ''}
               data-ms-id="${escHtml(id)}" data-ms-val="${escHtml(opt)}"
               onchange="msPickOption(this)"
               onclick="event.stopPropagation()">
        ${escHtml(opt)}
      </label>
    `;
  }).join('');
}

function msToggle(id) {
  if (_msOpenId && _msOpenId !== id) {
    const other = document.getElementById(`${_msOpenId}-drop`);
    if (other) other.style.display = 'none';
    _msOpenId = null;
  }
  const drop = document.getElementById(`${id}-drop`);
  if (!drop) return;
  const opening = drop.style.display === 'none';
  drop.style.display = opening ? 'block' : 'none';
  _msOpenId = opening ? id : null;
  if (opening) document.getElementById(`${id}-search`)?.focus();
}

function _msPick(id, value, checked) {
  const state = msState[id];
  if (checked && state.selected.size < state.max) {
    state.selected.add(value);
  } else if (!checked) {
    state.selected.delete(value);
  }
  // Refresh tags in the control without closing the dropdown
  const el    = document.getElementById(id);
  const wrap  = el?.querySelector('.ms-tags-wrap');
  if (wrap) {
    const tags = [...state.selected].map(v => `
      <span class="ms-tag">
        ${escHtml(v)}
        <button class="ms-tag-rm" type="button"
                data-ms-id="${escHtml(id)}" data-ms-val="${escHtml(v)}"
                onclick="msRemoveTag(this); event.stopPropagation()">×</button>
      </span>
    `).join('');
    wrap.innerHTML = tags || `<span class="ms-placeholder">Select…</span>`;
  }
  // Refresh option list (updates checked + disabled states)
  const search = document.getElementById(`${id}-search`);
  _renderMsOptions(id, search?.value || '');
}

function msRemoveTag(btn) {
  msRemove(btn.dataset.msId, btn.dataset.msVal);
}

function msSearchInput(input) {
  _renderMsOptions(input.dataset.msId, input.value);
}

function msPickOption(input) {
  _msPick(input.dataset.msId, input.dataset.msVal, input.checked);
}

function msRemove(id, value) {
  const state = msState[id];
  if (!state) return;
  state.selected.delete(value);
  _renderMs(id);
  // If dropdown was open, re-open it
  if (_msOpenId === id) {
    const drop = document.getElementById(`${id}-drop`);
    if (drop) drop.style.display = 'block';
  }
}

function _msCloseAll() {
  if (_msOpenId) {
    const drop = document.getElementById(`${_msOpenId}-drop`);
    if (drop) drop.style.display = 'none';
    _msOpenId = null;
  }
}


/* ════════════════════════════════════════════════════════════════
   STUDENT PROFILE SUMMARY (editable)
════════════════════════════════════════════════════════════════ */
function renderStudentProfile(student) {
  const p    = student.profile || {};
  const body = document.getElementById('student-profile-body');

  body.innerHTML = `
    <div class="student-profile-card">

      <div class="student-profile-row">
        <div class="student-profile-label">
          Academic Interests
          <div class="student-profile-sublabel">Select up to 2</div>
        </div>
        <div class="student-profile-value">
          <div class="ms-container" id="ms-academic"></div>
        </div>
      </div>

      <div class="student-profile-divider"></div>

      <div class="student-profile-row">
        <div class="student-profile-label">
          Other Interests
          <div class="student-profile-sublabel">Select up to 5</div>
        </div>
        <div class="student-profile-value">
          <div class="ms-container" id="ms-other"></div>
        </div>
      </div>

      <div class="student-profile-divider"></div>

      <div class="student-profile-row">
        <div class="student-profile-label">Hobbies &amp; Recreation*</div>
        <div class="student-profile-value">
          <textarea class="profile-text-input" id="profile-recreation" rows="2">${escHtml(p.recreation || '')}</textarea>
        </div>
      </div>

      <div class="student-profile-divider"></div>

      <div class="student-profile-row">
        <div class="student-profile-label">Employment*</div>
        <div class="student-profile-value">
          <input class="profile-text-input" type="text" id="profile-employment"
                 value="${escHtml(p.employment || '')}">
        </div>
      </div>

      <div class="student-profile-divider"></div>

      <div class="student-profile-row">
        <div class="student-profile-label">Additional Information</div>
        <div class="student-profile-value">
          <textarea class="profile-text-input" id="profile-additional" rows="3"
                    placeholder="Any additional context that may help generate recommendations…"
          >${escHtml(p.additionalInfo || '')}</textarea>
        </div>
      </div>

      <div class="student-profile-divider"></div>

      <div class="student-profile-update-row">
        <button class="profile-update-btn" id="profile-update-btn" onclick="updateRecommendations()">
          Update Recommendations
        </button>
      </div>

      <div class="student-profile-privacy-note">*For privacy reasons, hobbies/recreation activities and employment information have been summarized instead of being provided verbatim. If information is updated, please ensure that you provide no private or personally identifiable information since it will be shared with an AI system to generate recommendations.</div>
    </div>
  `;

  // Initialise multi-selects after HTML is in the DOM
  const opts = window.__OPTIONS__ || {};
  initMs('ms-academic', opts.academicInterests || [], p.academicInterests || [], 2);
  initMs('ms-other',    opts.otherInterests    || [], p.topInterests      || [], 5);
}


/* ════════════════════════════════════════════════════════════════
   UPDATE RECOMMENDATIONS
════════════════════════════════════════════════════════════════ */
async function updateRecommendations() {
  const btn = document.getElementById('profile-update-btn');
  if (!btn || !currentStudent) return;

  const academic       = [...(msState['ms-academic']?.selected || [])];
  const other          = [...(msState['ms-other']?.selected    || [])];
  const rec            = document.getElementById('profile-recreation')?.value  || '';
  const emp            = document.getElementById('profile-employment')?.value   || '';
  const additionalInfo = document.getElementById('profile-additional')?.value   || '';

  if (academic.length === 0) {
    showToast('Please select at least one Academic Interest.');
    return;
  }

  // Show loading state
  btn.disabled    = true;
  btn.textContent = 'Updating… This may take 90-120 seconds.';

  const leftPanel = document.getElementById('profile-left');
  const overlay   = document.createElement('div');
  overlay.id        = 'regen-loading-overlay';
  overlay.className = 'regen-loading-overlay';
  overlay.innerHTML = `
    <div class="regen-loading-spinner"></div>
    <p class="regen-loading-msg">Updating...This will take 90-120 seconds.</p>
  `;
  if (leftPanel) {
    leftPanel.style.position = 'relative';
    leftPanel.appendChild(overlay);
  }

  const cycleMessages = [
    'Compiling profile to create recommendations…',
    'Searching through major options…',
    'Constructing major recommendations…',
    'Exploring Gen-Ed areas…',
    'Matching areas to student profile…',
    'Finding Gen-Ed course matches…',
    'Searching FYS course options…',
    'Finalizing recommendations… Almost there!',
  ];
  let cycleIdx = 0;
  const msgEl = overlay.querySelector('.regen-loading-msg');
  const cycleTimer = setInterval(() => {
    if (msgEl) msgEl.textContent = cycleMessages[cycleIdx % cycleMessages.length];
    cycleIdx++;
  }, 10000);

  try {
    const resp = await fetch('/api/regen', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id:                currentStudent.student_id,
        academicInterests: academic,
        topInterests:      other,
        recreation:        rec,
        employment:        emp,
        additionalInfo,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Server error ${resp.status}`);
    }

    const data = await resp.json();

    // Update in-memory profile and recommendations
    currentStudent.profile.academicInterests = academic;
    currentStudent.profile.topInterests      = other;
    currentStudent.profile.recreation        = rec;
    currentStudent.profile.employment        = emp;
    currentStudent.profile.additionalInfo    = additionalInfo;
    currentStudent.recommendations           = data.recommendations;

    // Re-render all suggestion panels
    currentSuggestions = generateSuggestions(currentStudent);
    majorCoursePanelsOpen.clear();
    majorConcentrationPanelsOpen.clear();
    genedAreaCoursePanelsOpen.clear();
    renderFysSuggestions();
    renderMajorSuggestions();
    renderGenedTabs();
    resetDetailPanel();

    showToast('Recommendations updated successfully.');
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    clearInterval(cycleTimer);
    btn.disabled    = false;
    btn.textContent = 'Update Recommendations';
    document.getElementById('regen-loading-overlay')?.remove();
    if (leftPanel) leftPanel.style.position = '';
  }
}


/* ════════════════════════════════════════════════════════════════
   PROFILE RENDERING
════════════════════════════════════════════════════════════════ */
function loadProfile(student) {
  renderStudentProfile(student);
  document.getElementById('profile-empty-state').style.display  = 'none';
  document.getElementById('profile-layout').style.display       = '';

  currentSuggestions = generateSuggestions(student);
  majorCoursePanelsOpen.clear();
  majorConcentrationPanelsOpen.clear();
  genedAreaCoursePanelsOpen.clear();
  fySearchQuery = '';

  renderFysSuggestions();
  renderMajorSuggestions();
  renderGenedTabs();

  renderFirstYearCourses();
  resetDetailPanel();
  navTo('acc-profile');
}


/* ════════════════════════════════════════════════════════════════
   FYS SUGGESTIONS — all items shown, inline "Add" checkbox
════════════════════════════════════════════════════════════════ */
function renderFysSuggestions() {
  const container = document.getElementById('fys-list');
  const items     = currentSuggestions.fys;

  container.innerHTML = '<div class="suggestion-list">' +
    items.map((item, i) => {
      const itemId    = `fys-${i}`;
      const isChecked = selectedItems.has(itemId);
      return `
        <div class="suggestion-item" id="sug-fys-${i}" onclick="selectSuggestion('fys', ${i})">
          <div class="suggestion-rank">${i + 1}</div>
          <div class="suggestion-text">
            <div class="suggestion-name">${escHtml(item.name)}</div>
          </div>
          <label class="inline-add-label" onclick="event.stopPropagation()" title="Add to selected list">
            <input type="checkbox" id="inline-cb-${escHtml(itemId)}"
                   data-item-id="${escHtml(itemId)}"
                   data-item-name="${escHtml(item.name)}"
                   data-display-type="FYS"
                   ${isChecked ? 'checked' : ''}
                   onchange="handleInlineCheckbox(this)">
            <span>Add to list</span>
          </label>
          <span class="suggestion-arrow" aria-hidden="true">›</span>
        </div>
      `;
    }).join('') +
  '</div>';
}


/* ════════════════════════════════════════════════════════════════
   MAJOR SUGGESTIONS — all items shown
   Each item: inline "Add" checkbox + "View Courses" sub-panel
════════════════════════════════════════════════════════════════ */
function renderMajorSuggestions() {
  const container = document.getElementById('major-list');
  const items     = currentSuggestions.majors;

  container.innerHTML = '<div class="suggestion-list">' +
    items.map((item, i) => renderMajorItem(item, i)).join('') +
  '</div>';
}

function renderMajorItem(item, i) {
  const panelOpen = majorCoursePanelsOpen.has(i);

  const coursesPanelHtml = item.courses.length > 0 ? `
    <div class="major-courses-panel${panelOpen ? ' open' : ''}" id="major-courses-panel-${i}">
      ${item.courses.map((c, ci) => {
        const courseId   = `major-${i}-course-${ci}`;
        const courseName = c.code + (c.name ? ' – ' + c.name : '');
        const isCourseChecked = selectedItems.has(courseId);
        const genedHtml  = c.gen_ed
          ? genedBadgesHtml(c.gen_ed.split(',').map(g => g.trim()).filter(Boolean))
          : '';
        return `
          <div class="major-course-row" onclick="event.stopPropagation(); selectMajorCourse(${i}, ${ci})">
            <span class="major-course-name">${escHtml(courseName)}</span>
            ${genedHtml ? `<span class="major-course-geneds">${genedHtml}</span>` : ''}
            <label class="inline-add-label" onclick="event.stopPropagation()" title="Add to selected list">
              <input type="checkbox" class="major-course-cb"
                     data-item-id="${escHtml(courseId)}"
                     data-item-name="${escHtml(courseName)}"
                     data-display-type="Major Course"
                     ${isCourseChecked ? 'checked' : ''}
                     onchange="handleInlineCheckbox(this)">
              <span>Add to list</span>
            </label>
            <span class="suggestion-arrow" aria-hidden="true">›</span>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="suggestion-item" id="sug-major-${i}" onclick="selectSuggestion('major', ${i})">
      <div class="suggestion-rank">${i + 1}</div>
      <div class="suggestion-text">
        <div class="suggestion-name">${escHtml(item.name)}</div>
      </div>
      ${item.courses.length > 0 ? `
        <button class="view-courses-btn" id="view-courses-btn-${i}"
                onclick="event.stopPropagation(); toggleMajorCourses(${i}); selectSuggestion('major', ${i})">
          ${panelOpen ? 'Hide' : 'View'} Courses
        </button>
      ` : ''}
      <span class="suggestion-arrow" aria-hidden="true">›</span>
    </div>
    ${coursesPanelHtml}
  `;
}

function toggleMajorCourses(i) {
  const panel = document.getElementById(`major-courses-panel-${i}`);
  const btn   = document.getElementById(`view-courses-btn-${i}`);
  if (!panel) return;

  if (majorCoursePanelsOpen.has(i)) {
    majorCoursePanelsOpen.delete(i);
    panel.classList.remove('open');
    if (btn) btn.textContent = 'View Courses';
  } else {
    majorCoursePanelsOpen.add(i);
    panel.classList.add('open');
    if (btn) btn.textContent = 'Hide Courses';
  }
}

function toggleMajorConcentrations(i) {
  const panel = document.getElementById(`major-conc-panel-${i}`);
  const btn   = document.getElementById(`view-conc-btn-${i}`);
  if (!panel) return;

  if (majorConcentrationPanelsOpen.has(i)) {
    majorConcentrationPanelsOpen.delete(i);
    panel.classList.remove('open');
    if (btn) btn.textContent = 'View Concentrations';
  } else {
    majorConcentrationPanelsOpen.add(i);
    panel.classList.add('open');
    if (btn) btn.textContent = 'Hide Concentrations';
  }
}


/* ════════════════════════════════════════════════════════════════
   FIRST-YEAR AVAILABLE COURSES
   Display matches suggestion-item style; includes search bar
════════════════════════════════════════════════════════════════ */
function renderFirstYearCourses() {
  const courses   = currentStudent?.fy_courses || [];
  const container = document.getElementById('fy-courses-body');

  if (courses.length === 0) {
    container.innerHTML = '<div style="padding:16px 22px;color:var(--text-light);font-size:.88rem">No first-year courses available.</div>';
    return;
  }

  container.innerHTML = `
    <div class="fy-search-bar">
      <input type="text"
             id="fy-course-search"
             placeholder="Search by code (ANTH), number (201), title, or attribute (AISO)…"
             oninput="filterFyCourses()"
             value="${escHtml(fySearchQuery)}">
    </div>
    <div class="suggestion-list" id="fy-courses-list">
      ${renderFyCourseItems(courses)}
    </div>
  `;
}

function renderFyCourseItems(courses) {
  const query    = fySearchQuery.trim().toLowerCase();
  const filtered = query
    ? courses.filter(c => {
        const code     = (c.subj || '').toLowerCase();
        const num      = (c.crse || '').toLowerCase();
        const title    = (c.title || '').toLowerCase();
        const attrs    = (c.geneds || []).join(' ').toLowerCase();
        const combined = `${code} ${num}`;
        return code.includes(query) || num.includes(query) || title.includes(query)
               || attrs.includes(query) || combined.includes(query);
      })
    : courses;

  if (filtered.length === 0) {
    return `<div style="padding:12px 4px;color:var(--text-light);font-size:.88rem;text-align:center">No courses match your search.</div>`;
  }

  return filtered.map((c, i) => {
    const idx         = courses.indexOf(c);
    const itemId      = `fycourse-${idx}`;
    const isChecked   = selectedItems.has(itemId);
    const displayName = `${c.subj} ${c.crse} – ${c.title}`;
    return `
      <div class="suggestion-item" onclick="selectFyCourse(${idx})">
        <div class="suggestion-rank">${i + 1}</div>
        <div class="suggestion-text">
          <div class="suggestion-name">${escHtml(c.subj)} ${escHtml(c.crse)}</div>
          <div class="suggestion-desc">${escHtml(c.title)}</div>
        </div>
        ${c.geneds && c.geneds.length ? `<span style="display:flex;gap:4px;flex-shrink:0">${genedBadgesHtml(c.geneds)}</span>` : ''}
        <label class="inline-add-label" onclick="event.stopPropagation()" title="Add to selected list">
          <input type="checkbox" id="inline-cb-${escHtml(itemId)}"
                 data-item-id="${escHtml(itemId)}"
                 data-item-name="${escHtml(displayName)}"
                 data-display-type="FY Course"
                 ${isChecked ? 'checked' : ''}
                 onchange="handleInlineCheckbox(this)">
          <span>Add to list</span>
        </label>
        <span class="suggestion-arrow" aria-hidden="true">›</span>
      </div>
    `;
  }).join('');
}

function filterFyCourses() {
  fySearchQuery    = document.getElementById('fy-course-search')?.value || '';
  const courses    = currentStudent?.fy_courses || [];
  const listEl     = document.getElementById('fy-courses-list');
  if (listEl) listEl.innerHTML = renderFyCourseItems(courses);
}

function selectFyCourse(idx) {
  const courses = currentStudent?.fy_courses || [];
  const c = courses[idx];
  if (!c) return;

  const itemId      = `fycourse-${idx}`;
  const isChecked   = selectedItems.has(itemId);
  const displayName = `${c.subj} ${c.crse} – ${c.title}`;

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('collapsed');
  panel.innerHTML = `
    <div class="detail-panel-header">
      <div style="flex:1">
        <div class="detail-panel-title">${escHtml(c.title)}</div>
      </div>
      <label class="detail-select-label" title="Add to selected list">
        <input type="checkbox" id="detail-cb-${escHtml(itemId)}"
               data-item-id="${escHtml(itemId)}"
               data-item-name="${escHtml(displayName)}"
               data-display-type="FY Course"
               ${isChecked ? 'checked' : ''}
               onchange="handleDetailCheckbox(this)">
        <span>Add to list</span>
      </label>
      <button class="detail-icon-btn" title="Collapse" onclick="toggleDetailPanel()">⌄</button>
      <button class="detail-icon-btn close" title="Close" onclick="resetDetailPanel()">×</button>
    </div>
    <div class="detail-panel-body">
      <div class="detail-section">
        <div class="detail-section-label">Course Code</div>
        <p>${escHtml(c.subj)} ${escHtml(c.crse)}</p>
      </div>
      ${c.desc ? `
      <div class="detail-section">
        <div class="detail-section-label">Description</div>
        <p>${escHtml(c.desc)}</p>
      </div>` : ''}
      ${c.geneds && c.geneds.length ? `
      <div class="detail-section">
        <div class="detail-section-label">Gen-Eds Fulfilled</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${genedBadgesHtml(c.geneds)}</div>
      </div>` : ''}
    </div>
  `;
}


/* ════════════════════════════════════════════════════════════════
   SELECTED ITEMS
════════════════════════════════════════════════════════════════ */
function handleDetailCheckbox(cb) {
  const itemId      = cb.dataset.itemId;
  const itemName    = cb.dataset.itemName;
  const displayType = cb.dataset.displayType;
  toggleSelectedItem(itemId, itemName, displayType, cb.checked);

  // Sync the corresponding inline checkbox if visible
  const inlineCb = document.getElementById(`inline-cb-${itemId}`);
  if (inlineCb) inlineCb.checked = cb.checked;
}

function handleInlineCheckbox(cb) {
  const itemId      = cb.dataset.itemId;
  const itemName    = cb.dataset.itemName;
  const displayType = cb.dataset.displayType;
  toggleSelectedItem(itemId, itemName, displayType, cb.checked);

  // Sync the detail panel checkbox if visible
  const detailCb = document.getElementById(`detail-cb-${itemId}`);
  if (detailCb) detailCb.checked = cb.checked;
}

function toggleSelectedItem(itemId, itemName, displayType, checked) {
  if (checked) {
    selectedItems.set(itemId, { name: itemName, displayType });
  } else {
    selectedItems.delete(itemId);
  }
  renderSelectedBox();
}

function removeSelectedItem(itemId) {
  selectedItems.delete(itemId);
  const cb = document.getElementById('detail-cb-' + itemId);
  if (cb) cb.checked = false;
  const inlineCb = document.getElementById('inline-cb-' + itemId);
  if (inlineCb) inlineCb.checked = false;
  renderSelectedBox();
}

function renderSelectedBox() {
  const body = document.getElementById('selected-items-body');
  if (selectedItems.size === 0) {
    body.innerHTML = '<div class="selected-items-empty">No items selected. Use checkboxes in the detail panel.</div>';
    return;
  }
  body.innerHTML = [...selectedItems.entries()].map(([id, item]) => `
    <div class="selected-item" data-item-id="${escHtml(id)}">
      <span class="selected-item-type">${escHtml(item.displayType)}</span>
      <span class="selected-item-name">${escHtml(item.name)}</span>
      <button class="selected-item-remove"
              onclick="removeSelectedItem('${escHtml(id)}')"
              title="Remove">×</button>
    </div>
  `).join('');
}

function copySelectedItems() {
  if (selectedItems.size === 0) { showToast('Nothing to copy.'); return; }

  // Category display config: order, heading label, bullet prefix
  const categoryConfig = [
    { type: 'FYS',           heading: 'First-Year Seminar (FYS) Suggestions'  },
    { type: 'Concentration', heading: 'Concentration Suggestions'              },
    { type: 'Major Course',  heading: 'Suggested Major Courses'                },
    { type: 'Gen-Ed Area',   heading: 'Gen-Ed Area Recommendations'            },
    { type: 'Gen-Ed Course', heading: 'Recommended Gen-Ed Courses'             },
    { type: 'FY Course',     heading: 'First-Year Courses'                     },
  ];

  // Group items by displayType
  const grouped = new Map();
  for (const item of selectedItems.values()) {
    if (!grouped.has(item.displayType)) grouped.set(item.displayType, []);
    grouped.get(item.displayType).push(item.name);
  }

  // Build email body
  const sections = categoryConfig
    .filter(cat => grouped.has(cat.type))
    .map(cat => {
      const items = grouped.get(cat.type).map(name => `  • ${name}`).join('\n');
      return `${cat.heading}\n${items}`;
    });

  const studentId = currentStudent?.student_id ?? currentStudent?.studentId ?? 'your advisee';

  const emailText =
`Dear [Student],

Following our discussion, here is a summary of the courses and programs we discussed.

${sections.join('\n\n')}

Please feel free to reach out if you have any questions about these recommendations. I look forward to supporting you as you begin your academic journey at UR.

Best regards,
[Advisor Name]
University of Richmond`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(emailText)
      .then(() => showToast('Email template copied to clipboard.'))
      .catch(() => fallbackCopy(emailText));
  } else {
    fallbackCopy(emailText);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Copied to clipboard.'); }
  catch { showToast('Could not copy — please copy manually.'); }
  document.body.removeChild(ta);
}


/* ════════════════════════════════════════════════════════════════
   SUGGESTION DETAIL — FYS (no Add to list) and Major (with Add to list)
════════════════════════════════════════════════════════════════ */
function selectSuggestion(type, idx) {
  document.querySelectorAll('.suggestion-item').forEach(el => el.classList.remove('selected'));
  document.getElementById(`sug-${type}-${idx}`)?.classList.add('selected');

  const listMap = { major: currentSuggestions.majors, fys: currentSuggestions.fys };
  const item    = listMap[type]?.[idx];
  if (!item) return;

  const itemId = `${type}-${idx}`;
  const panel  = document.getElementById('detail-panel');
  panel.classList.remove('collapsed');

  if (type === 'fys') {
    const whyList = item.whyRecommended.map(w => `<li>${escHtml(w)}</li>`).join('');
    panel.innerHTML = `
      <div class="detail-panel-header">
        <div style="flex:1">
          <div class="detail-panel-title">${escHtml(item.name)}</div>
        </div>
        <button class="detail-icon-btn" title="Collapse" onclick="toggleDetailPanel()">⌄</button>
        <button class="detail-icon-btn close" title="Close" onclick="resetDetailPanel()">×</button>
      </div>
      <div class="detail-panel-body">
        ${item.description ? `
        <div class="detail-section">
          <div class="detail-section-label">Description</div>
          <p>${escHtml(item.description)}</p>
        </div>` : ''}
        ${whyList ? `
        <div class="detail-section">
          <div class="detail-section-label">Reasons for Recommendation</div>
          <ul class="why-list">${whyList}</ul>
        </div>` : ''}
      </div>
    `;
    return;
  }

  // Major
  const concNote = item.suggestedConcentration
    ? `<li><strong>Suggested concentration:</strong> ${escHtml(item.suggestedConcentration)}</li>`
    : '';
  const whyList    = item.whyRecommended.map(w => `<li>${escHtml(w)}</li>`).join('') + concNote;
  const coursesHtml = item.courses.map(c => {
    const label   = escHtml(c.code + (c.name ? ' – ' + c.name : ''));
    const genedTag = c.gen_ed
      ? ` ${genedBadgesHtml(c.gen_ed.split(',').map(g => g.trim()).filter(Boolean))}`
      : '';
    return `<div class="course-item">${label}${genedTag}</div>`;
  }).join('');

  const concDetailHtml = item.concentrations && item.concentrations.length > 0 ? `
    <div class="detail-section">
      <div class="detail-section-label">Available Concentrations</div>
      <ul class="why-list">
        ${item.concentrations.map(c => `<li>${escHtml(c)}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  panel.innerHTML = `
    <div class="detail-panel-header">
      <div style="flex:1">
        <div class="detail-panel-title">${escHtml(item.name)}</div>
        ${item.level ? `<div class="detail-panel-subtitle">${escHtml(item.level)}</div>` : ''}
      </div>
      <button class="detail-icon-btn" title="Collapse" onclick="toggleDetailPanel()">⌄</button>
      <button class="detail-icon-btn close" title="Close" onclick="resetDetailPanel()">×</button>
    </div>
    <div class="detail-panel-body">
      ${item.additionalNotes ? `
      <div class="detail-section">
        <div class="detail-section-label">Additional Notes</div>
        <p>${escHtml(item.additionalNotes)}</p>
      </div>` : ''}
      <div class="detail-section">
        <div class="detail-section-label">Reasons for Recommendation</div>
        <ul class="why-list">${whyList}</ul>
      </div>
      ${concDetailHtml}
      ${coursesHtml ? `
      <div class="detail-section">
        <div class="courses-box">
          <h4>Suggested Courses</h4>
          ${coursesHtml}
        </div>
      </div>` : ''}
    </div>
  `;
}

function copyConcentrations(idx) {
  const item = currentSuggestions?.majors?.[idx];
  if (!item || !item.concentrations || item.concentrations.length === 0) return;
  const text = `${item.name} – Available Concentrations:\n${item.concentrations.map(c => `  • ${c}`).join('\n')}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Concentrations copied to clipboard.'))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function selectMajorCourse(majorIdx, courseIdx) {
  const item = currentSuggestions?.majors[majorIdx];
  const c    = item?.courses[courseIdx];
  if (!c) return;

  const courseId   = `major-${majorIdx}-course-${courseIdx}`;
  const courseName = c.code + (c.name ? ' – ' + c.name : '');
  const isChecked  = selectedItems.has(courseId);

  // Look up the full FY course record for description and authoritative gen-eds
  const fyCourse = (currentStudent?.fy_courses || []).find(
    fc => `${fc.subj} ${fc.crse}`.trim().toLowerCase() === c.code.trim().toLowerCase()
  );

  const geneds   = fyCourse?.geneds?.length ? fyCourse.geneds
                 : c.gen_ed ? c.gen_ed.split(',').map(g => g.trim()).filter(Boolean)
                 : [];
  const genedHtml = geneds.length
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${genedBadgesHtml(geneds)}</div>`
    : '';
  const desc = fyCourse?.desc || '';

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('collapsed');
  panel.innerHTML = `
    <div class="detail-panel-header">
      <div style="flex:1">
        <div class="detail-panel-title">${escHtml(c.name || c.code)}</div>
        <div class="detail-panel-subtitle">${escHtml(c.code)}</div>
      </div>
      <label class="detail-select-label" title="Add to selected list">
        <input type="checkbox" id="detail-cb-${escHtml(courseId)}"
               data-item-id="${escHtml(courseId)}"
               data-item-name="${escHtml(courseName)}"
               data-display-type="Major Course"
               ${isChecked ? 'checked' : ''}
               onchange="handleDetailCheckbox(this)">
        <span>Add to list</span>
      </label>
      <button class="detail-icon-btn" title="Collapse" onclick="toggleDetailPanel()">⌄</button>
      <button class="detail-icon-btn close" title="Close" onclick="resetDetailPanel()">×</button>
    </div>
    <div class="detail-panel-body">
      ${desc ? `
      <div class="detail-section">
        <div class="detail-section-label">Description</div>
        <p>${escHtml(desc)}</p>
      </div>` : ''}
      ${genedHtml ? `
      <div class="detail-section">
        <div class="detail-section-label">Gen-Eds Fulfilled</div>
        ${genedHtml}
      </div>` : ''}
    </div>
  `;
}

function toggleDetailPanel() {
  document.getElementById('detail-panel').classList.toggle('collapsed');
}

function resetDetailPanel() {
  document.querySelectorAll('.suggestion-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('detail-panel').innerHTML = `
    <div class="detail-placeholder">
      <p>Select a suggestion on the left to see details here.</p>
    </div>
  `;
  document.getElementById('detail-panel').classList.remove('collapsed');
}


/* ════════════════════════════════════════════════════════════════
   ACCORDION TOGGLE
════════════════════════════════════════════════════════════════ */
function toggleAccordion(id) {
  document.getElementById(id).classList.toggle('open');
}

function navTo(id) {
  // Hide all left-panel accordions, show only the chosen one
  document.querySelectorAll('#profile-left .accordion').forEach(acc => {
    acc.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = '';
  if (!el.classList.contains('open')) el.classList.add('open');

  // Track active tab
  document.querySelectorAll('.topnav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick') === `navTo('${id}')`);
  });

  // Gened filter popup only visible when gened section is active
  const popup = document.getElementById('gened-filter-popup');
  if (popup) popup.style.display = id === 'acc-gened' ? 'block' : 'none';
}


/* ════════════════════════════════════════════════════════════════
   GEN-ED TABS & FILTER
   Tab order: Recommended Courses (1st/default), Gen-Ed Areas (2nd)
════════════════════════════════════════════════════════════════ */
function renderGenedTabs() {
  if (!currentSuggestions) return;
  const geneds = currentSuggestions.geneds;

  currentGenedTab  = 'courses';
  genedFilterState = {};
  geneds.forEach(g => { genedFilterState[g.code] = true; });

  renderGenedAreas();
  renderGenedCourses();
  initGenedFilterPopup(geneds);

  document.getElementById('tab-btn-courses').classList.add('active');
  document.getElementById('tab-btn-areas').classList.remove('active');
  document.getElementById('gened-courses-panel').style.display = 'block';
  document.getElementById('gened-areas-panel').style.display   = 'none';
}

function renderGenedAreas() {
  const geneds    = currentSuggestions.geneds;
  const fyCourses = currentStudent?.fy_courses || [];
  const container = document.getElementById('gened-areas-panel');
  container.innerHTML = `
    <div class="suggestion-list" style="padding:8px 22px 18px">
      ${geneds.map((g, i) => {
        const areaFyCourses = fyCourses.filter(c => c.geneds && c.geneds.includes(g.code));
        const panelOpen     = genedAreaCoursePanelsOpen.has(i);
        const allFyCourses = currentStudent?.fy_courses || [];
        const coursesPanelHtml = areaFyCourses.length > 0 ? `
          <div class="major-courses-panel gened-area-courses-dropdown${panelOpen ? ' open' : ''}" id="gened-area-courses-panel-${i}">
            ${areaFyCourses.map(c => {
              const origIdx  = allFyCourses.indexOf(c);
              const courseId = `gened-area-${i}-fycourse-${origIdx}`;
              const isCourseChecked = selectedItems.has(courseId);
              const displayName = `${c.subj} ${c.crse} – ${c.title}`;
              return `
                <div class="major-course-row" onclick="event.stopPropagation(); selectFyCourse(${origIdx})">
                  <span class="major-course-name">
                    <strong>${escHtml(c.subj)} ${escHtml(c.crse)}</strong> – ${escHtml(c.title)}
                  </span>
                  ${c.geneds && c.geneds.length
                    ? `<span class="major-course-geneds">${genedBadgesHtml(c.geneds)}</span>`
                    : ''}
                  <label class="inline-add-label" onclick="event.stopPropagation()" title="Add to selected list">
                    <input type="checkbox" class="major-course-cb"
                           data-item-id="${escHtml(courseId)}"
                           data-item-name="${escHtml(displayName)}"
                           data-display-type="Gen-Ed Course"
                           ${isCourseChecked ? 'checked' : ''}
                           onchange="handleInlineCheckbox(this)">
                    <span>Add to list</span>
                  </label>
                  <span class="suggestion-arrow" aria-hidden="true">›</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : '';
        return `
          <div class="suggestion-item" id="sug-gened-area-${i}" onclick="selectGenedArea(${i})">
            <div class="suggestion-rank">${i + 1}</div>
            <div class="suggestion-text">
              <div class="suggestion-name">${escHtml(g.name)}</div>
            </div>
            <span class="badge badge-green gened-code-badge">${escHtml(g.code)}</span>
            ${areaFyCourses.length > 0 ? `
              <button class="view-courses-btn" id="gened-area-view-btn-${i}"
                      onclick="event.stopPropagation(); toggleGenedAreaCourses(${i}); selectGenedArea(${i})">
                ${panelOpen ? 'Hide' : 'View'} Courses
              </button>
            ` : ''}
            <span class="suggestion-arrow" aria-hidden="true">›</span>
          </div>
          ${coursesPanelHtml}
        `;
      }).join('')}
    </div>
  `;
}

function toggleGenedAreaCourses(i) {
  const panel = document.getElementById(`gened-area-courses-panel-${i}`);
  const btn   = document.getElementById(`gened-area-view-btn-${i}`);
  if (!panel) return;

  if (genedAreaCoursePanelsOpen.has(i)) {
    genedAreaCoursePanelsOpen.delete(i);
    panel.classList.remove('open');
    if (btn) btn.textContent = 'View Courses';
  } else {
    genedAreaCoursePanelsOpen.add(i);
    panel.classList.add('open');
    if (btn) btn.textContent = 'Hide Courses';
  }
}

function selectGenedArea(idx) {
  document.querySelectorAll('.suggestion-item').forEach(el => el.classList.remove('selected'));
  document.getElementById(`sug-gened-area-${idx}`)?.classList.add('selected');

  const item = currentSuggestions.geneds[idx];
  if (!item) return;

  const whyList = item.whyRecommended.map(w => `<li>${escHtml(w)}</li>`).join('');

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('collapsed');
  panel.innerHTML = `
    <div class="detail-panel-header">
      <div style="flex:1">
        <div class="detail-panel-title">${escHtml(item.name)}</div>
      </div>
      <span class="badge badge-green detail-panel-category">${escHtml(item.code)}</span>
      <button class="detail-icon-btn" title="Collapse" onclick="toggleDetailPanel()">⌄</button>
      <button class="detail-icon-btn close" title="Close" onclick="resetDetailPanel()">×</button>
    </div>
    <div class="detail-panel-body">
      ${item.description ? `
      <div class="detail-section">
        <div class="detail-section-label">Description</div>
        <p>${escHtml(item.description)}</p>
      </div>` : ''}
      <div class="detail-section">
        <div class="detail-section-label">Reasons for Recommendation</div>
        <ul class="why-list">${whyList}</ul>
      </div>
    </div>
  `;
}

function renderGenedCourses() {
  const container = document.getElementById('gened-courses-panel');
  const courses   = currentSuggestions.genedCourses || [];

  const filtered = courses.filter(c => {
    if (!c.geneds || c.geneds.length === 0) return true;
    return c.geneds.some(code => genedFilterState[code] !== false);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:18px 22px;color:var(--text-light);font-size:.88rem">No recommended courses match the active filter.</div>';
    return;
  }

  const courseIndexes = filtered.map(c => courses.indexOf(c));

  container.innerHTML = `
    <div class="suggestion-list" style="padding:8px 22px 18px">
      ${filtered.map((c, i) => {
        const originalIdx = courseIndexes[i];
        const itemId      = `gened-course-${originalIdx}`;
        const isChecked   = selectedItems.has(itemId);
        return `
          <div class="suggestion-item" id="sug-gened-course-${originalIdx}"
               onclick="selectGenedCourse(${originalIdx})">
            <div class="suggestion-rank">${i + 1}</div>
            <div class="suggestion-text">
              <div class="suggestion-name">${escHtml(c.name)}</div>
            </div>
            ${c.geneds && c.geneds.length ? genedBadgesHtml(c.geneds) : ''}
            <label class="inline-add-label" onclick="event.stopPropagation()" title="Add to selected list">
              <input type="checkbox" id="inline-cb-${escHtml(itemId)}"
                     data-item-id="${escHtml(itemId)}"
                     data-item-name="${escHtml(c.name)}"
                     data-display-type="Gen-Ed Course"
                     ${isChecked ? 'checked' : ''}
                     onchange="handleInlineCheckbox(this)">
              <span>Add to list</span>
            </label>
            <span class="suggestion-arrow" aria-hidden="true">›</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function selectGenedCourse(idx) {
  document.querySelectorAll('.suggestion-item').forEach(el => el.classList.remove('selected'));
  document.getElementById(`sug-gened-course-${idx}`)?.classList.add('selected');

  const courses = currentSuggestions.genedCourses || [];
  const c = courses[idx];
  if (!c) return;

  const whyList = c.whyRecommended.map(w => `<li>${escHtml(w)}</li>`).join('');

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('collapsed');
  panel.innerHTML = `
    <div class="detail-panel-header">
      <div style="flex:1">
        <div class="detail-panel-title">${escHtml(c.name)}</div>
      </div>
      ${c.geneds && c.geneds.length ? `<div style="display:flex;gap:4px;flex-shrink:0">${genedBadgesHtml(c.geneds)}</div>` : ''}
      <button class="detail-icon-btn" title="Collapse" onclick="toggleDetailPanel()">⌄</button>
      <button class="detail-icon-btn close" title="Close" onclick="resetDetailPanel()">×</button>
    </div>
    <div class="detail-panel-body">
      ${c.description ? `
      <div class="detail-section">
        <div class="detail-section-label">Description</div>
        <p>${escHtml(c.description)}</p>
      </div>` : ''}
      <div class="detail-section">
        <div class="detail-section-label">Reasons for Recommendation</div>
        <ul class="why-list">${whyList}</ul>
      </div>
    </div>
  `;
}

function switchGenedTab(tab) {
  currentGenedTab = tab;
  document.getElementById('gened-areas-panel').style.display   = tab === 'areas'   ? 'block' : 'none';
  document.getElementById('gened-courses-panel').style.display  = tab === 'courses' ? 'block' : 'none';
  document.getElementById('tab-btn-areas').classList.toggle('active',   tab === 'areas');
  document.getElementById('tab-btn-courses').classList.toggle('active', tab === 'courses');
}

function toggleGenedAccordion() {
  toggleAccordion('acc-gened');
  const isOpen = document.getElementById('acc-gened').classList.contains('open');
  document.getElementById('gened-filter-popup').style.display = isOpen ? 'block' : 'none';
}

function initGenedFilterPopup(geneds) {
  const body = document.getElementById('gened-filter-body');
  body.innerHTML = `
    <label class="filter-check-item filter-check-all">
      <input type="checkbox" id="gened-check-all" checked onchange="toggleAllGened(this.checked)">
      <span>Show All</span>
    </label>
    <div class="filter-divider"></div>
    ${geneds.map(g => `
      <label class="filter-check-item">
        <input type="checkbox" class="gened-check" data-code="${escHtml(g.code)}" checked
               onchange="toggleGenedArea('${escHtml(g.code)}', this.checked)">
        <span class="badge badge-green gened-code-badge" style="margin-right:4px">${escHtml(g.code)}</span>
        <span>${escHtml(g.name)}</span>
      </label>
    `).join('')}
  `;
}

function toggleAllGened(checked) {
  Object.keys(genedFilterState).forEach(code => { genedFilterState[code] = checked; });
  document.querySelectorAll('.gened-check').forEach(cb => { cb.checked = checked; });
  renderGenedCourses();
}

function toggleGenedArea(code, checked) {
  genedFilterState[code] = checked;
  const allChecked  = Object.values(genedFilterState).every(v => v);
  const someChecked = Object.values(genedFilterState).some(v => v);
  const checkAll    = document.getElementById('gened-check-all');
  checkAll.checked       = allChecked;
  checkAll.indeterminate = !allChecked && someChecked;
  renderGenedCourses();
}



/* ════════════════════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════════════════════ */
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}


/* ════════════════════════════════════════════════════════════════
   INITIALISE
════════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { _msCloseAll(); }
});

// Close open multi-select dropdown when clicking outside it
document.addEventListener('click', e => {
  if (!_msOpenId) return;
  const container = document.getElementById(_msOpenId);
  if (container && !container.contains(e.target)) _msCloseAll();
});

document.addEventListener('DOMContentLoaded', () => {
  if (window.__STUDENT__) {
    currentStudent = window.__STUDENT__;
    loadProfile(window.__STUDENT__);
  }
});
