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
  let celebrationCanvas = null;
  let celebrationContext = null;
  let celebrationFrameId = null;
  let celebrationLastFrame = 0;
  let celebrationStreamers = [];
  let celebrationConfetti = [];
  let celebrationSize = { width: 0, height: 0, ratio: 1 };

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

  function normalizeNumberInput(value) {
    return String(value ?? "")
      .trim()
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
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

  function randomId(prefix) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${id}`;
  }

  function centralAverage(rows = cloudParticipants) {
    if (!rows.length) return 0;
    return Math.round(rows.reduce((sum, row) => sum + (Number(row.score) || 0), 0) / rows.length);
  }

  function traitKeyFromTitle(title) {
    return Object.keys(traits).find((key) => traits[key].title === title);
  }

  function centralRowForInsert(row, number) {
    return {
      participant_number: number,
      score: Math.max(0, Math.min(96, Number(row.score) || 0)),
      quality_type: row.quality_type || "تعديل يدوي",
      answers: Array.isArray(row.answers) ? row.answers : [],
      completed_at: row.completed_at || new Date().toISOString(),
      session_id: row.session_id || randomId("admin-restore")
    };
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

  function ensureCompletionCelebration() {
    const box = $("completionCelebration");
    if (!box || box.dataset.ready === "true") return;
    celebrationCanvas = document.createElement("canvas");
    celebrationCanvas.className = "celebration-canvas";
    celebrationCanvas.setAttribute("aria-hidden", "true");
    box.textContent = "";
    box.appendChild(celebrationCanvas);
    celebrationContext = celebrationCanvas.getContext("2d");
    box.dataset.ready = "true";
    resizeCompletionCelebration();
    window.addEventListener("resize", resizeCompletionCelebration);
  }

  function resizeCompletionCelebration() {
    if (!celebrationCanvas) return;
    const box = $("completionCelebration");
    const rect = box?.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect?.width || window.innerWidth || 1));
    const height = Math.max(1, Math.round(rect?.height || window.innerHeight || 1));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (celebrationSize.width === width && celebrationSize.height === height && celebrationSize.ratio === ratio) return;
    celebrationSize = { width, height, ratio };
    celebrationCanvas.width = Math.round(width * ratio);
    celebrationCanvas.height = Math.round(height * ratio);
    celebrationCanvas.style.width = `${width}px`;
    celebrationCanvas.style.height = `${height}px`;
    if (celebrationContext) celebrationContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    createCompletionCelebrationItems(width, height);
  }

  function createCompletionCelebrationItems(width, height) {
    const colors = ["#0a6b5b", "#16b985", "#59ddb0", "#08745f", "#143d38", "#8ee8ca"];
    const streamers = [
      [0.04, -0.12, 42, 7.5, 0], [0.14, 0.18, -38, 8.1, 1], [0.27, -0.3, 54, 7.2, 2],
      [0.40, 0.06, -46, 8.7, 3], [0.54, -0.22, 36, 7.8, 4], [0.68, 0.24, -44, 8.5, 5],
      [0.81, -0.08, 50, 7.1, 1], [0.94, 0.32, -34, 8.3, 2], [0.10, -0.5, -52, 9.1, 0],
      [0.74, -0.42, 58, 9.4, 3]
    ];
    celebrationStreamers = streamers.map(([x, y, drift, seconds, colorIndex], index) => ({
      x: width * x,
      y: height * y,
      drift,
      speed: (height + 360) / seconds,
      length: Math.max(130, Math.min(300, height * (index % 3 === 1 ? .18 : .14))),
      amp: 16 + (index % 4) * 5,
      width: 6 + (index % 3),
      phase: index * 1.7,
      wave: .0026 + (index % 3) * .0007,
      color: colors[colorIndex]
    }));
    celebrationConfetti = Array.from({ length: 64 }, (_, index) => ({
      x: width * (((index * 17) % 100) / 100),
      y: height * (-.05 - ((index * 11) % 120) / 100),
      drift: (index % 2 ? -1 : 1) * (18 + (index % 5) * 10),
      speed: 75 + (index % 7) * 18,
      size: 3 + (index % 4),
      phase: index * .91,
      color: colors[index % colors.length]
    }));
  }

  function drawStreamer(ctx, streamer, time) {
    const points = [];
    const segments = 7;
    for (let i = 0; i <= segments; i += 1) {
      const p = i / segments;
      const y = p * streamer.length;
      const x = Math.sin(p * 8.2 + time * streamer.wave + streamer.phase) * streamer.amp
        + Math.sin(time * streamer.wave * 1.7 + streamer.phase) * 8;
      points.push([x, y]);
    }
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const cpX = (prev[0] + curr[0]) / 2 + Math.sin(time * streamer.wave * 2 + streamer.phase + i) * streamer.amp * .35;
        const cpY = (prev[1] + curr[1]) / 2;
        ctx.quadraticCurveTo(cpX, cpY, curr[0], curr[1]);
      }
    };
    const sway = Math.sin(time * streamer.wave + streamer.phase) * 34;
    const rotate = Math.sin(time * streamer.wave * 1.4 + streamer.phase) * .55;
    ctx.save();
    ctx.translate(streamer.x + sway, streamer.y);
    ctx.rotate(rotate);
    trace();
    ctx.lineWidth = streamer.width + 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(20,61,56,.15)";
    ctx.stroke();
    trace();
    ctx.lineWidth = streamer.width;
    ctx.strokeStyle = streamer.color;
    ctx.stroke();
    trace();
    ctx.lineWidth = Math.max(2, streamer.width * .34);
    ctx.strokeStyle = "rgba(255,255,255,.62)";
    ctx.setLineDash([16, 18]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawCompletionCelebration(now) {
    if (!$("completionCelebration")?.classList.contains("is-visible")) return;
    resizeCompletionCelebration();
    const ctx = celebrationContext;
    if (!ctx) return;
    const { width, height, ratio } = celebrationSize;
    const delta = Math.min(.04, Math.max(.001, (now - (celebrationLastFrame || now)) / 1000));
    celebrationLastFrame = now;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    celebrationStreamers.forEach((streamer) => {
      streamer.y += streamer.speed * delta;
      if (streamer.y > height + streamer.length + 30) streamer.y = -streamer.length - Math.random() * height * .55;
      drawStreamer(ctx, streamer, now);
    });
    celebrationConfetti.forEach((piece) => {
      piece.y += piece.speed * delta;
      if (piece.y > height + 20) piece.y = -20 - Math.random() * height * .35;
      const wobble = Math.sin(now * .003 + piece.phase) * piece.drift;
      ctx.save();
      ctx.translate(piece.x + wobble, piece.y);
      ctx.rotate(now * .004 + piece.phase);
      ctx.fillStyle = piece.color;
      ctx.globalAlpha = .72;
      ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * .72);
      ctx.globalAlpha = 1;
      ctx.restore();
    });
    celebrationFrameId = requestAnimationFrame(drawCompletionCelebration);
  }

  function setCompletionCelebration(active) {
    ensureCompletionCelebration();
    const box = $("completionCelebration");
    const app = $("displayApp");
    app?.classList.toggle("is-complete", active);
    box?.classList.toggle("is-visible", active);
    if (active) {
      if (!celebrationFrameId) {
        celebrationLastFrame = performance.now();
        celebrationFrameId = requestAnimationFrame(drawCompletionCelebration);
      }
    } else {
      if (celebrationFrameId) cancelAnimationFrame(celebrationFrameId);
      celebrationFrameId = null;
      celebrationLastFrame = 0;
      if (celebrationContext) celebrationContext.clearRect(0, 0, celebrationSize.width, celebrationSize.height);
    }
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
    const isComplete = count >= MAX_PARTICIPANTS;
    setCompletionCelebration(isComplete);

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

  function initParticipantRealtime() {
    if (!supabase) return;
    let syncTimer = null;
    const sync = () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        try {
          await refreshCentralParticipants();
          if ($("adminScreen").classList.contains("is-active")) renderAdmin();
        } catch (error) {
          console.warn("Participant realtime sync failed", error);
        }
      }, 150);
    };
    const channel = supabase.channel("participants-play")
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, sync)
      .subscribe();
    window.addEventListener("beforeunload", () => { supabase.removeChannel(channel); });
  }

  function renderAdmin() {
    const total = participantCount();
    const rows = isSupabaseConfigured ? cloudParticipants : submissions;
    const avg = total ? Math.round(rows.reduce((s, x) => s + Number(x.score ?? x.score96 ?? 0), 0) / total) : 0;
    $("adminTotal").textContent = total;
    $("adminAverage").textContent = avg;
    const stats = {};
    Object.keys(traits).forEach((k) => stats[k] = 0);
    rows.forEach((s) => {
      const traitKey = s.trait || traitKeyFromTitle(s.quality_type || s.traitTitle);
      if (stats[traitKey] !== undefined) stats[traitKey] += 1;
    });
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

  async function openAdmin() {
    clearInterval(timerId);
    clearInterval(autoResetId);
    if (supabase) {
      try { await refreshCentralParticipants(); }
      catch (error) { console.warn("Admin refresh failed", error); toast("تعذر تحديث بيانات لوحة المشرف الآن"); }
    }
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

  async function setCentralParticipantCount(count) {
    const existing = await refreshCentralParticipants();
    const current = existing.length;
    if (count === current) return;

    const { error: setCountError } = await supabase.rpc("set_participant_count", { p_count: count });
    if (!setCountError) {
      await refreshCentralParticipants();
      return;
    }
    const missingRpc = setCountError.code === "PGRST202" || String(setCountError.message || "").includes("set_participant_count");
    if (!missingRpc) throw setCountError;
    console.warn("set_participant_count RPC is unavailable; using compatibility path", setCountError);

    if (count > current) {
      const fillerScore = centralAverage(existing);
      for (let number = current + 1; number <= count; number += 1) {
        const { error } = await supabase.rpc("complete_participant", {
          p_session_id: randomId("admin-count"),
          p_score: fillerScore,
          p_quality_type: "تعديل يدوي",
          p_answers: []
        });
        if (error) throw error;
      }
      await refreshCentralParticipants();
      return;
    }

    const preserved = existing.slice(0, count).map((row, index) => centralRowForInsert(row, index + 1));
    const { error: resetError } = await supabase.rpc("reset_participants");
    if (resetError) throw resetError;
    for (const item of preserved) {
      const { error } = await supabase.rpc("complete_participant", {
        p_session_id: item.session_id,
        p_score: item.score,
        p_quality_type: item.quality_type,
        p_answers: item.answers
      });
      if (error) throw error;
    }
    await refreshCentralParticipants();
  }

  async function editParticipantCount() {
    const requested = prompt("أدخل إجمالي المشاركات الذي تريد عرضه:", String(participantCount()));
    if (requested === null) return;
    const count = Number(normalizeNumberInput(requested));
    if (!Number.isFinite(count) || count < 0 || count > MAX_PARTICIPANTS || !Number.isInteger(count)) {
      toast("أدخل رقمًا صحيحًا من 0 إلى 96");
      return;
    }
    try {
      if (supabase) {
        await setCentralParticipantCount(count);
      } else {
        participantAdjustment = count - submissions.length;
        writeParticipantAdjustment();
      }
      renderAdmin();
      updateCounters();
      toast("تم تعديل إجمالي المشاركات");
    } catch (error) {
      console.error("Participant count edit failed", error);
      toast("تعذر تعديل المشاركات الآن");
    }
  }

  async function resetAll() {
    const code = prompt("لتأكيد حذف جميع النتائج اكتب: 96");
    if (normalizeNumberInput(code) !== "96") return;
    if (supabase) {
      const { error } = await supabase.rpc("reset_participants");
      if (error) {
        console.warn("Central reset failed; trying set_participant_count fallback", error);
        const { error: fallbackError } = await supabase.rpc("set_participant_count", { p_count: 0 });
        if (fallbackError) {
          console.error("Central reset failed", fallbackError);
          toast("تعذر تصفير العداد المركزي الآن");
          return;
        }
      }
      await refreshCentralParticipants();
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
      initParticipantRealtime();
    }
    bindEvents();
    updateFullscreenButton();
    if (new URLSearchParams(location.search).get("admin") === "1") openAdmin();

  }

  init();
})();
