const SCROLLABLE_CHAT_SELECTOR = '.conversation-area';
const MESSAGE_FORM_SELECTOR = '.message-composer';
const GENERATED_IMAGE_SELECTOR = '.generated-image-card img';

export function scrollToBottom() {
  const chat = document.querySelector(SCROLLABLE_CHAT_SELECTOR);
  if (!chat) return;

  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

export function enableChatAutoScroll() {
  const scheduleScroll = () => {
    // Wait for React to commit the newly submitted message or image to the DOM.
    requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
  };

  const handleSubmit = (event) => {
    if (event.target instanceof Element && event.target.matches(MESSAGE_FORM_SELECTOR)) {
      scheduleScroll();
    }
  };

  const handleImageLoad = (event) => {
    if (event.target instanceof HTMLImageElement && event.target.matches(GENERATED_IMAGE_SELECTOR)) {
      scheduleScroll();
    }
  };

  document.addEventListener('submit', handleSubmit, true);
  document.addEventListener('load', handleImageLoad, true);

  return () => {
    document.removeEventListener('submit', handleSubmit, true);
    document.removeEventListener('load', handleImageLoad, true);
  };
}
