const IMAGE_PRESETS = {
  high: { targetKb: 800, maxWidth: 2560, maxHeight: 2560, startQuality: 0.92, minQuality: 0.45 },
  balanced: { targetKb: 400, maxWidth: 1920, maxHeight: 1920, startQuality: 0.86, minQuality: 0.38 },
  low: { targetKb: 200, maxWidth: 1280, maxHeight: 1280, startQuality: 0.78, minQuality: 0.32 },
};

const VIDEO_PRESETS = {
  high: { maxWidth: 1920, maxHeight: 1080, crf: 24, audioKbps: 128 },
  balanced: { maxWidth: 1920, maxHeight: 1080, crf: 29, audioKbps: 96 },
  low: { maxWidth: 1280, maxHeight: 720, crf: 33, audioKbps: 64 },
};

const SUPPORTED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);
const SUPPORTED_VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm", "avi"]);
const MAX_RECOMMENDED_VIDEO_BYTES = 500 * 1024 * 1024;
const ZIP_IMAGE_LIMIT = 100;
const ZIP_SIZE_LIMIT = 700 * 1024 * 1024;

const state = {
  items: [],
  processing: false,
  cancelRequested: false,
  currentVideoItem: null,
  ffmpeg: null,
  ffmpegLoaded: false,
  ffmpegLogHandler: null,
  ffmpegProgressHandler: null,
  batches: [],
  toastTimer: null,
};

const el = {
  fileInput: document.getElementById("fileInput"),
  folderInput: document.getElementById("folderInput"),
  dropZone: document.getElementById("dropZone"),
  clearButton: document.getElementById("clearButton"),
  startButton: document.getElementById("startButton"),
  cancelButton: document.getElementById("cancelButton"),
  selectedCount: document.getElementById("selectedCount"),
  imageCount: document.getElementById("imageCount"),
  videoCount: document.getElementById("videoCount"),
  originalSize: document.getElementById("originalSize"),
  selectionNotice: document.getElementById("selectionNotice"),
  fileList: document.getElementById("fileList"),
  emptyQueue: document.getElementById("emptyQueue"),
  overallProgressWrap: document.getElementById("overallProgressWrap"),
  overallProgressText: document.getElementById("overallProgressText"),
  overallProgressPercent: document.getElementById("overallProgressPercent"),
  overallProgressBar: document.getElementById("overallProgressBar"),
  engineStatus: document.getElementById("engineStatus"),
  engineStatusTitle: document.getElementById("engineStatusTitle"),
  engineStatusText: document.getElementById("engineStatusText"),
  customImageKb: document.getElementById("customImageKb"),
  zipName: document.getElementById("zipName"),
  resultCard: document.getElementById("resultCard"),
  resultTitle: document.getElementById("resultTitle"),
  resultSummary: document.getElementById("resultSummary"),
  resultOriginal: document.getElementById("resultOriginal"),
  resultCompressed: document.getElementById("resultCompressed"),
  resultReduction: document.getElementById("resultReduction"),
  downloadList: document.getElementById("downloadList"),
  downloadAllButton: document.getElementById("downloadAllButton"),
  toast: document.getElementById("toast"),
};

init();

function init() {
  el.zipName.value = `압축파일_${formatDateTime(new Date())}`;
  bindEvents();
  registerServiceWorker();
  updatePresetCards();
  render();
}

function bindEvents() {
  el.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  el.folderInput.addEventListener("change", (event) => addFiles(event.target.files));
  el.dropZone.addEventListener("click", (event) => {
    if (event.target.closest("label")) return;
    el.fileInput.click();
  });
  el.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el.fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((type) => el.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropZone.classList.add("drag-over");
  }));
  ["dragleave", "drop"].forEach((type) => el.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropZone.classList.remove("drag-over");
  }));
  el.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  document.querySelectorAll('input[name="imagePreset"], input[name="videoPreset"]').forEach((input) => {
    input.addEventListener("change", updatePresetCards);
  });
  el.customImageKb.addEventListener("focus", () => {
    const customRadio = document.querySelector('input[name="imagePreset"][value="custom"]');
    customRadio.checked = true;
    updatePresetCards();
  });
  el.customImageKb.addEventListener("change", () => {
    el.customImageKb.value = String(clamp(Number(el.customImageKb.value) || 300, 50, 2000));
  });

  el.clearButton.addEventListener("click", clearAll);
  el.startButton.addEventListener("click", processAll);
  el.cancelButton.addEventListener("click", cancelProcessing);
  el.downloadAllButton.addEventListener("click", downloadAllBatches);
  el.fileList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-id]");
    if (button && !state.processing) removeItem(button.dataset.removeId);
  });
  el.downloadList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-download-batch]");
    if (button) downloadBatch(Number(button.dataset.downloadBatch), button);
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.processing) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

