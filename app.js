// ==========================================
// 1. GLOBAL SAAS DATA & STATE
// ==========================================
let currentSchoolId = null;
let currentSchoolName = "";
let isMobileMode = false;
let currentViewStr = 'schedule';

// Unified memory for BOTH Exam Manager and Routine Manager
window.appData = {
    staff: [], classes: [], subjects: [],
    roomConfigs: [], dutyRecords: {}, schedule: [],
    examNames: ["1st Summative", "Annual Examination", "Test Examination"],
    currentMeta: { date: new Date().toISOString().split('T')[0], examName: 'Annual Examination', time: '10:00 AM', subjectHeading: '' },
    calendarMonth: new Date().getMonth(), calendarYear: new Date().getFullYear(),
    absentees: {}, lockedDates: {},
    
    // Routine Manager Variables
    teachers: [], routineData: [], substitutionHistory: [], routineTimes: [], portalStatus: 'disabled'
};

// Map globalData to appData so the Routine Manager scripts work natively
window.globalData = window.appData;

// ==========================================
// 2. SAAS INITIALIZATION, AUTH & ROUTING
// ==========================================

window.onload = async function() {
    // 1. Check if the user is already logged in
    currentSchoolId = sessionStorage.getItem('currentSchoolId');
    currentSchoolName = sessionStorage.getItem('currentSchoolName');
    
    const path = window.location.pathname;
    const isLogin = path.endsWith('index.html') || path.endsWith('/');
    const isHub = path.endsWith('home.html');

    // --- IF NOT LOGGED IN ---
    if (!currentSchoolId) {
        if (!isLogin) {
            window.location.href = 'index.html';
            return;
        }
        
        const { data: schools } = await supabaseClient.from('schools').select('id, school_name');
        const selector = document.getElementById('login-school-selector');
        if (selector && schools) {
            selector.innerHTML = '<option value="">-- Select Your School --</option>';
            schools.forEach(s => selector.innerHTML += `<option value="${s.id}">${s.school_name}</option>`);
        }
        
        document.getElementById('loading-overlay').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
        return; 
    }

    // --- IF LOGGED IN ---
    if (currentSchoolId) {
        if (isLogin) {
            window.location.href = 'home.html';
            return;
        }

        if (isHub) {
            const hubTitle = document.getElementById('hub-school-name');
            if (hubTitle) hubTitle.innerText = currentSchoolName + " Portal";
            document.getElementById('loading-overlay').classList.add('hidden');
            return; 
        }

        if (window.activeModule === 'exam' || window.activeModule === 'routine') {
            const title = document.getElementById('app-title');
            if (title) title.innerText = currentSchoolName + " Manager";
            
            await loadSchoolDataFromCloud();
            
            const loader = document.getElementById('loading-overlay');
            if (loader) loader.classList.add('hidden');
            
            if (window.activeModule === 'exam') {
                renderView('schedule');
            } else if (window.activeModule === 'routine') {
                if (typeof renderSidebar === "function") renderSidebar();
                if (typeof renderGrid === "function") renderGrid();
                if (typeof startSilentLeavePoller === "function") startSilentLeavePoller();
            }
        }
    }
};

async function loginAsSchool() {
    const schoolId = document.getElementById('login-school-selector').value;
    const password = document.getElementById('login-password').value.trim();

    if (!schoolId || !password) return alert("Please select a school and enter the password.");

    const { data, error } = await supabaseClient.from('schools').select('*').eq('id', schoolId).eq('password', password);

    if (error || data.length === 0) return alert("❌ Incorrect Password or School combination!");

    sessionStorage.setItem('currentSchoolId', data[0].id);
    sessionStorage.setItem('currentSchoolName', data[0].school_name);

    window.location.href = 'home.html';
}

async function registerSchool() {
    const schoolName = document.getElementById('signup-school-name').value.trim();
    const password = document.getElementById('signup-password').value.trim();

    if (!schoolName || !password) return alert("Please fill in all fields.");

    const { error } = await supabaseClient
        .from('schools')
        .insert([{ school_name: schoolName, password: password }])
        .select();

    if (error) {
        console.error("Registration Error:", error);
        return alert("Registration failed: " + error.message);
    }

    alert(`✅ ${schoolName} registered successfully! You can now log in.`);
    toggleAuth('login');
}

function toggleAuth(mode) {
    document.getElementById('login-screen').classList.toggle('hidden', mode !== 'login');
    document.getElementById('signup-screen').classList.toggle('hidden', mode !== 'signup');
}

function logoutUser() {
    if (confirm("Are you sure you want to log out?")) {
        sessionStorage.clear(); 
        window.location.replace('index.html'); 
    }
}

function openExamManager() {
    document.getElementById('home-hub-screen').classList.add('hidden');
    document.getElementById('exam-manager-wrapper').classList.remove('hidden');
    renderView('schedule'); 
}

function openRoutineManager() {
    document.getElementById('home-hub-screen').classList.add('hidden');
    document.getElementById('routine-manager-wrapper').classList.remove('hidden');
    if (typeof renderSidebar === "function") renderSidebar();
    if (typeof renderGrid === "function") renderGrid();
    if (typeof startSilentLeavePoller === "function") startSilentLeavePoller();
}

function returnToHub() {
    document.getElementById('exam-manager-wrapper').classList.add('hidden');
    document.getElementById('routine-manager-wrapper').classList.add('hidden');
    document.getElementById('home-hub-screen').classList.remove('hidden');
}


// ==========================================
// 3. SUPABASE DATABASE SYNC (LOAD & SAVE)
// ==========================================

async function loadSchoolDataFromCloud() {
    if (!currentSchoolId) return;
    
    const { data, error } = await supabaseClient
        .from('exam_db')
        .select('data_key, json_payload')
        .eq('school_id', currentSchoolId);
        
    if (error) {
        console.error("❌ Supabase Load Error:", error);
        return alert("Error loading data: " + error.message);
    }
    
    if (data && data.length > 0) {
        data.forEach(row => {
            window.appData[row.data_key] = row.json_payload;
        });
        
        // Ensure Routine Manager uses Exam Manager's staff list
        if (window.appData.staff && window.appData.staff.length > 0) {
            window.appData.teachers = window.appData.staff.map(s => s.name);
        }
    }
    
    // Auto-extract unique classes & subjects for Exam Datalists
    let uc = new Set(); let us = new Set();
    if (window.appData.schedule) {
        window.appData.schedule.forEach(s => { 
            if(s.classes) uc.add(s.classes); 
            if(s.subject) us.add(s.subject); 
        });
    }
    
    window.appData.classes = Array.from(new Set([...window.appData.classes, ...Array.from(uc)]));
    window.appData.subjects = Array.from(new Set([...window.appData.subjects, ...Array.from(us)]));

    // Ensure globalData mapping remains intact
    window.globalData = window.appData;
    
    if (window.activeModule === 'exam') updateDatalists();
    console.log("✅ Data successfully loaded from Supabase.");
}

let saveTimer;
function saveToStorage() {
    if (!currentSchoolId) return;
    const titleObj = document.getElementById('app-title');
    if(titleObj) titleObj.innerText = "☁️ Saving...";
    
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        let payloads = [];
        
        for (const key of Object.keys(window.appData)) {
            if (Array.isArray(window.appData[key]) && window.appData[key].length === 0 && key !== 'routineData') {
                continue; 
            }
            payloads.push({
                school_id: currentSchoolId, 
                data_key: key, 
                json_payload: window.appData[key] 
            });
        }

        const { error } = await supabaseClient.from('exam_db').upsert(payloads, { onConflict: 'school_id, data_key' });

        if (error) {
            console.error("Save Error:", error);
            if(titleObj) { titleObj.innerText = "❌ Sync Failed"; titleObj.style.color = "#ff9800"; }
        } else {
            if(titleObj) { 
                titleObj.innerText = "✅ Saved"; 
                setTimeout(() => { titleObj.innerText = currentSchoolName + (window.activeModule === 'exam' ? " Manager" : ""); titleObj.style.color = window.activeModule === 'exam' ? "white" : "#1f2937"; }, 1500); 
            }
        }
    }, 1200);
}

async function saveRoutineDataInternal(callback, day) {
    if (typeof updateLocalDataFromDOM === 'function') updateLocalDataFromDOM(); 
    saveToStorage();
    if (callback) callback();
}

function downloadCloudBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.appData, null, 2));
    const a = document.createElement('a'); a.href = dataStr; a.download = `${currentSchoolName}_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}


// ==========================================
// 4. EXAM MANAGER: UI CORE
// ==========================================
function updateDatalists() {
    const fill = (id, arr) => {
        const el = document.getElementById(id);
        if(el) el.innerHTML = arr.map(i => `<option value="${i}">`).join('');
    };
    fill('list-classes', window.appData.classes);
    fill('list-subjects', window.appData.subjects);
}

function renderView(view) {
    currentViewStr = view;
    const container = document.getElementById('app-container');
    if (!container) return; 
    
    container.innerHTML = '';
    if (view === 'manager') renderManager(container);
    if (view === 'schedule') renderSchedule(container);
    if (view === 'dashboard') renderDashboard(container);
}

function toggleMobileMode() {
    isMobileMode = document.getElementById('mobile-mode-chk').checked;
    if(isMobileMode) document.body.classList.add('mobile-mode-active');
    else document.body.classList.remove('mobile-mode-active');
    renderView(currentViewStr);
}

function toggleCardOverlay(btn) {
    const card = btn.closest('.card');
    card.classList.toggle('overlay-active');
    if(card.classList.contains('overlay-active')) {
        btn.innerHTML = '❌ Close Full-Screen'; btn.style.background = '#f44336'; document.body.style.overflow = 'hidden'; 
    } else {
        btn.innerHTML = '🔲 Open in Large Overlay'; btn.style.background = '#e91e63'; document.body.style.overflow = 'auto';
    }
}


// ==========================================
// 5. EXAM MANAGER: SETUP & REPORTS
// ==========================================

function addNewStaff() { 
    const n = document.getElementById('new-staff-name').value.trim(); 
    if(n) { 
        window.appData.staff.push({id:'S'+Date.now(), name:n}); 
        window.appData.teachers = window.appData.staff.map(s => s.name); // Sync instantly
        saveToStorage(); 
        renderView('manager'); 
        if (typeof renderSidebar === "function") renderSidebar();
    } 
}

function renderManager(container) {
    const expandBtn = isMobileMode ? `<button type="button" class="action-btn no-print" style="background:#e91e63; margin-bottom:15px; width:100%;" onclick="toggleCardOverlay(this)">🔲 Open in Large Overlay</button>` : '';
    
    let allDatesSet = new Set();
    (window.appData.schedule || []).forEach(s => { if(s.date) allDatesSet.add(s.date); });
    Object.keys(window.appData.dutyRecords || {}).forEach(d => allDatesSet.add(d));
    const allDates = Array.from(allDatesSet).sort().reverse();
    let lockHtml = allDates.length === 0 ? '<p>No dates available.</p>' : allDates.map(d => {
        const isLocked = window.appData.dutyRecords[d] && window.appData.dutyRecords[d].meta && window.appData.dutyRecords[d].meta.isLocked === true;
        return `<div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; align-items:center;"><strong>${d.split('-').reverse().join('-')}</strong><button class="action-btn" style="background:${isLocked ? '#f44336' : '#4CAF50'};" onclick="toggleDateLock('${d}', ${!isLocked})">${isLocked ? '🔒 Locked' : '🔓 Unlocked'}</button></div>`;
    }).join('');
    
    container.innerHTML = `
        <div class="grid-container">
            <div class="card">
                ${expandBtn}
                <h3 style="color:#e91e63;">📊 Global Reports</h3>
                <button class="action-btn" style="width:100%; margin-bottom:10px; background:#4CAF50;" onclick="openPrintAbsenteeModal()">🖨️ Print Absentee List</button>
                <button class="action-btn" style="width:100%; margin-bottom:10px; background:#3f51b5;" onclick="openAllAbsenteesView()">👀 View Absentee Records</button>
                <button class="action-btn" style="width:100%; background:#2196F3;" onclick="printAllRoomSheets()">🖨️ Bulk Print Rooms</button>
                <hr style="margin:20px 0;"><h3 style="color:#3f51b5;">📈 Consolidated Master Report</h3>
                <div style="background:#f5f5f5; padding:10px; border-radius:5px;">
                    <select id="cons-exam" class="exam-select" style="margin-bottom:5px;"><option>Loading...</option></select>
                    <select id="cons-date" class="exam-select" style="margin-bottom:5px;"><option>Loading...</option></select>
                    <div id="cons-class-container" style="background:#fff; border:1px solid #ccc; padding:5px; margin-bottom:10px; max-height:100px; overflow-y:auto; display:flex; gap:10px; flex-wrap:wrap;"></div>
                    <div style="display:flex; gap:10px;"><button class="action-btn" style="flex:1; background:#00897b;" onclick="executeConsolidatedReport('print')">🖨️ Print</button><button class="action-btn" style="flex:1; background:#e64a19;" onclick="executeConsolidatedReport('jpg')">📥 JPG</button></div>
                </div>
            </div>

            <div class="card">
                ${expandBtn}
                <h3 style="color:#d32f2f;">🔐 Lock Exam Dates</h3>
                <div style="max-height:200px; overflow-y:auto; border:1px solid #ccc;">${lockHtml}</div>
                <hr style="margin:20px 0;"><h3 style="color:#d32f2f;">⚠️ Download Database Backup</h3>
                <button class="action-btn" style="width:100%; background:#4CAF50;" onclick="downloadCloudBackup()">💾 Download JSON Backup</button>
            </div>

            <div class="card">
                ${expandBtn}
                <h3>👤 Staff Editor</h3>
                <div style="display:flex; gap:5px; margin-bottom:10px;"><input type="text" id="new-staff-name" class="exam-input" placeholder="Staff Name"><button class="action-btn" onclick="addNewStaff()">+ Add</button></div>
                <div style="max-height:300px; overflow-y:auto; border:1px solid #ccc;">
                    ${window.appData.staff.map((s, idx) => `
                        <div style="padding:6px; border-bottom:1px dotted #ccc; display:flex; justify-content:space-between; ${s.isHidden ? 'opacity:0.5;' : ''}">
                            <input type="text" value="${s.name}" class="exam-input" onchange="editStaffName(${idx}, this.value)" style="border:none; font-weight:bold; width:50%; margin:0;">
                            <div><label><input type="checkbox" ${s.isHidden ? 'checked' : ''} onchange="toggleStaffHide(${idx}, this.checked)"> Hide</label><button class="delete-btn" onclick="deleteStaff(${idx})">Del</button></div>
                        </div>`).join('')}
                </div>
            </div>
            
            <div class="card">
                ${expandBtn}
                <h3>📊 Staff Duty Counter</h3>
                <div style="display:flex; gap:5px; margin-bottom:10px;"><input type="date" id="count-start" class="exam-input"><input type="date" class="exam-input" id="count-end"><button class="action-btn" onclick="calculateDutyCount()">Count</button></div>
                <div id="duty-count-result" style="max-height:200px; overflow-y:auto; border:1px solid #ccc; padding:5px;"></div>
            </div>

            <div class="card">
                ${expandBtn}
                <div style="display:flex; justify-content:space-between;"><h3>🏠 Exam Rooms</h3><div><button class="action-btn" style="background:#2196F3;" onclick="printAllRoomStickers()">🖨️ Stickers</button><button class="action-btn" style="background:#4CAF50;" onclick="printRoomSittingArrangementTable()">🖨️ Table</button></div></div>
                <div style="display:flex; gap:5px; margin-bottom:10px;"><input type="text" id="new-room" class="exam-input" placeholder="Room No"><button class="action-btn" onclick="addRoom()">+ Add</button></div>
                <div style="max-height:500px; overflow-y:auto;">${window.appData.roomConfigs.map(renderRoomCard).join('')}</div>
            </div>
        </div>`;
    setTimeout(populateConsolidatedDropdowns, 100);
}

function renderRoomCard(room) {
    const totalCap = room.classes.reduce((sum, c) => sum + (parseInt(c.capacity)||0), 0);
    return `
        <div style="border:1px solid #ddd; padding:10px; margin-bottom:10px; background:#fff; border-radius:5px;">
            <div style="display:flex; justify-content:space-between; font-weight:bold;"><span>${room.name} (Cap: ${totalCap})</span><div><button class="action-btn" style="padding:2px 5px;" onclick="printRoomSheet('${room.name}')">🖨️</button><button class="delete-btn" style="padding:2px 5px;" onclick="deleteRoom('${room.id}')">Del</button></div></div>
            <select class="exam-select" onchange="updateRoom('${room.id}', 'gender', this.value)" style="margin:5px 0; width:auto;"><option value="Mixed" ${room.gender=='Mixed'?'selected':''}>Mixed</option><option value="Boys" ${room.gender=='Boys'?'selected':''}>Boys</option><option value="Girls" ${room.gender=='Girls'?'selected':''}>Girls</option></select>
            <div id="classes-${room.id}">
                ${room.classes.map((c, idx) => `
                    <div class="class-entry" style="display:flex; gap:5px; margin-bottom:5px;">
                        <input type="text" class="exam-input class-select" value="${c.class}" style="width:70px; margin:0;" onchange="saveRoomConfigClasses('${room.id}')">
                        <input type="text" class="exam-input roll-series" value="${c.rolls || (c.rollFrom?c.rollFrom+'-'+c.rollTo:'')}" style="flex-grow:1; margin:0;" oninput="updateAllotment(this)">
                        <input type="number" class="exam-input capacity-input" value="${c.capacity}" style="width:50px; margin:0;" readonly>
                        <button onclick="deleteRoomClass('${room.id}', ${idx})" style="color:red; border:none; background:none;">X</button>
                    </div>`).join('')}
            </div>
            <button class="action-btn" style="width:100%; background:#2196F3; margin-top:5px;" onclick="addRoomClass('${room.id}')">+ Class Slot</button>
        </div>`;
}

