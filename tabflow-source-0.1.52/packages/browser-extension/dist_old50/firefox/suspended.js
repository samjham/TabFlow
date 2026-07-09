(function() {
  const params = new URLSearchParams(window.location.search);
  const realUrl = params.get('url') || '';
  const pageTitle = params.get('title') || 'Suspended Tab';
  const faviconUrl = params.get('favicon') || '';

  // Set the document title (shows in Chrome's tab bar)
  document.title = pageTitle;

  // Set favicon in the tab bar
  if (faviconUrl) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    document.head.appendChild(link);

    const faviconEl = document.getElementById('favicon');
    if (faviconEl) {
      faviconEl.src = faviconUrl;
      faviconEl.style.display = 'block';
      faviconEl.onerror = function() { this.style.display = 'none'; };
    }
  }

  // Display info
  const titleEl = document.getElementById('title');
  const urlEl = document.getElementById('url');
  if (titleEl) titleEl.textContent = pageTitle;
  if (urlEl) urlEl.textContent = realUrl;

  // Click to navigate to real URL
  const clickArea = document.getElementById('clickArea');
  if (clickArea) {
    clickArea.addEventListener('click', function() {
      if (realUrl) {
        window.location.href = realUrl;
      }
    });
  }
})();