function addFiles(fileList) {
  if (state.processing) return;
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;

  const existingKeys = new Set(state.items.map((item) => item.sourceKey));
  let unsupported = 0;
  let duplicate = 0;
  let largeVideos = 0;

  for (const file of incoming) {
    const ext = getExtension(file.name);
    const kind = SUPPORTED_IMAGE_EXTS.has(ext) ? "image" : SUPPORTED_VIDEO_EXTS.has(ext) ? "video" : null;
    if (!kind) {
      unsupported += 1;
      continue;
    }
    const sourceKey = `${file.name}::${file.size}::${file.lastModified}`;
    if (existingKeys.has(sourceKey)) {
      duplicate += 1;
      continue;
    }
    existingKeys.add(sourceKey);
    if (kind === "video" && file.size > MAX_RECOMMENDED_VIDEO_BYTES) largeVideos += 1;
    state.items.push({
      id: createId(),
      sourceKey,
      file,
      kind,
      ext,
      relativePath: file.webkitRelativePath || "",
      status: "waiting",
      statusText: "대기",
      progress: 0,
      outputBlob: null,
      outputSize: 0,
      note: "",
      error: "",
      previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
    });
  }

  el.fileInput.value = "";
  el.folderInput.value = "";
  state.batches = [];
  el.resultCard.classList.add("hidden");

  const notices = [];
  if (unsupported) notices.push(`지원하지 않는 파일 ${unsupported}개는 제외했습니다.`);
  if (duplicate) notices.push(`동일한 파일 ${duplicate}개는 중복 추가하지 않았습니다.`);
  if (largeVideos) notices.push(`500MB를 넘는 동영상 ${largeVideos}개는 모바일에서 실패할 수 있습니다.`);
  const imageCount = state.items.filter((item) => item.kind === "image").length;
  if (imageCount > ZIP_IMAGE_LIMIT) notices.push(`사진 ${imageCount}장은 ZIP당 최대 100장씩 자동 분할됩니다.`);
  showSelectionNotice(notices.join(" "));
  render();
}

function removeItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  releaseItem(state.items[index]);
  state.items.splice(index, 1);
  state.batches = [];
  el.resultCard.classList.add("hidden");
  render();
}

function clearAll() {
  if (state.processing) return;
  state.items.forEach(releaseItem);
  state.items = [];
  state.batches = [];
  showSelectionNotice("");
  el.resultCard.classList.add("hidden");
  resetProgress();
  render();
}

function releaseItem(item) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  item.outputBlob = null;
}