function updateAllotment(input) {
    const row = input.closest('.class-entry');
    row.querySelector('.capacity-input').value = parseRolls(row.querySelector('.roll-series').value).length;
    clearTimeout(input.saveTimeout);
    input.saveTimeout = setTimeout(() => saveRoomConfigClasses(input.closest('[id^="classes-"]').id.replace('classes-', '')), 1000);
}

function saveRoomConfigClasses(id) {
    const entries = document.getElementById('classes-'+id).querySelectorAll('.class-entry');
    window.appData.roomConfigs.find(r => r.id === id).classes = Array.from(entries).map(e => ({ class: e.querySelector('.class-select').value, rolls: e.querySelector('.roll-series').value, capacity: e.querySelector('.capacity-input').value }));
    saveToStorage();
}

function addRoom() { const n = document.getElementById('new-room').value.trim(); if(n) { window.appData.roomConfigs.push({id:'R'+Date.now(), name:n, gender:'Mixed', classes:[]}); saveToStorage(); renderView('manager'); } }
function deleteRoom(id) { window.appData.roomConfigs = window.appData.roomConfigs.filter(r => r.id !== id); saveToStorage(); renderView('manager'); }
function updateRoom(id, f, v) { window.appData.roomConfigs.find(r => r.id === id)[f] = v; saveToStorage(); }
function addRoomClass(id) { window.appData.roomConfigs.find(r => r.id === id).classes.push({class:"", capacity:0, rolls:""}); saveToStorage(); renderView('manager'); }
function deleteRoomClass(id, idx) { window.appData.roomConfigs.find(r => r.id === id).classes.splice(idx, 1); saveToStorage(); renderView('manager'); }
function editStaffName(idx, n) { window.appData.staff[idx].name = n.trim(); saveToStorage(); }
function toggleStaffHide(idx, b) { window.appData.staff[idx].isHidden = b; saveToStorage(); renderView('manager'); }
function deleteStaff(idx) { window.appData.staff.splice(idx, 1); saveToStorage(); renderView('manager'); }
function toggleDateLock(d, b) { if(!window.appData.dutyRecords[d]) window.appData.dutyRecords[d] = {meta:{}, rows:[]}; window.appData.dutyRecords[d].meta.isLocked = b; saveToStorage(); renderView('manager'); }

