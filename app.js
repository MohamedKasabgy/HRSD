import { supabase, isSupabaseConfigured } from "./src/lib/supabase.js";

(() => {
  "use strict";

  const MAX_PARTICIPANTS = 96;
  const TARGET = MAX_PARTICIPANTS;
  const TOTAL_SECONDS = 96;
  const AUTO_RESET_SECONDS = 15;
  const DB_NAME = "quality96DB";
  const STORE_NAME = "submissions";
  const BACKUP_KEY = "quality96_submissions_backup_v1";
  const COUNT_ADJUSTMENT_KEY = "quality96_participant_adjustment_v1";

  const traits = {
    impact: { title: "صانع الأثر", description: "تربط القرار بالنتيجة، وتتعامل مع الأداء كأثر قابل للقياس والاستدامة.", mark: "◆" },
    efficiency: { title: "قائد الكفاءة", description: "تبحث عن الطريقة الأذكى لتحقيق النتائج مع الحفاظ على جودة التنفيذ.", mark: "↗" },
    quality: { title: "عين الجودة", description: "تبحث عن الأسباب قبل الحلول، وتركّز على منع تكرار المشكلة.", mark: "◎" },
    innovation: { title: "مبتكر الحلول", description: "تحوّل التحديات إلى فرص، وتختبر الفكرة وتقيس أثرها قبل التوسع.", mark: "+" },
    beneficiary: { title: "صوت المستفيد", description: "تضع تجربة المستفيد في قلب القرار وتوازن بينها وبين مؤشرات الأداء.", mark: "◉" }
  };

  // المحتوى مأخوذ من العرض المقدم للمشروع.
  // weight: 3 = القرار الأفضل، 2 = قرار جزئي/ناقص، 1 = القرار الأضعف.
  const questions = [
    {
      category: "الكفاءة", trait: "efficiency",
      text: "إجراء يومي يستغرق 7 خطوات ويمكن إنجازه في 4 دون التأثير على الجودة.",
      options: [
        { text: "أستمر كما هو لأنه الإجراء المعتاد.", weight: 1 },
        { text: "أختصر الخطوات مباشرة.", weight: 2 },
        { text: "أدرس الخطوات، أحدد غير الضروري، أقترح التحسين وأقيس أثره.", weight: 3 }
      ]
    },
    {
      category: "الجودة", trait: "quality",
      text: "تتكرر ملاحظة معينة من المستفيدين.",
      options: [
        { text: "أعالج كل حالة بشكل منفصل.", weight: 2 },
        { text: "أحلل الملاحظات، أحدد السبب الجذري، وأقترح إجراءً يمنع تكرارها.", weight: 3 },
        { text: "أنتظر زيادة عدد الملاحظات.", weight: 1 }
      ]
    },
    {
      category: "الأداء", trait: "impact",
      text: "حقق أحد المؤشرات المستهدف المطلوب 100%.",
      options: [
        { text: "انتهى العمل على المؤشر.", weight: 1 },
        { text: "أرفع المستهدف مباشرة.", weight: 2 },
        { text: "أتحقق من استدامة النتيجة وأحلل أسباب النجاح وفرص التحسين.", weight: 3 }
      ]
    },
    {
      category: "الابتكار", trait: "innovation",
      text: "لديك فكرة تعتقد أنها ستوفر وقت الموظفين.",
      options: [
        { text: "أطبقها على الجميع مباشرة.", weight: 2 },
        { text: "أجربها على نطاق صغير، أقيس النتيجة، ثم أطورها قبل التوسع.", weight: 3 },
        { text: "أحتفظ بها حتى أتأكد تمامًا من نجاحها.", weight: 1 }
      ]
    },
    {
      category: "تجربة المستفيد", trait: "beneficiary",
      text: "الإجراء يحقق المؤشر الداخلي، لكن المستفيدين ما زالوا يرونه معقدًا.",
      options: [
        { text: "ناجح لأن المؤشر تحقق.", weight: 1 },
        { text: "غير ناجح لأن رضا المستفيد أهم من كل المؤشرات.", weight: 2 },
        { text: "أراجع المؤشر وتجربة المستفيد معًا لتحديد فجوة الأداء.", weight: 3 }
      ]
    }
  ];

  const $ = (id) => document.getElementById(id);
  const screens = ["homeScreen", "quizScreen", "resultScreen", "adminScreen"];

  let db = null;
  let submissions = [];
  let participantAdjustment = 0;
  let currentQuestion = 0;
  let answers = [];
  let timerId = null;
  let remaining = TOTAL_SECONDS;
  let startedAt = 0;
  let questionShownAt = 0;
  let autoResetId = null;
  let adminTapCount = 0;
  let adminTapTimer = null;
  let cloudParticipants = [];
  let currentSessionId = null;
  let completionInProgress = false;

  function showScreen(id) {
    screens.forEach((screenId) => {
      const el = $(screenId);
      const active = screenId === id;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  async function openDB() {
    if (!window.indexedDB) return null;
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async function readDB() {
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function putDB(item) {
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  async function clearDB() {
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  function readBackup() {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]"); }
    catch { return []; }
  }

  function writeBackup() {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(submissions)); } catch {}
  }

  function readParticipantAdjustment() {
    try {
      const value = Number(localStorage.getItem(COUNT_ADJUSTMENT_KEY) || 0);
      return Number.isFinite(value) ? Math.round(value) : 0;
    } catch { return 0; }
  }

  function writeParticipantAdjustment() {
    try { localStorage.setItem(COUNT_ADJUSTMENT_KEY, String(participantAdjustment)); } catch {}
  }

  function participantCount() {
    return isSupabaseConfigured ? cloudParticipants.length : Math.max(0, submissions.length + participantAdjustment);
  }

  async function loadSubmissions() {
    const fromDB = await readDB();
    const fromBackup = readBackup();
    submissions = fromDB.length >= fromBackup.length ? fromDB : fromBackup;
    submissions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    // Restore DB from backup if IndexedDB was temporarily empty.
    if (db && fromDB.length < submissions.length) {
      for (const item of submissions) await putDB(item);
    }
    updateCounters();
  }

  async function refreshCentralParticipants() {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("participants")
      .select("id, participant_number, score, quality_type, answers, completed_at, session_id")
      .order("participant_number", { ascending: true });
    if (error) throw error;
    cloudParticipants = data || [];
    updateCounters();
    return cloudParticipants;
  }

  async function saveSubmission(item) {
    // يحتفظ الجهاز بالنتيجة فقط كـ pending إذا تعذر الاتصال؛ العداد العام لا يتغير قبل نجاح RPC.
    if (!supabase) {
      item.pending = true;
      submissions.push(item);
      writeBackup();
      await putDB(item);
      return { ...item, participant_number: participantCount() };
    }
    const { data, error } = await supabase.rpc("complete_participant", {
      p_session_id: item.session_id,
      p_score: item.score96,
      p_quality_type: item.traitTitle,
      p_answers: item.answers
    });
    if (error) throw error;
    const saved = data?.[0];
    if (!saved) throw new Error("No participant returned from submission");
    item.pending = false;
    item.participant_number = saved.participant_number;
    submissions.push(item);
    writeBackup();
    await putDB(item);
    await refreshCentralParticipants();
    return saved;
  }

  async function retryPendingSubmissions() {
    if (!supabase) return;
    for (const item of submissions.filter((submission) => submission.pending && submission.session_id)) {
      try {
        const { data, error } = await supabase.rpc("complete_participant", {
          p_session_id: item.session_id,
          p_score: item.score96,
          p_quality_type: item.traitTitle,
          p_answers: item.answers
        });
        if (error || !data?.[0]) throw error || new Error("No participant returned from pending submission");
        const saved = data[0];
        item.pending = false;
        item.participant_number = saved.participant_number;
      } catch (error) { console.warn("Pending participant sync failed", error); }
    }
    writeBackup();
    await refreshCentralParticipants();
  }

  function updateCounters() {
    const count = participantCount();
    $("homeCount").textContent = Math.min(count, TARGET);
    $("homeProgress").style.width = `${Math.min(100, (count / TARGET) * 100)}%`;
    const state = $("targetState");
    if (count >= TARGET) {
      state.textContent = "تم الوصول إلى 96 مشاركة — الهدف مكتمل";
      state.classList.add("done");
    } else {
      state.textContent = `متبقي ${TARGET - count} للوصول إلى الهدف`;
      state.classList.remove("done");
    }
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  }

  function updateFullscreenButton() {
    const button = $("fullscreenBtn");
    if (!button) return;
    const active = !!fullscreenElement();
    button.setAttribute("aria-label", active ? "الخروج من ملء الشاشة" : "تشغيل ملء الشاشة");
    button.querySelector("span:last-child").textContent = active ? "الخروج من ملء الشاشة" : "ملء الشاشة";
  }

  async function enterFullscreen() {
    const el = document.documentElement;
    try {
      if (fullscreenElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit) await exit.call(document);
        return;
      }

      const request = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (!request) throw new Error("Fullscreen API is unavailable");
      await request.call(el);
    } catch {
      // iOS Safari and embedded previews may prohibit browser full screen.
      // The layout still fills the available viewport in those environments.
      window.scrollTo(0, 0);
      toast("ملء الشاشة غير مدعوم هنا — افتح الصفحة في المتصفح ثم اضغط الزر");
    } finally {
      updateFullscreenButton();
    }
  }

  async function startChallenge() {
    if (supabase) {
      try { await refreshCentralParticipants(); }
      catch (error) { console.warn("Unable to refresh participant count", error); toast("تعذر التحقق من حالة التحدي الآن"); return; }
      if (participantCount() >= MAX_PARTICIPANTS) { toast("اكتمل تحدي الـ 96 مشاركًا"); return; }
    }
    clearTimeout(autoResetId);
    currentSessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    completionInProgress = false;
    currentQuestion = 0;
    answers = [];
    remaining = TOTAL_SECONDS;
    startedAt = Date.now();
    $("timerValue").textContent = remaining;
    $("timer").classList.remove("is-low");
    showScreen("quizScreen");
    renderQuestion();
    clearInterval(timerId);
    timerId = setInterval(() => {
      remaining -= 1;
      $("timerValue").textContent = Math.max(remaining, 0);
      if (remaining <= 15) $("timer").classList.add("is-low");
      if (remaining <= 0) finishByTimeout();
    }, 1000);
  }

  function renderQuestion() {
    const q = questions[currentQuestion];
    $("questionNumber").textContent = currentQuestion + 1;
    $("questionCategory").textContent = q.category;
    $("questionText").textContent = q.text;
    $("stepProgress").style.width = `${((currentQuestion + 1) / questions.length) * 100}%`;
    const options = $("options");
    options.innerHTML = "";
    const letters = ["أ", "ب", "ج"];
    q.options.forEach((opt, index) => {
      const button = document.createElement("button");
      button.className = "option-button";
      button.type = "button";
      button.innerHTML = `<span class="option-letter">${letters[index]}</span><span class="option-text"></span>`;
      button.querySelector(".option-text").textContent = opt.text;
      button.addEventListener("click", () => selectOption(index));
      options.appendChild(button);
    });
    questionShownAt = Date.now();
  }

  function selectOption(optionIndex) {
    const q = questions[currentQuestion];
    const selected = q.options[optionIndex];
    answers.push({
      questionIndex: currentQuestion,
      category: q.category,
      trait: q.trait,
      optionIndex,
      text: selected.text,
      weight: selected.weight,
      responseMs: Math.max(0, Date.now() - questionShownAt)
    });
    currentQuestion += 1;
    if (currentQuestion >= questions.length) completeChallenge(false);
    else renderQuestion();
  }

  function finishByTimeout() {
    clearInterval(timerId);
    // الأسئلة غير المجابة تعامل كأضعف وزن حتى يبقى المؤشر على مقياس موحّد.
    for (let i = currentQuestion; i < questions.length; i++) {
      const q = questions[i];
      const weakestIndex = q.options.reduce((best, opt, idx, arr) => opt.weight < arr[best].weight ? idx : best, 0);
      const opt = q.options[weakestIndex];
      answers.push({
        questionIndex: i, category: q.category, trait: q.trait,
        optionIndex: weakestIndex, text: opt.text, weight: opt.weight, responseMs: TOTAL_SECONDS * 1000
      });
    }
    completeChallenge(true);
  }

  function calculateResult() {
    const totalWeight = answers.reduce((sum, a) => sum + a.weight, 0);
    const score96 = Math.max(0, Math.min(96, Math.round((totalWeight / (questions.length * 3)) * 96)));

    // البصمة = البعد الذي ظهر فيه أقوى قرار. عند التعادل، القرار الأسرع يحسم النتيجة.
    const ranked = answers.map((a) => ({ trait: a.trait, weight: a.weight, responseMs: a.responseMs }));
    ranked.sort((a, b) => b.weight - a.weight || a.responseMs - b.responseMs);
    const traitKey = ranked[0]?.trait || "impact";
    return { score96, traitKey };
  }

  async function completeChallenge(timedOut) {
    if (completionInProgress) return;
    completionInProgress = true;
    clearInterval(timerId);
    const { score96, traitKey } = calculateResult();
    const durationSeconds = Math.min(TOTAL_SECONDS, Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    const item = {
      id: currentSessionId,
      session_id: currentSessionId,
      createdAt: new Date().toISOString(),
      score96,
      trait: traitKey,
      traitTitle: traits[traitKey].title,
      durationSeconds,
      timedOut: !!timedOut,
      answers: answers.map(({ questionIndex, category, optionIndex, weight, responseMs }) => ({ questionIndex, category, optionIndex, weight, responseMs }))
    };
    try {
      const saved = await saveSubmission(item);
      item.participant_number = saved.participant_number;
      renderResult(item);
    } catch (error) {
      console.error("Participant submission failed", error);
      if (String(error.message || error).includes("MAX_PARTICIPANTS_REACHED")) {
        toast("اكتمل تحدي الـ 96 مشاركًا");
        resetToHome();
      } else {
        toast("تعذر حفظ النتيجة الآن. ستتم المحاولة تلقائيًا عند عودة الاتصال.");
        item.pending = true;
        submissions.push(item);
        writeBackup();
        await putDB(item);
        renderResult(item);
      }
    } finally { completionInProgress = false; }
  }

  function renderResult(item) {
    const trait = traits[item.trait] || traits.impact;
    $("scoreValue").textContent = item.score96;
    $("traitTitle").textContent = trait.title;
    $("traitDescription").textContent = trait.description;
    $("traitIcon").textContent = trait.mark;
    $("participantNumber").textContent = item.participant_number || "—";
    const average = cloudParticipants.length
      ? Math.round(cloudParticipants.reduce((sum, participant) => sum + participant.score, 0) / cloudParticipants.length)
      : null;
    $("resultComparison").hidden = average === null;
    if (average !== null) $("groupAverage").textContent = average;
    const circumference = 2 * Math.PI * 92;
    const offset = circumference * (1 - item.score96 / 96);
    $("scoreRing").style.strokeDasharray = circumference.toFixed(2);
    $("scoreRing").style.strokeDashoffset = circumference.toFixed(2);
    showScreen("resultScreen");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $("scoreRing").style.strokeDashoffset = offset.toFixed(2);
    }));

    let seconds = AUTO_RESET_SECONDS;
    $("autoResetText").textContent = `ستعود الشاشة تلقائيًا خلال ${seconds} ثانية`;
    clearInterval(autoResetId);
    autoResetId = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        clearInterval(autoResetId);
        resetToHome();
      } else {
        $("autoResetText").textContent = `ستعود الشاشة تلقائيًا خلال ${seconds} ثانية`;
      }
    }, 1000);
  }

  function resetToHome() {
    clearInterval(timerId);
    clearInterval(autoResetId);
    answers = [];
    currentQuestion = 0;
    updateCounters();
    showScreen("homeScreen");
  }

  function renderDisplay(rows, newlyCompletedNumber = null) {
    const count = rows.length;
    const scores = rows.map((row) => Number(row.score) || 0);
    const average = count ? Math.round(scores.reduce((sum, score) => sum + score, 0) / count) : 0;
    const highest = count ? Math.max(...scores) : 0;
    const distribution = Object.fromEntries(Object.values(traits).map((trait) => [trait.title, 0]));
    rows.forEach((row) => { if (distribution[row.quality_type] !== undefined) distribution[row.quality_type] += 1; });
    const leading = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0];

    $("displayCount").textContent = count;
    $("displayAverage").textContent = count ? average : "—";
    $("displayHigh").textContent = count ? highest : "—";
    $("displayTrait").textContent = count && leading?.[1] ? leading[0] : "—";
    $("completionMessage").hidden = count < MAX_PARTICIPANTS;

    const grid = $("participantGrid");
    grid.innerHTML = "";
    for (let number = 1; number <= MAX_PARTICIPANTS; number += 1) {
      const cell = document.createElement("div");
      cell.className = `participant-cell${number <= count ? " is-complete" : ""}${number === newlyCompletedNumber ? " is-new" : ""}`;
      cell.textContent = number;
      grid.appendChild(cell);
    }
    const traitsBox = $("displayTraits");
    traitsBox.innerHTML = "";
    Object.entries(distribution).forEach(([name, value]) => {
      const row = document.createElement("div");
      const percentage = count ? (value / count) * 100 : 0;
      row.className = "display-trait-row";
      row.innerHTML = `<span></span><i><b></b></i><strong>${value}</strong>`;
      row.querySelector("span").textContent = name;
      row.querySelector("b").style.width = `${percentage}%`;
      traitsBox.appendChild(row);
    });
  }

  async function initDisplay() {
    document.documentElement.classList.add("is-display-view");
    document.body.classList.add("is-display-view");
    $("app").hidden = true;
    $("displayApp").hidden = false;
    const status = $("displayStatus");
    const setStatus = (message) => { status.textContent = message; };
    if (!supabase) { setStatus("لم يتم إعداد الاتصال بالبيانات المركزية بعد."); renderDisplay([]); return; }
    const sync = async () => {
      try { await refreshCentralParticipants(); renderDisplay(cloudParticipants); setStatus("يتم التحديث تلقائيًا"); }
      catch (error) { console.warn("Display sync failed", error); setStatus("سيُعاد الاتصال تلقائيًا…"); }
    };
    await sync();
    const channel = supabase.channel("participants-display")
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, (payload) => {
        const row = payload.new;
        if (payload.eventType === "INSERT" && !cloudParticipants.some((participant) => participant.id === row.id)) {
          cloudParticipants = [...cloudParticipants, row].sort((a, b) => a.participant_number - b.participant_number);
          renderDisplay(cloudParticipants, row.participant_number);
          setStatus("تم التحديث الآن");
        } else if (payload.eventType === "DELETE") {
          sync();
        }
      })
      .subscribe((state) => { if (state === "SUBSCRIBED") setStatus("يتم التحديث تلقائيًا"); });
    setInterval(sync, 12000);
    $("displayFullscreenBtn").addEventListener("click", async () => {
      await enterFullscreen();
      $("displayFullscreenBtn").classList.add("is-muted");
    });
    window.addEventListener("beforeunload", () => { supabase.removeChannel(channel); });
  }

  function renderAdmin() {
    const total = participantCount();
    const avg = total ? Math.round(submissions.reduce((s, x) => s + Number(x.score96 || 0), 0) / total) : 0;
    $("adminTotal").textContent = total;
    $("adminAverage").textContent = avg;
    const stats = {};
    Object.keys(traits).forEach((k) => stats[k] = 0);
    submissions.forEach((s) => { if (stats[s.trait] !== undefined) stats[s.trait] += 1; });
    const box = $("traitStats");
    box.innerHTML = "";
    Object.entries(traits).forEach(([key, value]) => {
      const count = stats[key] || 0;
      const pct = total ? (count / total) * 100 : 0;
      const row = document.createElement("div");
      row.className = "trait-stat";
      row.innerHTML = `<div class="trait-stat-info"><div class="trait-stat-name"></div><div class="trait-stat-bar"><span style="width:${pct}%"></span></div></div><div class="trait-stat-count">${count}</div>`;
      row.querySelector(".trait-stat-name").textContent = value.title;
      box.appendChild(row);
    });
  }

  function openAdmin() {
    clearInterval(timerId);
    clearInterval(autoResetId);
    renderAdmin();
    showScreen("adminScreen");
  }

  function escapeCsv(value) {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCSV() {
    const header = ["رقم", "التاريخ", "المؤشر_من_96", "البصمة", "المدة_بالثواني", "انتهاء_الوقت", "س1", "س2", "س3", "س4", "س5"];
    const rows = submissions.map((s, i) => {
      const answerCells = Array.from({ length: 5 }, (_, qIndex) => {
        const a = (s.answers || []).find((x) => Number(x.questionIndex) === qIndex);
        if (!a) return "";
        const q = questions[qIndex];
        const opt = q?.options?.[Number(a.optionIndex)];
        return opt ? `${Number(a.optionIndex) + 1} - ${opt.text} [${a.weight}/3]` : `${Number(a.optionIndex) + 1}`;
      });
      return [
        i + 1,
        s.createdAt,
        s.score96,
        s.traitTitle || traits[s.trait]?.title || s.trait,
        s.durationSeconds,
        s.timedOut ? "نعم" : "لا",
        ...answerCells
      ];
    });
    const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quality96-results-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportBackup() {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      submissions,
      participantAdjustment
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quality96-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast("تم تنزيل النسخة الاحتياطية");
  }

  async function restoreBackup(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!Array.isArray(backup.submissions)) throw new Error("Invalid backup");
      const merged = new Map(submissions.map((item) => [item.id, item]));
      backup.submissions.forEach((item) => {
        if (item && item.id) merged.set(item.id, item);
      });
      submissions = Array.from(merged.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const adjustment = Number(backup.participantAdjustment);
      participantAdjustment = Number.isFinite(adjustment) ? Math.round(adjustment) : participantAdjustment;
      writeBackup();
      writeParticipantAdjustment();
      for (const item of submissions) await putDB(item);
      renderAdmin();
      updateCounters();
      toast("تمت استعادة النسخة الاحتياطية");
    } catch {
      toast("تعذر قراءة ملف النسخة الاحتياطية");
    }
  }

  function editParticipantCount() {
    const requested = prompt("أدخل إجمالي المشاركات الذي تريد عرضه:", String(participantCount()));
    if (requested === null) return;
    const count = Number(requested);
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      toast("أدخل رقمًا صحيحًا موجبًا أو صفرًا");
      return;
    }
    participantAdjustment = count - submissions.length;
    writeParticipantAdjustment();
    renderAdmin();
    updateCounters();
    toast("تم تعديل إجمالي المشاركات");
  }

  async function resetAll() {
    const code = prompt("لتأكيد حذف جميع النتائج اكتب: 96");
    if (code !== "96") return;
    if (supabase) {
      const { error } = await supabase.rpc("reset_participants");
      if (error) {
        console.error("Central reset failed", error);
        toast("تعذر تصفير العداد المركزي الآن");
        return;
      }
      cloudParticipants = [];
    }
    submissions = [];
    participantAdjustment = 0;
    writeBackup();
    writeParticipantAdjustment();
    await clearDB();
    renderAdmin();
    updateCounters();
    toast("تم تصفير النتائج");
  }

  function bindEvents() {
    $("startBtn").addEventListener("click", async () => {
      await startChallenge();
    });
    $("finishBtn").addEventListener("click", resetToHome);
    $("fullscreenBtn").addEventListener("click", enterFullscreen);
    $("fullscreenAdminBtn").addEventListener("click", enterFullscreen);
    $("closeAdminBtn").addEventListener("click", resetToHome);
    $("exportBtn").addEventListener("click", exportCSV);
    $("backupBtn").addEventListener("click", exportBackup);
    $("restoreBtn").addEventListener("click", () => $("restoreInput").click());
    $("restoreInput").addEventListener("change", (event) => {
      restoreBackup(event.target.files?.[0]);
      event.target.value = "";
    });
    $("editCountBtn").addEventListener("click", editParticipantCount);
    $("resetBtn").addEventListener("click", resetAll);

    $("adminTrigger").addEventListener("click", () => {
      adminTapCount += 1;
      clearTimeout(adminTapTimer);
      adminTapTimer = setTimeout(() => adminTapCount = 0, 1800);
      if (adminTapCount >= 5) {
        adminTapCount = 0;
        openAdmin();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") openAdmin();
      if (e.key === "Escape" && $("adminScreen").classList.contains("is-active")) resetToHome();
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("dragstart", (e) => e.preventDefault());
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
  }

  async function clearLegacyOfflineCache() {
    // لا نحتفظ بنسخة Offline حتى تظهر تحديثات الفعالية فور نشرها.
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("quality96-")).map((key) => caches.delete(key)));
    }
  }

  async function init() {
    clearLegacyOfflineCache().catch((error) => console.warn("Cache cleanup failed", error));
    if (location.pathname.replace(/\/+$/, "") === "/display" || new URLSearchParams(location.search).get("view") === "display") {
      await initDisplay();
      return;
    }
    db = await openDB();
    participantAdjustment = readParticipantAdjustment();
    await loadSubmissions();
    if (supabase) {
      try { await refreshCentralParticipants(); await retryPendingSubmissions(); }
      catch (error) { console.warn("Supabase initial sync failed", error); toast("تعمل الشاشة محليًا حتى يعود الاتصال بالبيانات المركزية"); }
    }
    bindEvents();
    updateFullscreenButton();
    if (new URLSearchParams(location.search).get("admin") === "1") openAdmin();

  }

  init();
})();