async function processAll() {
  if (state.processing || !state.items.length) return;

  state.processing = true;
  state.cancelRequested = false;
  state.batches = [];
  el.resultCard.classList.add("hidden");
  el.overallProgressWrap.classList.remove("hidden");
  el.cancelButton.classList.remove("hidden");
  el.startButton.disabled = true;
  el.clearButton.disabled = true;

  for (const item of state.items) {
    item.status = "waiting";
    item.statusText = "대기";
    item.progress = 0;
    item.outputBlob = null;
    item.outputSize = 0;
    item.note = "";
    item.error = "";
  }
  renderFileList();

  const settings = getSettings();
  let completed = 0;

  for (const item of state.items) {
    if (state.cancelRequested) break;
    item.status = "processing";
    item.statusText = item.kind === "image" ? "사진 압축 중" : "영상 준비 중";
    item.progress = 2;
    renderFileList();
    updateOverallProgress(completed, state.items.length, item.file.name);

    try {
      const result = item.kind === "image"
        ? await compressImage(item, settings.image)
        : await compressVideo(item, settings.video);

      if (state.cancelRequested) break;
      item.outputBlob = result.blob;
      item.outputSize = result.blob.size;
      item.note = result.note || "";
      item.progress = 100;
      item.status = "done";
      item.statusText = "완료";
    } catch (error) {
      if (state.cancelRequested) break;
      console.error(error);
      item.status = "error";
      item.statusText = "실패";
      item.error = humanizeError(error, item.kind);
      item.progress = 0;
    }

    completed += 1;
    renderFileList();
    updateOverallProgress(completed, state.items.length, item.file.name);
    await nextFrame();
  }

  state.processing = false;
  el.cancelButton.classList.add("hidden");
  el.engineStatus.classList.add("hidden");
  el.clearButton.disabled = state.items.length === 0;
  el.startButton.disabled = state.items.length === 0;

  if (state.cancelRequested) {
    state.items.forEach((item) => {
      if (item.status === "processing" || item.status === "waiting") {
        item.status = "waiting";
        item.statusText = "중지됨";
        item.progress = 0;
      }
    });
    showToast("압축을 중지했습니다.");
    render();
    return;
  }

  const successItems = state.items.filter((item) => item.status === "done" && item.outputBlob);
  if (successItems.length) {
    state.batches = buildBatches(successItems);
    showResults(successItems);
    el.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    showToast("완료된 파일이 없습니다. 실패 내용을 확인해주세요.");
  }
  render();
}

function cancelProcessing() {
  if (!state.processing) return;
  state.cancelRequested = true;
  el.cancelButton.disabled = true;
  el.cancelButton.textContent = "중지 중";
  if (state.ffmpeg && state.currentVideoItem) {
    try { state.ffmpeg.terminate(); } catch (error) { console.warn(error); }
    state.ffmpeg = null;
    state.ffmpegLoaded = false;
    state.currentVideoItem = null;
  }
  setTimeout(() => {
    el.cancelButton.disabled = false;
    el.cancelButton.textContent = "중지";
  }, 500);
}

async function compressImage(item, preset) {
  const file = item.file;
  const mime = imageMimeFromExtension(item.ext);
  const targetBytes = preset.targetKb * 1024;

  if (file.size <= targetBytes && getMaxDimensionPreset(file, preset)) {
    item.progress = 85;
    renderFileList();
  }

  const source = await decodeImage(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  let { width, height } = fitWithin(sourceWidth, sourceHeight, preset.maxWidth, preset.maxHeight);
  const isLossy = mime === "image/jpeg" || mime === "image/webp";
  let bestBlob = null;
  let bestDistance = Infinity;
  let attempts = 0;

  try {
    for (let scaleAttempt = 0; scaleAttempt < 9; scaleAttempt += 1) {
      if (state.cancelRequested) throw new DOMException("중지됨", "AbortError");
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(width));
      canvas.height = Math.max(2, Math.round(height));
      const context = canvas.getContext("2d", { alpha: mime === "image/png" });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      if (mime === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      if (isLossy) {
        let low = preset.minQuality;
        let high = preset.startQuality;
        let localBest = null;
        for (let qTry = 0; qTry < 7; qTry += 1) {
          const quality = qTry === 0 ? high : (low + high) / 2;
          const blob = await canvasToBlob(canvas, mime, quality);
          attempts += 1;
          const distance = Math.abs(blob.size - targetBytes);
          if (!bestBlob || distance < bestDistance || (blob.size <= targetBytes && bestBlob.size > targetBytes)) {
            bestBlob = blob;
            bestDistance = distance;
          }
          if (blob.size <= targetBytes) {
            localBest = blob;
            low = quality;
          } else {
            high = quality;
          }
          item.progress = Math.min(94, 10 + Math.round((scaleAttempt * 7 + qTry + 1) / 70 * 84));
          renderFileList();
        }
        if (localBest && localBest.size >= targetBytes * 0.72) {
          bestBlob = localBest;
          break;
        }
      } else {
        const blob = await canvasToBlob(canvas, mime);
        attempts += 1;
        if (!bestBlob || Math.abs(blob.size - targetBytes) < bestDistance || (blob.size <= targetBytes && bestBlob.size > targetBytes)) {
          bestBlob = blob;
          bestDistance = Math.abs(blob.size - targetBytes);
        }
        item.progress = Math.min(94, 15 + scaleAttempt * 10);
        renderFileList();
        if (blob.size <= targetBytes) break;
      }

      if (bestBlob && bestBlob.size <= targetBytes * 1.03) break;
      if (width <= 420 || height <= 420) break;
      const ratio = bestBlob ? Math.sqrt(targetBytes / bestBlob.size) : 0.82;
      const scale = clamp(ratio * 0.97, 0.72, 0.9);
      width = Math.max(2, Math.floor(width * scale));
      height = Math.max(2, Math.floor(height * scale));
      await nextFrame();
    }
  } finally {
    if (typeof source.close === "function") source.close();
    if (source.objectUrl) URL.revokeObjectURL(source.objectUrl);
  }

  if (!bestBlob) throw new Error("사진을 변환하지 못했습니다.");
  if (bestBlob.size >= file.size) {
    return { blob: file.slice(0, file.size, file.type || mime), note: "압축본보다 원본이 작아 원본을 유지했습니다." };
  }
  const note = bestBlob.size > targetBytes * 1.08
    ? `확장자 유지로 목표 ${preset.targetKb.toLocaleString()}KB보다 크게 생성되었습니다.`
    : `${attempts}회 최적화`;
  return { blob: bestBlob, note };
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      console.warn("createImageBitmap fallback", error);
    }
  }
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      image.width = image.naturalWidth;
      image.height = image.naturalHeight;
      image.objectUrl = objectUrl;
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("사진을 열 수 없습니다."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지 생성에 실패했습니다.")), mime, quality);
  });
}