// ==========================================
// 6. EXAM MANAGER: SCHEDULE VIEW
// ==========================================
function renderSchedule(container) {
    const expandBtn = isMobileMode ? `<button class="action-btn no-print" style="background:#e91e63; margin-bottom:15px; width:100%;" onclick="toggleCardOverlay(this)">🔲 Open in Large Overlay</button>` : '';
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currM = window.appData.calendarMonth; const currY = window.appData.calendarYear;
    const firstDay = new Date(currY, currM, 1).getDay(); const daysInM = new Date(currY, currM+1, 0).getDate();
    
    let html = ''; for(let i=0; i<firstDay; i++) html += `<div></div>`;
    for(let d=1; d<=daysInM; d++) {
        const dateStr = `${currY}-${String(currM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const scheds = window.appData.schedule.filter(s => s.date === dateStr);
        const duty = window.appData.dutyRecords[dateStr];
        let events = scheds.map(s => `<span class="event-dot event-schedule">${s.classes} - ${s.subject}</span>`).join('');
        if (duty) { events += `<div style="display:flex; gap:2px; margin-top:4px;"><button class="duty-btn" onclick="event.stopPropagation(); selectDateForDashboard('${dateStr}')">✅ Duty</button><button class="delete-btn" style="padding:3px 6px;" onclick="event.stopPropagation(); clearDutyData('${dateStr}')">🗑️</button></div>`; } 
        else if(scheds.length > 0) { events += `<button class="duty-btn" style="background:#ccc;" onclick="event.stopPropagation(); autoStartDutyFromSchedule('${dateStr}', '${scheds[0].examName}', '${scheds[0].subject}', '${scheds[0].time}')">➕ Create Duty</button>`; }
        html += `<div class="calendar-day ${dateStr === window.appData.currentMeta.date ? 'selected-date' : ''}" onclick="selectDate('${dateStr}')" oncontextmenu="openScheduleContextMenu(event, '${dateStr}')"><div style="font-weight:bold; color:#e91e63;">${d}</div>${events}</div>`;
    }

    const uniqueExams = [...new Set([...window.appData.examNames, ...(window.appData.schedule || []).map(s => s.examName).filter(Boolean)])];
    const uniqueClasses = [...new Set((window.appData.schedule || []).map(s => s.classes).filter(Boolean))].sort();

    container.innerHTML = `
        <div class="card">
            ${expandBtn}
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button class="action-btn" onclick="navMonth(-1)">◀ Prev</button><h3 style="margin:0; color:#3f51b5;">${months[currM]} ${currY}</h3><button class="action-btn" onclick="navMonth(1)">Next ▶</button>
            </div>
            <div id="calendar-grid"><div class="day-header">Sun</div><div class="day-header">Mon</div><div class="day-header">Tue</div><div class="day-header">Wed</div><div class="day-header">Thu</div><div class="day-header">Fri</div><div class="day-header">Sat</div>${html}</div>
        </div>
        
        <div class="card">
            ${expandBtn}
            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom:15px; border-bottom: 2px dashed #eee; padding-bottom: 10px;">
                <h3 style="margin:0;">➕ Add Schedule: <span style="color:#ff9800;">${window.appData.currentMeta.date}</span></h3>
                <div style="display:flex; gap:5px;">
                    <select id="print-sch-exam" class="exam-select" style="padding:8px; margin:0;">${uniqueExams.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
                    <select id="print-sch-class" class="exam-select" style="padding:8px; margin:0;"><option value="ALL">All Classes</option>${uniqueClasses.map(c => `<option value="${c}">Class ${c}</option>`).join('')}</select>
                </div>
            </div>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
                <input type="text" id="sch-time" class="exam-input" placeholder="Time" style="width:100px;">
                <select id="sch-exam" class="exam-select" style="width:150px;">${uniqueExams.map(n=>`<option value="${n}">${n}</option>`).join('')}</select>
                <input type="text" id="sch-class" class="exam-input" list="list-classes" placeholder="Class" style="width:80px;">
                <input type="text" id="sch-sub" class="exam-input" list="list-subjects" placeholder="Subject" style="flex-grow:1;">
                <button class="action-btn" onclick="addSchedule()">Add</button>
            </div>
            <div style="margin-top:10px;">
                ${window.appData.schedule.filter(s => s.date === window.appData.currentMeta.date).map(s => `
                    <div style="padding:5px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; background:#fafafa; align-items:center;">
                        <span><b style="color:#3f51b5;">${s.time}</b>: ${s.classes} - <b>${s.subject}</b></span>
                        <button class="delete-btn" onclick="deleteSchedule('${s.id}')">🗑️ Delete</button>
                    </div>`).join('')}
            </div>
        </div>`;
}

function navMonth(dir) { window.appData.calendarMonth += dir; renderView('schedule'); }
function selectDate(date) { window.appData.currentMeta.date = date; renderView('schedule'); }
function selectDateForDashboard(date) { window.appData.currentMeta.date = date; renderView('dashboard'); }

function addSchedule() {
    const d = window.appData.currentMeta.date; 
    const t = document.getElementById('sch-time').value.trim(); 
    const e = document.getElementById('sch-exam').value.trim(); 
    const c = document.getElementById('sch-class').value.trim(); 
    const s = document.getElementById('sch-sub').value.trim();
    if(!t || !c || !s) return alert("Fill Time, Class, and Subject.");
    
    const ex = window.appData.schedule.find(x => x.examName === e && x.classes.trim().toLowerCase() === c.toLowerCase() && x.subject.trim().toLowerCase() === s.toLowerCase());
    if(ex) return alert(ex.date === d ? `Duplicate on this day at ${ex.time}.` : `CONFLICT! Already scheduled on ${ex.date}.`);
    
    window.appData.schedule.push({ id:'P'+Date.now(), date:d, time:t, examName:e, classes:c, subject:s });
    saveToStorage(); 
    renderView('schedule');
}

function deleteSchedule(id) { window.appData.schedule = window.appData.schedule.filter(s => s.id !== id); saveToStorage(); renderView('schedule'); }
function clearDutyData(date) { if(confirm(`Clear saved duty for ${date}?`)) { delete window.appData.dutyRecords[date]; saveToStorage(); renderView('schedule'); } }
function autoStartDutyFromSchedule(date, examName, subject, time) {
    if(!window.appData.dutyRecords[date]) window.appData.dutyRecords[date] = { meta: {}, rows: [] };
    window.appData.dutyRecords[date].meta = { date, examName, subjectHeading: subject, time };
    window.appData.currentMeta = { ...window.appData.dutyRecords[date].meta };
    if(window.appData.dutyRecords[date].rows.length === 0) window.appData.roomConfigs.forEach(r => window.appData.dutyRecords[date].rows.push({room: r.name, invigilators:["", ""]}));
    saveToStorage(); renderView('dashboard');
}

function openScheduleContextMenu(e, dateStr) {
    e.preventDefault(); 
    const menu = document.getElementById('schedule-context-menu'); 
    document.getElementById('ctx-date').value = dateStr;
    document.getElementById('list-exams').innerHTML = window.appData.examNames.map(n => `<option value="${n}">`).join('');
    document.getElementById('ctx-exam').value = window.appData.currentMeta.examName || window.appData.examNames[0] || '';
    document.getElementById('ctx-time').value = ''; 
    document.getElementById('ctx-class').value = ''; 
    document.getElementById('ctx-sub').value = '';
    menu.style.display = 'block'; 
    menu.style.left = Math.min(e.pageX, window.innerWidth - 270) + 'px'; 
    menu.style.top = e.pageY + 'px';
}

function closeScheduleContextMenu() { document.getElementById('schedule-context-menu').style.display = 'none'; }
function quickAddSchedule() {
    const d=document.getElementById('ctx-date').value; 
    const t=document.getElementById('ctx-time').value.trim(); 
    const e=document.getElementById('ctx-exam').value.trim(); 
    const c=document.getElementById('ctx-class').value.trim(); 
    const s=document.getElementById('ctx-sub').value.trim();
    if(!e || !t || !c || !s) return alert("Fill all fields.");
    
    if(!window.appData.examNames.includes(e)) window.appData.examNames.push(e);
    window.appData.schedule.push({ id:'P'+Date.now(), date:d, time:t, examName:e, classes:c, subject:s });
    closeScheduleContextMenu(); 
    saveToStorage(); 
    window.appData.currentMeta.date = d; 
    renderView('schedule');
}
function clearScheduleOnRightClick() { 
    const d = document.getElementById('ctx-date').value; 
    if(confirm(`Delete ALL exams for ${d}?`)) { 
        window.appData.schedule = window.appData.schedule.filter(s => s.date !== d); 
        closeScheduleContextMenu(); 
        saveToStorage(); 
        window.appData.currentMeta.date = d; 
        renderView('schedule'); 
    } 
}

// ==========================================
// 7. EXAM MANAGER: DASHBOARD / DUTY VIEW
// ==========================================
function renderDashboard(container) {
    const expandBtn = isMobileMode ? `<button class="action-btn no-print" style="background:#e91e63; margin-bottom:15px; width:100%;" onclick="toggleCardOverlay(this)">🔲 Open in Large Overlay</button>` : '';
    const date = window.appData.currentMeta.date; 
    const daySchedules = (window.appData.schedule || []).filter(s => s.date === date);
    
    let autoTime = window.appData.currentMeta.time || ''; 
    let autoExam = window.appData.currentMeta.examName || "Examination"; 
    let autoSubj = window.appData.currentMeta.subjectHeading || '';
    
    if (daySchedules.length > 0) {
        autoTime = daySchedules[0].time || ''; 
        autoExam = daySchedules[0].examName || autoExam;
        autoSubj = [...new Set(daySchedules.filter(s => s.classes && s.subject).map(s => `${s.classes.trim()} - ${s.subject.trim()}`))].join(', ');
    }
    
    if(!window.appData.dutyRecords[date]) {
        window.appData.dutyRecords[date] = { meta: { ...window.appData.currentMeta, time: autoTime, examName: autoExam, subjectHeading: autoSubj }, rows: [] };
    } else if(daySchedules.length > 0) { 
        window.appData.dutyRecords[date].meta.time = autoTime; 
        window.appData.dutyRecords[date].meta.examName = autoExam; 
        window.appData.dutyRecords[date].meta.subjectHeading = autoSubj; 
    }
    
    window.appData.currentMeta.time = window.appData.dutyRecords[date].meta.time; 
    window.appData.currentMeta.subjectHeading = window.appData.dutyRecords[date].meta.subjectHeading;
    const record = window.appData.dutyRecords[date];

    const sortedDates = Object.keys(window.appData.dutyRecords).sort(); 
    const currIdx = sortedDates.indexOf(date);
    const prevDate = currIdx > 0 ? sortedDates[currIdx - 1] : null; 
    const prevRecord = prevDate ? window.appData.dutyRecords[prevDate] : null;

    const allAssigned = new Set(); 
    record.rows.forEach(r => (r.invigilators || []).forEach(inv => { if(inv && inv !== 'Select') allAssigned.add(inv); }));
    
    const dutyCounts = {}; 
    window.appData.staff.forEach(s => dutyCounts[s.name] = 0);
    Object.values(window.appData.dutyRecords).forEach(rec => rec.rows.forEach(r => (r.invigilators||[]).forEach(inv => { if(inv && inv !== 'Select') dutyCounts[inv] = (dutyCounts[inv]||0) + 1; })));

    let rowsHtmlText = record.rows.map((row, idx) => {
        const room = window.appData.roomConfigs.find(r => r.name === row.room);
        const genderClass = room ? (room.gender === 'Girls' ? 'room-girls' : 'room-boys') : '';
        let ghostText = "";
        
        if(prevRecord) {
            const prevRow = prevRecord.rows.find(r => r.room === row.room);
            if(prevRow && prevRow.invigilators) ghostText = `<span class="ghost-text">Prev: ${prevRow.invigilators.filter(n=>n).join(', ')}</span>`;
        }

        const invigs = (row.invigilators || []).map((inv, iIdx) => {
            const candidates = window.appData.staff.filter(s => (!s.isHidden && !allAssigned.has(s.name)) || s.name === inv).sort((a,b) => (dutyCounts[a.name]||0) - (dutyCounts[b.name]||0));
            return `
            <div class="invigilator-list" style="display:flex; gap:2px; margin-bottom:2px;">
                <select class="exam-select invig-select" style="flex-grow:1; margin:0;" onchange="updateInvig(${idx}, ${iIdx}, this.value)">
                    <option value="">-- Select --</option>${candidates.map(c => `<option value="${c.name}" ${c.name === inv ? 'selected' : ''}>${c.name} (${dutyCounts[c.name]})</option>`).join('')}
                </select>
                <button class="delete-btn no-print" onclick="removeInvig(${idx}, ${iIdx})">x</button>
            </div>`;
        }).join('');

        const allocHtml = room ? room.classes.map(c => {
            const schedMatch = daySchedules.find(s => s.classes.toUpperCase().includes(c.class.toUpperCase()));
            return `<div style="margin-bottom:4px;"><b>${c.class}</b> ${schedMatch ? `<div style="color:#e91e63; font-weight:bold; font-size:0.9em;">📖 ${schedMatch.subject}</div>` : ''} <div style="font-size:0.85em; color:#555;">Roll: ${c.rolls||(c.rollFrom?c.rollFrom+'-'+c.rollTo:'')}</div></div>`;
        }).join('<hr style="margin:4px 0; border-top:1px dashed #ccc;">') : '-';

        return `
            <tr class="${genderClass}">
                <td data-label="Room">
                    <select class="exam-select hide-on-print" onchange="updateDutyRow(${idx}, 'room', this.value)"><option>${row.room}</option>${window.appData.roomConfigs.map(r=>`<option>${r.name}</option>`).join('')}</select>
                    <span class="print-only font-bold" style="font-size:1.1em; display:none;">${row.room} <span style="font-size:0.8em; font-weight:normal;">(${room ? room.gender : ''})</span></span>
                </td>
                <td data-label="Allocation">${allocHtml}</td>
                <td data-label="Invigilators">${invigs}<button class="action-btn no-print" style="padding:2px 5px;" onclick="addInvig(${idx})">+ Staff</button>${ghostText}<span class="print-invig-text no-print" style="display:none;">${(row.invigilators||[]).join(', ')}</span></td>
                <td data-label="Absent Rolls" class="no-print"><div id="absentee-panel-${idx}"></div></td>
                <td data-label="Action" class="no-print"><button class="action-btn" style="background:#607d8b;" onclick="printRoomSheet('${row.room}')">🖨️</button><button class="delete-btn" onclick="removeDutyRow(${idx})">X</button></td>
            </tr>`;
    }).join('');

    if (rowsHtmlText === '') rowsHtmlText = `<tr><td colspan="5" style="padding: 30px; text-align: center; color: #d32f2f; font-weight: bold;">⚠️ No rooms loaded. Click "Load All Configured Rooms".</td></tr>`;

    container.innerHTML = `
        <div class="card no-print">
            <div style="display:flex; justify-content:space-between;"><h3 style="color:#ff9800;">📝 Edit Assignment: ${date}</h3><button class="action-btn" style="background:#ff9800;" onclick="autoAssignDuties()">⚡ Smart Auto-Assign</button></div>
            <div style="display:flex; gap:10px; margin-top:10px;">
                <input type="text" class="exam-input" value="${record.meta.time||''}" placeholder="Time" onchange="updateDutyMeta('time', this.value)" style="flex:1;">
                <input type="text" class="exam-input" value="${record.meta.subjectHeading||''}" placeholder="Subject Heading" onchange="updateDutyMeta('subjectHeading', this.value)" style="flex:2;">
            </div>
        </div>
        <div id="duty-print-area">
            <div class="print-header"><h2>${currentSchoolName}</h2><h3>${record.meta.examName}</h3><h4>Date: <strong>${date.split('-').reverse().join('-')}</strong> &nbsp;|&nbsp; Sub: <strong>${record.meta.subjectHeading}</strong></h4></div>
            <div class="card">
                ${expandBtn}
                <table class="assignment-table" id="duty-table">
                    <thead><tr><th>Room</th><th>Allocation</th><th>Invigilators</th><th class="no-print">Absent Rolls</th><th class="no-print">Act</th></tr></thead>
                    <tbody>${rowsHtmlText}</tbody>
                </table>
                <button class="action-btn no-print" style="width:100%; margin-top:5px; background:#3f51b5;" onclick="addDutyRow()">+ Add Blank Slot</button>
            </div>
        </div>
        <button class="action-btn" style="background:#9c27b0; width:100%; margin-top:10px;" onclick="loadAllRoomsToDuty()">🔄 Load All Configured Rooms</button>
        <div class="card no-print" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
            <button class="action-btn" style="background:#9c27b0; flex:1;" onclick="printSummaryAndReserve()">📄 Print Summary</button>
            <button class="action-btn" style="background:#d32f2f; flex:1;" onclick="downloadDutyJPG()">📥 Download JPG</button>
            <button class="action-btn" style="background:#009688; flex:1;" onclick="exportAbsenteesCSV()">📤 Export CSV</button>
            <button class="action-btn" style="background:#e91e63; flex:1;" onclick="openAbsenteeReview()">📋 Review Absentees</button>
        </div>`;

    setTimeout(() => { record.rows.forEach((row, idx) => { const room = window.appData.roomConfigs.find(r => r.name === row.room); if(room) renderAbsenteeCheckboxes(room, document.getElementById(`absentee-panel-${idx}`), date, `absentee-panel-${idx}`); }); }, 100);
}

function loadAllRoomsToDuty() { const d = window.appData.currentMeta.date; window.appData.roomConfigs.forEach(r => { if (!window.appData.dutyRecords[d].rows.find(row => row.room === r.name)) window.appData.dutyRecords[d].rows.push({ room: r.name, invigilators: ["", ""] }); }); saveToStorage(); renderView('dashboard'); }
function addDutyRow() { window.appData.dutyRecords[window.appData.currentMeta.date].rows.push({room:"", invigilators:["", ""]}); saveToStorage(); renderView('dashboard'); }
function removeDutyRow(i) { window.appData.dutyRecords[window.appData.currentMeta.date].rows.splice(i, 1); saveToStorage(); renderView('dashboard'); }
function updateDutyRow(i, f, v) { window.appData.dutyRecords[window.appData.currentMeta.date].rows[i][f]=v; saveToStorage(); renderView('dashboard'); }
function addInvig(i) { window.appData.dutyRecords[window.appData.currentMeta.date].rows[i].invigilators.push(""); saveToStorage(); renderView('dashboard'); }
function updateInvig(ri, ii, v) { window.appData.dutyRecords[window.appData.currentMeta.date].rows[ri].invigilators[ii]=v; saveToStorage(); renderView('dashboard'); }
function removeInvig(ri, ii) { window.appData.dutyRecords[window.appData.currentMeta.date].rows[ri].invigilators.splice(ii, 1); saveToStorage(); renderView('dashboard'); }
function updateDutyMeta(f, v) { window.appData.dutyRecords[window.appData.currentMeta.date].meta[f]=v; saveToStorage(); }

function autoAssignDuties() {
    const date = window.appData.currentMeta.date; 
    const record = window.appData.dutyRecords[date];
    const staffHistory = {}; 
    window.appData.staff.forEach(s => staffHistory[s.name] = { lastRoom: null, lastGender: null });
    
    Object.keys(window.appData.dutyRecords).forEach(d => { 
        window.appData.dutyRecords[d].rows.forEach(r => { 
            const roomObj = window.appData.roomConfigs.find(rc => rc.name === r.room); 
            (r.invigilators||[]).forEach(inv => { 
                if(inv && d < date) staffHistory[inv] = { lastRoom: r.room, lastGender: roomObj?roomObj.gender:'Mixed' }; 
            }); 
        }); 
    });

    let pool = [...window.appData.staff].filter(s => !s.isHidden).sort(() => Math.random() - 0.5);
    let assignedToday = new Set(); 
    record.rows.forEach(r => (r.invigilators || []).forEach(inv => { if(inv) assignedToday.add(inv); }));

    record.rows.forEach(row => {
        if(!row.invigilators) row.invigilators = ["", ""];
        const currGender = window.appData.roomConfigs.find(r => r.name === row.room)?.gender || 'Mixed';
        for(let i=0; i<row.invigilators.length; i++) {
            if(!row.invigilators[i]) {
                let candidateIdx = pool.findIndex(p => !assignedToday.has(p.name) && staffHistory[p.name].lastRoom !== row.room && (staffHistory[p.name].lastGender !== currGender || currGender === 'Mixed'));
                if (candidateIdx === -1) candidateIdx = pool.findIndex(p => !assignedToday.has(p.name) && staffHistory[p.name].lastRoom !== row.room);
                if (candidateIdx === -1) candidateIdx = pool.findIndex(p => !assignedToday.has(p.name));
                if (candidateIdx !== -1) { let chosen = pool.splice(candidateIdx, 1)[0]; row.invigilators[i] = chosen.name; assignedToday.add(chosen.name); }
            }
        }
    });
    saveToStorage(); renderView('dashboard'); alert("Smart Auto-Assignment Complete!");
}

// ==========================================
// 8. EXAM MANAGER: ABSENTEES & EXPORTS
// ==========================================
function renderAbsenteeCheckboxes(room, container, date) {
    let html = '<div class="no-print">'; let absentList = [];
    room.classes.forEach(cls => {
        let rArr = parseRolls(cls.rolls || (cls.rollFrom ? cls.rollFrom + '-' + cls.rollTo : ''));
        if(rArr.length > 0) {
            html += `<div style="margin-bottom:5px; border-bottom:1px dashed #ccc;"><strong>${cls.class}:</strong><div style="display:flex; flex-wrap:wrap; gap:5px;">`;
            rArr.forEach(r => {
                const key = `${date}_${room.name}_${cls.class}_${r}`;
                const isChecked = window.appData.absentees[key] ? 'checked' : '';
                if (isChecked) absentList.push(`${cls.class}-${r}`);
                html += `<label style="font-size:0.9em; display:flex; align-items:center;">${r} <input type="checkbox" ${isChecked} onchange="toggleAbsent('${key}')"></label>`;
            });
            html += `</div></div>`;
        }
    });
    container.innerHTML = (absentList.length > 0 ? `<div style="color:#d32f2f; font-weight:bold; margin-bottom:8px;">Absent: ${absentList.join(', ')}</div>` : '') + html + '</div>';
}
function toggleAbsent(key) { if(window.appData.absentees[key]) delete window.appData.absentees[key]; else window.appData.absentees[key] = true; saveToStorage(); }
function parseRolls(rollStr) {
    let rolls = []; String(rollStr||'').split(',').forEach(p => { p = p.trim(); if (p.includes('-')) { let [s, e] = p.split('-').map(Number); if (!isNaN(s) && !isNaN(e)) for (let i = s; i <= e; i++) rolls.push(i); } else { let v = parseInt(p); if (!isNaN(v)) rolls.push(v); } });
    return [...new Set(rolls)].sort((a, b) => a - b);
}

function exportAbsenteesCSV() {
    const date = window.appData.currentMeta.date; let csv = "Date,Room,Class,Roll\n"; let count = 0;
    Object.keys(window.appData.absentees).forEach(key => {
        if(key.startsWith(date + '_')) { const parts = key.split('_'); csv += `${parts[0]},${parts[1]},${parts[2]},${parts[3]}\n`; count++; }
    });
    if(count === 0) return alert("No absentees recorded for this date.");
    const blob = new Blob([csv], { type: 'text/csv' }); const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Absentees_${date}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function openAbsenteeReview() {
    const d = window.appData.currentMeta.date; let html = '';
    Object.keys(window.appData.absentees).filter(k => k.startsWith(d + '_')).forEach(key => {
        const p = key.split('_'); html += `<div style="padding:10px; border-bottom:1px solid #ccc; display:flex; justify-content:space-between;"><span>Room: <b>${p[1]}</b> | Class: <b>${p[2]}</b> | Roll: <b style="color:red;">${p[3]}</b></span><button class="delete-btn" onclick="toggleAbsent('${key}'); openAbsenteeReview();">Remove</button></div>`;
    });
    document.getElementById('absentee-list-container').innerHTML = html || '<p>No absentees marked.</p>';
    document.getElementById('absentee-modal').style.display = 'flex';
}
function closeAbsenteeReview() { document.getElementById('absentee-modal').style.display = 'none'; renderView('dashboard'); }

function openAllAbsenteesView() {
    let ex = new Set(); Object.values(window.appData.dutyRecords).forEach(d => { if(d.meta && d.meta.examName) ex.add(d.meta.examName); });
    document.getElementById('absentee-exam-filter').innerHTML = '<option value="ALL">All Exams</option>' + Array.from(ex).map(e => `<option>${e}</option>`).join('');
    renderAllAbsenteesList('ALL'); document.getElementById('all-absentees-modal').style.display = 'flex';
}
function renderAllAbsenteesList(filter) {
    let html = ''; Object.keys(window.appData.absentees).forEach(key => { const p = key.split('_'); const dRec = window.appData.dutyRecords[p[0]]; if(filter === 'ALL' || (dRec && dRec.meta.examName === filter)) { html += `<div style="padding:10px; border-bottom:1px solid #eee;">Date: ${p[0]} | Room: ${p[1]} | Class: ${p[2]} | Roll: <b style="color:red;">${p[3]}</b></div>`; } });
    document.getElementById('all-absentees-list').innerHTML = html || '<p>No records.</p>';
}
function closeAllAbsenteesView() { document.getElementById('all-absentees-modal').style.display = 'none'; }

function openPrintAbsenteeModal() {
    const modal = document.getElementById('print-absentee-modal');
    let exams = new Set(); let classes = new Set(); let subjects = new Set();
    Object.keys(window.appData.absentees).forEach(key => {
        let p = key.split('_'); if (p.length >= 4) {
            classes.add(p[2]);
            const m = window.appData.dutyRecords[p[0]]?.meta;
            if (m) { if(m.examName) exams.add(m.examName); subjects.add(`${p[0].split('-').reverse().join('-')} - ${m.subjectHeading||'N/A'}`); }
        }
    });

    document.getElementById('print-filter-exam').innerHTML = '<option value="ALL">All Exams</option>' + Array.from(exams).sort().map(e => `<option value="${e}">${e}</option>`).join('');
    document.getElementById('print-filter-subject').innerHTML = '<option value="ALL">All Subjects & Dates</option>' + Array.from(subjects).sort().map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('print-filter-class-container').innerHTML = Array.from(classes).sort().map(c => `<label style="display:flex; align-items:center; cursor:pointer;"><input type="checkbox" class="print-class-chk" value="${c}" checked style="margin-right:5px;">${c}</label>`).join('') || '<span style="color:#777;">No data.</span>';
    modal.style.display = 'flex';
}
function closePrintAbsenteeModal() { document.getElementById('print-absentee-modal').style.display = 'none'; }

function generateAndPrintAbsenteeList() {
    const exFilt = document.getElementById('print-filter-exam').value;
    const subFilt = document.getElementById('print-filter-subject').value;
    const clsChk = Array.from(document.querySelectorAll('.print-class-chk:checked')).map(cb => cb.value);
    
    if(clsChk.length === 0) return alert("Select at least one class!");
    
    let toPrint = [];
    Object.keys(window.appData.absentees).forEach(key => {
        let p = key.split('_'); if (p.length < 4) return;
        let dStr = p[0].split('-').reverse().join('-');
        let m = window.appData.dutyRecords[p[0]]?.meta;
        let recExam = m?.examName || '-'; let recSub = `${dStr} - ${m?.subjectHeading || '-'}`;
        
        if ((exFilt === 'ALL' || recExam === exFilt) && clsChk.includes(p[2]) && (subFilt === 'ALL' || recSub === subFilt)) {
            toPrint.push({ date: dStr, exam: recExam, subject: m?.subjectHeading||'-', room: p[1], cls: p[2], roll: parseInt(p[3]) });
        }
    });

    if (toPrint.length === 0) return alert("No absentees found for these filters.");
    toPrint.sort((a,b) => a.date !== b.date ? b.date.localeCompare(a.date) : a.cls !== b.cls ? a.cls.localeCompare(b.cls) : a.roll - b.roll);
    
    let rowsHtml = toPrint.map((a, i) => `<tr><td>${i+1}</td><td>${a.date}</td><td>${a.exam}</td><td>${a.subject}</td><td style="color:#e91e63; font-weight:bold;">${a.cls}</td><td>${a.room}</td><td style="color:red; font-weight:bold;">${a.roll}</td></tr>`).join('');

    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Absentee Report</title><style>@page { size: A4 portrait; margin: 15mm; } body { font-family: sans-serif; } table { width: 100%; border-collapse: collapse; margin-top: 20px; } th, td { border: 1px solid #333; padding: 8px; text-align: center; } th { background: #3f51b5 !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } @media print { .no-print { display: none !important; } }</style></head><body>
        <button class="no-print" onclick="window.print()" style="position:fixed; bottom:20px; right:20px; padding:10px 20px; background:#e91e63; color:white; cursor:pointer;">🖨️ Print</button>
        <div style="text-align:center;"><h2>${currentSchoolName}</h2><h3>Absentee Student Report</h3></div>
        <table><thead><tr><th>Sl</th><th>Date</th><th>Exam</th><th>Subject</th><th>Class</th><th>Room</th><th>Roll</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        <div style="margin-top:20px; text-align:right; font-weight:bold;">Total Absentees: ${toPrint.length}</div>
    </body></html>`);
    w.document.close(); setTimeout(() => w.print(), 500);
}

// ==========================================
// 9. EXAM MANAGER: PRINTERS & REPORTS
// ==========================================
function downloadDutyJPG() {
    const btn = event.target; btn.innerText = "⏳ Generating...";
    const printArea = document.getElementById('duty-print-area');
    document.body.classList.add('colorful-export-mode'); 
    setTimeout(() => {
        html2canvas(printArea, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
            const a = document.createElement('a'); a.download = `Duty_Chart_${window.appData.currentMeta.date}.jpg`;
            a.href = canvas.toDataURL('image/jpeg', 1.0); document.body.appendChild(a); a.click(); document.body.removeChild(a);
            document.body.classList.remove('colorful-export-mode'); btn.innerText = "📥 Download JPG";
        });
    }, 500);
}

