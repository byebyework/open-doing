/* Open Doing 原型：最小交互（仅用于演示，非生产代码） */
(function () {
  "use strict";

  // 通知气泡开关
  document.addEventListener("click", function (e) {
    const bell = e.target.closest("[data-popover-trigger]");
    if (bell) {
      const id = bell.getAttribute("data-popover-trigger");
      const pop = document.getElementById(id);
      if (pop) pop.classList.toggle("open");
      return;
    }
    if (!e.target.closest(".popover")) {
      document.querySelectorAll(".popover.open").forEach((p) => p.classList.remove("open"));
    }
  });

  // 弹窗
  function setModal(sel, open) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!el) return;
    el.classList.toggle("open", open);
  }
  document.addEventListener("click", function (e) {
    const opener = e.target.closest("[data-modal-open]");
    if (opener) {
      setModal("#" + opener.getAttribute("data-modal-open"), true);
      return;
    }
    const closer = e.target.closest("[data-modal-close]");
    if (closer) {
      setModal(closer.closest(".modal-backdrop"), false);
      return;
    }
    if (e.target.classList && e.target.classList.contains("modal-backdrop")) {
      setModal(e.target, false);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
  });

  // 分段切换（列表/看板等）—— 同页面内切换提示；真实视图是两个路由
  document.querySelectorAll("[data-seg]").forEach(function (seg) {
    seg.addEventListener("click", function (e) {
      const btn = e.target.closest("button[data-href]");
      if (!btn) return;
      seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.href) window.location.href = btn.dataset.href;
    });
  });

  // 子任务勾选
  document.addEventListener("change", function (e) {
    const cb = e.target.closest(".subtask input[type=checkbox], .task-check");
    if (!cb) return;
    const row = cb.closest(".subtask");
    if (row) row.classList.toggle("done", cb.checked);
    updateProgress();
  });

  function updateProgress() {
    document.querySelectorAll("[data-progress-from]").forEach(function (wrap) {
      const list = document.querySelector(wrap.getAttribute("data-progress-from"));
      if (!list) return;
      const boxes = list.querySelectorAll("input[type=checkbox]");
      const done = list.querySelectorAll("input[type=checkbox]:checked").length;
      const pct = boxes.length ? Math.round((done / boxes.length) * 100) : 0;
      wrap.querySelector(".progress > span").style.width = pct + "%";
      wrap.querySelector(".pct").textContent = pct + "%";
      wrap.querySelector(".ratio").textContent = done + "/" + boxes.length;
    });
  }
  updateProgress();

  // 看板：HTML5 拖拽（演示用）
  const cards = document.querySelectorAll(".kanban-card[draggable=true]");
  let dragging = null;
  cards.forEach(function (card) {
    card.addEventListener("dragstart", function () {
      dragging = card;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", function () {
      card.classList.remove("dragging");
      dragging = null;
      document.querySelectorAll(".kcol.drag-over").forEach((c) => c.classList.remove("drag-over"));
    });
  });
  document.querySelectorAll(".kcol .kcol-body, .kcol").forEach(function (col) {
    const body = col.classList.contains("kcol-body") ? col : col.querySelector(".kcol-body");
    if (!body) return;
    body.addEventListener("dragover", function (e) {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    body.addEventListener("dragleave", function () {
      col.classList.remove("drag-over");
    });
    body.addEventListener("drop", function (e) {
      e.preventDefault();
      col.classList.remove("drag-over");
      if (dragging) body.appendChild(dragging);
    });
  });
})();