async function compressVideo(item, preset) {
  if (item.file.size > MAX_RECOMMENDED_VIDEO_BYTES && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
    item.note = "500MB 초과 영상";
  }
  const ffmpeg = await ensureFFmpeg();
  if (state.cancelRequested) throw new DOMException("중지됨", "AbortError");

  const [{ fetchFile }] = await Promise.all([import("./vendor/ffmpeg-util/index.js")]);
  const metadata = await getVideoMetadata(item.file);
  const dimensions = fitWithinEven(metadata.width || preset.maxWidth, metadata.height || preset.maxHeight, preset.maxWidth, preset.maxHeight);
  const safeExt = item.ext === "m4v" ? "mp4" : item.ext;
  const token = item.id.replace(/[^a-zA-Z0-9]/g, "");
  const inputName = `input_${token}.${safeExt}`;
  const outputName = `output_${token}.${safeExt}`;

  state.currentVideoItem = item;
  item.statusText = "영상 불러오는 중";
  item.progress = 4;
  renderFileList();

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(item.file));
    item.statusText = "영상 압축 중";
    item.progress = 7;
    renderFileList();

    const args = buildVideoArgs(inputName, outputName, safeExt, dimensions, preset);
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) throw new Error(`동영상 변환 코드 ${exitCode}`);
    const data = await ffmpeg.readFile(outputName);
    const mime = videoMimeFromExtension(item.ext);
    let blob = new Blob([data.buffer], { type: mime });

    if (blob.size >= item.file.size) {
      blob = item.file.slice(0, item.file.size, item.file.type || mime);
      return { blob, note: "압축본보다 원본이 작아 원본을 유지했습니다." };
    }
    return { blob, note: `${dimensions.width}×${dimensions.height}` };
  } finally {
    state.currentVideoItem = null;
    try { await ffmpeg.deleteFile(inputName); } catch (_) {}
    try { await ffmpeg.deleteFile(outputName); } catch (_) {}
  }
}

function buildVideoArgs(inputName, outputName, ext, dimensions, preset) {
  const common = [
    "-i", inputName,
    "-map_metadata", "-1",
    "-vf", `scale=${dimensions.width}:${dimensions.height}`,
  ];

  if (ext === "webm") {
    return [
      ...common,
      "-c:v", "libvpx-vp9",
      "-crf", String(preset.crf + 2),
      "-b:v", "0",
      "-deadline", "good",
      "-cpu-used", "5",
      "-row-mt", "1",
      "-c:a", "libopus",
      "-b:a", `${preset.audioKbps}k`,
      outputName,
    ];
  }

  if (ext === "avi") {
    return [
      ...common,
      "-c:v", "mpeg4",
      "-q:v", String(Math.max(4, Math.round((preset.crf - 18) / 2))),
      "-c:a", "libmp3lame",
      "-b:a", `${preset.audioKbps}k`,
      outputName,
    ];
  }

  return [
    ...common,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", String(preset.crf),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", `${preset.audioKbps}k`,
    "-movflags", "+faststart",
    outputName,
  ];
}