function printSummaryAndReserve() {
    const w = window.open('', '_blank');
    const assigned = new Set(); window.appData.dutyRecords[window.appData.currentMeta.date].rows.forEach(r => (r.invigilators || []).forEach(i => { if(i) assigned.add(i); }));
    const reserve = window.appData.staff.filter(s => !s.isHidden && !assigned.has(s.name)).map(s => s.name);
    
    let html = `<style>body{font-family:sans-serif;} table{width:100%; border-collapse:collapse;} th,td{border:1px solid #000; padding:10px; text-align:center;} th{background:#eee;}</style>
                <h2>${currentSchoolName} - Duty Summary</h2><p>Date: ${window.appData.currentMeta.date} | Exam: ${window.appData.currentMeta.examName}</p>
                <table><tr><th>Room</th><th>Invigilators</th></tr>`;
    window.appData.dutyRecords[window.appData.currentMeta.date].rows.forEach(r => html += `<tr><td>${r.room}</td><td>${(r.invigilators||[]).join(', ')}</td></tr>`);
    html += `</table><br><h3>Reserve Staff: ${reserve.join(', ')}</h3>`;
    w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500);
}

function printAllRoomStickers() {
    const w = window.open('', '_blank');
    let html = `<html><head><title>Stickers</title><style>
        @page { size: A4 landscape; margin: 0; } body { font-family: sans-serif; margin:0; padding:0; background: white; }
        .sticker { height: 100vh; box-sizing: border-box; border: 10px solid black; padding: 2vw; text-align: center; page-break-after: always; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        h1 { font-size: 15vw; margin: 0; color: darkred; font-weight: 900; line-height: 1; }
        h2 { font-size: 3.5vw; margin: 0 0 10px 0; }
        table { width: 95%; font-size: 2.2vw; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 4px solid black; padding: 1.5vw; }
    </style></head><body>`;
    window.appData.roomConfigs.forEach(room => {
        html += `<div class="sticker"><h2>${currentSchoolName}</h2><h1>ROOM ${room.name}</h1>
                <table><tr><th>Class</th><th>Roll Range</th><th>Total</th></tr>
                ${room.classes.map(c => `<tr><td>${c.class}</td><td>${c.rolls || (c.rollFrom?c.rollFrom+'-'+c.rollTo:'')}</td><td>${c.capacity}</td></tr>`).join('')}
                </table></div>`;
    });
    html += '</body></html>';
    w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500);
}

