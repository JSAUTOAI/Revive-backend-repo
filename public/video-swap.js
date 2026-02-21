/**
 * Video Swap Script - Replaces Pexels stock video with custom video
 *
 * Usage: Add to Aura page:
 * <script src="https://revive-backend-repo-production.up.railway.app/video-swap.js"
 *         data-video-url="YOUR_CLOUDINARY_VIDEO_URL_HERE"></script>
 */
(function () {
  'use strict';

  // Get video URL from script tag's data attribute
  var scriptEl = document.currentScript;
  var videoUrl = scriptEl && scriptEl.getAttribute('data-video-url');

  if (!videoUrl) {
    console.warn('[VideoSwap] No data-video-url attribute found on script tag');
    return;
  }

  function swapVideo() {
    // Find all video source elements
    var sources = document.querySelectorAll('video source');
    var swapped = false;

    sources.forEach(function (source) {
      // Only swap the Pexels stock video
      if (source.src && source.src.indexOf('pexels.com') !== -1) {
        var video = source.parentElement;
        source.src = videoUrl;
        video.load();
        swapped = true;
      }
    });

    if (!swapped) {
      // Fallback: try to find any video in the hero grid section
      var heroVideo = document.querySelector('.grid video');
      if (heroVideo) {
        var heroSource = heroVideo.querySelector('source');
        if (heroSource) {
          heroSource.src = videoUrl;
          heroVideo.load();
          swapped = true;
        }
      }
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', swapVideo);
  } else {
    swapVideo();
  }
})();
