import './image-generation.css';
import { scrollToBottom } from './chat-scroll.js';

const IMAGE_PROMPT_INSTRUCTION = 'Translate and expand this image description into a detailed, photorealistic English image generation prompt. Return ONLY the English prompt without quotes or explanations.';
const IMAGE_SERVICE = 'https://image.pollinations.ai/prompt/';
const IMAGE_REQUEST_PATTERN = /(?:ارسم|ارسملي|ارسم لي|صمم صورة|صورة(?: لي)?|ولد صورة|أنشئ صورة|انشئ صورة|توليد صورة|generate\s+(?:an?\s+)?image|create\s+(?:an?\s+)?image|draw\s+(?:me\s+)?(?:an?\s+)?(?:image|picture))/i;
const IMAGE_SELECTOR = '.generated-image-card img';
const COMPOSER_SELECTOR = '.message-composer';
const IMAGE_MODE_SELECTOR = '.image-mode-button[aria-pressed="true"]';

const pendingRequests = [];
const observedImages = new WeakSet();

function isImageRequest(form, prompt) {
  return Boolean(form.querySelector(IMAGE_MODE_SELECTOR) || IMAGE_REQUEST_PATTERN.test(prompt));
}

async function enhancePrompt(prompt) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      systemInstruction: IMAGE_PROMPT_INSTRUCTION
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Prompt enhancement failed (HTTP ${response.status}).`);
  if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Gemini returned an empty image prompt.');
  return data.reply.trim().replace(/^['"“”]+|['"“”]+$/g, '');
}

function fluxImageUrl(prompt) {
  return `${IMAGE_SERVICE}${encodeURIComponent(prompt)}?model=flux&width=1024&height=1024&nologo=true`;
}

function setStatus(card, text, state = 'loading') {
  let status = card.querySelector('.image-generation-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'image-generation-status';
    status.setAttribute('role', 'status');
    card.prepend(status);
  }
  status.dataset.state = state;
  status.textContent = text;
  return status;
}

function applyEnhancedPrompt(image, request) {
  const card = image.closest('.generated-image-card');
  if (!card || image.dataset.fluxEnhancementStarted) return;
  image.dataset.fluxEnhancementStarted = 'true';
  const originalUrl = image.currentSrc || image.src;
  image.dataset.originalImageUrl = originalUrl;
  image.classList.add('image-generation-pending');
  setStatus(card, 'جاري رسم الصورة...');

  request.promptPromise.then((englishPrompt) => {
    image.dataset.englishPrompt = englishPrompt;
    image.dataset.fluxImageUrl = fluxImageUrl(englishPrompt);
    image.src = image.dataset.fluxImageUrl;
  }).catch(() => {
    setStatus(card, 'تعذر تحسين الوصف؛ جاري تحميل الصورة الأصلية…');
    image.dataset.imageGenerationFallback = 'true';
    image.src = originalUrl;
  });
}

function finishImageLoad(image) {
  if (!image.dataset.fluxEnhancementStarted) return;
  image.classList.remove('image-generation-pending');
  image.classList.add('image-generation-ready');
  const status = image.closest('.generated-image-card')?.querySelector('.image-generation-status');
  if (status) status.remove();
  scrollToBottom();
}

function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches(COMPOSER_SELECTOR)) return;
  const input = form.querySelector('.message-input');
  const prompt = input?.value.trim() || '';
  if (!prompt || !isImageRequest(form, prompt)) return;

  // Start enhancement immediately; pair its result with the image card React renders for this send.
  pendingRequests.push({ promptPromise: enhancePrompt(prompt) });
}

function handleImageLoad(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.matches(IMAGE_SELECTOR)) return;
  if (image.dataset.fluxEnhancementStarted) {
    finishImageLoad(image);
    return;
  }

  const request = pendingRequests.shift();
  if (request) {
    observedImages.add(image);
    applyEnhancedPrompt(image, request);
  }
}

function observeRenderedImages() {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const images = [];
        if (node.matches?.(IMAGE_SELECTOR)) images.push(node);
        images.push(...node.querySelectorAll(IMAGE_SELECTOR));
        for (const image of images) {
          if (observedImages.has(image)) continue;
          const request = pendingRequests.shift();
          if (!request) continue;
          observedImages.add(image);
          applyEnhancedPrompt(image, request);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function downloadGeneratedImage(button) {
  const card = button.closest('.generated-image-card');
  const image = card?.querySelector('img');
  const url = image?.dataset.fluxImageUrl || image?.currentSrc || image?.src;
  if (!url) return;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Image download failed.');
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'zaka-plus-flux-image.jpg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function handleDownloadClick(event) {
  const button = event.target.closest?.('.generated-image-card .message-action');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  downloadGeneratedImage(button);
}

document.addEventListener('submit', handleSubmit, true);
document.addEventListener('load', handleImageLoad, true);
document.addEventListener('click', handleDownloadClick, true);
observeRenderedImages();