function printRoomSittingArrangementTable() {
    if (!window.appData.roomConfigs || window.appData.roomConfigs.length === 0) return alert("No rooms configured!");
    let totalSchoolStudents = 0; let tableRowsHtml = '';
    
    window.appData.roomConfigs.forEach((room, index) => {
        const classesCount = (room.classes || []).length; let roomTotalStudents = 0;
        (room.classes || []).forEach(c => { let rArr = parseRolls(c.rolls || (c.rollFrom ? c.rollFrom + '-' + c.rollTo : '')); roomTotalStudents += rArr.length > 0 ? rArr.length : (parseInt(c.capacity) || 0); });
        totalSchoolStudents += roomTotalStudents;

        if (classesCount === 0) { tableRowsHtml += `<tr><td style="text-align:center;">${index + 1}</td><td style="text-align:center; color:#d32f2f; font-weight:bold;">Room ${room.name}</td><td colspan="3" style="text-align:center; color:#777;">No classes assigned</td><td style="text-align:center;">0</td></tr>`; } 
        else {
            (room.classes || []).forEach((c, cIdx) => {
                let rStr = c.rolls || (c.rollFrom ? c.rollFrom + '-' + c.rollTo : '');
                let rArr = parseRolls(rStr); let count = rArr.length > 0 ? rArr.length : (parseInt(c.capacity) || 0);

                tableRowsHtml += `<tr>`;
                if (cIdx === 0) tableRowsHtml += `<td rowspan="${classesCount}" style="text-align:center;">${index + 1}</td><td rowspan="${classesCount}" style="text-align:center; font-weight:bold; color:#3f51b5;">Room ${room.name}<br><small>(${room.gender})</small></td>`;
                tableRowsHtml += `<td style="text-align:center; color:#e91e63; font-weight:bold;">Class ${c.class}</td><td style="text-align:center;">${rStr || '-'}</td><td style="text-align:center; color:#2e7d32; font-weight:bold;">${count}</td>`;
                if (cIdx === 0) tableRowsHtml += `<td rowspan="${classesCount}" style="text-align:center; font-weight:900; background:#f8f9fa;">${roomTotalStudents}</td>`;
                tableRowsHtml += `</tr>`;
            });
        }
    });

    const w = window.open('', '_blank');
    w.document.write(`
        <html><head><title>Sitting Arrangement</title>
        <style>@page { size: A4 portrait; margin: 15mm; } body { font-family: sans-serif; } table { width: 100%; border-collapse: collapse; margin-top: 15px; } th, td { border: 1px solid #333; padding: 10px; } th { background: #3f51b5 !important; color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } @media print { .no-print { display: none !important; } }</style></head>
        <body>
            <button class="no-print" onclick="window.print()" style="position:fixed; bottom:20px; right:20px; padding:15px; background:#4CAF50; color:white; border-radius:5px; cursor:pointer;">🖨️ Print</button>
            <h2 style="text-align:center; color:#3f51b5; text-transform:uppercase;">${currentSchoolName}</h2>
            <h3 style="text-align:center;">${window.appData.currentMeta.examName} - Sitting Arrangement</h3>
            <table>
                <thead><tr><th>Sl.</th><th>Room</th><th>Class</th><th>Roll Range</th><th>Students</th><th>Room Total</th></tr></thead>
                <tbody>${tableRowsHtml}</tbody>
                <tfoot><tr style="background:#e8eaf6; font-weight:bold;"><td colspan="4" style="text-align:right; padding:10px;">TOTAL STUDENTS:</td><td colspan="2" style="text-align:center; font-size:18px; color:white; background:#e91e63 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${totalSchoolStudents}</td></tr></tfoot>
            </table>
        </body></html>
    `);
    w.document.close(); setTimeout(() => w.print(), 500);
}

