const form = document.querySelector("#review-form");
const statusEl = document.querySelector("#status");
const verdictEl = document.querySelector("#verdict");
const confidenceEl = document.querySelector("#confidence");
const refAiDecisionEl = document.querySelector("#ref-ai-decision");
const aiUsedEl = document.querySelector("#ai-used");
const reportIdEl = document.querySelector("#report-id");
const playObservationEl = document.querySelector("#play-observation");
const reasoningEl = document.querySelector("#reasoning");
const rulesEl = document.querySelector("#rules");
const clipInput = document.querySelector('input[name="clip"]');
const clipPreview = document.querySelector("#clip-preview");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function renderRules(rules = []) {
  rulesEl.innerHTML = "";

  if (!rules.length) {
    rulesEl.textContent = "No matching rule chunks returned.";
    return;
  }

  for (const rule of rules) {
    const card = document.createElement("article");
    card.className = "rule-card";
    card.innerHTML = `
      <h3>Law ${rule.law_number} - ${rule.law_title}: ${rule.section}</h3>
      <p></p>
      <a href="${rule.source}" target="_blank" rel="noreferrer">Official IFAB source</a>
    `;
    card.querySelector("p").textContent = rule.text;
    rulesEl.append(card);
  }
}

function loadVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not read that video file."));
  });
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Could not sample the video.")), 5000);
    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.currentTime = time;
  });
}

async function sampleVideoFrames(file, frameCount = 6) {
  if (!file) return [];

  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  const metadataReady = loadVideoMetadata(video);
  video.src = url;

  try {
    await metadataReady;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const canvas = document.createElement("canvas");
    const width = 640;
    const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width) || 360);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const frames = [];

    for (let index = 0; index < frameCount; index += 1) {
      const time = Math.min(duration - 0.05, (duration * (index + 1)) / (frameCount + 1));
      await seekVideo(video, Math.max(0, time));
      context.drawImage(video, 0, 0, width, height);
      frames.push(canvas.toDataURL("image/jpeg", 0.72));
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

clipInput.addEventListener("change", () => {
  const file = clipInput.files?.[0];
  if (!file) {
    clipPreview.hidden = true;
    clipPreview.removeAttribute("src");
    return;
  }

  clipPreview.src = URL.createObjectURL(file);
  clipPreview.hidden = false;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector("button");
  const formData = new FormData(form);
  const file = clipInput.files?.[0];
  const payload = {
    sport: formData.get("sport"),
    original_call: formData.get("original_call"),
    play_description: formData.get("play_description"),
    clip: file
      ? {
          name: file.name,
          type: file.type,
          size: file.size
        }
      : null,
    frame_data_urls: []
  };

  submitButton.disabled = true;
  setStatus(file ? "Sampling clip frames..." : "Checking IFAB Laws from reviewer notes...");

  try {
    payload.frame_data_urls = await sampleVideoFrames(file);

    if (file && payload.frame_data_urls.length === 0) {
      throw new Error("No video frames were sampled. Try a shorter MP4 clip.");
    }
    
    setStatus(`Creating RefCheck report with ${payload.frame_data_urls.length} sampled frames...`);

    const response = await fetch("/api/analyze-clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const report = await response.json();
    if (!response.ok) throw new Error(report.error || "Analysis failed.");
    const result = report.analysis;

    verdictEl.textContent = result.verdict;
    confidenceEl.textContent = result.confidence;
    refAiDecisionEl.textContent = result.ref_ai_decision || "Inconclusive";
    aiUsedEl.textContent = result.ai_used ? "Vision model" : "Rule fallback";
    reportIdEl.textContent = report.id;
    playObservationEl.textContent = result.play_observation || "No separate play observation returned.";
    reasoningEl.textContent = result.reasoning;
    renderRules(result.relevant_rules);
    setStatus(result.warning || "Report created.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});