async function ensureFFmpeg() {
  if (state.ffmpegLoaded && state.ffmpeg) return state.ffmpeg;

  el.engineStatus.classList.remove("hidden");
  el.engineStatusTitle.textContent = "동영상 압축 엔진 준비 중";
  el.engineStatusText.textContent = "최초 1회 압축 모듈을 내려받습니다.";

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import("./vendor/ffmpeg/index.js"),
    import("./vendor/ffmpeg-util/index.js"),
  ]);

  const ffmpeg = new FFmpeg();
  state.ffmpeg = ffmpeg;
  state.ffmpegProgressHandler = ({ progress }) => {
    if (!state.currentVideoItem) return;
    const safeProgress = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
    state.currentVideoItem.progress = Math.max(8, Math.min(96, Math.round(8 + safeProgress * 88)));
    renderFileList();
  };
  state.ffmpegLogHandler = ({ message }) => {
    if (state.currentVideoItem && /time=/.test(message)) {
      state.currentVideoItem.statusText = "영상 압축 중";
    }
  };
  ffmpeg.on("progress", state.ffmpegProgressHandler);
  ffmpeg.on("log", state.ffmpegLogHandler);

  const baseUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  const downloadProgress = ({ total, received }) => {
    if (total > 0) {
      const percent = Math.min(100, Math.round(received / total * 100));
      el.engineStatusText.textContent = `압축 엔진 다운로드 ${percent}%`;
    }
  };

  try {
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript", true, downloadProgress),
      toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, "application/wasm", true, downloadProgress),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    state.ffmpegLoaded = true;
    el.engineStatusTitle.textContent = "동영상 압축 엔진 준비 완료";
    el.engineStatusText.textContent = "동영상은 한 개씩 순차 처리합니다.";
    setTimeout(() => {
      if (!state.currentVideoItem) el.engineStatus.classList.add("hidden");
    }, 900);
    return ffmpeg;
  } catch (error) {
    state.ffmpeg = null;
    state.ffmpegLoaded = false;
    throw new Error("동영상 압축 엔진을 불러오지 못했습니다. 인터넷 연결과 브라우저를 확인해주세요.");
  }
}

function getVideoMetadata(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const data = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      cleanup();
      resolve(data);
    };
    video.onerror = () => {
      cleanup();
      resolve({ width: 0, height: 0, duration: 0 });
    };
    video.src = url;
  });
}

function buildBatches(items) {
  const batches = [];
  let current = createEmptyBatch();
  for (const item of items) {
    const wouldExceedImages = item.kind === "image" && current.imageCount >= ZIP_IMAGE_LIMIT;
    const wouldExceedSize = current.items.length > 0 && current.totalSize + item.outputBlob.size > ZIP_SIZE_LIMIT;
    if (wouldExceedImages || wouldExceedSize) {
      batches.push(current);
      current = createEmptyBatch();
    }
    current.items.push(item);
    current.totalSize += item.outputBlob.size;
    if (item.kind === "image") current.imageCount += 1;
  }
  if (current.items.length) batches.push(current);
  return batches.map((batch, index) => ({ ...batch, index, blob: null, generating: false }));
}

function createEmptyBatch() {
  return { items: [], totalSize: 0, imageCount: 0 };
}

async function generateBatchBlob(batch) {
  if (batch.blob) return batch.blob;
  if (!window.JSZip) throw new Error("ZIP 모듈을 불러오지 못했습니다.");
  batch.generating = true;
  renderDownloadList();
  const zip = new window.JSZip();
  const duplicateCount = new Map();

  for (const item of batch.items) {
    const baseName = item.file.name;
    const count = (duplicateCount.get(baseName) || 0) + 1;
    duplicateCount.set(baseName, count);
    const path = count === 1 ? baseName : `중복파일_${count}/${baseName}`;
    zip.file(path, item.outputBlob, { binary: true, compression: "STORE" });
  }

  batch.blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
  batch.generating = false;
  renderDownloadList();
  return batch.blob;
}