function printRoomSheet(roomName) {
    const w = window.open('', '_blank');
    const room = window.appData.roomConfigs.find(r => r.name === roomName);
    if (!room) return alert("Room not found");
    
    let alloc = room.classes.map(c => `<b>Class ${c.class}:</b> ${c.rolls || (c.rollFrom?c.rollFrom+'-'+c.rollTo:'')}`).join('<br>');
    
    w.document.write(`
        <html><head><title>Room Sheet - ${roomName}</title>
        <style>@page { size: A4 portrait; margin: 15mm; } body { font-family: serif; } table { width: 100%; border-collapse: collapse; margin-top: 20px; } th, td { border: 1px solid black; padding: 12px; text-align: center; } th { background: #eee; } @media print { .no-print { display: none !important; } }</style></head>
        <body>
            <button class="no-print" onclick="window.print()" style="position:fixed; bottom:20px; right:20px; padding:10px; background:#4CAF50; color:white; cursor:pointer;">🖨️ Print</button>
            <h2 style="text-align:center;">${currentSchoolName}</h2>
            <h3 style="text-align:center;">Room: ${roomName}</h3>
            <p style="text-align:center; font-size:16px;">${alloc}</p>
            <table>
                <tr><th>Sl</th><th>Date</th><th>Subject</th><th>Total Present</th><th>Total Absent</th><th>Invigilator Signature</th></tr>
                <tr style="height:80px;"><td>1</td><td></td><td></td><td></td><td></td><td></td></tr>
                <tr style="height:80px;"><td>2</td><td></td><td></td><td></td><td></td><td></td></tr>
                <tr style="height:80px;"><td>3</td><td></td><td></td><td></td><td></td><td></td></tr>
            </table>
        </body></html>
    `);
    w.document.close(); setTimeout(() => w.print(), 500);
}

function printAllRoomSheets() {
    const w = window.open('', '_blank');
    let allDates = Array.from(new Set(window.appData.schedule.map(s => s.date))).sort();
    
    let fullHtml = `<html><head><title>Bulk Room Sheets</title>
        <style>
            @page { size: A4 portrait; margin: 10mm; } body { font-family: serif; margin:0; padding:0; }
            .page { page-break-after: always; width: 100%; height: 270mm; box-sizing: border-box; padding: 5mm; border: 1px solid #ccc; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; } th, td { border: 1px solid black; padding: 8px; text-align: center; } th { background: #eee; }
            .no-print { position:fixed; bottom:20px; right:20px; padding:12px; background:#2196F3; color:white; border:none; cursor:pointer; }
            @media print { .no-print { display: none !important; } }
        </style></head><body>
        <button class="no-print" onclick="window.print()">🖨️ Print All Sheets</button>`;
    
    window.appData.roomConfigs.forEach(room => {
        let alloc = room.classes.map(c => `<b>Class ${c.class}:</b> ${c.rolls || ''}`).join(' | ');
        let rowsHtml = '';
        allDates.forEach((date, i) => {
            let sched = window.appData.schedule.find(s => s.date === date && room.classes.some(c => s.classes.includes(c.class)));
            let subj = sched ? sched.subject : "---";
            rowsHtml += `<tr><td>${i + 1}</td><td>${date.split('-').reverse().join('-')}</td><td>${subj}</td><td></td><td></td><td></td></tr>`;
        });

        fullHtml += `
        <div class="page">
            <h2 style="text-align:center; margin:0;">${currentSchoolName}</h2>
            <h3 style="text-align:center; color:#d32f2f; margin:5px 0;">Room: ${room.name}</h3>
            <p style="text-align:center; font-size:14px; margin:5px 0;">${alloc}</p>
            <table><tr><th>Sl</th><th>Date</th><th>Subject</th><th>Present</th><th>Absent</th><th>Invigilator</th></tr>${rowsHtml}</table>
        </div>`;
    });
    
    fullHtml += `</body></html>`;
    w.document.write(fullHtml); w.document.close(); setTimeout(() => w.print(), 500);
}

function populateConsolidatedDropdowns() {
    let exams = new Set(); let datesObj = {}; let classes = new Set();
    Object.keys(window.appData.dutyRecords).forEach(d => {
        let meta = window.appData.dutyRecords[d].meta;
        if(meta && meta.examName) exams.add(meta.examName);
        if(meta && meta.subjectHeading) datesObj[d] = meta.subjectHeading;
    });
    window.appData.roomConfigs.forEach(r => (r.classes || []).forEach(c => { if(c.class) classes.add(c.class); }));

    document.getElementById('cons-exam').innerHTML = '<option value="ALL">All Exams</option>' + Array.from(exams).sort().map(e => `<option value="${e}">${e}</option>`).join('');
    document.getElementById('cons-date').innerHTML = '<option value="ALL">All Dates & Subjects</option>' + Object.keys(datesObj).sort().map(d => `<option value="${d}">${d.split('-').reverse().join('-')} ➔ ${datesObj[d]}</option>`).join('');
    document.getElementById('cons-class-container').innerHTML = Array.from(classes).sort().map(c => `<label style="cursor:pointer; display:flex; align-items:center; font-size:14px;"><input type="checkbox" class="cons-class-chk" value="${c}" checked style="margin:0 5px 0 0;">${c}</label>`).join('') || '<span style="color:#777;">No classes configured.</span>';
}

