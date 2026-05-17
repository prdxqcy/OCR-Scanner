const selectionBox = document.getElementById("selectionBox");
const trackerLabel = document.getElementById("trackerLabel");
const url = new URL(window.location.href);
const offsetX = Number(url.searchParams.get("offsetX") || 0);
const offsetY = Number(url.searchParams.get("offsetY") || 0);
const selectedTrackerLabel = url.searchParams.get("trackerLabel") || "Tracker";

trackerLabel.textContent = selectedTrackerLabel;

let dragStart = null;

function renderBox(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x);
  const height = Math.abs(start.y - end.y);

  selectionBox.classList.remove("hidden");
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

window.addEventListener("mousedown", (event) => {
  dragStart = { x: event.clientX, y: event.clientY };
  renderBox(dragStart, dragStart);
});

window.addEventListener("mousemove", (event) => {
  if (!dragStart) {
    return;
  }

  renderBox(dragStart, { x: event.clientX, y: event.clientY });
});

window.addEventListener("mouseup", (event) => {
  if (!dragStart) {
    return;
  }

  const x = Math.min(dragStart.x, event.clientX);
  const y = Math.min(dragStart.y, event.clientY);
  const width = Math.abs(dragStart.x - event.clientX);
  const height = Math.abs(dragStart.y - event.clientY);

  dragStart = null;

  if (width < 8 || height < 8) {
    window.scannerApi.cancelSelection();
    return;
  }

  window.scannerApi.confirmSelection({
    x: x + offsetX,
    y: y + offsetY,
    width,
    height
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.scannerApi.cancelSelection();
  }
});