async function downloadBatch(index, button) {
  const batch = state.batches[index];
  if (!batch || batch.generating) return;
  const oldText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "ZIP 생성 중";
  }
  try {
    const blob = await generateBatchBlob(batch);
    triggerDownload(blob, batchFileName(index));
  } catch (error) {
    console.error(error);
    showToast("ZIP 생성에 실패했습니다.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "다운로드";
    }
  }
}

async function downloadAllBatches() {
  if (!state.batches.length) return;
  el.downloadAllButton.disabled = true;
  const originalText = el.downloadAllButton.textContent;
  try {
    for (let i = 0; i < state.batches.length; i += 1) {
      el.downloadAllButton.textContent = `ZIP 생성 중 ${i + 1}/${state.batches.length}`;
      const blob = await generateBatchBlob(state.batches[i]);
      triggerDownload(blob, batchFileName(i));
      if (i < state.batches.length - 1) await delay(900);
    }
    showToast(state.batches.length > 1 ? "분할 ZIP 다운로드를 시작했습니다." : "ZIP 다운로드를 시작했습니다.");
  } catch (error) {
    console.error(error);
    showToast("ZIP 생성 중 오류가 발생했습니다.");
  } finally {
    el.downloadAllButton.disabled = false;
    el.downloadAllButton.textContent = originalText;
  }
}