function executeConsolidatedReport(actionType) {
    const examVal = document.getElementById('cons-exam').value;
    const dateVal = document.getElementById('cons-date').value;
    const checkedClasses = Array.from(document.querySelectorAll('.cons-class-chk:checked')).map(cb => cb.value);

    if(checkedClasses.length === 0) return alert("Please select at least one class!");

    let datesToProcess = dateVal === 'ALL' ? Object.keys(window.appData.dutyRecords).sort() : [dateVal];
    let fullHtmlContent = '';

    datesToProcess.forEach(d => {
        let rec = window.appData.dutyRecords[d];
        if(!rec || !rec.rows || rec.rows.length === 0) return;
        if(examVal !== 'ALL' && rec.meta.examName !== examVal) return;

        let tableRows = ''; let totalAbsentForDay = 0;

        rec.rows.forEach(row => {
            let roomObj = window.appData.roomConfigs.find(r => r.name === row.room);
            if(!roomObj) return;

            let filteredClasses = roomObj.classes.filter(c => checkedClasses.includes(c.class));
            if(filteredClasses.length === 0) return; 

            let invigs = (row.invigilators || []).filter(i => i && i !== 'Select').join(', ');
            let allocText = filteredClasses.map(c => c.class).join(', ');
            
            let absentByClass = {};
            filteredClasses.forEach(c => {
                let rArr = parseRolls(c.rolls || (c.rollFrom ? c.rollFrom + '-' + c.rollTo : ''));
                let absForC = [];
                rArr.forEach(r => { if(window.appData.absentees && window.appData.absentees[`${d}_${roomObj.name}_${c.class}_${r}`]) absForC.push(r); });
                if(absForC.length > 0) { absentByClass[c.class] = absForC; totalAbsentForDay += absForC.length; }
            });

            let absHtml = Object.keys(absentByClass).length > 0 ? Object.keys(absentByClass).map(cls => `<div style="color:#d32f2f; font-weight:bold;">${cls}: ${absentByClass[cls].join(', ')}</div>`).join('') : '<span style="color:#388E3C; font-weight:bold;">NIL</span>';

            tableRows += `<tr>
                <td style="padding:10px; border:1px solid #ccc; font-weight:bold; text-align:center;">${row.room}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:center;">${allocText}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:center;">${invigs || '-'}</td>
                <td style="padding:10px; border:1px solid #ccc;">${absHtml}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:center; font-weight:bold; color:${Object.keys(absentByClass).length > 0 ? 'red' : 'green'};">${Object.keys(absentByClass).length > 0 ? Object.values(absentByClass).flat().length : 0}</td>
            </tr>`;
        });

        if(tableRows !== '') {
            fullHtmlContent += `
                <div style="margin-bottom:30px;">
                    <h3 style="background:#3f51b5; color:white; padding:10px; margin:0; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Date: ${d.split('-').reverse().join('-')} | Subject: ${rec.meta.subjectHeading}</h3>
                    <table style="width:100%; border-collapse:collapse; border:1px solid #ccc;">
                        <thead style="background:#e0e0e0; -webkit-print-color-adjust: exact; print-color-adjust: exact;"><tr><th>Room</th><th>Allocation</th><th>Invigilators</th><th>Absentee Rolls</th><th>Absent</th></tr></thead>
                        <tbody>${tableRows}</tbody>
                        <tfoot><tr><td colspan="4" style="text-align:right; font-weight:bold; padding:10px;">Total Absentees:</td><td style="text-align:center; font-weight:bold; color:white; background:#e91e63; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${totalAbsentForDay}</td></tr></tfoot>
                    </table>
                </div>`;
        }
    });

    if (fullHtmlContent === '') return alert("No data found for the selected filters.");

    const headerHtml = `<div style="text-align:center; margin-bottom:20px;"><h2>${currentSchoolName}</h2><h3>${examVal !== 'ALL' ? examVal : 'CONSOLIDATED REPORT'}</h3><p>Filtered Classes: ${checkedClasses.join(', ')}</p></div>`;

    if (actionType === 'print') {
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>Consolidated Report</title><style>@page { size: A4 portrait; margin: 15mm; } body { font-family: sans-serif; } th { padding: 10px; border: 1px solid #ccc; } @media print { .no-print { display: none !important; } }</style></head><body>
            <button class="no-print" onclick="window.print()" style="position:fixed; bottom:20px; right:20px; padding:15px; background:#00897b; color:white; cursor:pointer;">🖨️ Print Document</button>
            ${headerHtml}${fullHtmlContent}
        </body></html>`);
        w.document.close(); setTimeout(() => w.print(), 500);
    } else {
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position:absolute; left:-9999px; width:1000px; background:#fff; padding:30px; font-family:sans-serif;';
        tempDiv.innerHTML = headerHtml + fullHtmlContent;
        document.body.appendChild(tempDiv);
        setTimeout(() => {
            html2canvas(tempDiv, { scale: 2, useCORS: true }).then(canvas => {
                const a = document.createElement('a'); a.download = `Report_${dateVal}.jpg`;
                a.href = canvas.toDataURL('image/jpeg', 1.0); document.body.appendChild(a); a.click(); document.body.removeChild(a);
                document.body.removeChild(tempDiv);
            });
        }, 800);
    }
}

// ==========================================
// 10. EXAM MANAGER: STUDENT SEARCH
// ==========================================
function openStudentSearchModal() {
    let classes = new Set(); 
    window.appData.roomConfigs.forEach(r => r.classes.forEach(c => { if(c.class) classes.add(c.class); }));
    let sel = '<option value="">-- Select Class --</option>' + Array.from(classes).map(c => `<option value="${c}">${c}</option>`).join('');

    const modalId = 'search-modal';
    const d = document.createElement('div'); 
    d.id = modalId; 
    d.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;justify-content:center;align-items:center;";
    
    d.innerHTML = `
    <div style="background:#fff; padding:25px; border-radius:8px; text-align:center; width:300px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <h3 style="margin:0;">Find Student</h3>
            <button onclick="document.getElementById('${modalId}').remove()" style="background:red; color:#fff; border:none; padding:5px 10px; cursor:pointer; font-weight:bold; border-radius:4px;">Close</button>
        </div>
        <select id="s-cls" class="exam-select" style="width:100%; margin-bottom:10px;">${sel}</select>
        <select id="s-gender" class="exam-select" style="width:100%; margin-bottom:10px;">
            <option value="ALL">All (Boys & Girls)</option><option value="Boys">Boys Only</option><option value="Girls">Girls Only</option>
        </select>
        <input type="number" id="s-roll" class="exam-input" placeholder="Roll No" style="width:100%; margin-bottom:10px; padding:8px; box-sizing:border-box;">
        <button onclick="executeSearch()" style="width:100%; background:#4CAF50; color:#fff; padding:10px; border:none; cursor:pointer; font-weight:bold;">Search Room</button>
        <div id="s-res" style="margin-top:15px; font-weight:bold;"></div>
    </div>`;
    document.body.appendChild(d);
}

function executeSearch() {
    const c = document.getElementById('s-cls').value;
    const genderFilter = document.getElementById('s-gender').value;
    const rollInput = document.getElementById('s-roll').value;
    const resBox = document.getElementById('s-res');
    
    if(!c || !rollInput) { resBox.innerHTML = '<span style="color:red;">⚠️ Please select Class and Roll!</span>'; return; }
    
    const roll = parseInt(rollInput);
    let results = [];

    window.appData.roomConfigs.forEach(room => {
        if (genderFilter !== 'ALL' && room.gender !== 'Mixed' && room.gender !== genderFilter) return;
        
        room.classes.forEach(cls => {
            if(cls.class === c && parseRolls(cls.rolls || (cls.rollFrom ? cls.rollFrom + '-' + cls.rollTo : '')).includes(roll)) {
                results.push({ name: room.name, gender: room.gender });
            }
        });
    });
    
    if (results.length > 0) {
        resBox.innerHTML = `✅ Found in:<br>` + results.map(r => {
            let icon = r.gender === 'Boys' ? '👦' : (r.gender === 'Girls' ? '👧' : '🧑');
            return `<div style="margin:8px 0; padding:10px; background:#f9f9f9; border-radius:5px; border:1px solid #ddd;"><span style="font-size:1.5em; font-weight:bold; color:#e91e63;">Room: ${r.name}</span><br><span style="font-size:1.2em;">${icon} ${r.gender}</span></div>`;
        }).join('');
    } else {
        resBox.innerHTML = '❌ Not Found';
    }
}

// ==========================================
// 11. DUTY COUNTER
// ==========================================
function calculateDutyCount() {
    const startStr = document.getElementById('count-start').value;
    const endStr = document.getElementById('count-end').value;
    if(!startStr || !endStr) return alert("Please select both From and To dates.");
    
    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime() + 86400000; 

    let counts = {};
    window.appData.staff.forEach(s => counts[s.name] = 0);

    Object.keys(window.appData.dutyRecords).forEach(date => {
        let dTime = new Date(date).getTime();
        if(dTime >= start && dTime < end) {
            window.appData.dutyRecords[date].rows.forEach(r => {
                (r.invigilators || []).forEach(inv => {
                    if(inv && inv !== 'Select' && counts[inv] !== undefined) counts[inv]++;
                });
            });
        }
    });

    let sorted = Object.keys(counts).map(k => ({name: k, count: counts[k]})).sort((a,b) => b.count - a.count);
    let html = sorted.map(s => `<div style="padding:6px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;"><span>${s.name}</span> <b style="color:#e91e63;">${s.count} Duties</b></div>`).join('');
    document.getElementById('duty-count-result').innerHTML = html || '<span style="color:red;">No duties found in this range.</span>';
}