function batchFileName(index) {
  const base = sanitizeZipBaseName(el.zipName.value) || `압축파일_${formatDateTime(new Date())}`;
  return state.batches.length > 1 ? `${base}_${index + 1}부.zip` : `${base}.zip`;
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function showResults(successItems) {
  const original = successItems.reduce((sum, item) => sum + item.file.size, 0);
  const compressed = successItems.reduce((sum, item) => sum + item.outputSize, 0);
  const reduction = original > 0 ? Math.max(0, (1 - compressed / original) * 100) : 0;
  const failed = state.items.filter((item) => item.status === "error").length;

  el.resultTitle.textContent = `${successItems.length}개 파일 압축 완료`;
  el.resultSummary.textContent = failed ? `실패 ${failed}개를 제외하고 ZIP ${state.batches.length}개로 준비했습니다.` : `원래 파일명을 유지해 ZIP ${state.batches.length}개로 준비했습니다.`;
  el.resultOriginal.textContent = formatBytes(original);
  el.resultCompressed.textContent = formatBytes(compressed);
  el.resultReduction.textContent = `${reduction.toFixed(reduction >= 10 ? 1 : 2)}%`;
  el.resultCard.classList.remove("hidden");
  renderDownloadList();
}

function render() {
  const imageCount = state.items.filter((item) => item.kind === "image").length;
  const videoCount = state.items.filter((item) => item.kind === "video").length;
  const totalSize = state.items.reduce((sum, item) => sum + item.file.size, 0);
  el.selectedCount.textContent = `${state.items.length.toLocaleString()}개`;
  el.imageCount.textContent = `${imageCount.toLocaleString()}장`;
  el.videoCount.textContent = `${videoCount.toLocaleString()}개`;
  el.originalSize.textContent = formatBytes(totalSize);
  el.clearButton.disabled = state.processing || state.items.length === 0;
  el.startButton.disabled = state.processing || state.items.length === 0;
  el.emptyQueue.classList.toggle("hidden", state.items.length > 0);
  el.fileList.classList.toggle("hidden", state.items.length === 0);
  renderFileList();
}

function renderFileList() {
  if (!state.items.length) {
    el.fileList.innerHTML = "";
    return;
  }
  el.fileList.innerHTML = state.items.map((item) => {
    const resultMeta = item.outputSize ? ` → ${formatBytes(item.outputSize)}` : "";
    const note = item.error || item.note;
    const thumb = item.kind === "image" && item.previewUrl
      ? `<img src="${escapeAttribute(item.previewUrl)}" alt="" />`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h9a3 3 0 013 3v10a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3z"/><path d="M18 9l3-2v10l-3-2z"/><path d="M9 9l5 3-5 3V9z"/></svg>`;
    return `
      <div class="file-row" data-item-id="${item.id}">
        <div class="file-thumb">${thumb}</div>
        <div class="file-info">
          <div class="file-topline">
            <span class="file-name" title="${escapeAttribute(item.file.name)}">${escapeHtml(item.file.name)}</span>
            <span class="file-type-chip">${item.kind === "image" ? "사진" : "영상"}</span>
          </div>
          <div class="file-meta">
            <span>${formatBytes(item.file.size)}${resultMeta}</span>
            ${note ? `<span>· ${escapeHtml(note)}</span>` : ""}
          </div>
          ${item.status === "processing" ? `<div class="file-progress"><span style="width:${item.progress}%"></span></div>` : ""}
        </div>
        <div class="file-status ${item.status}">
          ${escapeHtml(item.statusText)}
          ${!state.processing && item.status !== "processing" ? `<button class="remove-file" type="button" data-remove-id="${item.id}" aria-label="${escapeAttribute(item.file.name)} 삭제"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}
        </div>
      </div>`;
  }).join("");
}

function renderDownloadList() {
  el.downloadList.innerHTML = state.batches.map((batch, index) => `
    <div class="download-row">
      <div>
        <strong>${escapeHtml(batchFileName(index))}</strong>
        <span>${batch.items.length}개 파일 · 약 ${formatBytes(batch.totalSize)}${batch.imageCount ? ` · 사진 ${batch.imageCount}장` : ""}</span>
      </div>
      <button class="download-button" type="button" data-download-batch="${index}" ${batch.generating ? "disabled" : ""}>${batch.generating ? "ZIP 생성 중" : "다운로드"}</button>
    </div>`).join("");
  el.downloadAllButton.textContent = state.batches.length > 1 ? `전체 ZIP ${state.batches.length}개 다운로드` : "전체 ZIP 다운로드";
}

function updatePresetCards() {
  document.querySelectorAll(".preset-card").forEach((card) => {
    const radio = card.querySelector('input[type="radio"]');
    card.classList.toggle("selected", Boolean(radio?.checked));
  });
}

function getSettings() {
  const imagePresetName = document.querySelector('input[name="imagePreset"]:checked')?.value || "balanced";
  const videoPresetName = document.querySelector('input[name="videoPreset"]:checked')?.value || "balanced";
  const imagePreset = imagePresetName === "custom"
    ? { ...IMAGE_PRESETS.balanced, targetKb: clamp(Number(el.customImageKb.value) || 300, 50, 2000) }
    : { ...IMAGE_PRESETS[imagePresetName] };
  return { image: imagePreset, video: { ...VIDEO_PRESETS[videoPresetName] } };
}

function updateOverallProgress(completed, total, currentName) {
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  el.overallProgressBar.style.width = `${percent}%`;
  el.overallProgressPercent.textContent = `${percent}%`;
  el.overallProgressText.textContent = completed >= total ? "모든 파일 처리 완료" : `${completed + 1}/${total} · ${currentName}`;
}

function resetProgress() {
  el.overallProgressWrap.classList.add("hidden");
  el.overallProgressBar.style.width = "0%";
  el.overallProgressPercent.textContent = "0%";
  el.overallProgressText.textContent = "준비 중";
}

function showSelectionNotice(message) {
  el.selectionNotice.textContent = message;
  el.selectionNotice.classList.toggle("hidden", !message);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add("show");
  state.toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2600);
}

function fitWithin(width, height, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}

function fitWithinEven(width, height, maxWidth, maxHeight) {
  const fitted = fitWithin(width || maxWidth, height || maxHeight, maxWidth, maxHeight);
  return {
    width: Math.max(2, Math.round(fitted.width / 2) * 2),
    height: Math.max(2, Math.round(fitted.height / 2) * 2),
  };
}

function getMaxDimensionPreset() {
  return true;
}

function getExtension(name) {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function imageMimeFromExtension(ext) {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function videoMimeFromExtension(ext) {
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "avi") return "video/x-msvideo";
  return "video/mp4";
}

function humanizeError(error, kind) {
  const message = error?.message || String(error || "알 수 없는 오류");
  if (/memory|abort|out of bounds/i.test(message)) return "기기 메모리가 부족합니다.";
  if (/engine|모듈|fetch|network/i.test(message)) return "압축 엔진 연결 실패";
  if (/codec|encoder|decoder|Invalid data/i.test(message)) return "지원하지 않는 코덱";
  return kind === "video" ? "동영상 압축 실패" : "사진 압축 실패";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sanitizeZipBaseName(value) {
  return String(value || "")
    .replace(/\.zip$/i, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function createId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
}
